"""Local surface/weight polish on the existing phase-two asset. Never creates bones.

Input is the phase-two .blend at 8b3c2eb, kept in Git; pass its path explicitly.
Original triangles, positions, UVs, packed images and all 103 rest bones survive.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

spec = importlib.util.spec_from_file_location('phase2', Path(__file__).with_name('refine_tripo_dynamics.py'))
phase2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(phase2)
SOURCE_SHA256 = '4ee16afb8bf86c50ef22dbd6e7582e6fa6607f135ce229c07f66780bd78b1c2b'


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def surface_data(obj):
    p = np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
    h = np.array([v.value for v in obj.data.attributes['Secondary_Hair_Region'].data])
    d = np.array([v.value for v in obj.data.attributes['Secondary_Dress_Region'].data])
    return p, h, d


def body_graph(obj, p, h, d):
    # Geometric adjacency across UV seams, without welding the actual mesh or hair.
    lookup, groups, mapping = {}, [], {}
    for i, point in enumerate(p):
        if h[i] or d[i]:
            continue
        key = tuple(np.round(point, 5))
        if key not in lookup:
            lookup[key] = len(groups)
            groups.append([])
        k = lookup[key]
        groups[k].append(i)
        mapping[i] = k
    edges, directed, neighbors = Counter(), {}, defaultdict(set)
    for face in obj.data.polygons:
        ids = list(face.vertices)
        if any(i not in mapping for i in ids):
            continue
        for a, b in zip(ids, ids[1:] + ids[:1]):
            u, v = mapping[a], mapping[b]
            if u == v:
                continue
            key = tuple(sorted((u, v)))
            edges[key] += 1
            directed[key] = (u, v)
            neighbors[u].add(v)
            neighbors[v].add(u)
    return groups, mapping, neighbors, [directed[k] for k, n in edges.items() if n == 1]


def polish_weights(obj, p, h, d):
    names = [g.name for g in obj.vertex_groups]
    groups, mapping, adjacency, _ = body_graph(obj, p, h, d)
    original = np.zeros((len(p), len(names)))
    for v in obj.data.vertices:
        for g in v.groups:
            original[v.index, g.group] = g.weight
    w = original.copy()
    arm_ids = [i for i, n in enumerate(names) if any(x in n for x in ('Arm', 'Hand', 'Shoulder'))]
    leg_ids = [i for i, n in enumerate(names) if any(x in n for x in ('Leg', 'Foot', 'Toe'))]
    body = ~(h | d)
    # Explicitly bounded islands found in the raised-arm edge audit.
    for anchor in [7681, 7650, 22240]:
        for i in groups[mapping[anchor]]:
            w[i, arm_ids] = 0
            w[i, leg_ids] = 0
            w[i] /= w[i].sum()
    joint_weights = np.array([w[ids].mean(0) for ids in groups])
    centers = np.array([p[ids[0]] for ids in groups])
    distance = np.linalg.norm(centers - p[12140], axis=1)
    editable = distance < .018
    strength = .30 * smooth((.018 - distance) / .012)
    for _ in range(2):
        old = joint_weights.copy()
        for i in np.where(editable)[0]:
            ns = sorted(adjacency[i])
            if ns:
                dist = np.linalg.norm(centers[ns] - centers[i], axis=1)
                blend = np.average(old[ns], axis=0, weights=1 / np.maximum(dist, .002))
                joint_weights[i] = old[i] * (1 - strength[i]) + blend * strength[i]
    for k in np.where(editable)[0]:
        for i in groups[k]:
            w[i] = joint_weights[k]
    changed = []
    for i in np.where(np.max(np.abs(w - original), axis=1) > 1e-7)[0]:
        row = w[i]
        keep = np.argsort(row)[-4:]
        row[[j for j in range(len(names)) if j not in keep]] = 0
        row[row < 1e-4] = 0
        row /= row.sum()
        for g in list(obj.data.vertices[i].groups):
            obj.vertex_groups[g.group].remove([int(i)])
        for j in np.where(row > 0)[0]:
            obj.vertex_groups[int(j)].add([int(i)], float(row[j]), 'REPLACE')
        changed.append(int(i))
    return changed


def boundary_cycles(boundary):
    # Extract simple directed loops, including loops touching at one vertex.
    outgoing = defaultdict(list)
    for a, b in boundary:
        outgoing[a].append(b)
    unused = set(boundary)
    cycles = []
    while unused:
        a, b = min(unused)
        path = [a]
        while (a, b) in unused:
            unused.remove((a, b))
            if b in path:
                cycles.append(path[path.index(b):])
                break
            path.append(b)
            choices = [c for c in outgoing[b] if (b, c) in unused]
            if not choices:
                break
            a, b = b, min(choices)
    return cycles


def close_local_surfaces(obj, p, h, d):
    mesh = obj.data
    groups, _, _, boundary = body_graph(obj, p, h, d)
    loops = []
    for cycle in boundary_cycles(boundary):
        ids = [groups[k][0] for k in cycle]
        points = p[ids]
        if len(ids) >= 3 and points[:, 2].min() > .645 and points[:, 2].max() < .78:
            loops.append(ids)
    # Find atlas swatches from actual nearby skin/fabric. No new texture is generated.
    shader = next(n for n in mesh.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    image = shader.inputs['Base Color'].links[0].from_node.image
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)
    uvs = np.array([v.uv[:] for v in mesh.uv_layers.active.data])
    candidates = []
    for face in mesh.polygons:
        ids = list(face.vertices)
        if h[ids[0]] or d[ids[0]]:
            continue
        center = p[ids].mean(0)
        if .63 < center[2] < .80:
            uv = uvs[list(face.loop_indices)].mean(0)
            x, y = np.clip((uv * image.size[:]).astype(int), 5, np.array(image.size[:]) - 6)
            swatch = pixels[y-4:y+5, x-4:x+5, :3]
            color = swatch.mean(axis=(0, 1))
            flesh = color[0] > color[2] + .035 and color[0] > color[1] + .025
            candidates.append((center, uv, color, flesh, float(swatch.std(axis=(0, 1)).mean())))
    added, added_uv, report = [], [], []
    existing = {tuple(sorted(face.vertices)) for face in mesh.polygons}
    for ids in loops:
        points = p[ids]
        center = points.mean(0)
        skin = center[2] > .725
        choices = [c for c in candidates if c[3] == skin]
        sample = min(choices, key=lambda c: np.linalg.norm(c[0] - center) + c[4] * .3)
        vectors = [Vector(obj.data.vertices[i].co) for i in ids]
        triangles = tessellate_polygon([vectors])
        count = 0
        _, _, basis = np.linalg.svd(points - center, full_matrices=False)
        planar = (points - center) @ basis[:2].T
        span = max(np.abs(planar).max(), .001)
        patch_uv = sample[1] + planar / span * .00065
        for triangle in triangles:
            indices = [int(v) if isinstance(v, int) else min(range(len(vectors)), key=lambda i: (vectors[i] - v).length_squared) for v in triangle]
            a, b, c = [points[i] for i in indices]
            if np.linalg.norm(np.cross(b-a, c-a)) < 1e-9:
                continue
            # Boundary follows the existing face; the closing surface must oppose it.
            indices.reverse()
            face = [ids[i] for i in indices]
            signature = tuple(sorted(face))
            if signature in existing:
                continue
            existing.add(signature)
            added.append(face)
            added_uv.extend([patch_uv[i].tolist() for i in indices])
            count += 1
        if count:
            report.append({'boundary_vertices': ids, 'triangles': count, 'skin': bool(skin)})
    vertices = [v.co[:] for v in mesh.vertices]
    faces = [f.vertices[:] for f in mesh.polygons] + added
    result = bpy.data.meshes.new('Tripo_Polished_Surface')
    result.from_pydata(vertices, [], faces)
    for mat in mesh.materials:
        result.materials.append(mat)
    for layer in mesh.uv_layers:
        target = result.uv_layers.new(name=layer.name)
        target.data.foreach_set('uv', np.concatenate([np.array([v.uv[:] for v in layer.data]).flatten(), np.array(added_uv).flatten()]))
    old_normals = [n.vector[:] for n in mesh.corner_normals]
    vertex_normals = np.array([v.normal[:] for v in mesh.vertices])
    for face in result.polygons:
        face.use_smooth = True
        if face.index < len(mesh.polygons):
            face.material_index = mesh.polygons[face.index].material_index
    result.normals_split_custom_set(old_normals + [tuple(vertex_normals[i]) for face in added for i in face])
    weights = [[(g.group, g.weight) for g in v.groups] for v in mesh.vertices]
    group_names = [g.name for g in obj.vertex_groups]
    for name, kind in [('Secondary_Hair_Region', 'BOOLEAN'), ('Secondary_Dress_Region', 'BOOLEAN'), ('Phase1_Vertex', 'INT')]:
        attr = result.attributes.new(name, kind, 'POINT')
        attr.data.foreach_set('value', [x.value for x in mesh.attributes[name].data])
    obj.data = result
    obj.vertex_groups.clear()
    for name in group_names:
        obj.vertex_groups.new(name=name)
    for i, row in enumerate(weights):
        for group, weight in row:
            obj.vertex_groups[group].add([i], weight, 'REPLACE')
    assert not result.validate(clean_customdata=False), 'Local patches must be valid before export'
    return report


def evaluated_coords(obj):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    coords = np.array([obj.matrix_world @ v.co for v in mesh.vertices])
    ev.to_mesh_clear()
    return coords


def skin_matrices(obj, arm):
    transforms = [np.array(arm.matrix_world @ arm.pose.bones[g.name].matrix @
                           arm.data.bones[g.name].matrix_local.inverted() @
                           arm.matrix_world.inverted() @ obj.matrix_world)[:3, :3]
                  for g in obj.vertex_groups]
    return np.array([sum((transforms[g.group] * g.weight for g in v.groups), np.zeros((3, 3)))
                     for v in obj.data.vertices])


def sculpt_arm_correctives(obj, arm):
    p, h, d = surface_data(obj)
    groups, mapping, neighbors, _ = body_graph(obj, p, h, d)
    centers = np.array([p[ids[0]] for ids in groups])
    mask = (smooth((centers[:, 2] - .63) / .025) * smooth((.80 - centers[:, 2]) / .025)
            * smooth((.14 - np.abs(centers[:, 0])) / .025)
            * smooth((np.abs(centers[:, 0]) - .025) / .02)
            * np.maximum(smooth((centers[:, 1] + .07) / .025), smooth((centers[:, 2] - .72) / .025)))
    selected = np.where(mask > 0)[0]
    pairs = np.array([(a, b) for a in neighbors for b in neighbors[a] if a < b and (mask[a] or mask[b])])
    rest = np.linalg.norm(centers[pairs[:, 0]] - centers[pairs[:, 1]], axis=1)
    obj.shape_key_add(name='Basis')
    stats = []
    for level in [1, 2, 3]:
        for key in obj.data.shape_keys.key_blocks:
            key.value = 0
        # Invert the smooth envelope to sample exactly 1/3, 2/3, 1 elevation.
        low, high = 0., 1.
        for _ in range(30):
            mid = (low + high) / 2
            if smooth(mid) < level / 3:
                low = mid
            else:
                high = mid
        phase2.pose(arm, 'ArmsUp', .8 * (low + high) / 2)
        posed = evaluated_coords(obj)
        q = np.array([posed[ids].mean(0) for ids in groups])
        target = q.copy()
        # Local fairing of the pinched axilla; the boundary and all hair/skirt stay fixed.
        for _ in range(8):
            previous = target.copy()
            for i in selected:
                ns = sorted(neighbors[i])
                if ns:
                    blend = .20 * mask[i] * smooth((centers[i, 2] - .68) / .035)
                    target[i] = previous[i] * (1 - blend) + previous[ns].mean(0) * blend
        # Bound local strain instead of hiding the hole with a floating backing surface.
        for _ in range(45):
            delta = target[pairs[:, 1]] - target[pairs[:, 0]]
            length = np.linalg.norm(delta, axis=1)
            excess = np.maximum(0, length - (rest * 1.75 + .002))
            correction = delta * (excess / np.maximum(length, 1e-8))[:, None]
            ma, mb = mask[pairs[:, 0]], mask[pairs[:, 1]]
            total = np.maximum(ma + mb, 1e-6)
            offsets = np.zeros_like(target)
            counts = np.zeros(len(target))
            np.add.at(offsets, pairs[:, 0], correction * (ma / total)[:, None])
            np.add.at(offsets, pairs[:, 1], -correction * (mb / total)[:, None])
            np.add.at(counts, pairs[:, 0], excess > 0)
            np.add.at(counts, pairs[:, 1], excess > 0)
            target += offsets / np.maximum(counts, 1)[:, None]
        matrices = skin_matrices(obj, arm)
        key = obj.shape_key_add(name=f'Axilla_Raise_{level}')
        maximum = 0.
        for i in selected:
            for vertex in groups[i]:
                delta = target[i] - posed[vertex]
                local = np.linalg.solve(matrices[vertex], delta)
                key.data[vertex].co += Vector(local)
                maximum = max(maximum, float(np.linalg.norm(delta)))
        stats.append({'key': key.name, 'max_posed_offset': maximum, 'vertices': sum(len(groups[i]) for i in selected)})
    phase2.reset(arm)
    return stats


def apply_correctives(obj, name, t):
    if not obj.data.shape_keys:
        return
    envelope = float(smooth(min(1., t / .8, (4 - t) / .8))) if name == 'ArmsUp' else 0.
    for level in [1, 2, 3]:
        obj.data.shape_keys.key_blocks[f'Axilla_Raise_{level}'].value = max(0., 1 - abs(envelope * 3 - level))
    envelope = float(smooth(min(1., t / .8, (4 - t) / .8)))
    for pose_name in ['Sit', 'LieDown']:
        key = obj.data.shape_keys.key_blocks.get(pose_name + '_Clearance')
        if key:
            key.value = envelope if name == pose_name else 0.


def body_capsules(arm):
    def rest(name):
        return arm.matrix_world @ arm.data.bones['mixamorig:' + name].head_local
    up = (rest('Head') - rest('Hips')).normalized()
    left = (rest('LeftUpLeg') - rest('RightUpLeg')).normalized()
    front = left.cross(up).normalized()
    specs = [('Head', rest('Head') + up * .025, rest('Head') + up * .075, .060, 'hair'),
             ('Spine2', rest('Spine2') - front * .015, rest('Spine2') + up * .055 - front * .015, .052, 'hair'),
             ('Spine', rest('Spine') - front * .025, rest('Spine2') - front * .025, .050, 'both'),
             ('Hips', rest('Hips') - left * .032 - front * .025, rest('Hips') + left * .032 - front * .025, .045, 'both')]
    for side in ['Left', 'Right']:
        specs.append((side + 'Arm', rest(side + 'Arm'), rest(side + 'Arm').lerp(rest(side + 'ForeArm'), .38), .029, 'hair'))
        specs.append((side + 'UpLeg', rest(side + 'UpLeg').lerp(rest(side + 'Leg'), .15), rest(side + 'Leg'), .039, 'dress'))
    result = []
    for name, a, b, radius, part in specs:
        bone = arm.pose.bones['mixamorig:' + name]
        matrix = arm.matrix_world @ bone.matrix @ bone.bone.matrix_local.inverted() @ arm.matrix_world.inverted()
        result.append((np.array(matrix @ a), np.array(matrix @ b), radius, part))
    return result


def project_contacts(points, mask, capsules, part, clearance=.002):
    target = points.copy()
    indices = np.where(mask)[0]
    for _ in range(5):
        for a, b, radius, kind in capsules:
            if kind not in (part, 'both'):
                continue
            axis = b - a
            t = np.clip((target[indices] - a) @ axis / max(axis @ axis, 1e-12), 0, 1)
            closest = a + t[:, None] * axis
            delta = target[indices] - closest
            distance = np.linalg.norm(delta, axis=1)
            push = np.maximum(0, radius + clearance - distance)
            target[indices] += delta / np.maximum(distance, 1e-8)[:, None] * push[:, None]
    return target


def sculpt_contact_correctives(obj, arm):
    p, h, d = surface_data(obj)
    reports = []
    for pose_name in ['Sit', 'LieDown']:
        for key in obj.data.shape_keys.key_blocks:
            key.value = 0
        phase2.pose(arm, pose_name, 2.)
        posed = evaluated_coords(obj)
        capsules = body_capsules(arm)
        hair = h & (p[:, 2] < .84)
        target = project_contacts(posed, hair, capsules, 'hair')
        target = project_contacts(target, d, capsules, 'dress')
        # Feather only the displacement into adjacent cloth vertices; retain the strand/fold shape.
        delta = target - posed
        for region in [hair, d]:
            groups, _, neighbors, _ = body_graph(obj, p, ~region, np.zeros(len(p), dtype=bool))
            disp = np.array([delta[ids].mean(0) for ids in groups])
            for _ in range(3):
                old = disp.copy()
                for i in neighbors:
                    disp[i] = old[i] * .65 + old[sorted(neighbors[i])].mean(0) * .35
            for i, ids in enumerate(groups):
                delta[ids] = disp[i]
        target = project_contacts(posed + delta, hair, capsules, 'hair')
        target = project_contacts(target, d, capsules, 'dress')
        matrices = skin_matrices(obj, arm)
        key = obj.shape_key_add(name=pose_name + '_Clearance')
        delta = target - posed
        selected = np.where(np.linalg.norm(delta, axis=1) > 1e-6)[0]
        for i in selected:
            key.data[i].co += Vector(np.linalg.solve(matrices[i], delta[i]))
        reports.append({'pose': pose_name, 'hair_vertices': int((np.linalg.norm(delta, axis=1)[h] > 1e-6).sum()),
                        'dress_vertices': int((np.linalg.norm(delta, axis=1)[d] > 1e-6).sum()),
                        'max_posed_offset': float(np.linalg.norm(delta, axis=1).max())})
    phase2.reset(arm)
    return reports


def prepare(workspace, source):
    root, source = Path(workspace), Path(source)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_SHA256, 'Use the phase-two input at 8b3c2eb'
    scene = phase2.load_scene(source)
    bpy.context.window.scene = scene
    scene.name = 'Tripo_Dynamics_Polished'
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    obj = next(o for o in scene.objects if o.type == 'MESH')
    assert len(arm.data.bones) == 103
    phase2.reset(arm)
    p, h, d = surface_data(obj)
    changed = polish_weights(obj, p, h, d)
    patches = close_local_surfaces(obj, p, h, d)
    report = {'source_sha256': SOURCE_SHA256, 'weight_vertices': len(changed), 'changed_weight_ids': changed,
              'patches': patches, 'added_triangles': sum(p['triangles'] for p in patches),
              'triangles': len(obj.data.polygons), 'vertices': len(obj.data.vertices), 'bones': 103}
    return {'root': root, 'scene': scene, 'arm': arm, 'obj': obj, 'report': report}


def make_actions(state):
    obj, arm, scene = state['obj'], state['arm'], state['scene']
    actions = phase2.make_actions(arm, scene)
    keys = obj.data.shape_keys
    keys.animation_data_clear()
    keys.animation_data_create()
    for name in ['Walk', 'ArmsUp', 'Sit', 'LieDown']:
        action = bpy.data.actions.new('Correctives_' + name)
        keys.animation_data.action = action
        for frame in range(1, (37 if name == 'Walk' else 121) + 1, 3):
            apply_correctives(obj, name, (frame - 1) / 30)
            for key in list(keys.key_blocks)[1:]:
                key.keyframe_insert('value', frame=frame)
        action.use_fake_user = True
        actions.append(action)
        keys.animation_data.action = None
        track = keys.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, action)
        # Explicit influence makes in-Blender NLA playback independent of prior track state.
        strip.use_animated_influence = True
        strip.influence = 1.
        strip.blend_in = strip.blend_out = 0.
        strip.keyframe_insert('influence', frame=1)
        track.mute = True
    apply_correctives(obj, 'Rest', 0.)
    scene.frame_set(1)
    return actions


def bake_morph_channels(filepath, obj, last_frames=None):
    """Bake the authored Key F-curves explicitly.

    Blender 5.2 NLA export can sample muted Key tracks as constants even when the
    mesh targets and the bone tracks export correctly. Sampling the actual F-curves
    makes the resulting glTF self-contained and independent of exporter UI state.
    """
    data = filepath.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    binary = bytearray(data[28 + size:])
    names = [k.name for k in list(obj.data.shape_keys.key_blocks)[1:]]
    tracks = {t.name: t.strips[0].action for t in obj.data.shape_keys.animation_data.nla_tracks}

    def accessor(values, bounds=False):
        values = np.asarray(values, dtype='<f4').flatten()
        view = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': values.nbytes})
        binary.extend(values.tobytes())
        result = {'bufferView': view, 'componentType': 5126, 'count': len(values), 'type': 'SCALAR'}
        if bounds:
            result.update(min=[float(values.min())], max=[float(values.max())])
        doc['accessors'].append(result)
        return len(doc['accessors']) - 1

    for animation in doc['animations']:
        action = tracks[animation['name']]
        curves = {f.data_path: f for layer in action.layers for strip in layer.strips for bag in strip.channelbags for f in bag.fcurves}
        last = last_frames[animation['name']] if last_frames else (37 if animation['name'] == 'Walk' else 121)
        frames = range(1, last + 1)
        times = accessor([(frame - 1) / 30 for frame in frames], True)
        channels = [curves.get(f'key_blocks["{name}"].value') for name in names]
        values = accessor([[curve.evaluate(frame) if curve else 0. for curve in channels] for frame in frames])
        channel = next(c for c in animation['channels'] if c['target']['path'] == 'weights')
        channel['sampler'] = len(animation['samplers'])
        animation['samplers'].append({'input': times, 'output': values, 'interpolation': 'LINEAR'})
        used = sorted({c['sampler'] for c in animation['channels']})
        remap = {old: new for new, old in enumerate(used)}
        animation['samplers'] = [animation['samplers'][i] for i in used]
        for c in animation['channels']:
            c['sampler'] = remap[c['sampler']]
    # Compact references so replaced constant samplers do not leave unused accessors/views.
    references = []
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            references.extend((primitive['attributes'], k) for k in primitive['attributes'])
            if 'indices' in primitive: references.append((primitive, 'indices'))
            for target in primitive.get('targets', []): references.extend((target, k) for k in target)
    for skin in doc['skins']: references.append((skin, 'inverseBindMatrices'))
    for animation in doc['animations']:
        for sampler in animation['samplers']: references.extend([(sampler, 'input'), (sampler, 'output')])
    used = sorted({container[key] for container, key in references})
    remap = {old: new for new, old in enumerate(used)}
    doc['accessors'] = [doc['accessors'][i] for i in used]
    for container, key in references: container[key] = remap[container[key]]
    references = [(image, 'bufferView') for image in doc['images']]
    for item in doc['accessors']:
        if 'bufferView' in item: references.append((item, 'bufferView'))
        if 'sparse' in item:
            references.extend([(item['sparse']['indices'], 'bufferView'), (item['sparse']['values'], 'bufferView')])
    used = sorted({container[key] for container, key in references})
    remap = {old: new for new, old in enumerate(used)}
    packed = bytearray()
    views = []
    for i in used:
        view = doc['bufferViews'][i].copy()
        start = view.get('byteOffset', 0)
        chunk = binary[start:start + view['byteLength']]
        view['byteOffset'] = len(packed)
        packed.extend(chunk); packed.extend(b'\0' * (-len(packed) % 4))
        views.append(view)
    for container, key in references: container[key] = remap[container[key]]
    doc['bufferViews'] = views
    doc['buffers'][0]['byteLength'] = len(packed)
    encoded = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    filepath.write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(packed)) +
                         struct.pack('<II', len(encoded), 0x4e4f534a) + encoded +
                         struct.pack('<II', len(packed), 0x004e4942) + packed)


def export(state):
    root, scene, arm, obj = (state[n] for n in ['root', 'scene', 'arm', 'obj'])
    bpy.context.window.scene = scene
    actions = make_actions(state)
    arm['asset_version'] = 'tripo-secondary-rig-v2-polished'
    arm['pose_correctives'] = 'Three progressive axilla shapes; seated and supine contact shapes; baked into glTF clips'
    # Keep the original root empties: one carries the model's coordinate transform.
    assert sum(item.type == 'MESH' for item in scene.objects) == 1
    bpy.ops.object.select_all(action='DESELECT')
    for item in scene.objects:
        item.hide_set(False)
        item.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.context.view_layer.update()
    out = root / 'art/resident/tripo-dynamics/polish'
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(root / 'public/models/resident/luna-tripo-dynamics.glb'),
                             use_selection=True, use_active_scene=True, export_animations=True,
                             export_animation_mode='NLA_TRACKS', export_merge_animation='NLA_TRACK',
                             export_bake_animation=True,
                             export_nla_strips=True, export_morph=True, export_morph_animation=True,
                             export_morph_reset_sk_data=False,
                             export_try_sparse_sk=True, export_try_omit_sparse_sk=True,
                             export_extras=True, export_skins=True, export_all_influences=False,
                             export_influence_nb=4, export_yup=True, export_image_format='AUTO')
    bake_morph_channels(root / 'public/models/resident/luna-tripo-dynamics.glb', obj)
    state['report']['morph_channels_baked_from_blender_fcurves'] = True
    apply_correctives(obj, 'Rest', 0.)
    scene.frame_set(1)
    bpy.data.libraries.write(str(out.parent / 'luna-tripo-dynamics.blend'), {scene, *actions},
                             path_remap='RELATIVE', fake_user=True, compress=True)
    (out / 'repair.json').write_text(json.dumps(state['report'], indent=2) + '\n', encoding='utf-8')
    return state


def build(workspace, source):
    state = prepare(workspace, source)
    state['report']['arm_correctives'] = sculpt_arm_correctives(state['obj'], state['arm'])
    state['report']['contact_correctives'] = sculpt_contact_correctives(state['obj'], state['arm'])
    return export(state)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--source', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    print(json.dumps(build(args.workspace, args.source)['report'], indent=2))
