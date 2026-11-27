"""Repair the cardigan's sleeve binding in Blender and export only skin weights.

Run with Blender --background --factory-startup --python-exit-code 1 --python
scripts/repair-luna-cardigan-elbows.py. The saved source is editable; subsequent
runs export its weights without applying the procedural repair a second time.
"""
import argparse
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils import Vector, kdtree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/models/resident/Luna-Cardigan.blend"
MODEL = ROOT / "assets/public/models/resident/luna-cardigan.glb"
VERSION = "pocketworld_elbow_binding"


def smooth(value, low, high):
    t = max(0, min(1, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


def four_weights(weights):
    kept = sorted(((name, w) for name, w in weights.items() if w > 0),
                  key=lambda item: -item[1])[:4]
    total = sum(w for _, w in kept)
    if total <= 0:
        raise ValueError("Unweighted cardigan vertex")
    return {name: w / total for name, w in kept}


def repair(surface, rig):
    if surface.get(VERSION) == 1:
        return 0
    names = {group.index: group.name for group in surface.vertex_groups}
    changed = 0
    for side in ("Left", "Right"):
        upper, lower, hand = ("mixamorig:" + side + part for part in ("Arm", "ForeArm", "Hand"))
        shoulder, elbow, wrist = (rig.data.bones[name].head_local for name in (upper, lower, hand))
        axis = (wrist - shoulder).normalized()
        for vertex in surface.data.vertices:
            old = {names[g.group]: g.weight for g in vertex.groups if g.weight > 0}
            # Exclude adjacent hair and the torso. Fade at the shoulder seam,
            # armpit and forearm so the repair cannot introduce a hard weight cut.
            if old.get(upper, 0) + old.get(lower, 0) < .03:
                continue
            if sum(w for name, w in old.items() if name.startswith("Hair_")) > .01:
                continue
            delta = vertex.co - elbow
            along = delta.dot(axis)
            if (delta - axis * along).length > .055:
                continue
            mask = (smooth(abs(vertex.co.x), .090, .105)
                    * smooth(along, -.115, -.068)
                    * (1 - smooth(along, .025, .045)))
            if mask < 1e-6:
                continue
            # The sleeve above the hinge follows the humerus, not Spine1/2.
            # Blend across the elbow itself rather than dragging the whole sleeve.
            forearm = smooth(along, -.024, .024)
            weights = {name: w * (1 - mask) for name, w in old.items()}
            weights[upper] = weights.get(upper, 0) + mask * (1 - forearm)
            weights[lower] = weights.get(lower, 0) + mask * forearm
            weights = four_weights({name: w for name, w in weights.items() if w > .00001})
            if max(abs(weights.get(n, 0) - old.get(n, 0)) for n in old.keys() | weights.keys()) < 1e-5:
                continue
            for index in [g.group for g in vertex.groups]:
                surface.vertex_groups[index].remove([vertex.index])
            for name, weight in weights.items():
                surface.vertex_groups[name].add([vertex.index], weight, 'REPLACE')
            changed += 1
    surface[VERSION] = 1
    return changed


def export_weights(surface, base, output):
    """Preserve UV splits, morphs, _CONTACT_ID, textures and every animation byte."""
    raw = base.read_bytes()
    if raw[:4] != b'glTF':
        raise ValueError("Expected a binary glTF model")
    size = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + size])
    binary = bytearray(raw[28 + size:])
    if len(doc['meshes']) != 1 or len(doc['skins']) != 1:
        raise ValueError("Cardigan topology changed: expected one mesh and skin")

    def accessor(index):
        item = doc['accessors'][index]
        view = doc['bufferViews'][item['bufferView']]
        if 'sparse' in item or item.get('normalized'):
            raise ValueError("Unexpected sparse/normalized skin accessor")
        width = {'VEC3': 3, 'VEC4': 4}[item['type']]
        dtype = np.dtype({5126: '<f4', 5123: '<u2', 5121: 'u1'}[item['componentType']])
        return np.ndarray((item['count'], width), dtype=dtype, buffer=binary,
                          offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
                          strides=(view.get('byteStride', dtype.itemsize * width), dtype.itemsize))

    joint_ids = {doc['nodes'][node]['name'].replace(':', ''): i
                 for i, node in enumerate(doc['skins'][0]['joints'])}
    group_ids = {group.index: joint_ids[group.name.replace(':', '')] for group in surface.vertex_groups}
    source_weights = [four_weights({group_ids[g.group]: g.weight for g in vertex.groups})
                      for vertex in surface.data.vertices]
    tree = kdtree.KDTree(len(surface.data.vertices))
    for vertex in surface.data.vertices:
        tree.insert(vertex.co, vertex.index)
    tree.balance()
    changed, max_distance = 0, 0
    for primitive in doc['meshes'][0]['primitives']:
        attributes = primitive['attributes']
        positions = accessor(attributes['POSITION'])
        joints = accessor(attributes['JOINTS_0'])
        weights = accessor(attributes['WEIGHTS_0'])
        for index, point in enumerate(positions):
            local = Vector((float(point[0]), -float(point[2]), float(point[1])))
            _, vertex, distance = tree.find(local)
            max_distance = max(max_distance, distance)
            if distance > 1e-5:
                raise ValueError(f"Runtime vertex {index} no longer matches the Blender source ({distance} m)")
            desired = source_weights[vertex]
            # UV seams have repeated positions. Refuse an ambiguous weight transfer.
            for _, duplicate, _ in tree.find_range(local, 1e-6):
                other = source_weights[duplicate]
                if any(abs(desired.get(j, 0) - other.get(j, 0)) > 1e-5 for j in desired.keys() | other.keys()):
                    raise ValueError(f"Conflicting coincident source vertices at runtime vertex {index}")
            current = {int(j): float(w) for j, w in zip(joints[index], weights[index]) if w > 0}
            if all(abs(desired.get(j, 0) - current.get(j, 0)) < 1e-6 for j in desired.keys() | current.keys()):
                continue
            joints[index] = 0
            weights[index] = 0
            for slot, (joint, weight) in enumerate(desired.items()):
                joints[index, slot] = joint
                weights[index, slot] = weight
            changed += 1
        if not np.allclose(weights.sum(axis=1), 1, atol=1e-6):
            raise ValueError("Exported weights are not normalized")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw[:28 + size] + binary)
    return {'runtimeVerticesChanged': changed, 'mappingErrorMeters': max_distance,
            'bytes': output.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--base', type=Path, default=MODEL)
    parser.add_argument('--blend', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=MODEL)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(args.source))
    surface = bpy.data.objects['Luna_Cardigan']
    rig = surface.find_armature()
    changed = repair(surface, rig)
    result = export_weights(surface, args.base, args.output)
    bpy.context.preferences.filepaths.save_version = 0
    args.blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend), compress=True)
    print(json.dumps({'sourceVerticesChanged': changed, **result}))


if __name__ == '__main__':
    main()
