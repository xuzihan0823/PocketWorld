"""Correct the cardigan stretch in Blender, preserving all unrelated GLB bytes.

Blender --background --factory-startup --python-exit-code 1 --python
scripts/repair-cardigan-yawn.py
Re-running exports the edited source action without applying the correction twice.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys
import runpy

import bpy
import numpy as np
from bpy_extras import anim_utils
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'pocketworld_yawn_twist_v1'
OWNED = ['mixamorig:' + side + part for side in ('Left', 'Right')
         for part in ('Arm', 'ForeArm', 'Hand')]
CONVERT = Matrix.Rotation(-math.pi / 2, 4, 'X')


def smooth(t, low, high):
    x = min(1, max(0, (t - low) / (high - low)))
    return x * x * (3 - 2 * x)


def repair(rig, action, fps):
    if action.get(VERSION):
        return False
    rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    samples = []
    # Sample before editing: evaluation must always use the original action.
    for frame in range(251):
        t = frame / 30
        at = t * fps
        bpy.context.scene.frame_set(math.floor(at), subframe=at % 1)
        old = {b.name: b.matrix.copy() for b in rig.pose.bones}
        weight = smooth(t, 6.2, 6.65) * (1 - smooth(t, 7.55, 8.25))
        if weight == 0:
            samples.append({name: rig.pose.bones[name].rotation_quaternion.copy() for name in OWNED})
            continue
        frame_sample = {}
        for side in ('Left', 'Right'):
            names = ['mixamorig:' + side + part for part in ('Arm', 'ForeArm', 'Hand')]
            new = {}
            for i, name in enumerate(names[:2]):
                child = names[i + 1]
                axis = (rest[child].translation - rest[name].translation).normalized()
                direction = (old[child].translation - old[name].translation).normalized()
                swing = axis.rotation_difference(direction)
                delta = old[name].to_quaternion() @ rest[name].to_quaternion().inverted()
                twist = swing.inverted() @ delta
                angle = 2 * math.atan2(Vector((twist.x, twist.y, twist.z)).dot(axis), twist.w)
                angle = math.atan2(math.sin(angle), math.cos(angle))
                # The open-arm stretch should not roll the sleeve almost a quarter turn.
                target = swing @ Quaternion(axis, angle * .28) @ rest[name].to_quaternion()
                if i == 1:
                    # Transport the upper-arm frame through the elbow. Solving
                    # forearm roll independently is singular near a straight elbow.
                    delta_upper = new[names[0]].to_quaternion() @ rest[names[0]].to_quaternion().inverted()
                    aim = (delta_upper @ axis).rotation_difference(direction)
                    target = aim @ delta_upper @ rest[name].to_quaternion()
                q = old[name].to_quaternion().slerp(target, weight)
                new[name] = Matrix.LocRotScale(old[name].translation, q, old[name].to_scale())
            hand = names[2]
            palm_center = (rest['mixamorig:' + side + 'HandIndex1'].translation
                           + rest['mixamorig:' + side + 'HandPinky1'].translation) * .5
            palm_axis = palm_center - rest[hand].translation
            local_axis = rest[hand].to_quaternion().inverted() @ palm_axis.normalized()
            lower = names[1]
            follow = new[lower].to_quaternion() @ rest[lower].to_quaternion().inverted() @ rest[hand].to_quaternion()
            q = old[hand].to_quaternion().slerp(follow, weight)
            forward = q @ local_axis
            forearm = (old[hand].translation - old[lower].translation).normalized()
            desired = forward.lerp(forearm, .85 * weight).normalized()
            q = forward.rotation_difference(desired) @ q
            new[hand] = Matrix.LocRotScale(old[hand].translation, q, old[hand].to_scale())
            for name in names:
                bone = rig.data.bones[name]
                parent = bone.parent.name
                local = bone.convert_local_to_pose(new[name], bone.matrix_local,
                    parent_matrix=new.get(parent, old[parent]),
                    parent_matrix_local=rest[parent], invert=True)
                frame_sample[name] = local.to_quaternion()
        samples.append(frame_sample)
    # The original return has a two-frame elbow jerk. Smooth rotations in
    # quaternion space over 0.1 s; preserve the mouth-covering section exactly.
    raw_samples = samples
    samples = [{n: q.copy() for n, q in frame.items()} for frame in raw_samples]
    for i, sample in enumerate(samples):
        t = i / 30
        weight = smooth(t, 6.2, 6.65) * (1 - smooth(t, 7.8, 8.25))
        if not weight:
            continue
        for name in OWNED:
            reference = raw_samples[i][name]
            average = np.zeros(4)
            for j in range(max(0, i - 8), min(len(samples), i + 9)):
                q = raw_samples[j][name]
                sign = -1 if q.dot(reference) < 0 else 1
                average += np.array(q) * sign * math.exp(-.5 * ((j - i) / 3) ** 2)
            filtered = Quaternion(average / np.linalg.norm(average))
            sample[name] = reference.slerp(filtered, weight)
    slot = rig.animation_data.action_slot
    bag = anim_utils.action_ensure_channelbag_for_slot(action, slot)
    paths = {rig.pose.bones[name].path_from_id('rotation_quaternion') for name in OWNED}
    for curve in list(bag.fcurves):
        if curve.data_path in paths:
            bag.fcurves.remove(curve)
    for name in OWNED:
        previous = None
        for i, sample in enumerate(samples):
            q = sample[name]
            if previous is not None and q.dot(previous) < 0:
                q.negate()
            sample[name] = q
            previous = q.copy()
        for component in range(4):
            curve = bag.fcurves.new(rig.pose.bones[name].path_from_id('rotation_quaternion'), index=component)
            curve.keyframe_points.add(len(samples))
            for i, point in enumerate(curve.keyframe_points):
                point.co = (i / 30 * fps, samples[i][name][component])
                point.interpolation = 'LINEAR'
    action[VERSION] = True
    return True


def export_action(rig, action, fps, base, output):
    raw = base.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + size])
    binary = bytearray(raw[28 + size:])
    nodes = doc['nodes']
    parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
    world = {}
    def rest(i):
        if i not in world:
            n = nodes[i]
            q = n.get('rotation', [0, 0, 0, 1])
            local = Matrix.LocRotScale(Vector(n.get('translation', [0, 0, 0])),
                                      Quaternion((q[3], *q[:3])), Vector(n.get('scale', [1, 1, 1])))
            if 'matrix' in n:
                local = Matrix([n['matrix'][j:j + 4] for j in range(0, 16, 4)]).transposed()
            world[i] = rest(parents[i]) @ local if i in parents else local
        return world[i]
    def array(index):
        a = doc['accessors'][index]
        v = doc['bufferViews'][a['bufferView']]
        if a['componentType'] != 5126 or 'sparse' in a:
            raise ValueError('Expected dense float animation data')
        width = {'VEC4': 4, 'SCALAR': 1, 'MAT4': 16}[a['type']]
        return np.ndarray((a['count'], width), '<f4', binary,
                          v.get('byteOffset', 0) + a.get('byteOffset', 0),
                          (v.get('byteStride', width * 4), 4))
    skin = doc['skins'][0]
    binds = {node: Matrix(values.reshape(4, 4).tolist()).transposed().inverted()
             for node, values in zip(skin['joints'], array(skin['inverseBindMatrices']))}
    clip = next(a for a in doc['animations'] if a['name'] == 'Luna_Yawn')
    bones = {b.name.replace(':', ''): b for b in rig.pose.bones}
    targets = []
    for channel in clip['channels']:
        node = channel['target']['node']
        name = nodes[node]['name'].replace(':', '')
        if name not in {n.replace(':', '') for n in OWNED}:
            continue
        if channel['target']['path'] != 'rotation':
            raise ValueError('Unexpected owned channel')
        sampler = clip['samplers'][channel['sampler']]
        times, values = array(sampler['input']), array(sampler['output'])
        targets.append((node, times, values))
    if len(targets) != 6:
        raise ValueError('Expected six existing arm/hand rotation channels')
    for node, times, values in targets:
        previous = None
        for index, time in enumerate(times[:, 0]):
            if float(time) <= 6.2 or float(time) >= 8.25:
                previous = Quaternion((float(values[index, 3]), *map(float, values[index, :3])))
                continue
            at = float(time) * fps
            bpy.context.scene.frame_set(math.floor(at), subframe=at % 1)
            def posed(i):
                bone = bones.get(nodes[i].get('name', '').replace(':', ''))
                if bone is None:
                    return rest(i).to_quaternion()
                delta = CONVERT @ rig.matrix_world @ bone.matrix @ bone.bone.matrix_local.inverted() @ rig.matrix_world.inverted() @ CONVERT.inverted()
                return delta.to_quaternion() @ binds.get(i, rest(i)).to_quaternion()
            q = posed(parents[node]).inverted() @ posed(node)
            q.normalize()
            if previous is not None and q.dot(previous) < 0:
                q.negate()
            values[index] = (q.x, q.y, q.z, q.w)
            previous = q.copy()
    output.write_bytes(raw[:28 + size] + binary)
    return {'bytes': len(raw), 'rotationTracks': len(targets)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path)
    p.add_argument('--base', type=Path, default=ROOT / 'assets/public/models/resident/luna-cardigan.glb')
    p.add_argument('--blend', type=Path, default=ROOT / 'assets/models/resident/Luna-Cardigan-Stretch.blend')
    p.add_argument('--output', type=Path, default=ROOT / 'assets/public/models/resident/luna-cardigan.glb')
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    source = args.source or (args.blend if args.blend.exists() else None)
    if source:
        bpy.ops.wm.open_mainfile(filepath=str(source))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = 30
        bpy.ops.import_scene.gltf(filepath=str(args.base))
    rig = bpy.data.objects['Luna_Cardigan_Rig']
    action = bpy.data.actions['Luna_Yawn']
    rig.animation_data.action = action
    rig.animation_data.action_slot = next(s for s in action.slots if 'Rig' in s.identifier)
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    changed = repair(rig, action, fps)
    binding = runpy.run_path(str(Path(__file__).with_name('cardigan-sleeve-binding.py')))
    surface = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.find_armature() == rig)
    sleeve_count = binding['repair'](surface, rig)
    result = export_action(rig, action, fps, args.base, args.output)
    exported_sleeves = binding['export'](surface, args.output)
    bpy.context.scene.frame_set(round(7 * fps))
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend), compress=True)
    print(json.dumps({'authored': changed, 'sleeveVertices': sleeve_count,
                      'exportedSleeveVertices': exported_sleeves, **result}))

if __name__ == '__main__':
    main()
