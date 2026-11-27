"""Blender sleeve binding used by the cardigan stretch repair.

Uses the established local upper-sleeve mask from the elbow repair; the GLB
transfer changes skin attributes only, preserving UV seams and contact indices.
"""
import json
import struct
import numpy as np
from mathutils import Vector, kdtree


def smooth(value, low, high):
    t = max(0, min(1, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


def four(weights):
    kept = sorted(((n, w) for n, w in weights.items() if w > 0), key=lambda item: -item[1])[:4]
    total = sum(w for _, w in kept)
    if total <= 0:
        raise ValueError('Unweighted sleeve vertex')
    return {n: w / total for n, w in kept}


def repair(surface, rig):
    if surface.get('pocketworld_elbow_binding') == 1:
        return 0
    names = {g.index: g.name for g in surface.vertex_groups}
    changed = 0
    for side in ('Left', 'Right'):
        upper, lower, hand = ('mixamorig:' + side + p for p in ('Arm', 'ForeArm', 'Hand'))
        shoulder, elbow, wrist = (rig.data.bones[n].head_local for n in (upper, lower, hand))
        axis = (wrist - shoulder).normalized()
        for v in surface.data.vertices:
            old = {names[g.group]: g.weight for g in v.groups if g.weight > 0}
            if old.get(upper, 0) + old.get(lower, 0) < .03:
                continue
            if sum(w for n, w in old.items() if n.startswith('Hair_')) > .01:
                continue
            delta = v.co - elbow
            along = delta.dot(axis)
            if (delta - axis * along).length > .055:
                continue
            mask = smooth(abs(v.co.x), .090, .105) * smooth(along, -.115, -.068) * (1 - smooth(along, .025, .045))
            if mask < 1e-6:
                continue
            forearm = smooth(along, -.024, .024)
            weights = {n: w * (1 - mask) for n, w in old.items()}
            weights[upper] = weights.get(upper, 0) + mask * (1 - forearm)
            weights[lower] = weights.get(lower, 0) + mask * forearm
            weights = four({n: w for n, w in weights.items() if w > .00001})
            if max(abs(weights.get(n, 0) - old.get(n, 0)) for n in old.keys() | weights.keys()) < 1e-5:
                continue
            for index in [g.group for g in v.groups]:
                surface.vertex_groups[index].remove([v.index])
            for n, w in weights.items():
                surface.vertex_groups[n].add([v.index], w, 'REPLACE')
            changed += 1
    surface['pocketworld_elbow_binding'] = 1
    return changed


def export(surface, path):
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + size])
    binary = bytearray(raw[28 + size:])
    if len(doc['meshes']) != 1 or len(doc['skins']) != 1:
        raise ValueError('Unexpected cardigan topology')
    def array(index):
        a = doc['accessors'][index]; view = doc['bufferViews'][a['bufferView']]
        if 'sparse' in a or a.get('normalized'):
            raise ValueError('Unexpected sparse or normalized skin accessor')
        width = {'VEC3': 3, 'VEC4': 4}[a['type']]
        dtype = np.dtype({5126: '<f4', 5123: '<u2', 5121: 'u1'}[a['componentType']])
        return np.ndarray((a['count'], width), dtype, binary, view.get('byteOffset', 0) + a.get('byteOffset', 0),
                          (view.get('byteStride', width * dtype.itemsize), dtype.itemsize))
    ids = {doc['nodes'][n]['name'].replace(':', ''): i for i, n in enumerate(doc['skins'][0]['joints'])}
    groups = {g.index: ids[g.name.replace(':', '')] for g in surface.vertex_groups}
    weights = [four({groups[g.group]: g.weight for g in v.groups if g.weight > 0}) for v in surface.data.vertices]
    tree = kdtree.KDTree(len(surface.data.vertices))
    for v in surface.data.vertices:
        tree.insert(v.co, v.index)
    tree.balance()
    changed = 0
    for primitive in doc['meshes'][0]['primitives']:
        attrs = primitive['attributes']
        positions, joints, skin = (array(attrs[n]) for n in ('POSITION', 'JOINTS_0', 'WEIGHTS_0'))
        for i, p in enumerate(positions):
            co = Vector((float(p[0]), -float(p[2]), float(p[1])))
            _, index, distance = tree.find(co)
            if distance > 1e-5:
                raise ValueError(f'Unmatched runtime vertex {i}: {distance}')
            desired = weights[index]
            for _, duplicate, _ in tree.find_range(co, 1e-6):
                other = weights[duplicate]
                if any(abs(desired.get(n, 0) - other.get(n, 0)) > 1e-5 for n in desired.keys() | other.keys()):
                    raise ValueError('Ambiguous UV seam weights')
            old = {int(j): float(w) for j, w in zip(joints[i], skin[i]) if w > 0}
            if all(abs(desired.get(n, 0) - old.get(n, 0)) < 1e-6 for n in desired.keys() | old.keys()):
                continue
            joints[i] = 0; skin[i] = 0
            for slot, (joint, weight) in enumerate(desired.items()):
                joints[i, slot] = joint; skin[i, slot] = weight
            changed += 1
        if not np.allclose(skin.sum(axis=1), 1, atol=1e-6):
            raise ValueError('Non-normalized skin')
    path.write_bytes(raw[:28 + size] + binary)
    return changed
