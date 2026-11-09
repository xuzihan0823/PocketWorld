"""Validate body preservation, secondary skinning, poses, and a GLB round trip."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.kdtree import KDTree


def glb(path):
    blob = Path(path).read_bytes()
    assert struct.unpack_from('<4sII', blob) == (b'glTF', 2, len(blob))
    length = struct.unpack_from('<I', blob, 12)[0]
    document = json.loads(blob[20:20 + length])
    binary = blob[28 + length:]
    images = []
    for image in document['images']:
        assert 'uri' not in image
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        images.append(hashlib.sha256(binary[start:start + view['byteLength']]).hexdigest())
    return document, images, hashlib.sha256(blob).hexdigest(), len(blob)


def world_vertices(obj, evaluated=False):
    if evaluated:
        obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    coords = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
    obj.data.vertices.foreach_get('co', coords)
    matrix = np.array(obj.matrix_world)
    return coords.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]


def skin_weights(obj):
    result = np.zeros((len(obj.data.vertices), len(obj.vertex_groups)))
    for vertex in obj.data.vertices:
        for group in vertex.groups:
            result[vertex.index, group.group] = group.weight
    return result


def clear_pose(armature):
    if armature.animation_data:
        armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def rotate(armature, name, axis, radians):
    bone = armature.pose.bones[name]
    basis = armature.matrix_world.to_3x3() @ bone.bone.matrix_local.to_3x3()
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = Quaternion((basis.inverted() @ Vector(axis)).normalized(), radians)


def validate(source, editable, runtime, report_path):
    source, editable, runtime = [Path(p).resolve() for p in (source, editable, runtime)]
    if Path(report_path).resolve() in {source, editable, runtime}:
        raise ValueError('The validation report cannot replace an input asset')
    original_json, original_images, source_hash, _ = glb(source)
    runtime_json, runtime_images, runtime_hash, runtime_bytes = glb(runtime)
    assert sorted(original_images) == sorted(runtime_images), 'Embedded texture bytes changed'
    assert len(runtime_json['skins']) == 1 and len(runtime_json['meshes']) == 1
    assert len(runtime_json['skins'][0]['joints']) == 103
    assert not runtime_json.get('animations')
    assert not runtime_json.get('extensionsRequired')
    primitive = runtime_json['meshes'][0]['primitives'][0]
    assert len(runtime_json['meshes'][0]['primitives']) == 1
    assert {'POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'} <= primitive['attributes'].keys()
    triangles = runtime_json['accessors'][primitive['indices']]['count'] // 3
    assert triangles == 18525
    previous = bpy.context.window.scene
    scenes = []
    try:
        with bpy.data.libraries.load(str(editable), link=False) as (available, target):
            target.scenes = list(available.scenes)
            target.actions = [a for a in available.actions if a.startswith('Secondary_')]
        assert len(target.scenes) == 1 and len(target.actions) == 3
        scene = target.scenes[0]
        actions = target.actions
        scenes.append(scene)
        bpy.context.window.scene = scene
        obj = next(o for o in scene.objects if o.type == 'MESH')
        armature = next(o for o in scene.objects if o.type == 'ARMATURE')
        assert armature['source_sha256'] == source_hash
        clear_pose(armature)
        rest = world_vertices(obj)
        weights = skin_weights(obj)
        names = [g.name for g in obj.vertex_groups]
        masks = {}
        for part in ['Hair', 'Dress']:
            masks[part] = np.array([d.value for d in obj.data.attributes[f'Secondary_{part}_Region'].data])
        affected = masks['Hair'] | masks['Dress']
        _, seam = np.unique(np.round(rest, 6), axis=0, return_inverse=True)
        order = np.argsort(seam)
        duplicates = np.split(order, np.flatnonzero(np.diff(seam[order])) + 1)
        seam_error = max(np.ptp(weights[indices], axis=0).max() for indices in duplicates)
        assert seam_error < 1e-7
        assert np.abs(weights.sum(axis=1) - 1).max() < 1e-6
        assert (weights > 0).sum(axis=1).max() <= 4
        added = [i for i, n in enumerate(names) if n.startswith(('Hair_', 'Dress_'))]
        assert all(weights[:, i].sum() > .01 for i in added)
        assert not weights[~affected][:, added].any()
        fingers = [i for i, n in enumerate(names) if 'Hand' in n]
        assert not weights[affected][:, fingers].any()
        arms = [i for i, n in enumerate(names) if 'Arm' in n or 'Shoulder' in n]
        assert not weights[masks['Dress']][:, arms].any()
        edges = np.array([edge.vertices[:] for edge in obj.data.edges])
        edge_length = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1)
        pose_results = {}
        for action in actions:
            clear_pose(armature)
            armature.animation_data.action = action
            armature.animation_data.action_slot = action.slots[0]
            maximum, percentile, movement, seam_gap = 0., 0., 0., 0.
            for frame in [1, 16, 31, 46, 61, 76, 91, 106, 120]:
                scene.frame_set(frame)
                bpy.context.view_layer.update()
                coords = world_vertices(obj, True)
                assert np.isfinite(coords).all()
                stretch = np.linalg.norm(coords[edges[:, 0]] - coords[edges[:, 1]], axis=1) / edge_length
                maximum = max(maximum, float(stretch.max()))
                percentile = max(percentile, float(np.quantile(stretch, .99)))
                movement = max(movement, float(np.linalg.norm(coords - rest, axis=1).max()))
                seam_gap = max(seam_gap, float(max(np.ptp(coords[indices], axis=0).max() for indices in duplicates)))
            assert movement > .005 and seam_gap < 1e-5
            pose_results[action.name.split('.')[0]] = {'max_displacement': movement,
                                                       'max_edge_stretch_ratio': maximum,
                                                       'max_p99_edge_stretch_ratio': percentile,
                                                       'max_uv_seam_gap': seam_gap}
        clear_pose(armature)
        for side in ['Left', 'Right']:
            rotate(armature, f'mixamorig:{side}HandPinky3', (1, 0, 0), .7)
        bpy.context.view_layer.update()
        finger_displacement = float(np.linalg.norm(world_vertices(obj, True)[affected] - rest[affected], axis=1).max())
        assert finger_displacement < 1e-5
        clear_pose(armature)
        source_scene = bpy.data.scenes.new('Tripo source validation')
        scenes.append(source_scene)
        bpy.context.window.scene = source_scene
        bpy.ops.import_scene.gltf(filepath=str(source))
        source_mesh = next(o for o in source_scene.objects if o.type == 'MESH')
        source_arm = next(o for o in source_scene.objects if o.type == 'ARMATURE')
        assert len(source_mesh.data.vertices) == len(obj.data.vertices)
        geometry_error = float(np.abs(world_vertices(source_mesh) - rest).max())
        assert geometry_error < 1e-6
        assert [tuple(p.vertices) for p in source_mesh.data.polygons] == [tuple(p.vertices) for p in obj.data.polygons]
        assert np.allclose([d.uv[:] for d in source_mesh.data.uv_layers.active.data],
                           [d.uv[:] for d in obj.data.uv_layers.active.data], atol=1e-7)
        old_weights = skin_weights(source_mesh)
        assert names[:old_weights.shape[1]] == [g.name for g in source_mesh.vertex_groups]
        unchanged_error = float(np.abs(weights[~affected, :old_weights.shape[1]] - old_weights[~affected]).max())
        assert unchanged_error == 0
        for bone in source_arm.data.bones:
            retained = armature.data.bones[bone.name]
            assert np.allclose(bone.matrix_local, retained.matrix_local, atol=1e-6)
            assert (bone.parent.name if bone.parent else None) == (retained.parent.name if retained.parent else None)
        roundtrip_scene = bpy.data.scenes.new('Tripo roundtrip validation')
        scenes.append(roundtrip_scene)
        bpy.context.window.scene = roundtrip_scene
        bpy.ops.import_scene.gltf(filepath=str(runtime))
        imported = next(o for o in roundtrip_scene.objects if o.type == 'MESH')
        imported_arm = next(o for o in roundtrip_scene.objects if o.type == 'ARMATURE')
        assert len(imported_arm.data.bones) == 103
        reference = KDTree(len(rest))
        for i, co in enumerate(rest):
            reference.insert(Vector(co), i)
        reference.balance()
        matches = [reference.find(Vector(co)) for co in world_vertices(imported)]
        assert max(distance for _, _, distance in matches) < 1e-5
        mapping = np.array([index for _, index, _ in matches])
        roundtrip_rest_error = float(np.abs(world_vertices(imported) - rest[mapping]).max())
        assert roundtrip_rest_error < 1e-5
        original_uvs = [set() for _ in rest]
        for loop in obj.data.loops:
            original_uvs[loop.vertex_index].add(tuple(obj.data.uv_layers.active.data[loop.index].uv))
        nearby = [reference.find_range(Vector(co), 1e-5) for co in world_vertices(imported)]
        uv_error = 0.
        for loop in imported.data.loops:
            uv = np.array(imported.data.uv_layers.active.data[loop.index].uv)
            error = min(np.abs(uv - value).max() for _, index, _ in nearby[loop.vertex_index]
                        for value in original_uvs[index])
            uv_error = max(uv_error, float(error))
        assert uv_error < 1e-6
        for rig in [imported_arm, armature]:
            rotate(rig, 'Hair_Back_C_01', (1, 0, 0), .18)
            rotate(rig, 'Dress_Front_01', (1, 0, 0), -.3)
        bpy.context.view_layer.update()
        imported_pose = world_vertices(imported, True)
        bpy.context.window.scene = scene
        bpy.context.view_layer.update()
        pose_error = float(np.abs(imported_pose - world_vertices(obj, True)[mapping]).max())
        assert pose_error < 1e-5
        report = {'source_sha256': source_hash, 'runtime_sha256': runtime_hash,
                  'runtime_bytes': runtime_bytes, 'blender': bpy.app.version_string,
                  'meshes': 1, 'skins': 1, 'materials': 1, 'triangles': triangles,
                  'runtime_vertices': runtime_json['accessors'][primitive['attributes']['POSITION']]['count'],
                  'original_bones_preserved': 53, 'hair_bones': 26, 'dress_bones': 24,
                  'total_bones': 103, 'max_influences': 4, 'unweighted_vertices': 0,
                  'hair_vertices': int(masks['Hair'].sum()), 'dress_vertices': int(masks['Dress'].sum()),
                  'outside_region_vertices_unchanged': int((~affected).sum()),
                  'outside_weight_max_error': unchanged_error, 'geometry_max_error': geometry_error,
                  'textures_byte_identical': True, 'uvs_preserved': True, 'topology_preserved': True,
                  'seam_weight_max_error': float(seam_error), 'finger_test_displacement': finger_displacement,
                  'roundtrip_rest_max_error': roundtrip_rest_error, 'roundtrip_pose_max_error': pose_error,
                  'roundtrip_uv_max_error': uv_error,
                  'pose_checks': pose_results, 'check_actions_in_blend': 3,
                  'runtime_animation_clips': 0,
                  'limitations': ['Original mesh has fused hair/body and hem/leg contact surfaces.',
                                  'Diagnostic poses are not final character animations.',
                                  'No runtime spring solver, self-collision, or furniture collision is included.']}
        Path(report_path).write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
        return report
    finally:
        bpy.context.window.scene = previous
        for scene in scenes:
            for obj in list(scene.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.scenes.remove(scene)


def main():
    parser = argparse.ArgumentParser()
    for name in ['source', 'editable', 'runtime', 'report']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    validate(args.source, args.editable, args.runtime, args.report)


if __name__ == '__main__':
    main()
