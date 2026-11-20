"""Blender -b -P scripts/bake-luna-chair-cmu.py -- <CMU subject 113 directory>"""
import json
import math
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[sys.argv.index('--') + 1])
RESIDENT = ROOT / 'assets/public/models/resident'
FIRST, HOLD = 161, 497  # AMC frame numbers, inclusive, 120 Hz
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/models/resident/Luna-Sit-ContactFixed.blend'))
scene = bpy.context.scene
rig = scene.objects['Luna_ContactCorrected_Baked']

# ASF segments are endpoints. Each AMC rotation acts in that segment's axis system.
asf = (SOURCE / '113.asf').read_text()
bones = {}
for block in re.findall(r'\bbegin\s*\n(.*?)\bend\b', asf.split(':bonedata')[1].split(':hierarchy')[0], re.S):
    fields = {w[0]: w[1:] for line in block.splitlines() if (w := line.split())}
    axis = Euler(tuple(math.radians(float(v)) for v in fields['axis'][:3])).to_quaternion()
    offset = Vector(tuple(map(float, fields['direction']))) * float(fields['length'][0])
    bones[fields['name'][0]] = axis, offset, fields.get('dof', [])
edges = [(row[0], child) for line in asf.split(':hierarchy')[1].splitlines()
         if (row := line.split()) for child in row[1:]]
frames = {}
for line in (SOURCE / '113_15.amc').read_text().splitlines():
    words = line.split()
    if not words or words[0][0] in '#:':
        continue
    if words[0].isdigit():
        frame = frames[int(words[0])] = {}
    else:
        frame[words[0]] = list(map(float, words[1:]))

def landmarks(frame):
    rotations = {'root': Euler(tuple(map(math.radians, frame['root'][3:]))).to_quaternion()}
    points = {'root': Vector(frame['root'][:3])}
    for parent, child in edges:
        axis, offset, dofs = bones[child]
        angles = [0., 0., 0.]
        for dof, value in zip(dofs, frame.get(child, [])):
            angles['xyz'.index(dof[-1])] = math.radians(value)
        rotations[child] = rotations[parent] @ axis @ Euler(angles).to_quaternion() @ axis.inverted()
        points[child] = points[parent] + rotations[child] @ offset
    return points

def clamp(x):
    return min(1., max(0., x))

def ramp(x):
    x = clamp(x)
    return x*x*(3-2*x)

seated = landmarks(frames[HOLD])
left = seated['lhipjoint'] - seated['rhipjoint']
left.y = 0
left.normalize()
up = Vector((0, 1, 0))
front = left.cross(up)
# Blender rig faces -Y, stands on Z. Use one heading throughout the take.
def in_rig(v):
    return Vector((v.dot(left), -v.dot(front), v.y))

# Read the original glTF bind axes, which differ from the display axes in Blender.
raw = (RESIDENT / 'luna-walk-room.glb').read_bytes()
doc = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
bind = {}
def read_bind(i, parent):
    node = doc['nodes'][i]
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    bind[node['name']] = parent @ Quaternion((w, x, y, z))
    for child in node.get('children', []):
        read_bind(child, bind[node['name']])
for i in doc['scenes'][0]['nodes']:
    read_bind(i, Quaternion())
basis = Quaternion((1, 0, 0), math.pi / 2)
joints = {p.name.removeprefix('mixamorig:'): p for p in rig.pose.bones}
def gltf_world(joint, orientation):
    p = joints[joint]
    return basis.inverted() @ orientation @ p.bone.matrix_local.to_quaternion().inverted() @ basis @ bind[p.name]

aims = [('Spine', 'Spine1', 'root', 'lowerback'), ('Spine1', 'Spine2', 'lowerback', 'upperback'),
        ('Spine2', 'Neck', 'upperback', 'thorax'), ('Neck', 'Head', 'lowerneck', 'upperneck')]
for side, prefix in [('Left', 'l'), ('Right', 'r')]:
    aims.extend([(side+'Arm', side+'ForeArm', prefix+'clavicle', prefix+'humerus'),
                 (side+'ForeArm', side+'Hand', prefix+'humerus', prefix+'radius')])

# Measure both endpoints in the native character, including the ground-height
# and ankle orientation of each shoe on the supported front-edge seat.
def hip_position(frame):
    scene.frame_set(frame)
    return joints['Hips'].head.copy()

standing_hip = hip_position(1)
seated_hip = hip_position(53)
soles = {side: joints[side+'Foot'].matrix.copy() for side in ('Left', 'Right')}
# The contact reference supplies the open palm, finger chain and elbow bend
# plane. Move the palm from the curved lip to the flat part of each fixed pad.
scene.frame_set(72)
braced = {name: p.matrix.copy() for name, p in joints.items()}
finger_local = {name: p.parent.matrix.to_quaternion().inverted() @ p.matrix.to_quaternion()
                for name, p in joints.items() if 'Hand' in name and not name.endswith('Hand')}

def posed_head(p, rotations, hip):
    if not p.parent:
        return hip
    parent = p.parent
    name = parent.name.removeprefix('mixamorig:')
    old = parent.matrix.to_quaternion()
    return posed_head(parent, rotations, hip) + rotations.get(name, old) @ old.inverted() @ (p.head-parent.head)

def brace_arm(side, target, hip, reach):
    upper, lower, hand = [side+joint for joint in ('Arm', 'ForeArm', 'Hand')]
    arm, forearm, palm = [joints[name] for name in (upper, lower, hand)]
    origin = posed_head(arm, target, hip)
    wrist = posed_head(palm, target, hip)
    sign = 1 if side == 'Left' else -1
    rest_point = braced[hand].translation + Vector((-sign*.004, .075, -.0149 if side == 'Left' else -.0103)) / 1.43
    wrist = wrist.lerp(rest_point, reach)
    wrist.z += .135 / 1.43 * math.sin(math.pi*reach)
    delta = wrist-origin
    axis = delta.normalized()
    humerus, radius = forearm.head-arm.head, palm.head-forearm.head
    length = min(delta.length, humerus.length+radius.length-1e-6)
    along = (length**2 + humerus.length_squared-radius.length_squared)/(2*length)
    support_rotation = Quaternion((0, 0, 1), sign*.21) @ braced[hand].to_quaternion()
    hand_rotation = target[hand].slerp(support_rotation, reach)
    knuckle = joints[side+'HandMiddle1']
    palm_axis = palm.matrix.to_quaternion().inverted() @ (knuckle.head-palm.head).normalized()
    # Choose the bend plane closest to putting the elbow behind the palm.
    old_elbow = posed_head(forearm, target, hip)-origin
    desired_elbow = delta - (hand_rotation @ palm_axis) * radius.length
    pole = old_elbow.lerp(desired_elbow, reach)
    pole = (pole-axis*pole.dot(axis)).normalized()
    elbow = origin + axis*along + pole*math.sqrt(max(0, humerus.length_squared-along**2))
    rest_wrist = forearm.bone.matrix_local.to_quaternion().inverted() @ palm.bone.matrix_local.to_quaternion()
    forearm_roll = hand_rotation @ rest_wrist.inverted()
    for name, bone, segment, destination, rotation in [
        (upper, arm, humerus, elbow-origin, target[upper].slerp(braced[upper].to_quaternion(), reach)),
        (lower, forearm, radius, origin+axis*length-elbow, forearm_roll),
    ]:
        local_axis = bone.matrix.to_quaternion().inverted() @ segment
        target[name] = (rotation @ local_axis).rotation_difference(destination) @ rotation
    relaxed = target[lower] @ rest_wrist
    flex = relaxed.rotation_difference(hand_rotation)
    angle = min(flex.angle, 2*math.pi - flex.angle)
    wrist_weight = min(ramp((reach-.7)/.3), math.radians(50)/max(angle, 1e-6))
    target[hand] = relaxed.slerp(hand_rotation, wrist_weight)
    for name, contact in finger_local.items():
        if not name.startswith(side):
            continue
        joint = joints[name]
        parent = joint.parent.name.removeprefix('mixamorig:')
        local = joint.parent.matrix.to_quaternion().inverted() @ joint.matrix.to_quaternion()
        target[name] = target[parent] @ local.slerp(contact, reach)

hips = []
tracks = {}
previous = {}
times = []
clock = []
for number in range(FIRST, HOLD + 1, 4):
    points = landmarks(frames[number])
    pelvis = points['root']
    # Fit the recorded hip descent and horizontal retreat to Luna's supported
    # front-edge seat. The old deep scoot lifts both soles on this tall chair.
    start = Vector(frames[FIRST]['root'][:3])
    depth = clamp((start-pelvis).dot(front) / (start-seated['root']).dot(front))
    drop = clamp((start.y-pelvis.y) / (start.y-seated['root'].y))
    support = .55*depth + .45*drop
    reference = 52 * (1 - (1-support)**2.8)
    scene.frame_set(1 + int(reference), subframe=reference % 1)
    times.append((number-FIRST)/120)
    clock.extend((reference/30, 0, 0))
    # Fade from the room stance into the captured forward lean and recovery.
    weight = ramp((number-FIRST)/44)
    hip = standing_hip.lerp(seated_hip, depth**1.6)
    hip.z = standing_hip.z + (seated_hip.z-standing_hip.z)*drop - .0134*drop**3 / 1.43
    # Record a small lateral weight shift in the seat's width allowance.
    lateral = (pelvis-start).dot(left) - depth*(seated['root']-start).dot(left)
    hip.x += lateral * .012 * weight
    hip_shift = hip-joints['Hips'].head
    hips.extend(basis.inverted() @ hip)
    # Bake the pelvis rotation on the same clock as the IK. Resampling the old
    # hip curve independently between these keys makes the feet slide.
    target = {'Hips': joints['Hips'].matrix.to_quaternion()}
    for joint, child, a, b in aims:
        p = joints[joint]
        axis = (joints[child].head-p.head).normalized()
        direction = in_rig(points[b]-points[a]).normalized()
        swing = Quaternion().slerp(axis.rotation_difference(direction), weight)
        target[joint] = swing @ p.matrix.to_quaternion()
    # Plant the ankle and guide the two-link knee with the observed femur.
    # Solve in armature space to respect Luna's segment lengths and seat height.
    for side, prefix in [('Left', 'l'), ('Right', 'r')]:
        thigh, shin, foot = (joints[side+n] for n in ('UpLeg', 'Leg', 'Foot'))
        origin = thigh.head + hip_shift
        sole = soles[side]
        line = sole.translation - origin
        axis = line.normalized()
        upper = shin.head-thigh.head
        lower = foot.head-shin.head
        distance = min(line.length, upper.length+lower.length-1e-7)
        along = (distance**2 + upper.length_squared-lower.length_squared)/(2*distance)
        # On the tall cushion keep the knee aimed over its own shoe.
        direction = in_rig(points[prefix+'femur']-points[prefix+'hipjoint']).normalized()
        direction.x = max(-.17, min(.17, direction.x))
        pole = (direction-axis*direction.dot(axis)).normalized()
        forward = Vector((0,-1,0))
        guide = (forward-axis*forward.dot(axis)).normalized()
        pole = guide.lerp(pole, .5*drop).normalized()
        knee = origin + along*axis + math.sqrt(max(0, upper.length_squared-along**2))*pole
        ankle = origin + distance*axis
        target[side+'UpLeg'] = upper.rotation_difference(knee-origin) @ thigh.matrix.to_quaternion()
        target[side+'Leg'] = lower.rotation_difference(ankle-knee) @ shin.matrix.to_quaternion()
        target[side+'Foot'] = sole.to_quaternion()
    # The free rear hem reaches the curved cushion before the loaded thighs.
    # Lift its three rear panels about their waist attachments as support builds.
    for joint in ('Dress_Back_01', 'Dress_Back_L_01', 'Dress_Back_R_01'):
        target[joint] = Quaternion((1, 0, 0), .045 * drop**3) @ joints[joint].matrix.to_quaternion()
    # Preserve the clavicle orientation while the captured chest leans.
    for side in ['Left','Right']:
        joint = side+'Shoulder'
        target[joint] = joints[joint].matrix.to_quaternion()
    # Start the reach with a relaxed wrist before turning toward the padding.
    for side in ('Left', 'Right'):
        parent = joints[side+'ForeArm']
        hand = joints[side+'Hand']
        rest = parent.bone.matrix_local.to_quaternion().inverted() @ hand.bone.matrix_local.to_quaternion()
        pose = parent.matrix.to_quaternion().inverted() @ hand.matrix.to_quaternion()
        target[side+'Hand'] = target[side+'ForeArm'] @ rest.slerp(pose, .24)
        brace_arm(side, target, hip, ramp((number-217)/200))
    for joint, rotation in target.items():
        local = gltf_world(joint, rotation)
        if joints[joint].parent:
            parent = joints[joint].parent.name.removeprefix('mixamorig:')
            parent_rotation = target.get(parent, joints[parent].matrix.to_quaternion())
            local = gltf_world(parent, parent_rotation).inverted() @ local
        local.normalize()
        if joint in previous:
            local.make_compatible(previous[joint])
        previous[joint] = local
        tracks.setdefault(joints[joint].name, []).extend((local.x, local.y, local.z, local.w))

# Bone-only glTF overlay. The contact marker selects the synchronized reference
# pose for the pelvis, fingers, cloth bones and pre-skin cushion correction.
binary = bytearray()
views, accessors, nodes, samplers, channels = [], [], [], [], []
def accessor(values, kind, width):
    data = struct.pack(f'<{len(values)}f', *values)
    views.append(dict(buffer=0, byteOffset=len(binary), byteLength=len(data)))
    binary.extend(data)
    item = dict(bufferView=len(views)-1, componentType=5126, count=len(values)//width, type=kind)
    if width == 1:
        item.update(min=[min(values)], max=[max(values)])
    accessors.append(item)
    return len(accessors)-1

time = accessor(times, 'SCALAR', 1)
indices = {}
def channel(name, path, values, kind, width):
    if name not in indices:
        indices[name] = len(nodes)
        nodes.append(dict(name=name))
    channels.append(dict(sampler=len(samplers), target=dict(node=indices[name], path=path)))
    samplers.append(dict(input=time, output=accessor(values, kind, width), interpolation='LINEAR'))
for name, values in tracks.items():
    channel(name, 'rotation', values, 'VEC4', 4)
channel('mixamorig:Hips', 'translation', hips, 'VEC3', 3)
channel('ChairContactTime', 'translation', clock, 'VEC3', 3)
result = dict(asset=dict(version='2.0'), scene=0, scenes=[dict(nodes=list(range(len(nodes))))],
              nodes=nodes, animations=[dict(name='Chair_CMU_113_15', channels=channels, samplers=samplers)],
              buffers=[dict(byteLength=len(binary))], bufferViews=views, accessors=accessors)
metadata = json.dumps(result, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
with (RESIDENT / 'luna-chair-cmu113.glb').open('wb') as out:
    out.write(struct.pack('<4sII', b'glTF', 2, 28+len(metadata)+len(binary)))
    for tag, data in [(b'JSON', metadata), (b'BIN\0', binary)]:
        out.write(struct.pack('<I4s', len(data), tag))
        out.write(data)
