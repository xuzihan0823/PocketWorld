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
    sleeve_sections = []
    elbow_guides = []
    sleeve_normals = np.zeros_like(base)
    sleeve_normal_weight = np.zeros(len(base))
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
        # Sweep each sleeve section around the bent arm. The inside and the
        # ribboned outside of a section must travel around the same elbow.
        # Independent nearest-bone rotations flatten one wall against the other.
        s0, e0, w0 = joints[[upper, elbow, wrist]]
        u0, v0 = e0 - s0, w0 - e0
        lu, lv = np.linalg.norm(u0), np.linalg.norm(v0)
        u0, v0 = u0 / lu, v0 / lv
        along = (base - s0) @ u0
        after_elbow = (base - e0) @ v0
        along = np.where(along < lu, along, lu + after_elbow)
        u1 = (bent_elbow - shoulder) / lu
        v1 = (hand - bent_elbow) / lv
        # Integrate a linear tangent blend across the elbow so both the
        # centreline and its tangent remain continuous at the two joins.
        bend = .049
        a = np.clip(along - lu + bend, 0., 2 * bend)
        fore = a * a / (4 * bend) + np.maximum(along - lu - bend, 0.)
        upper_len = along - fore
        center0 = s0 + upper_len[:, None] * u0 + fore[:, None] * v0
        center1 = shoulder + upper_len[:, None] * u1 + fore[:, None] * v1
        mix = a[:, None] / (2 * bend)
        qa, qb = rotation[upper], rotation[elbow]
        if np.dot(qa, qb) < 0:
            qb = -qb
        q = unit((1 - mix) * qa + mix * qb)
        radial = base - center0
        radial = qmul(qmul(q, np.c_[np.zeros(len(base)), radial]), qconj(q))[:, 1:]
        target_sleeve = center1 + radial
        sleeve = (base[:, 0] * sign > 0) * smooth(.48, .94, arm) * smooth(.003, .050, along)
        sleeve *= 1 - smooth(lu + lv - .032, lu + lv + .012, along)
        wanted += (target_sleeve - wanted) * sleeve[:, None]
        mask = np.maximum(mask, sleeve)
        tangent = unit((1 - mix) * u1 + mix * v1)
        radial -= tangent * np.sum(radial * tangent, axis=1, keepdims=True)
        sleeve_sections.append((center1, tangent, radial, sleeve, along, lu + lv))
        # The scanned inner and outer walls lie at very different distances
        # from the bone. Parameterize the loft by the same horizontal cloth
        # rows on both walls, so the inside cannot fold back at the elbow.
        row = np.where(y >= e0[1], (y - s0[1]) / u0[1], lu + (y - e0[1]) / v0[1])
        bend_width = .070
        blend_t = np.clip((row - lu + bend_width) / (2 * bend_width), 0, 1)
        fore_len = bend_width * blend_t ** 2 + np.maximum(row - lu - bend_width, 0)
        axis = unit((1 - blend_t[:, None]) * u1 + blend_t[:, None] * v1)
        middle = shoulder + (row - fore_len)[:, None] * u1 + fore_len[:, None] * v1
        bind_center = s0 + (row - fore_len)[:, None] * u0 + fore_len[:, None] * v0
        # Use a radial frame transported about the bend plane. This frame
        # has no wrist twist and remains continuous through a flexed elbow.
        roll = unit((1 - blend_t[:, None]) * qa + blend_t[:, None] * qb)
        depth_axis = qmul(qmul(roll, np.tile([0., 0., 0., 1.], (len(base), 1))), qconj(roll))[:, 1:]
        depth_axis = unit(depth_axis - axis * (axis * depth_axis).sum(axis=1, keepdims=True))
        width_axis = unit(np.cross(depth_axis, axis))
        dx, dz = base[:, 0] - bind_center[:, 0], base[:, 2] - bind_center[:, 2]
        # The slanted bind arm has wider horizontal cuts than normal sections.
        angle = np.arctan2(dz, dx * abs(u0[1]))
        radius = .038 + .008 * np.exp(-((row - lu - .035) / .052) ** 2)
        outward = np.cos(angle)[:, None] * width_axis + np.sin(angle)[:, None] * depth_axis
        distance = radius * (.90 + .10 * np.clip(np.hypot(dx * abs(u0[1]), dz) / radius, .6, 1.4))
        influence = (base[:, 0] * sign > 0) * smooth(.52, .91, arm)
        influence *= smooth(.514, .549, y) * (1 - smooth(.639, .684, y))
        elbow_guides.append((middle + outward * distance[:, None], influence))
        # Average the split corners onto the same rounded sleeve. Scan normals
        # on the rim otherwise keep a hard shadow where the two panels meet.
        facing = (base[:, 0] * sign > 0) * smooth(.19, .78, arm)
        facing *= smooth(.50, .53, y) * (1 - smooth(.65, .705, y))
        sleeve_normals += outward * facing[:, None]
        sleeve_normal_weight = np.maximum(sleeve_normal_weight, facing)


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
    # Fair both sides of the *posed* join, including the cuff and the few
    # scanned hair corners sewn into the shoulder. Pulling only long edges
    # leaves compressed triangles folded over at the base of the sleeve.
    seam_distance = np.abs(x - (.128 - .305 * (y - .51)))
    seam_band = (1 - smooth(.014, .052, seam_distance)) * (1 - smooth(.028, .058, -base[:, 2]))
    arm_band = smooth(.22, .78, arm) * smooth(.07, .125, x)
    hair_join = smooth(.058, .083, x) * (1 - smooth(.118, .157, x)) * smooth(.733, .765, y)
    coverage = np.maximum(np.maximum(seam_band, arm_band), hair_join)
    coverage *= smooth(.49, .535, y) * (1 - smooth(.780, .813, y))
    coverage *= 1 - smooth(.177, .229, x)
    mask = np.maximum(mask, coverage)
    welded_target = wanted[first].copy()
    influence = coverage[first][:, None]
    from_ = np.r_[a, b]
    to = np.r_[b, a]
    edge_weight = 1 / np.maximum(np.r_[l0, l0], .003)
    mass = np.maximum(np.bincount(from_, edge_weight, minlength=len(first)), 1)
    for _ in range(65):
        summed = np.column_stack([np.bincount(from_, edge_weight * welded_target[to, k],
                                               minlength=len(first)) for k in range(3)])
        welded_target += .72 * influence * (summed / mass[:, None] - welded_target)
    wanted = welded_target[at]
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
    for _ in range(200):
        edge = posed[b] - posed[a]
        length = np.linalg.norm(edge, axis=1, keepdims=True)
        pull = edge * np.maximum(length - limits, 0) / np.maximum(length, 1e-9)
        pull *= .95 / np.maximum(total[:, None], 1e-8)
        change = np.column_stack([np.bincount(a, pull[:, k] * mobility[a], minlength=len(first))
                                  - np.bincount(b, pull[:, k] * mobility[b], minlength=len(first)) for k in range(3)])
        posed += change / counts + (target - posed) * .012
    # Smoothing removes the saw-tooth crease but also shrinks a closed
    # cross-section. Restore the loft around the actual bent centreline.
    for center, tangent, radial, sleeve, along, length in sleeve_sections:
        center, tangent, radial = center[first], tangent[first], radial[first]
        u = along[first] / length
        offset = posed - center
        axial = np.sum(offset * tangent, axis=1, keepdims=True)
        cross_section = offset - axial * tangent
        direction = unit(unit(cross_section) * .32 + unit(radial) * .68)
        radius = np.linalg.norm(radial, axis=1)
        # Preserve the fuller forearm and gathered cuff; only the elbow
        # rounds off substantially in the bent pose.
        profile = .037 + .015 * np.exp(-((u - .75) / .20) ** 2)
        radius = np.clip(.48 * radius + .52 * profile, .029, .064)
        restored = center + axial * tangent + direction * radius[:, None]
        influence = sleeve[first] * smooth(.06, .28, u)
        posed += (restored - posed) * (.95 * influence[:, None])
    # Even out the closest rings at the sewn shoulder after restoring volume.
    for _ in range(65):
        edge = posed[b] - posed[a]
        size = np.linalg.norm(edge, axis=1, keepdims=True)
        pull = edge * np.maximum(size - limits, 0) / np.maximum(size, 1e-9)
        pull /= np.maximum(total[:, None], 1e-8)
        correction = np.column_stack([np.bincount(a, pull[:, k] * mobility[a], minlength=len(first))
                                      - np.bincount(b, pull[:, k] * mobility[b], minlength=len(first)) for k in range(3)])
        posed += .94 * correction / counts
    displacement = posed - root
    displacement *= np.minimum(1., .103 * mask[first, None] / np.maximum(np.linalg.norm(displacement, axis=1, keepdims=True), 1e-9))
    inverse = np.linalg.pinv(blend, rcond=.09)
    delta = np.einsum('nij,nj->ni', inverse, displacement[at])
    delta *= np.minimum(1, .125 / np.maximum(np.linalg.norm(delta, axis=1, keepdims=True), 1e-9))
    # A nearly folded joint may not reproduce the full sculpt after the
    # bounded inverse-skin step. Check that reproduced surface and distribute
    # any remaining strain across the sewn rows and their immediate neighbours.
    current = transform(base + previous + delta)[first]
    source = current.copy()
    neighbours = at[triangles[:, [[0, 1], [1, 2], [2, 0]]]].reshape(-1, 2)
    l, r = np.unique(np.sort(neighbours, axis=1), axis=0).T
    rest_length = np.linalg.norm(rest[l] - rest[r], axis=1)
    move = smooth(.58, .613, rest[:, 1]) * (1 - smooth(.754, .796, rest[:, 1]))
    move *= smooth(.035, .065, np.abs(rest[:, 0]))
    keep = (move[l] + move[r] > .01) & (rest_length > .0005)
    l, r, rest_length = l[keep], r[keep], rest_length[keep]
    summed = np.maximum((move[l] + move[r])[:, None], 1e-8)
    limit = (1.70 * rest_length + .0004)[:, None]
    for _ in range(180):
        diff = current[r] - current[l]
        size = np.linalg.norm(diff, axis=1, keepdims=True)
        active = size[:, 0] > limit[:, 0]
        if not np.any(active):
            break
        lo, hi = l[active], r[active]
        force = diff[active] * (1 - limit[active] / size[active]) / summed[active]
        degree = np.maximum(np.bincount(np.r_[lo, hi], minlength=len(first)), 1)[:, None]
        correction = np.column_stack([np.bincount(lo, force[:, k], minlength=len(first)) -
                                      np.bincount(hi, force[:, k], minlength=len(first)) for k in range(3)])
        current += move[:, None] * (.84 * correction / degree + .001 * (source - current))
    # Apply the round inner elbow after the bounded inverse solve so the
    # skinned triangles actually follow the designed silhouette.
    for guide, coverage in elbow_guides:
        current += (guide[first] - current) * (.96 * coverage[first, None])
    delta += np.einsum('nij,nj->ni', np.linalg.pinv(blend, rcond=.025), (current - source)[at])
    delta[np.linalg.norm(delta, axis=1) < .0002] = 0
    return delta.astype(np.float32), unit(sleeve_normals), sleeve_normal_weight


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
        sleeve_shading = None
        if name.startswith('HoodieStretch_') and 345 <= int(name.rsplit('_', 1)[1]) <= 745:
            matrices = np.asarray(recorded['frames'][name]).reshape(-1, 4, 4).transpose(0, 2, 1)
            addition, sleeve_shading, sleeve_weight = sleeve_volume(matrices, base, before_delta, joints, weights, bone_names, tri, bind_joints, unfitted)
            deformed += to_blender(addition)
            block.data.foreach_set('co', np.ascontiguousarray(deformed[blender_to_gltf]).ravel())
            block.data.foreach_get('co', imported.ravel())
            deformed = imported[gltf_to_blender]
            axis_delta = before_delta + to_gltf(deformed - before)
            add_target(axis_delta, .000075, bounds=True)
            doc['accessors'][target['POSITION']] = doc['accessors'].pop()
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
        if name in recorded['frames']:
            # Three.js linearly blends normal transforms. At a bent elbow
            # this can point away from the final sleeve even when its vertices
            # form a round section. Transport the artist's split normals onto
            # the posed surface, then solve the normal morph back into bind space.
            matrices = np.asarray(recorded['frames'][name]).reshape(-1, 4, 4).transpose(0, 2, 1)
            skin = (matrices[joints] * weights[:, :, None, None]).sum(axis=1)
            linear = skin[:, :3, :3]
            final_pose = np.einsum('nij,nj->ni', linear, to_gltf(deformed)) + skin[:, :3, 3]
            actual = to_gltf(normals(to_blender(final_pose[first])))
            predicted = unit(np.einsum('nij,nj->ni', linear, to_gltf(rest_normals)))
            shaded = unit(np.einsum('nij,nj->ni', linear, original_normals))
            cross = np.cross(predicted, actual)
            dot = np.sum(predicted * actual, axis=1, keepdims=True)
            twist = np.cross(cross, shaded)
            desired = unit(shaded + twist + np.cross(cross, twist) / np.maximum(1 + dot, .02))
            seam_distance = np.abs(x - (.128 - .305 * (height - .51)))
            sewn = (1 - smooth(.014, .046, seam_distance)) * (1 - smooth(.033, .056, -base[:, 2]))
            sewn *= smooth(.505, .54, height) * (1 - smooth(.70, .74, height))
            desired = unit(desired + (actual - desired) * sewn[:, None])
            if sleeve_shading is not None:
                desired = unit(desired + (sleeve_shading - desired) * sleeve_weight[:, None])
            bind_normal = unit(np.einsum('nij,nj->ni', np.linalg.pinv(linear, rcond=.12), desired))
            coverage = smooth(.82, .99, cloth) * smooth(.035, .071, x) * smooth(.47, .52, height)
            coverage *= (1 - smooth(.747, .792, height)) * (1 - smooth(.193, .233, x))
            if sleeve_shading is not None:
                coverage = np.maximum(coverage, sleeve_weight * smooth(.035, .07, x) * (1 - smooth(.206, .231, x)))
            normal_delta = to_blender((bind_normal - original_normals) * coverage[:, None])
        target['NORMAL'] = add_target(to_gltf(normal_delta), .056)
        stats[name] = {'max_position_change_mm': round(1000 * float(np.linalg.norm(deformed - before, axis=1).max()), 3),
                       'normal_vertices': doc['accessors'][target['NORMAL']].get('sparse', {}).get('count', 0)}
    bpy.data.meshes.remove(normals_mesh)
    if review:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(review.resolve()))
    # Replacing sparse shape positions releases their old payloads. Keep
    # the runtime download limited to views still referenced by an accessor or image.
    refs = []
    def collect_views(value):
        if isinstance(value, list):
            for item in value:
                collect_views(item)
        elif isinstance(value, dict):
            if 'bufferView' in value:
                refs.append(value)
            for item in value.values():
                collect_views(item)
    collect_views(doc)
    packed = bytearray()
    views = []
    remap = {}
    for old in sorted({ref['bufferView'] for ref in refs}):
        view = doc['bufferViews'][old].copy()
        start = view.get('byteOffset', 0)
        view['byteOffset'] = len(packed)
        packed.extend(binary[start:start + view['byteLength']])
        packed.extend(bytes(-len(packed) % 4))
        remap[old] = len(views)
        views.append(view)
    for ref in refs:
        ref['bufferView'] = remap[ref['bufferView']]
    doc['bufferViews'] = views
    write_glb(output, doc, packed)
    return stats


if __name__ == '__main__':
    values = sys.argv[sys.argv.index('--') + 1:]
    assert len(values) in (3, 4), __doc__
    print(json.dumps(refine(*(Path(value) for value in values))))
