"""Blender pass for the fitted hoodie's shoulder morphs, preserving runtime GLB indices.

blender --background --factory-startup --python-exit-code 1 \
  --python scripts/refine-luna-hoodie-folds.py -- fitted.glb refined.glb pose-data.json [review.blend]
"""
import json
import os
import struct
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import numpy as np
from mathutils import Matrix


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


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def qmul(a, b):
    aw, av = a[..., :1], a[..., 1:]
    bw, bv = b[..., :1], b[..., 1:]
    return np.concatenate((aw * bw - np.sum(av * bv, axis=-1, keepdims=True), aw * bv + bw * av + np.cross(av, bv)), axis=-1)


def qconj(q):
    return q * np.array([1, -1, -1, -1])


def sleeve_volume(matrices, base, previous, indices, weights, names, triangles, joints, unfitted):
    """Return the bind-space offset that reproduces the relaxed posed surface with linear skinning."""
    all_linear = matrices[:, :3, :3]
    all_translate = matrices[:, :3, 3]
    rotation = np.array([tuple(Matrix(r.tolist()).to_quaternion().normalized()) for r in all_linear])
    dual = .5 * qmul(np.c_[np.zeros(len(rotation)), all_translate], rotation)
    real = rotation[indices]
    signs = np.where((real * real[:, :1, :]).sum(axis=-1) < 0, -1., 1.)
    weighted = weights * signs
    product = (real * weighted[:, :, None]).sum(axis=1)
    total = np.linalg.norm(product, axis=1, keepdims=True)
    product /= np.maximum(total, 1e-9)
    dual = (dual[indices] * weighted[:, :, None]).sum(axis=1) / np.maximum(total, 1e-9)
    blend = (all_linear[indices] * weights[:, :, None, None]).sum(axis=1)
    translation = (all_translate[indices] * weights[:, :, None]).sum(axis=1)
    transform = lambda points: np.einsum('nij,nj->ni', blend, points) + translation
    original = transform(base + previous)
    rigid = qmul(qmul(product, np.c_[np.zeros(len(base)), base]), qconj(product))[:, 1:]
    rigid += 2 * qmul(dual, qconj(product))[:, 1:]
    is_arm = np.array([n.endswith(('Arm', 'Shoulder')) and ('Left' in n or 'Right' in n) for n in names])
    is_body = np.array([n.endswith(('Spine', 'Spine1', 'Spine2', 'Hips')) for n in names])
    arm = (is_arm[indices] * weights).sum(axis=1)
    cloth = ((is_arm | is_body)[indices] * weights).sum(axis=1)
    x, y = np.abs(base[:, 0]), base[:, 1]
    mask = smooth(.894, .995, cloth) * smooth(.044, .085, x) * smooth(.443, .50, y) * (1 - smooth(.745, .805, y))
    # Keep fullness around the elbow instead of letting a weighted matrix flatten it.
    rotation_mix = .88 * mask * smooth(.14, .56, arm)
    wanted = original + (rigid - transform(base)) * rotation_mix[:, None]
    body = np.array([next(i for i, n in enumerate(names) if n.endswith(body_name))
                     for body_name in ('Spine', 'Spine1', 'Spine2')])
    body_w = np.column_stack((1 - smooth(.55, .65, y), smooth(.55, .65, y) * (1 - smooth(.64, .73, y)),
                              smooth(.55, .65, y) * smooth(.64, .73, y)))
    body_p = (np.einsum('kij,nj->nki', all_linear[body], base) + all_translate[body])
    torso_pin = mask * smooth(.02, .14, arm) * (1 - smooth(.14, .53, arm)) * (1 - smooth(.625, .695, y))
    wanted += ((body_p * body_w[:, :, None]).sum(axis=1) - wanted) * (torso_pin * .82)[:, None]
    for side, sign in (('Left', 1), ('Right', -1)):
        upper, elbow = [next(i for i, name in enumerate(names) if name.endswith(side + bone))
                        for bone in ('Arm', 'ForeArm')]
        shoulder = all_linear[upper] @ joints[upper] + all_translate[upper]
        end = all_linear[upper] @ joints[elbow] + all_translate[upper]
        axis = unit((end - shoulder)[None, :])[0]
        activated = smooth(-.26, .42, axis[1])
        contact = ((base[:, 0] * sign > 0) * mask * smooth(.20, .56, arm)
                   * (1 - smooth(.66, .745, y)))
        along = (wanted - shoulder) @ axis
        radial = wanted - (shoulder + np.maximum(along, .012)[:, None] * axis)
        length = np.linalg.norm(radial, axis=1)
        lower = smooth(-.012, .026, -radial[:, 1])
        armhole = contact * smooth(-.045, .015, along) * (1 - smooth(.070, .117, along))
        # Pull the excess underarm gusset onto the sleeve root rather than lifting the sidewall.
        excess = np.maximum(length - .042, 0)
        wanted -= unit(radial) * (excess * armhole * lower * activated * .95)[:, None]
        # The idle fix narrows the flank in the base mesh. Restore its original ease
        # once the arm is raised and no longer needs that clearance.
        restore = np.maximum(0, (unfitted[:, 0] - base[:, 0]) * sign)
        restore *= smooth(.82, .995, cloth) * (1 - smooth(.22, .48, arm)) * (base[:, 0] * sign > 0)
        restore *= smooth(.46, .51, y) * (1 - smooth(.65, .708, y)) * smooth(-.08, .41, axis[1])
        wanted += restore[:, None] * np.array([sign, 0, 0]) * .98
        mask = np.maximum(mask, smooth(.0001, .007, restore))
        wrist = next(i for i, name in enumerate(names) if name.endswith(side + 'Hand'))
        bent_elbow = all_linear[elbow] @ joints[elbow] + all_translate[elbow]
        hand = all_linear[wrist] @ joints[wrist] + all_translate[wrist]
        def along_segment(start, finish):
            segment = finish - start
            u = np.clip((wanted - start) @ segment / (segment @ segment), 0, 1)
            return wanted - (start + u[:, None] * segment)
        upper_radial = along_segment(shoulder, bent_elbow)
        fore_radial = along_segment(bent_elbow, hand)
        radial = np.where(np.linalg.norm(upper_radial, axis=1, keepdims=True) <
                          np.linalg.norm(fore_radial, axis=1, keepdims=True), upper_radial, fore_radial)
        radius = np.linalg.norm(radial, axis=1)
        elbow_panel = ((base[:, 0] * sign > 0) * smooth(.67, .91, arm) * smooth(.086, .134, x)
                       * smooth(.506, .551, y) * (1 - smooth(.648, .692, y)))
        excess = np.maximum(radius - .045, 0)
        wanted -= unit(radial) * (excess * elbow_panel * smooth(.044, .069, radius) * .96)[:, None]
        mask = np.maximum(mask, elbow_panel)

    # The scan fuses a few locks of hair to the shoulder. Let that tiny bridge relax;
    # keep the rest of the hair and the face at their original poses.
    hair_bones = np.array(['Hair_' in name for name in names])
    hair = (hair_bones[indices] * weights).sum(axis=1)
    seams = triangles[(hair[triangles].max(axis=1) > .6) & (cloth[triangles].max(axis=1) > .45)]
    for_hair = np.unique(seams.ravel())
    hair_mask = np.zeros(len(base))
    hair_mask[for_hair] = smooth(.5, .85, hair[for_hair]) * smooth(.07, .11, x[for_hair]) * (1 - smooth(.75, .785, y[for_hair]))
    mask = np.maximum(mask, hair_mask * .55)
    # Weld coincident UV corners only in the solver, never in the shipping mesh.
    _, first, at = np.unique(base, axis=0, return_index=True, return_inverse=True)
    rest = base[first]
    links = at[triangles[:, [[0, 1], [1, 2], [2, 0]]]].reshape(-1, 2)
    links = np.unique(np.sort(links, axis=1), axis=0)
    links = links[links[:, 0] != links[:, 1]]
    a, b = links.T
    l0 = np.linalg.norm(rest[a] - rest[b], axis=1)
    # The source joins a small hair patch to the fleece. Ease the actual stitched
    # edges; spread the offset away from the seam instead of moving each hair lock.
    is_hair, is_cloth = hair[first] > .65, (cloth[first] > .56) & (hair[first] < .25)
    paired = (is_hair[a] & is_cloth[b]) | (is_hair[b] & is_cloth[a])
    paired &= (l0 < .017) & (hair_mask[first][a] + hair_mask[first][b] > .1)
    a_h, b_c = np.where(is_hair[a[paired]], a[paired], b[paired]), np.where(is_cloth[b[paired]], b[paired], a[paired])
    gap = wanted[first][b_c] - wanted[first][a_h]
    gap_length = np.linalg.norm(gap, axis=1, keepdims=True)
    gap *= np.minimum(.042, np.maximum(gap_length - l0[paired, None] * 1.7, 0) * .70) / np.maximum(gap_length, 1e-9)
    force = np.zeros((len(first), 3))
    np.add.at(force, a_h, gap)
    degree = np.bincount(a_h, minlength=len(first))
    force /= np.maximum(degree, 1)[:, None]
    hair_edge = (is_hair[a] & is_hair[b]) & (l0 < .013)
    links_from = np.r_[a[hair_edge], b[hair_edge]]
    links_to = np.r_[b[hair_edge], a[hair_edge]]
    degree_h = np.maximum(np.bincount(links_from, minlength=len(first)), 1)[:, None]
    source = force.copy()
    for _ in range(8):
        values = np.zeros_like(force)
        np.add.at(values, links_from, force[links_to])
        force = .88 * values / degree_h
        force[degree > 0] = source[degree > 0]
    freedom = smooth(.00015, .006, np.linalg.norm(force, axis=1)) * (1 - smooth(.757, .787, rest[:, 1]))
    wanted += (force * freedom[:, None])[at]
    mask = np.maximum(mask, freedom[at] * .75)
    active = (mask[first][a] + mask[first][b] > .015) & (l0 > .0006)
    a, b, l0 = a[active], b[active], l0[active]
    root = original[first]
    target = wanted[first]
    posed = target.copy()
    mobility = mask[first] * (.36 + .64 * smooth(.06, .60, arm[first]))
    total = mobility[a] + mobility[b]
    counts = np.maximum(np.bincount(np.r_[a, b], minlength=len(first)), 1.)[:, None]
    limits = l0[:, None] * 1.22 + .00065
    # Project stretched edges back toward their material lengths without collapsing compressed folds.
    for _ in range(225):
        edge = posed[b] - posed[a]
        length = np.linalg.norm(edge, axis=1, keepdims=True)
        pull = edge * np.maximum(length - limits, 0) / np.maximum(length, 1e-9)
        pull *= .95 / np.maximum(total[:, None], 1e-8)
        change = np.column_stack([np.bincount(a, pull[:, k] * mobility[a], minlength=len(first))
                                  - np.bincount(b, pull[:, k] * mobility[b], minlength=len(first)) for k in range(3)])
        posed += change / counts + (target - posed) * .009
    displacement = posed - root
    displacement *= np.minimum(1., .070 * mask[first, None] / np.maximum(np.linalg.norm(displacement, axis=1, keepdims=True), 1e-9))
    inverse = np.linalg.pinv(blend, rcond=.18)
    delta = np.einsum('nij,nj->ni', inverse, displacement[at])
    delta *= np.minimum(1, .079 / np.maximum(np.linalg.norm(delta, axis=1, keepdims=True), 1e-9))
    delta[np.linalg.norm(delta, axis=1) < .0002] = 0
    return delta.astype(np.float32)


def refine(source, output, pose_data, review=None):
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
        dim = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
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
    bind = read(doc['skins'][0]['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    bind_joints = np.linalg.inv(bind)[:, :3, 3]
    recorded = json.loads(pose_data.read_text())
    unfitted = np.asarray(recorded['unfitted'], dtype=np.float32).reshape(base.shape)
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
            matrices = np.asarray(recorded['frames'][name]).reshape(-1, 4, 4).transpose(0, 2, 1)
            addition = sleeve_volume(matrices, base, before_delta, joints, weights, bone_names, tri, bind_joints, unfitted)
            deformed += to_blender(addition)
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
    assert len(values) in (3, 4), __doc__
    print(json.dumps(refine(*(Path(value) for value in values))))
