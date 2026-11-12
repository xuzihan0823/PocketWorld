"""Transfer donor Hair_/Dress_ bind bones and weights; retain target motion bytes.

Run with Blender --background --factory-startup --python transfer.py --
  --target animated.glb --donor previous.glb --output output.glb --report report.json
"""
import argparse
import copy
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix
from mathutils.kdtree import KDTree


class GLB:
    def __init__(self, path):
        self.raw = Path(path).read_bytes()
        magic, version, length = struct.unpack_from('<III', self.raw)
        assert magic == 0x46546C67 and version == 2 and length == len(self.raw)
        size, kind = struct.unpack_from('<II', self.raw, 12)
        assert kind == 0x4E4F534A
        self.doc = json.loads(self.raw[20:20 + size])
        count, kind = struct.unpack_from('<II', self.raw, 20 + size)
        assert kind == 0x004E4942
        self.binary = bytearray(self.raw[28 + size:28 + size + count])

    def array(self, index):
        a = self.doc['accessors'][index]
        assert 'sparse' not in a
        v = self.doc['bufferViews'][a['bufferView']]
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        offset = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        unit = np.dtype(dtype).itemsize
        return np.ndarray((a['count'], width), dtype=dtype, buffer=self.binary,
                          offset=offset, strides=(v.get('byteStride', unit * width), unit)).copy()

    def append(self, values, kind, component):
        while len(self.binary) % 4:
            self.binary.append(0)
        raw = values.astype({5123: '<u2', 5126: '<f4'}[component]).tobytes()
        view = len(self.doc['bufferViews'])
        self.doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.binary), 'byteLength': len(raw)})
        self.binary.extend(raw)
        index = len(self.doc['accessors'])
        self.doc['accessors'].append({'bufferView': view, 'componentType': component,
                                     'count': len(values), 'type': kind})
        return index

    def save(self, path):
        self.doc['buffers'][0]['byteLength'] = len(self.binary)
        raw = json.dumps(self.doc, ensure_ascii=False, separators=(',', ':')).encode()
        raw += b' ' * (-len(raw) % 4)
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        total = 12 + 8 + len(raw) + 8 + len(self.binary)
        Path(path).write_bytes(struct.pack('<IIIII', 0x46546C67, 2, total, len(raw), 0x4E4F534A)
                               + raw + struct.pack('<II', len(self.binary), 0x004E4942) + self.binary)


def main():
    parser = argparse.ArgumentParser()
    for key in ('target', 'donor', 'output', 'report'):
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    target, donor = GLB(args.target), GLB(args.donor)
    original_doc = copy.deepcopy(target.doc)
    original_binary = bytes(target.binary)
    tskin, dskin = target.doc['skins'][0], donor.doc['skins'][0]
    tnames = [target.doc['nodes'][i]['name'] for i in tskin['joints']]
    dnames = [donor.doc['nodes'][i]['name'] for i in dskin['joints']]
    tmats, dmats = target.array(tskin['inverseBindMatrices']), donor.array(dskin['inverseBindMatrices'])
    extras = [n for n in dnames if n.startswith(('Hair_', 'Dress_'))]
    assert len(extras) == 50 and len(tnames) == 65
    common_error = max(float(np.max(np.abs(tmats[tnames.index(n)] - dmats[dnames.index(n)])))
                       for n in dnames if n in tnames)
    # Same character, but importer/exporter rest transforms can have float noise.
    assert common_error < 0.0001, f'Different bind rigs: {common_error}; retargeting required'
    parent = {child: i for i, n in enumerate(donor.doc['nodes']) for child in n.get('children', [])}
    node_by_name = {n['name']: i for i, n in enumerate(target.doc['nodes']) if 'name' in n}
    bind = {n: Matrix(dmats[i].reshape(4, 4).T.tolist()).inverted() for i, n in enumerate(dnames)}
    tbind = {n: Matrix(tmats[i].reshape(4, 4).T.tolist()).inverted() for i, n in enumerate(tnames)}
    for n in extras:
        node_by_name[n] = len(target.doc['nodes'])
        target.doc['nodes'].append({'name': n})
    for n in extras:
        source_index = dskin['joints'][dnames.index(n)]
        parent_name = donor.doc['nodes'][parent[source_index]]['name']
        parent_bind = tbind[parent_name] if parent_name in tbind else bind[parent_name]
        local = parent_bind.inverted() @ bind[n]
        pos, rot, scale = local.decompose()
        node = target.doc['nodes'][node_by_name[n]]
        node.update(translation=list(pos), rotation=[rot.x, rot.y, rot.z, rot.w], scale=list(scale))
        node['extras'] = copy.deepcopy(donor.doc['nodes'][source_index].get('extras', {}))
        target.doc['nodes'][node_by_name[parent_name]].setdefault('children', []).append(node_by_name[n])
    tskin['joints'].extend(node_by_name[n] for n in extras)
    tskin['inverseBindMatrices'] = target.append(np.concatenate([tmats, dmats[[dnames.index(n) for n in extras]]]), 'MAT4', 5126)
    names = tnames + extras
    tp = target.doc['meshes'][0]['primitives'][0]
    dp = donor.doc['meshes'][0]['primitives'][0]
    ta, da = tp['attributes'], dp['attributes']
    positions, dpositions = target.array(ta['POSITION']), donor.array(da['POSITION'])
    uv, duv = target.array(ta['TEXCOORD_0']), donor.array(da['TEXCOORD_0'])
    joints, weights = target.array(ta['JOINTS_0']), target.array(ta['WEIGHTS_0'])
    dj, dw = donor.array(da['JOINTS_0']), donor.array(da['WEIGHTS_0'])
    tree = KDTree(len(dpositions))
    for i, p in enumerate(dpositions):
        tree.insert(p, i)
    tree.balance()
    changed, hair_count, dress_count, max_distance = [], 0, 0, 0
    for i, p in enumerate(positions):
        matches = tree.find_range(p, 0.000002)
        assert matches, f'No coincident donor vertex for {i}'
        _, source, distance = min(matches, key=lambda hit: float(np.linalg.norm(duv[hit[1]] - uv[i])))
        max_distance = max(max_distance, distance)
        row = [(dnames[int(k)], float(w)) for k, w in zip(dj[source], dw[source]) if w > 1e-7]
        if not any(n.startswith(('Hair_', 'Dress_')) for n, w in row):
            continue
        assert all(n in names for n, _ in row)
        joints[i] = 0
        weights[i] = 0
        for slot, (n, w) in enumerate(row):
            joints[i, slot], weights[i, slot] = names.index(n), w
        weights[i] /= weights[i].sum()
        changed.append(i)
        hair_count += any(n.startswith('Hair_') for n, _ in row)
        dress_count += any(n.startswith('Dress_') for n, _ in row)
    ta['JOINTS_0'] = target.append(joints, 'VEC4', 5123)
    ta['WEIGHTS_0'] = target.append(weights, 'VEC4', 5126)
    assert np.isfinite(weights).all() and np.max(np.abs(weights.sum(1) - 1)) < 1e-5
    assert target.doc['animations'] == original_doc['animations']
    assert bytes(target.binary[:len(original_binary)]) == original_binary
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    target.save(args.output)
    report = dict(target_sha256=hashlib.sha256(target.raw).hexdigest(),
                  donor_sha256=hashlib.sha256(donor.raw).hexdigest(),
                  output_sha256=hashlib.sha256(Path(args.output).read_bytes()).hexdigest(),
                  original_bones=len(tnames), transferred_bones=extras, final_bones=len(names),
                  common_inverse_bind_max_error=common_error,
                  vertex_match_max_distance=max_distance, reweighted_vertices=len(changed),
                  hair_vertices=hair_count, dress_vertices=dress_count,
                  original_animation_bytes_preserved=True, original_geometry_and_textures_preserved=True,
                  output_bytes=Path(args.output).stat().st_size,
                  max_weight_sum_error=float(np.max(np.abs(weights.sum(1)-1))),
                  limitations=['Original clip loop discontinuity retained; motion polish is a separate step.',
                               'No legacy animation, morph corrective, or runtime physics is transferred.'])
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(args.output).resolve()))
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 119
    bpy.context.scene.render.fps = 24
    bpy.context.scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.report).with_suffix('.blend').resolve()))
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
