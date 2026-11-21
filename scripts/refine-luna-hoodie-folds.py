"""Blender pass for the fitted hoodie's shoulder morphs, preserving runtime GLB indices.

blender --background --factory-startup --python-exit-code 1 \
  --python scripts/refine-luna-hoodie-folds.py -- fitted.glb refined.glb [review.blend]
"""
import json
import os
import struct
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import numpy as np


def write_glb(path, doc, binary):
    doc['buffers'][0]['byteLength'] = len(binary)
    text = json.dumps(doc, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    text += b' ' * (-len(text) % 4)
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(text) + len(binary), len(text), 0x4E4F534A)
                     + text + struct.pack('<II', len(binary), 0x004E4942) + binary)


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)


def refine(source, output, review=None):
    raw = source.read_bytes()
    magic, version, length, json_size, chunk = struct.unpack_from('<4sIIII', raw)
    assert (magic, version, length, chunk) == (b'glTF', 2, len(raw), 0x4E4F534A)
    doc = json.loads(raw[20:20 + json_size])
    binary = bytearray(raw[28 + json_size:])
    mesh, = doc['meshes']
    primitive, = mesh['primitives']
    attributes = primitive['attributes']
    names = mesh['extras']['targetNames']
    assert mesh['extras']['hoodieClearance'] and len(names) == len(primitive['targets'])
    assert len(doc['buffers']) == 1 and all('NORMAL' not in target for target in primitive['targets'])

    def read(index):
        a = doc['accessors'][index]
        dim = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dtype = {5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        if 'bufferView' in a:
            v = doc['bufferViews'][a['bufferView']]
            assert v['buffer'] == 0 and 'byteStride' not in v
            offset = v.get('byteOffset', 0) + a.get('byteOffset', 0)
            data = np.frombuffer(bytes(binary), dtype, a['count'] * dim, offset).copy().reshape(-1, dim)
        else:
            data = np.zeros((a['count'], dim), dtype)
        if 'sparse' in a:
            sparse = a['sparse']
            idx, values = sparse['indices'], sparse['values']
            assert idx['componentType'] == 5123
            i = np.frombuffer(bytes(binary), '<u2', sparse['count'], doc['bufferViews'][idx['bufferView']].get('byteOffset', 0) + idx.get('byteOffset', 0))
            data[i] = np.frombuffer(bytes(binary), dtype, sparse['count'] * dim, doc['bufferViews'][values['bufferView']].get('byteOffset', 0) + values.get('byteOffset', 0)).reshape(-1, dim)
        return data

    def add_view(data):
        index = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary.extend(data)
        binary.extend(b'\0' * (-len(binary) % 4))
        return index

    def add_target(values, epsilon, bounds=False):
        values = np.asarray(values, dtype='<f4')
        ids = np.flatnonzero(np.linalg.norm(values, axis=1) >= epsilon)
        index = len(doc['accessors'])
        a = {'componentType': 5126, 'count': len(values), 'type': 'VEC3'}
        if len(ids):
            a['sparse'] = {'count': len(ids),
                           'indices': {'bufferView': add_view(ids.astype('<u2').tobytes()), 'componentType': 5123},
                           'values': {'bufferView': add_view(values[ids].tobytes())}}
        if bounds:
            a['min'] = np.minimum(0, values[ids].min(axis=0)).tolist()
            a['max'] = np.maximum(0, values[ids].max(axis=0)).tolist()
        doc['accessors'].append(a)
        return index

    base = read(attributes['POSITION'])
    original_normals = read(attributes['NORMAL'])
    tri = read(primitive['indices']).reshape(-1, 3)
    joints, weights = (read(attributes[key]) for key in ('JOINTS_0', 'WEIGHTS_0'))
    bone_names = [doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
    cloth_bones = np.array([name.endswith(('Arm', 'Shoulder', 'Spine', 'Spine1', 'Spine2', 'Hips')) for name in bone_names])
    assert len(base) <= 65535
    cloth = (cloth_bones[joints] * weights).sum(axis=1)
    x, height = np.abs(base[:, 0]), base[:, 1]
    mask = (smooth(.045, .076, x) * (1 - smooth(.158, .215, x))
            * smooth(.560, .617, height) * (1 - smooth(.744, .791, height)) * smooth(.88, .98, cloth))
    assert np.any(mask > .5)

    # Work in Blender's Z-up coordinates. Weld only for neighborhood and normal evaluation, not export.
    to_blender = lambda v: np.column_stack((v[:, 0], -v[:, 2], v[:, 1]))
    to_gltf = lambda v: np.column_stack((v[:, 0], v[:, 2], -v[:, 1]))
    base_xyz = to_blender(base)
    welded, first, at = np.unique(base_xyz, axis=0, return_index=True, return_inverse=True)
    welded_tri = at[tri]
    welded_tri = welded_tri[(welded_tri[:, 0] != welded_tri[:, 1]) & (welded_tri[:, 1] != welded_tri[:, 2]) & (welded_tri[:, 2] != welded_tri[:, 0])]
    links = np.unique(np.concatenate([welded_tri[:, [0, 1]], welded_tri[:, [0, 2]], welded_tri[:, [1, 2]]]).reshape(-1, 2), axis=0)
    links = np.unique(np.sort(links, axis=1), axis=0)
    a, b = np.r_[links[:, 0], links[:, 1]], np.r_[links[:, 1], links[:, 0]]
    amount = 1 / np.maximum(.0015, np.linalg.norm(welded[a] - welded[b], axis=1))
    total = np.maximum(np.bincount(a, amount, minlength=len(welded)), 1e-9)
    local_mask = mask[first]
    normals_mesh = bpy.data.meshes.new('Working welded shoulder normals')
    normals_mesh.from_pydata(welded.tolist(), [], welded_tri.tolist())

    def normals(coords):
        normals_mesh.vertices.foreach_set('co', np.ascontiguousarray(coords, dtype=np.float32).ravel())
        normals_mesh.update()
        out = np.empty((len(welded), 3), dtype=np.float32)
        normals_mesh.vertices.foreach_get('normal', out.ravel())
        return unit(out[at])

    rest_normals = normals(welded)
    with TemporaryDirectory(dir=os.environ.get('PI_SCRATCH_DIR')) as temp:
        stage = Path(temp) / 'mesh.glb'
        stage_doc = json.loads(json.dumps(doc))
        stage_doc.pop('animations', None)
        vertex_ids = np.arange(len(base), dtype='<f4').tobytes()
        view = len(stage_doc['bufferViews'])
        stage_doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(vertex_ids)})
        stage_attrs = stage_doc['meshes'][0]['primitives'][0]['attributes']
        stage_attrs['_SOURCE_VERTEX'] = len(stage_doc['accessors'])
        stage_doc['accessors'].append({'bufferView': view, 'componentType': 5126, 'count': len(base), 'type': 'SCALAR'})
        write_glb(stage, stage_doc, bytes(binary) + vertex_ids)
        bpy.ops.import_scene.gltf(filepath=str(stage), merge_vertices=False, import_pack_images=True)
    surface = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.vertices) == len(base))
    blocks = surface.data.shape_keys.key_blocks
    assert list(blocks.keys())[1:] == names
    source_vertex = surface.data.attributes['_SOURCE_VERTEX']
    ids = np.empty(len(base), dtype=np.float32)
    source_vertex.data.foreach_get('value', ids)
    blender_to_gltf = ids.astype(np.intp)
    gltf_to_blender = np.argsort(blender_to_gltf)
    assert np.array_equal(blender_to_gltf[gltf_to_blender], np.arange(len(base)))
    surface.data.attributes.remove(source_vertex)
    imported = np.empty_like(base_xyz)
    blocks[0].data.foreach_get('co', imported.ravel())
    assert np.allclose(imported[gltf_to_blender], base_xyz, atol=1e-6, rtol=0), 'Blender vertex mapping changed'
    source_normals = to_blender(original_normals)
    stats = {}
    for name, target in zip(names, primitive['targets']):
        before_delta = read(target['POSITION'])
        block = blocks[name]
        block.data.foreach_get('co', imported.ravel())
        before = imported[gltf_to_blender]
        assert np.allclose(before, base_xyz + to_blender(before_delta), atol=1e-6, rtol=0), name
        deformed = before.copy()
        if name.startswith('HoodieStretch_') and 430 <= int(name.rsplit('_', 1)[1]) <= 685:
            delta = to_blender(before_delta)[first]
            avg = np.column_stack([np.bincount(a, amount * delta[b, axis], minlength=len(welded)) / total for axis in range(3)])
            correction = (avg - delta) * (.38 * local_mask[:, None])
            size = np.linalg.norm(correction, axis=1, keepdims=True)
            correction *= np.minimum(1, .0016 / np.maximum(size, 1e-9))
            correction[size[:, 0] < .000035] = 0
            deformed += correction[at]
            block.data.foreach_set('co', np.ascontiguousarray(deformed[blender_to_gltf]).ravel())
            block.data.foreach_get('co', imported.ravel())
            deformed = imported[gltf_to_blender]
            axis_delta = before_delta + to_gltf(deformed - before)
            target['POSITION'] = add_target(axis_delta, 1e-9, bounds=True)
        # Rotate the original split normals by the local shape's normal change, rather than replacing face/UV normals.
        shape = normals((base_xyz + to_blender(before_delta) + deformed - before)[first])
        cross = np.cross(rest_normals, shape)
        dot = (rest_normals * shape).sum(axis=1, keepdims=True)
        twist = np.cross(cross, source_normals)
        rotated = source_normals + twist + np.cross(cross, twist) / np.maximum(1 + dot, .1)
        amount_normal = .7 * mask[:, None] * smooth(.0004, .003, np.linalg.norm(deformed - base_xyz, axis=1))[:, None]
        normal_delta = (unit(rotated) - source_normals) * amount_normal
        length_normal = np.linalg.norm(normal_delta, axis=1, keepdims=True)
        normal_delta *= np.minimum(1, .30 / np.maximum(length_normal, 1e-9))
        target['NORMAL'] = add_target(to_gltf(normal_delta), .022)
        stats[name] = {'max_position_change_mm': round(1000 * float(np.linalg.norm(deformed - before, axis=1).max()), 3),
                       'normal_vertices': doc['accessors'][target['NORMAL']].get('sparse', {}).get('count', 0)}
    bpy.data.meshes.remove(normals_mesh)
    if review:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(review.resolve()))
    write_glb(output, doc, binary)
    return stats


if __name__ == '__main__':
    values = sys.argv[sys.argv.index('--') + 1:]
    assert len(values) in (2, 3), __doc__
    print(json.dumps(refine(*(Path(value) for value in values))))
