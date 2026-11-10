"""Add secondary bones to the supplied Tripo rig without rebuilding its body."""
import argparse
import hashlib
import heapq
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector


SOURCE_SHA256 = 'c3dd0a6fed696a085e850b49dfee9297529b1856cc600f4948b9141792ab381f'
PREFIXES = ('Hair_', 'Dress_')


def smooth(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def segment_mesh(obj):
    mesh = obj.data
    material = mesh.materials[0]
    shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    image = shader.inputs['Base Color'].links[0].from_node.image
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(image.size[1], image.size[0], 4)
    coords = np.array([obj.matrix_world @ v.co for v in mesh.vertices])
    colors = np.zeros((len(coords), 3))
    hits = np.zeros(len(coords))
    for face in mesh.polygons:
        uvs = np.array([mesh.uv_layers.active.data[i].uv[:] for i in face.loop_indices])
        center = uvs.mean(axis=0)
        for loop, uv in zip(face.loop_indices, uvs):
            sample = uv * .85 + center * .15
            pixel = np.minimum((sample * image.size[:]).astype(int), np.array(image.size[:]) - 1)
            index = mesh.loops[loop].vertex_index
            colors[index] += pixels[pixel[1], pixel[0], :3]
            hits[index] += 1
    colors /= np.maximum(hits[:, None], 1)
    points, weld = np.unique(np.round(coords, 6), axis=0, return_inverse=True)
    shared_colors = np.zeros((len(points), 3))
    np.add.at(shared_colors, weld, colors)
    shared_colors /= np.bincount(weld)[:, None]
    x, y, z = points.T
    blue = shared_colors[:, 2] - shared_colors[:, 0]
    face = (z < .895) & (z > .80) & (np.abs(x) < .051) & (y < -.055)
    hair = (z > .565) & (blue > .105) & ~face
    skirt_envelope = ((z > .342) & (z < .636)
                      & (np.abs(x) < .171 - .12 * np.maximum(z - .40, 0)))
    outside_legs = (z > .39) | (np.abs(x) > .105) | (y < -.062) | (y > .047)
    dress = skirt_envelope & ((blue > -.035) | outside_legs) & ~hair
    neighbours = [set() for _ in points]
    for edge in mesh.edges:
        a, b = weld[list(edge.vertices)]
        if a != b:
            neighbours[a].add(b)
            neighbours[b].add(a)
    for _ in range(2):
        fill = [i for i, near in enumerate(neighbours)
                if not hair[i] and z[i] > .565 and blue[i] > .06 and not face[i]
                and near and sum(hair[j] for j in near) / len(near) > .7]
        hair[fill] = True
    dress &= ~hair
    return coords, points, weld, hair, dress, neighbours


def chain_layout():
    chains = {'Hair_Back_C': [(0, .07, .87), (0, .095, .795),
                              (0, .09, .72), (0, .074, .65), (0, .055, .585)]}
    for side, sign in [('L', 1), ('R', -1)]:
        for name, points in {
            'Back': [(.065, .06, .86), (.073, .09, .79), (.074, .09, .72),
                     (.074, .07, .65), (.075, .047, .585)],
            'Side': [(.096, .015, .86), (.112, .015, .79), (.13, .015, .72),
                     (.127, .025, .65), (.135, .026, .58)],
            'Front': [(.065, -.044, .84), (.077, -.052, .78),
                      (.06, -.069, .73), (.067, -.074, .675)],
        }.items():
            chains[f'Hair_{name}_{side}'] = [(sign * x, y, z) for x, y, z in points]
    sectors = ['Front', 'Front_L', 'Left', 'Back_L', 'Back', 'Back_R', 'Right', 'Front_R']
    for sector, name in enumerate(sectors):
        angle = sector * math.tau / len(sectors)
        chains[f'Dress_{name}'] = [(math.sin(angle) * rx, -math.cos(angle) * ry, height)
                                  for rx, ry, height in [(.083, .055, .565), (.12, .08, .49),
                                                         (.142, .097, .42), (.154, .106, .35)]]
    return chains


def add_bones(armature, chains):
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    inverse = armature.matrix_world.inverted()
    try:
        for chain, points in chains.items():
            parent = armature.data.edit_bones['mixamorig:Head' if chain.startswith('Hair_') else 'mixamorig:Hips']
            for i, (head, tail) in enumerate(zip(points, points[1:]), 1):
                bone = armature.data.edit_bones.new(f'{chain}_{i:02}')
                bone.head = inverse @ Vector(head)
                bone.tail = inverse @ Vector(tail)
                bone.parent = parent
                bone.use_connect = i > 1
                bone.align_roll(inverse.to_3x3() @ Vector((0, -1, 0)))
                parent = bone
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')
    for name in ['Body', 'Hair', 'Dress']:
        collection = armature.data.collections.new(name)
        for bone in armature.data.bones:
            part = 'Hair' if bone.name.startswith('Hair_') else 'Dress' if bone.name.startswith('Dress_') else 'Body'
            if part == name:
                collection.assign(bone)
                bone.color.palette = 'THEME04' if part == 'Hair' else 'THEME03' if part == 'Dress' else 'DEFAULT'
    armature.show_in_front = True


def vertical_weights(points, height):
    for i in range(len(points) - 2):
        top, bottom = points[i][2], points[i + 1][2]
        if height >= bottom:
            blend = float(np.clip((top - height) / (top - bottom), 0, 1))
            return [(i + 1, 1 - blend), (i + 2, blend)]
    return [(len(points) - 1, 1.)]


def boundary_distance(points, neighbours, mask):
    distance = np.full(len(points), np.inf)
    queue = []
    for i in np.flatnonzero(mask):
        if any(not mask[j] for j in neighbours[i]):
            distance[i] = 0.
            heapq.heappush(queue, (0., int(i)))
    while queue:
        value, i = heapq.heappop(queue)
        if value != distance[i]:
            continue
        for j in neighbours[i]:
            candidate = value + float(np.linalg.norm(points[i] - points[j]))
            if mask[j] and candidate < distance[j]:
                distance[j] = candidate
                heapq.heappush(queue, (candidate, j))
    return distance


def assign_weights(obj, chains, segmentation):
    coords, points, weld, hair, dress, neighbours = segmentation
    original_names = [group.name for group in obj.vertex_groups]
    original = np.zeros((len(coords), len(original_names)))
    for vertex in obj.data.vertices:
        for group in vertex.groups:
            original[vertex.index, group.group] = group.weight
    shared = np.zeros((len(points), len(original_names)))
    np.add.at(shared, weld, original)
    shared /= np.bincount(weld)[:, None]
    for chain, positions in chains.items():
        for i in range(1, len(positions)):
            obj.vertex_groups.new(name=f'{chain}_{i:02}')
    names = [group.name for group in obj.vertex_groups]
    group_index = {name: i for i, name in enumerate(names)}
    hair_chains = {name: p for name, p in chains.items() if name.startswith('Hair_')}
    dress_chains = [name for name in chains if name.startswith('Dress_')]
    result = np.zeros((len(points), len(names)))
    result[:, :len(original_names)] = shared
    hair_border = boundary_distance(points, neighbours, hair)
    dress_border = boundary_distance(points, neighbours, dress)
    for index in np.where(hair | dress)[0]:
        point = points[index]
        weights = {}
        if hair[index]:
            if point[2] >= .87:
                weights['mixamorig:Head'] = 1.
            else:
                distances = []
                for name, path in hair_chains.items():
                    curve = np.array(path)[::-1]
                    xy = np.array([np.interp(point[2], curve[:, 2], curve[:, axis]) for axis in (0, 1)])
                    distances.append((name, 1 / (float(np.linalg.norm(point[:2] - xy)) ** 2 + .012 ** 2) ** 2))
                total = sum(value for _, value in distances)
                for name, value in distances:
                    amount = value / total
                    root = float(smooth((hair_chains[name][0][2] + .01 - point[2]) / .055))
                    weights['mixamorig:Head'] = weights.get('mixamorig:Head', 0.) + amount * (1 - root)
                    for segment, influence in vertical_weights(hair_chains[name], point[2]):
                        key = f'{name}_{segment:02}'
                        weights[key] = weights.get(key, 0.) + amount * root * influence
        else:
            angle = math.atan2(point[0] / .145, -point[1] / .1) % math.tau
            sector = angle / math.tau * len(dress_chains)
            left = int(sector)
            blend = sector - left
            root = float(smooth((.636 - point[2]) / .10))
            weights['mixamorig:Hips'] = 1 - root
            for offset, fraction in [(0, 1 - blend), (1, blend)]:
                name = dress_chains[(left + offset) % len(dress_chains)]
                for segment, influence in vertical_weights(chains[name], point[2]):
                    weights[f'{name}_{segment:02}'] = fraction * influence * root
            # The waist stays attached to the existing bodice across the selection boundary.
            attach = float(smooth((.636 - point[2]) / .018))
            weights = {name: weight * attach for name, weight in weights.items()}
            for j, value in enumerate(shared[index]):
                if value > 0:
                    weights[original_names[j]] = weights.get(original_names[j], 0) + value * (1 - attach)
        # This retopology welds some strands and hem vertices to the body. Fade at those joins.
        border = hair_border[index] if hair[index] else dress_border[index]
        transition = float(smooth(border / (.025 if hair[index] else .018)))
        if not hair[index] and point[2] >= .40:
            transition = 1.
        if hair[index] and point[2] >= .84:
            transition = 1.
        attachment = {}
        for j, value in enumerate(shared[index]):
            name = original_names[j]
            if 'Hand' in name or 'ForeArm' in name or (not hair[index] and ('Arm' in name or 'Shoulder' in name)):
                name = 'mixamorig:Spine2' if hair[index] else 'mixamorig:Hips'
            attachment[name] = attachment.get(name, 0.) + float(value)
        weights = {name: value * transition for name, value in weights.items()}
        for name, value in attachment.items():
            weights[name] = weights.get(name, 0.) + value * (1 - transition)
        for name in list(weights):
            if 'Hand' in name or 'ForeArm' in name or (not hair[index] and ('Arm' in name or 'Shoulder' in name)):
                destination = 'mixamorig:Spine2' if hair[index] else 'mixamorig:Hips'
                weights[destination] = weights.get(destination, 0.) + weights.pop(name)
        selected = sorted(((name, weight) for name, weight in weights.items() if weight > 1e-7),
                          key=lambda item: item[1], reverse=True)[:4]
        total = sum(value for _, value in selected)
        result[index] = 0
        for name, value in selected:
            result[index, group_index[name]] = value / total
    affected = np.where((hair | dress)[weld])[0]
    for group in obj.vertex_groups:
        group.remove(affected.tolist())
    for index in affected:
        for group in np.flatnonzero(result[weld[index]]):
            obj.vertex_groups[int(group)].add([int(index)], float(result[weld[index], group]), 'REPLACE')
    for name, mask in [('Secondary_Hair_Region', hair), ('Secondary_Dress_Region', dress)]:
        attribute = obj.data.attributes.new(name, 'BOOLEAN', 'POINT')
        attribute.data.foreach_set('value', mask[weld].tolist())
    return original, result, names


def rotate_world(armature, name, axis, angle):
    bone = armature.pose.bones[name]
    rest_world = armature.matrix_world.to_3x3() @ bone.bone.matrix_local.to_3x3()
    local_axis = rest_world.inverted() @ Vector(axis)
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = Quaternion(local_axis.normalized(), angle)


def make_checks(armature, scene, chains):
    scene.render.fps = 30
    armature.animation_data_create()
    actions = []
    for name, last in [('Secondary_Hair_Check', 120), ('Secondary_Dress_Walk_Check', 120),
                       ('Secondary_Dress_Sit_Check', 120)]:
        action = bpy.data.actions.new(name)
        armature.animation_data.action = action
        for frame in range(1, last + 1, 5):
            t = (frame - 1) / (last - 1)
            envelope = math.sin(math.pi * t) ** 2
            for bone in armature.pose.bones:
                bone.matrix_basis.identity()
            if 'Hair' in name:
                rotate_world(armature, 'mixamorig:Head', (0, 0, 1), math.sin(t * math.tau) * .25)
                for chain, points in chains.items():
                    if chain.startswith('Hair_'):
                        for i in range(1, len(points)):
                            rotate_world(armature, f'{chain}_{i:02}', (0, 1, 0),
                                         math.sin(t * math.tau - i * .35) * envelope * (.045 + .02 * i))
            elif 'Walk' in name:
                for side, sign in [('Left', 1), ('Right', -1)]:
                    swing = math.sin(t * math.tau * 2) * .32 * sign * envelope
                    rotate_world(armature, f'mixamorig:{side}UpLeg', (1, 0, 0), swing)
                    rotate_world(armature, f'mixamorig:{side}Leg', (1, 0, 0), max(0, -swing) * .7)
                for chain, points in chains.items():
                    if chain.startswith('Dress_'):
                        for i in range(1, len(points)):
                            rotate_world(armature, f'{chain}_{i:02}', (1, 0, 0),
                                         math.sin(t * math.tau * 2 - .3 * i) * .07 * envelope)
            else:
                for side in ['Left', 'Right']:
                    rotate_world(armature, f'mixamorig:{side}UpLeg', (1, 0, 0), -math.pi / 2 * envelope)
                    rotate_world(armature, f'mixamorig:{side}Leg', (1, 0, 0), math.pi / 2 * envelope)
                for chain, points in chains.items():
                    if chain.startswith('Dress_'):
                        front = (1 - chains[chain][0][1] / .055) * .5
                        rotate_world(armature, f'{chain}_01', (1, 0, 0), -(1.1 + .35 * front) * envelope)
                        rotate_world(armature, f'{chain}_02', (1, 0, 0), .18 * envelope)
                        rotate_world(armature, f'{chain}_03', (1, 0, 0), .25 * envelope)
            for bone in armature.pose.bones:
                if bone.name.startswith(PREFIXES) or any(part in bone.name for part in ['Head', 'UpLeg', 'Leg']):
                    bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
        for bone in armature.pose.bones:
            bone.matrix_basis.identity()
            if bone.name.startswith(PREFIXES) or any(part in bone.name for part in ['Head', 'UpLeg', 'Leg']):
                bone.keyframe_insert('rotation_quaternion', frame=last, group=bone.name)
        action.use_fake_user = True
        actions.append(action)
    armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis.identity()
    scene.frame_start = 1
    scene.frame_end = 120
    scene.frame_set(1)
    return actions


def build(source, editable, runtime):
    source, editable, runtime = map(lambda value: Path(value).resolve(), (source, editable, runtime))
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_SHA256, 'Unexpected input model'
    for path in [editable, runtime]:
        if path.exists():
            raise FileExistsError(f'Refusing to overwrite {path}')
        path.parent.mkdir(parents=True, exist_ok=True)
    previous = bpy.context.window.scene
    scene = bpy.data.scenes.new('Tripo_Secondary_Rig')
    try:
        bpy.context.window.scene = scene
        bpy.ops.import_scene.gltf(filepath=str(source))
        obj = next(o for o in scene.objects if o.type == 'MESH')
        armature = next(o for o in scene.objects if o.type == 'ARMATURE')
        assert len(armature.data.bones) == 53
        obj.name = 'Tripo_Resident'
        obj.data.name = 'Tripo_Resident_Surface'
        obj.data.materials[0].name = 'Tripo_Resident_Material'
        armature.name = 'Tripo_Resident_Rig'
        armature.data.name = 'Tripo_Resident_Armature'
        segmentation = segment_mesh(obj)
        chains = chain_layout()
        add_bones(armature, chains)
        original, weights, names = assign_weights(obj, chains, segmentation)
        actions = make_checks(armature, scene, chains)
        armature['asset_version'] = 'tripo-secondary-rig-v1'
        armature['source_sha256'] = SOURCE_SHA256
        armature['secondary_motion'] = 'Animation-ready bones; no runtime cloth or hair simulation'
        for image in {node.image for material in obj.data.materials for node in material.node_tree.nodes
                      if node.type == 'TEX_IMAGE' and node.image}:
            if not image.packed_file:
                image.pack()
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        for item in scene.objects:
            item.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(runtime), use_selection=True, use_active_scene=True,
                                 export_animations=False, export_extras=True, export_skins=True,
                                 export_all_influences=False, export_influence_nb=4,
                                 export_yup=True, export_image_format='AUTO')
        bpy.data.libraries.write(str(editable), {scene, *actions}, path_remap='RELATIVE',
                                 fake_user=True, compress=True)
        result = {'scene': scene, 'object': obj, 'armature': armature, 'actions': actions,
                  'segmentation': segmentation, 'original_weights': original,
                  'weights': weights, 'group_names': names, 'chains': chains}
        bpy.app.driver_namespace['pw_secondary_delivery'] = result
        print(json.dumps({'bones': len(armature.data.bones),
                          'hair_bones': sum(n.startswith('Hair_') for n in names),
                          'dress_bones': sum(n.startswith('Dress_') for n in names),
                          'hair_vertices': int(segmentation[3][segmentation[2]].sum()),
                          'dress_vertices': int(segmentation[4][segmentation[2]].sum()),
                          'editable': str(editable), 'runtime': str(runtime)}, indent=2))
        return result
    finally:
        bpy.context.window.scene = previous


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--editable', required=True)
    parser.add_argument('--runtime', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    build(args.source, args.editable, args.runtime)


if __name__ == '__main__':
    main()
