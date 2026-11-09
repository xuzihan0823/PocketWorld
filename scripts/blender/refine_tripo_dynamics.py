"""Refine the existing 103-bone asset; never add or replace its armature."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector

spec = importlib.util.spec_from_file_location('secondary_v1', Path(__file__).with_name('rig_tripo_secondary.py'))
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)


def load_scene(path):
    with bpy.data.libraries.load(str(path), link=False) as (source, target):
        target.scenes = source.scenes
    return target.scenes[0]


def reset(arm):
    arm.animation_data_clear()
    for bone in arm.pose.bones:
        bone.matrix_basis.identity()
        bone.rotation_mode = 'QUATERNION'


def repair_surface(obj, source_obj):
    mesh = obj.data
    positions = np.array([obj.matrix_world @ v.co for v in mesh.vertices])
    masks = [np.array([x.value for x in mesh.attributes['Secondary_' + k + '_Region'].data])
             for k in ['Hair', 'Dress']]
    names = [g.name for g in obj.vertex_groups]
    source_names = [g.name for g in source_obj.vertex_groups]
    assert len(source_obj.data.vertices) == len(mesh.vertices)
    source_positions = np.array([source_obj.matrix_world @ v.co for v in source_obj.data.vertices])
    assert np.abs(source_positions - positions).max() < 1e-6
    original = [{source_names[g.group]: g.weight for g in v.groups} for v in source_obj.data.vertices]
    shader = next(n for n in mesh.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    image = shader.inputs['Base Color'].links[0].from_node.image
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(image.size[1], image.size[0], 4)
    labels = []
    for face in mesh.polygons:
        ids = list(face.vertices)
        uv = np.mean([mesh.uv_layers.active.data[i].uv[:] for i in face.loop_indices], axis=0)
        pixel = np.clip((uv * image.size[:]).astype(int), 0, np.array(image.size[:]) - 1)
        r, g, b = pixels[pixel[1], pixel[0], :3]
        flesh = r > b + .035 and r > g + .025
        center = positions[ids].mean(axis=0)
        label = (1 if masks[0][ids].sum() >= 2 and not flesh
                 else 2 if masks[1][ids].sum() >= 2 and not flesh else 0)
        radius_x = np.interp(center[2], [.35, .42, .49, .565], [.154, .142, .12, .083])
        radius_y = np.interp(center[2], [.35, .42, .49, .565], [.106, .097, .08, .055])
        if label == 2 and center[2] < .53 and (center[0] / radius_x) ** 2 + (center[1] / radius_y) ** 2 < .30:
            label = 0
        labels.append(label)
    lookup, source_ids, regions, vertices, faces = {}, [], [], [], []
    for face, label in zip(mesh.polygons, labels):
        indices = []
        for old in face.vertices:
            key = (old, label)
            if key not in lookup:
                lookup[key] = len(vertices)
                vertices.append(mesh.vertices[old].co[:])
                source_ids.append(old)
                regions.append(label)
            indices.append(lookup[key])
        faces.append(indices)
    refined = bpy.data.meshes.new('Tripo_Phase2_Surface')
    refined.from_pydata(vertices, [], faces)
    refined.materials.clear()
    for material in mesh.materials:
        refined.materials.append(material)
    for uv in mesh.uv_layers:
        target = refined.uv_layers.new(name=uv.name)
        values = np.empty(len(uv.data) * 2, dtype=np.float32)
        uv.data.foreach_get('uv', values)
        target.data.foreach_set('uv', values)
    for face, source in zip(refined.polygons, mesh.polygons):
        face.use_smooth = source.use_smooth
        face.material_index = source.material_index
    refined.normals_split_custom_set([n.vector[:] for n in mesh.corner_normals])
    obj.data = refined
    obj.vertex_groups.clear()
    for name in names:
        obj.vertex_groups.new(name=name)
    chains = v1.chain_layout()
    hair_chains = {name: p for name, p in chains.items() if name.startswith('Hair_')}
    dress_chains = [name for name in chains if name.startswith('Dress_')]
    group_index = {group.name: group.index for group in obj.vertex_groups}
    for index, (old, region) in enumerate(zip(source_ids, regions)):
        point = positions[old]
        weights = {}
        if region == 1:
            distances = []
            for name, path in hair_chains.items():
                curve = np.array(path)[::-1]
                xy = np.array([np.interp(point[2], curve[:, 2], curve[:, axis]) for axis in (0, 1)])
                distances.append((name, 1 / (float(np.linalg.norm(point[:2] - xy)) ** 2 + .018 ** 2) ** 2))
            total = sum(value for _, value in distances)
            for name, value in distances:
                amount = value / total
                root = float(v1.smooth((hair_chains[name][0][2] + .01 - point[2]) / .065))
                weights['mixamorig:Head'] = weights.get('mixamorig:Head', 0) + amount * (1 - root)
                for segment, influence in v1.vertical_weights(hair_chains[name], point[2]):
                    key = f'{name}_{segment:02}'
                    weights[key] = weights.get(key, 0) + amount * root * influence
        elif region == 2:
            sector = (math.atan2(point[0] / .145, -point[1] / .1) % math.tau) / math.tau * 8
            left, blend = int(sector), sector % 1
            root = float(v1.smooth((.63 - point[2]) / .12))
            weights['mixamorig:Hips'] = 1 - root
            for offset, fraction in [(0, 1 - blend), (1, blend)]:
                name = dress_chains[(left + offset) % 8]
                for segment, influence in v1.vertical_weights(chains[name], point[2]):
                    weights[f'{name}_{segment:02}'] = fraction * influence * root
            waist = float(v1.smooth((point[2] - .60) / .03))
            weights = {name: value * (1 - waist) for name, value in weights.items()}
            attachment = {name: value for name, value in original[old].items() if 'Spine' in name or 'Hips' in name}
            if not attachment:
                attachment = {'mixamorig:Hips': 1.}
            amount = sum(attachment.values())
            for name, value in attachment.items():
                weights[name] = weights.get(name, 0) + value / amount * waist
        else:
            weights = dict(original[old])
            if sum(value for name, value in weights.items() if 'Leg' in name) > .5:
                weights = {name: value for name, value in weights.items() if not any(s in name for s in ['Arm', 'Hand', 'Shoulder'])}
        selected = sorted(((name, value) for name, value in weights.items() if value > 1e-4),
                          key=lambda item: item[1], reverse=True)[:4]
        total = sum(value for _, value in selected)
        assert total > 0, (index, old, region, point, original[old])
        for name, value in selected:
            obj.vertex_groups[group_index[name]].add([index], value / total, 'REPLACE')
    for name, values in [('Secondary_Hair_Region', np.array(regions) == 1),
                         ('Secondary_Dress_Region', np.array(regions) == 2)]:
        attr = refined.attributes.new(name, 'BOOLEAN', 'POINT')
        attr.data.foreach_set('value', values)
    attr = refined.attributes.new('Phase1_Vertex', 'INT', 'POINT')
    attr.data.foreach_set('value', source_ids)
    return {'original_vertices': len(mesh.vertices), 'vertices': len(vertices), 'triangles': len(faces),
            'split_vertices': len(vertices) - len(mesh.vertices),
            'region_faces': {name: labels.count(i) for i, name in enumerate(['body', 'hair', 'dress'])}}


def pose(arm, name, t):
    for bone in arm.pose.bones:
        bone.matrix_basis.identity()
    rotate = lambda n, axis, angle: v1.rotate_world(arm, n, axis, angle)
    envelope = min(1., t / .8, (4 - t) / .8)
    envelope = float(v1.smooth(envelope))
    if name == 'Walk':
        for side, sign in [('Left', 1), ('Right', -1)]:
            swing = math.sin(t * math.tau / 1.2) * sign
            rotate(f'mixamorig:{side}UpLeg', (1, 0, 0), swing * .38)
            rotate(f'mixamorig:{side}Leg', (1, 0, 0), max(0, -swing) * .5)
            rotate(f'mixamorig:{side}Arm', (1, 0, 0), -swing * .23)
    elif name == 'ArmsUp':
        for side, sign in [('Left', 1), ('Right', -1)]:
            rotate(f'mixamorig:{side}Shoulder', (0, 1, 0), -sign * .12 * envelope)
            rotate(f'mixamorig:{side}Arm', (0, 1, 0), -sign * 2.28 * envelope)
    elif name == 'Sit':
        for side in ['Left', 'Right']:
            rotate(f'mixamorig:{side}UpLeg', (1, 0, 0), -math.pi / 2 * envelope)
            rotate(f'mixamorig:{side}Leg', (1, 0, 0), math.pi / 2 * envelope)
            rotate(f'mixamorig:{side}Arm', (1, 0, 0), -.28 * envelope)
        for chain, points in v1.chain_layout().items():
            if chain.startswith('Dress_'):
                front = (1 - points[0][1] / .055) * .5
                rotate(chain + '_01', (1, 0, 0), -(.35 + 1.12 * front) * envelope)
                rotate(chain + '_02', (1, 0, 0), (.05 + .22 * front) * envelope)
                rotate(chain + '_03', (1, 0, 0), (.05 + .20 * front) * envelope)
        arm.pose.bones['mixamorig:Hips'].location = (arm.matrix_world.to_3x3() @ arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()).inverted() @ Vector((0, 0, -.21 * envelope))
    elif name == 'LieDown':
        rotate('mixamorig:Hips', (1, 0, 0), -math.pi / 2 * envelope)
        arm.pose.bones['mixamorig:Hips'].location = (arm.matrix_world.to_3x3() @ arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()).inverted() @ Vector((0, 0, -.39 * envelope))
        for side, sign in [('Left', 1), ('Right', -1)]:
            rotate(f'Hair_Side_{side[0]}_01', (0, 1, 0), -sign * .10 * envelope)
            rotate(f'Hair_Back_{side[0]}_02', (0, 1, 0), -sign * .08 * envelope)
    bpy.context.view_layer.update()


def make_actions(arm, scene):
    reset(arm)
    scene.render.fps = 30
    arm.animation_data_create()
    actions = []
    for name in ['Walk', 'ArmsUp', 'Sit', 'LieDown']:
        action = bpy.data.actions.new(name)
        arm.animation_data.action = action
        last = 37 if name == 'Walk' else 121
        for frame in range(1, last + 1, 3):
            pose(arm, name, (frame - 1) / 30)
            for bone in arm.pose.bones:
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
                if bone.name == 'mixamorig:Hips':
                    bone.keyframe_insert('location', frame=frame, group=bone.name)
        action.use_fake_user = True
        actions.append(action)
    arm.animation_data.action = None
    for action in actions:
        track = arm.animation_data.nla_tracks.new()
        track.name = action.name.split('.')[0]
        track.strips.new(track.name, 1, action)
        track.mute = True
    for bone in arm.pose.bones:
        bone.matrix_basis.identity()
    scene.frame_start, scene.frame_end = 1, 121
    scene.frame_set(1)
    return actions


def build(workspace, source):
    root = Path(workspace)
    assert hashlib.sha256(Path(source).read_bytes()).hexdigest() == v1.SOURCE_SHA256
    scene = load_scene(root / 'art/resident/tripo-secondary/luna-tripo-secondary.blend')
    scene.name = 'Tripo_Dynamics_Phase2'
    bpy.context.window.scene = scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    obj = next(o for o in scene.objects if o.type == 'MESH')
    assert len(arm.data.bones) == 103
    reset(arm)
    temporary = bpy.data.scenes.new('Phase2_SourceWeights')
    bpy.context.window.scene = temporary
    bpy.ops.import_scene.gltf(filepath=str(source))
    source_obj = next(o for o in temporary.objects if o.type == 'MESH')
    bpy.context.window.scene = scene
    report = repair_surface(obj, source_obj)
    for item in list(temporary.objects):
        bpy.data.objects.remove(item, do_unlink=True)
    bpy.data.scenes.remove(temporary)
    actions = make_actions(arm, scene)
    for bone in arm.data.bones:
        if bone.name.startswith(v1.PREFIXES):
            bone['secondary_length'] = bone.length
    arm['asset_version'] = 'tripo-secondary-rig-v2'
    arm['secondary_motion'] = 'Fixed-step runtime spring solver; clips are diagnostic poses'
    arm['test_clips'] = 'Walk, ArmsUp, Sit, LieDown; authored in Blender, not mocap'
    bpy.ops.object.select_all(action='DESELECT')
    for item in scene.objects:
        item.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.context.view_layer.update()
    out = root / 'art/resident/tripo-dynamics'
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(root / 'public/models/resident/luna-tripo-dynamics.glb'),
                             use_selection=True, use_active_scene=True, export_animations=True,
                             export_animation_mode='NLA_TRACKS', export_nla_strips=True,
                             export_extras=True, export_skins=True, export_all_influences=False,
                             export_influence_nb=4, export_yup=True, export_image_format='AUTO')
    bpy.data.libraries.write(str(out / 'luna-tripo-dynamics.blend'), {scene, *actions},
                             path_remap='RELATIVE', fake_user=True, compress=True)
    bpy.app.driver_namespace['pw_phase2'] = {'scene': scene, 'arm': arm, 'obj': obj, 'actions': actions}
    (out / 'repair.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return scene


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--source', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    build(args.workspace, args.source)
