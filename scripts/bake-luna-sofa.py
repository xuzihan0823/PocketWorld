"""Blender -b -P scripts/bake-luna-sofa.py -- <CMU subject 75 directory> <neutral.json>
Generate neutral.json with node scripts/luna-library-neutral.mjs. Coordinates below
are glTF Y-up room metres until local joint transforms are serialized.
"""
import json
import math
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

root = Path(__file__).resolve().parents[1]
source, neutral_file = map(Path, sys.argv[sys.argv.index('--') + 1:])
resident = root / 'assets/public/models/resident'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(resident / 'luna-walk-room.glb'))
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
bones = list(rig.data.bones)
key = lambda name: name.replace(':', '')
neutral = {name: Matrix([values[i:i+4] for i in range(0,16,4)]).transposed()
           for name, values in json.loads(neutral_file.read_text()).items()}
asf = (source / '75.asf').read_text()
axes = {}
for block in re.findall(r'\bbegin\s*\n(.*?)\bend\b', asf.split(':bonedata')[1].split(':hierarchy')[0], re.S):
    fields = {w[0]: w[1:] for line in block.splitlines() if (w := line.split())}
    axes[fields['name'][0]] = (Euler(tuple(math.radians(float(x)) for x in fields['axis'][:3])).to_quaternion(), fields.get('dof', []))
edges = [(row[0], child) for line in asf.split(':hierarchy')[1].splitlines()
         if (row := line.split()) for child in row[1:]]
frames = []
for line in (source / '75_20.amc').read_text().splitlines():
    words = line.split()
    if words[0].isdigit():
        frames.append({})
    elif words[0][0] not in '#:':
        frames[-1][words[0]] = list(map(float, words[1:]))

def capture(frame):
    rotations = {'root': Euler(tuple(map(math.radians, frame['root'][3:]))).to_quaternion()}
    for parent, child in edges:
        axis, dofs = axes[child]
        angles = [0., 0., 0.]
        for dof, value in zip(dofs, frame.get(child, [])):
            angles['xyz'.index(dof[-1])] = math.radians(value)
        rotations[child] = rotations[parent] @ axis @ Euler(angles).to_quaternion() @ axis.inverted()
    return rotations

mapping = dict(Hips='root', Spine='lowerback', Spine1='upperback', Spine2='thorax', Neck='upperneck', Head='head')
for side, prefix in [('Left','l'), ('Right','r')]:
    for joint, segment in [('Shoulder','clavicle'), ('Arm','humerus'), ('ForeArm','radius'), ('Hand','hand'), ('UpLeg','femur'), ('Leg','tibia')]:
        mapping[side + joint] = prefix + segment
first, last = 94, 260
ref = capture(frames[first])
start = Vector(frames[first]['root'][:3])
tracks = {}
nodes = []
previous = {}
# The bare cushion sits below the folded blanket on the other side.
# Let the last pleat on this side unfold as the cushion takes the load.
hem_drop = {'Dress_Back_R_03': .036, 'Dress_Right_03': .023}
indices = {bone.name: i for i, bone in enumerate(bones)}
for bone in bones:
    world = neutral[key(bone.name)]
    local = neutral[key(bone.parent.name)].inverted() @ world if bone.parent else world
    translation, rotation, scale = local.decompose()
    if not bone.parent:
        translation /= 1.43
        scale /= 1.43
    node = {
        'name': bone.name, 'translation': list(translation),
        'rotation': [rotation.x, rotation.y, rotation.z, rotation.w], 'scale': list(scale),
    }
    if bone.children:
        node['children'] = [indices[child.name] for child in bone.children]
    nodes.append(node)

for frame_index in range(first, last + 1, 2):
    frame = frames[frame_index]
    sample = capture(frame)
    delta = Vector(frame['root'][:3]) - start
    weight = min(1., max(0., -delta.y / 13.6))
    settle = min(1., max(0., (frame_index - 156) / 48))
    settle = settle * settle * (3 - 2 * settle)
    unfold = min(1., max(0., (frame_index - 184) / 60))
    unfold = unfold * unfold * (3 - 2 * unfold)
    worlds = {}
    for bone in bones:
        name = key(bone.name)
        rest = neutral[name]
        parent = key(bone.parent.name) if bone.parent else None
        world = worlds[parent] @ neutral[parent].inverted() @ rest if parent else rest.copy()
        joint = name.removeprefix('mixamorig')
        if joint in mapping:
            segment = mapping[joint]
            rotation = sample[segment] @ ref[segment].inverted() @ rest.to_quaternion()
            if joint.endswith(('Arm', 'Hand')):
                rotation = rotation.slerp(rest.to_quaternion(), .44 * weight)
            world = Matrix.LocRotScale(world.translation, rotation, rest.to_scale())
        if joint == 'Hips':
            # The performer rolls onto a low support. Limit pelvic roll on the
            # higher upholstered lip while preserving captured spine motion.
            world = Matrix.LocRotScale(world.translation, rest.to_quaternion().slerp(world.to_quaternion(), .5), rest.to_scale())
            world.translation += Vector((delta.x*.028, delta.y*.0142, delta.z*.058*min(1., .25+weight*1.6)))
        if name.startswith('Dress_'):
            _, panel, *suffix = name.split('_')
            level = int(suffix[-1]) - 1
            left = panel == 'Left' or 'L' in suffix
            right = panel == 'Right' or 'R' in suffix
            side = int(left) - int(right)
            # Each tier has its own tangent: the upper cloth clears the thighs,
            # then the free hem curls down. Lateral panels gather toward the knees.
            if panel == 'Front':
                pitch = (-1.23, -.99, -.68)[level]
                flare = (.31, .23, .14)[level]
                sweep = -.17
            elif panel == 'Back':
                # Drop from the waist first, then turn the lower tier out
                # along the cushion. The corners spread around the hips.
                entry = (1.18, .76, .12)[level]
                seated = ((.08, .21, -.70) if side else (.67, -.33, .37))[level]
                pitch = entry + (seated - entry) * settle
                flare = (.52, .40, .26)[level]
                sweep = .04
            else:
                pitch = (-.82, -.90, -.76)[level] + (.18, .22, .19)[level] * settle
                # The blanket raises the support under the left-hand folds.
                gather = (.30, .25, .17) if left else (.48, .44, .34)
                flare = (1.08, .92, .70)[level] - gather[level] * settle
                sweep = -.34
            # The hem follows a few capture frames behind the hip. Blend back
            # to the held sample so reversal uses exactly the same cloth pose.
            earlier = frames[max(first, frame_index - level * 3)]['root'][1]
            lag = min(1., max(0., (start.y - earlier) / 13.6))
            bend = (weight + lag) * .5
            roll = Quaternion((0, 0, 1), side * flare * bend)
            turn = Quaternion((0, 1, 0), side * sweep * bend)
            fold = turn @ Quaternion((1, 0, 0), pitch * bend) @ roll
            world = Matrix.LocRotScale(world.translation, fold @ rest.to_quaternion(), rest.to_scale())
            world.translation.y -= hem_drop.get(name, 0.) * unfold
        worlds[name] = world

    # Two-link IK keeps each ankle and sole at its own calibrated standing
    # contact. Use the mocap knee as the bend-plane guide.
    for side in ('Left','Right'):
        names = ['mixamorig'+side+n for n in ('UpLeg','Leg','Foot')]
        thigh, shin, foot = (worlds[n] for n in names)
        target = neutral[names[2]].translation
        line = target - thigh.translation
        axis = line.normalized()
        upper = shin.translation - thigh.translation
        lower = foot.translation - shin.translation
        length = min(line.length, upper.length+lower.length-1e-8)
        along = (length**2 + upper.length_squared - lower.length_squared)/(2*length)
        pole = (upper - axis*upper.dot(axis)).normalized()
        knee = thigh.translation + axis*along + pole*math.sqrt(max(0., upper.length_squared-along**2))
        for n, old, direction, origin in [(names[0], upper, knee-thigh.translation, thigh.translation),
                                          (names[1], lower, target-knee, knee)]:
            w = worlds[n]
            worlds[n] = Matrix.LocRotScale(origin, old.rotation_difference(direction) @ w.to_quaternion(), w.to_scale())
        worlds[names[2]] = neutral[names[2]].copy()

    for bone in bones:
        name = key(bone.name)
        if name.removeprefix('mixamorig') not in mapping and not name.endswith('Foot') and not name.startswith('Dress_'):
            continue
        world = worlds[name]
        local = worlds[key(bone.parent.name)].inverted() @ world if bone.parent else world
        q = local.to_quaternion()
        if name in previous:
            q.make_compatible(previous[name])
        previous[name] = q.copy()
        tracks.setdefault((indices[bone.name], 'rotation'), []).extend([q.x,q.y,q.z,q.w])
        if name == 'mixamorigHips':
            tracks.setdefault((indices[bone.name], 'translation'), []).extend(local.translation / 1.43)
        elif name in hem_drop:
            tracks.setdefault((indices[bone.name], 'translation'), []).extend(local.translation)

# Write only joint transforms. The room supplies Luna's mesh, skin and textures.
binary = bytearray()
accessors, views, channels, samplers = [], [], [], []

def accessor(values, kind, width):
    raw = struct.pack(f'<{len(values)}f', *values)
    views.append(dict(buffer=0, byteOffset=len(binary), byteLength=len(raw)))
    binary.extend(raw)
    item = dict(bufferView=len(views) - 1, componentType=5126, count=len(values) // width, type=kind)
    if width == 1:
        item.update(min=[min(values)], max=[max(values)])
    accessors.append(item)
    return len(accessors) - 1

times = accessor([(f - first) / 60 for f in range(first, last + 1, 2)], 'SCALAR', 1)
for (node, path), values in tracks.items():
    kind, width = ('VEC4', 4) if path == 'rotation' else ('VEC3', 3)
    output = accessor(values, kind, width)
    channels.append(dict(sampler=len(samplers), target=dict(node=node, path=path)))
    samplers.append(dict(input=times, output=output, interpolation='LINEAR'))

doc = {
    'asset': {'version': '2.0', 'generator': 'PocketWorld Blender CMU retarget'},
    'scene': 0, 'scenes': [{'nodes': [indices[b.name] for b in bones if not b.parent]}], 'nodes': nodes,
    'animations': [dict(name='Luna_CMU_75_20', samplers=samplers, channels=channels)],
    'buffers': [dict(byteLength=len(binary))], 'bufferViews': views, 'accessors': accessors,
}
metadata = json.dumps(doc, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
with (resident / 'luna-sofa-low-sit.glb').open('wb') as stream:
    stream.write(struct.pack('<4sII', b'glTF', 2, 28 + len(metadata) + len(binary)))
    for tag, content in [(b'JSON', metadata), (b'BIN\0', binary)]:
        stream.write(struct.pack('<I4s', len(content), tag))
        stream.write(content)
