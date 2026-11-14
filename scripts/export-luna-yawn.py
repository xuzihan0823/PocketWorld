"""Bake the user-supplied Mixamo Yawn onto Luna's upper-body rest basis.

Run with Blender --background --python scripts/export-luna-yawn.py -- <Yawn.fbx>.
The planted lower body remains owned by the runtime neutral pose.
"""
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source))
rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
raw = (ROOT / "assets/public/models/resident/luna-walk-room.glb").read_bytes()
doc = json.loads(raw[20:20 + struct.unpack_from("<I", raw, 12)[0]])
nodes = doc["nodes"]
parents = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
world = {}

def rest(i):
    if i not in world:
        node = nodes[i]
        q = node.get("rotation", [0, 0, 0, 1])
        local = Matrix.LocRotScale(Vector(node.get("translation", [0, 0, 0])),
                                   Quaternion((q[3], *q[:3])), Vector(node.get("scale", [1, 1, 1])))
        if "matrix" in node:
            a = node["matrix"]
            local = Matrix([a[j:j + 4] for j in range(0, 16, 4)]).transposed()
        world[i] = rest(parents[i]) @ local if i in parents else local
    return world[i]

bones = {b.name.replace(":", ""): b for b in rig.pose.bones}
selected = [i for i, n in enumerate(nodes) if n.get("name", "").replace(":", "") in bones
            and any(part in n["name"] for part in ("Spine", "Neck", "Head", "Shoulder", "Arm", "Hand"))]
conversion = Matrix.Rotation(-math.pi / 2, 4, "X")
corrections = {}
for i in selected:
    name = nodes[i]['name'].replace(':', '')
    bone = bones[name]
    children = [j for j in nodes[i].get('children', []) if nodes[j].get('name', '').replace(':', '') in bones]
    if 'Hand' in name and not any(c.isdigit() for c in name):
        children = [j for j in children if 'Middle1' in nodes[j]['name']]
    if children:
        child = children[0]
        source_child = bones[nodes[child]['name'].replace(':', '')]
        a = (rest(child).translation - rest(i).translation).normalized()
        b = (conversion @ rig.matrix_world.to_4x4()).to_3x3() @ (source_child.bone.head_local - bone.bone.head_local)
        corrections[i] = a.rotation_difference(b.normalized())
    else:
        corrections[i] = Quaternion()
samples = {i: [] for i in selected}
previous = {}
start, end = map(int, rig.animation_data.action.frame_range)
for frame in range(start, end + 1):
    bpy.context.scene.frame_set(frame)
    posed = {}
    for i in selected:
        bone = bones[nodes[i]["name"].replace(":", "")]
        delta = conversion @ rig.matrix_world @ bone.matrix @ bone.bone.matrix_local.inverted() @ rig.matrix_world.inverted() @ conversion.inverted()
        posed[i] = delta.to_quaternion() @ corrections[i] @ rest(i).to_quaternion()
    for i in selected:
        parent = parents.get(i)
        basis = posed.get(parent, rest(parent).to_quaternion() if parent is not None else Quaternion())
        q = basis.inverted() @ posed[i]
        if i in previous and q.dot(previous[i]) < 0:
            q.negate()
        previous[i] = q.copy()
        samples[i].extend([q.x, q.y, q.z, q.w])

binary = bytearray()
views, accessors = [], []
def add(values, kind, width):
    offset = len(binary)
    binary.extend(struct.pack("<" + "f" * len(values), *values))
    views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(values) * 4})
    accessor = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(values) // width, "type": kind}
    if kind == "SCALAR":
        accessor.update(min=[min(values)], max=[max(values)])
    accessors.append(accessor)
    return len(accessors) - 1

time = add([(f - start) / 30 for f in range(start, end + 1)], "SCALAR", 1)
samplers, channels = [], []
for index, i in enumerate(selected):
    samplers.append({"input": time, "output": add(samples[i], "VEC4", 4), "interpolation": "LINEAR"})
    channels.append({"sampler": index, "target": {"node": index, "path": "rotation"}})
result = {"asset": {"version": "2.0", "generator": "PocketWorld Mixamo upper-body retarget"},
          "scene": 0, "scenes": [{"nodes": list(range(len(selected)))}],
          "nodes": [{"name": nodes[i]["name"]} for i in selected],
          "animations": [{"name": "Luna_Yawn", "samplers": samplers, "channels": channels}],
          "buffers": [{"byteLength": len(binary)}], "bufferViews": views, "accessors": accessors}
encoded = json.dumps(result, separators=(",", ":")).encode()
encoded += b" " * (-len(encoded) % 4)
output = struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
output += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
output += struct.pack("<II", len(binary), 0x004E4942) + binary
target = ROOT / "assets/public/models/resident/luna-yawn.glb"
target.write_bytes(output)
print(target, len(output), "bytes", len(selected), "rotation tracks", (end - start) / 30, "seconds")
