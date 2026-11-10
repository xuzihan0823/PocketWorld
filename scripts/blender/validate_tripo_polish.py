"""Windows/Blender acceptance for local polish, including exported morph round-trip."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import struct
import sys

import bpy
import numpy as np
from mathutils.kdtree import KDTree

spec = importlib.util.spec_from_file_location('polish', Path(__file__).with_name('polish_tripo_dynamics.py'))
polish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(polish)


def sample(obj, arm, name, t, corrected):
    polish.phase2.pose(arm, name, t)
    if corrected:
        polish.apply_correctives(obj, name, t)
    bpy.context.view_layer.update()
    return polish.evaluated_coords(obj)


def pose_metrics(obj, arm, corrected):
    p, h, d = polish.surface_data(obj)
    edges = np.array([e.vertices[:] for e in obj.data.edges])
    rest = np.linalg.norm(p[edges[:, 0]] - p[edges[:, 1]], axis=1)
    report = {}
    for name in ['Walk', 'ArmsUp', 'Sit', 'LieDown']:
        largest, count, p99 = 0., 0, 0.
        times = [.1 * i for i in range(1, 12)] if name == 'Walk' else [.1 * i for i in range(1, 9)] + [2., 3.4, 3.8]
        for t in times:
            q = sample(obj, arm, name, t, corrected)
            assert np.isfinite(q).all()
            length = np.linalg.norm(q[edges[:, 0]] - q[edges[:, 1]], axis=1)
            ratio = length / np.maximum(rest, 1e-6)
            largest = max(largest, float(ratio.max()))
            p99 = max(p99, float(np.percentile(ratio, 99)))
            count = max(count, int(((ratio > 2) & (length - rest > .015)).sum()))
        q = sample(obj, arm, name, 2. if name != 'Walk' else .3, corrected)
        capsules = polish.body_capsules(arm)
        contacts = {}
        for part, region in [('hair', h & (p[:, 2] < .84)), ('dress', d)]:
            projected = polish.project_contacts(q, region, capsules, part, clearance=0.)
            depth = np.linalg.norm(projected - q, axis=1)[region]
            contacts[part] = {'penetrating_vertices_over_1mm': int((depth > .001).sum()), 'max_projection': float(depth.max())}
        report[name] = {'max_edge_ratio': largest, 'p99_edge_ratio': p99, 'long_stretched_edges': count, 'capsule_surface_contacts': contacts}
    return report


def check_saved_nla(scene, arm, obj):
    keys = obj.data.shape_keys
    results = {}
    expected = {'Walk': [0., 0., 0., 0., 0.], 'ArmsUp': [0., 0., 1., 0., 0.],
                'Sit': [0., 0., 0., 1., 0.], 'LieDown': [0., 0., 0., 0., 1.]}
    for name, values in expected.items():
        for data in [arm, keys]:
            data.animation_data.action = None
            for track in data.animation_data.nla_tracks:
                track.mute = track.name != name
        scene.frame_set(1)
        scene.frame_set(20 if name == 'Walk' else 61)
        bpy.context.view_layer.update()
        results[name] = [round(key.value, 6) for key in list(keys.key_blocks)[1:]]
        assert results[name] == values, results
    for data in [arm, keys]:
        for track in data.animation_data.nla_tracks:
            track.mute = True
    for key in list(keys.key_blocks)[1:]:
        key.value = 0.
    scene.frame_set(1)
    return results


def validate(workspace, baseline):
    root, baseline = Path(workspace), Path(baseline)
    previous = bpy.context.window.scene
    scenes = []
    try:
        old = polish.phase2.load_scene(baseline)
        new = polish.phase2.load_scene(root / 'art/resident/tripo-dynamics/luna-tripo-dynamics.blend')
        scenes.extend([old, new])
        old_obj = next(o for o in old.objects if o.type == 'MESH')
        old_arm = next(o for o in old.objects if o.type == 'ARMATURE')
        obj = next(o for o in new.objects if o.type == 'MESH')
        arm = next(o for o in new.objects if o.type == 'ARMATURE')
        assert len(arm.data.bones) == len(old_arm.data.bones) == 103
        assert all(np.max(np.abs(np.array(b.matrix_local) - np.array(old_arm.data.bones[b.name].matrix_local))) < 1e-7
                   and (b.parent.name if b.parent else None) == (old_arm.data.bones[b.name].parent.name if old_arm.data.bones[b.name].parent else None)
                   for b in arm.data.bones)
        bpy.context.window.scene = old
        bpy.context.view_layer.update()
        old_p = polish.surface_data(old_obj)[0]
        bpy.context.window.scene = new
        bpy.context.view_layer.update()
        p, h, d = polish.surface_data(obj)
        assert np.max(np.abs(p - old_p)) < 1e-7, (float(np.max(np.abs(p - old_p))), p[0].tolist(), old_p[0].tolist(), list(map(list, obj.matrix_world)), list(map(list, old_obj.matrix_world)))
        assert len(obj.data.polygons) == 18659
        assert all(tuple(a.vertices) == tuple(b.vertices) for a, b in zip(obj.data.polygons, old_obj.data.polygons))
        assert all(tuple(a.uv) == tuple(b.uv) for a, b in zip(obj.data.uv_layers.active.data, old_obj.data.uv_layers.active.data))
        assert not obj.data.validate(clean_customdata=False)
        names = [g.name for g in obj.vertex_groups]
        conflicts = 0
        for v in obj.data.vertices:
            assert 1 <= len(v.groups) <= 4
            assert abs(sum(g.weight for g in v.groups) - 1) < 1e-6
            for g in v.groups:
                name = names[g.group]
                if h[v.index] and not (name.startswith('Hair_') or name == 'mixamorig:Head'): conflicts += 1
                if d[v.index] and any(s in name for s in ['Arm', 'Leg', 'Hand', 'Shoulder']): conflicts += 1
                if not (h[v.index] or d[v.index]) and name.startswith(('Hair_', 'Dress_')): conflicts += 1
        assert conflicts == 0
        bpy.context.window.scene = old
        polish.phase2.reset(old_arm)
        before = pose_metrics(old_obj, old_arm, False)
        bpy.context.window.scene = new
        saved_nla = check_saved_nla(new, arm, obj)
        polish.phase2.reset(arm); obj.data.shape_keys.animation_data_clear()
        after = pose_metrics(obj, arm, True)
        assert all(pose['long_stretched_edges'] == 0 for pose in after.values()), after
        runtime = root / 'public/models/resident/luna-tripo-dynamics.glb'
        data = runtime.read_bytes()
        manifest = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])
        def image_hashes(payload):
            size = struct.unpack_from('<I', payload, 12)[0]
            doc = json.loads(payload[20:20 + size])
            binary = payload[28 + size:]
            result = []
            for image in doc['images']:
                view = doc['bufferViews'][image['bufferView']]
                start = view.get('byteOffset', 0)
                result.append(hashlib.sha256(binary[start:start + view['byteLength']]).hexdigest())
            return sorted(result)
        baseline_glb = baseline.with_suffix('.glb')
        assert image_hashes(data) == image_hashes(baseline_glb.read_bytes())
        assert len(manifest['skins']) == 1 and len(manifest['skins'][0]['joints']) == 103
        assert [a['name'] for a in manifest['animations']] == ['Walk', 'ArmsUp', 'Sit', 'LieDown']
        assert len(manifest['meshes'][0]['primitives'][0]['targets']) == 5
        assert all(any(c['target']['path'] == 'weights' for c in a['channels']) for a in manifest['animations'])
        imported = bpy.data.scenes.new('Polish_Roundtrip'); scenes.append(imported)
        bpy.context.window.scene = imported
        bpy.ops.import_scene.gltf(filepath=str(runtime))
        other = next(o for o in imported.objects if o.type == 'MESH')
        other_arm = next(o for o in imported.objects if o.type == 'ARMATURE')
        polish.phase2.reset(other_arm); other.data.shape_keys.animation_data_clear()
        bpy.context.view_layer.update()
        target = np.array([other.matrix_world @ v.co for v in other.data.vertices])
        tree = KDTree(len(p))
        for i, point in enumerate(p): tree.insert(point, i)
        tree.balance()
        imported_names = [g.name for g in other.vertex_groups]
        mapping = []
        for vertex, point in zip(other.data.vertices, target):
            weights = {imported_names[g.group]: g.weight for g in vertex.groups if g.weight > 1e-6}
            matches = []
            for _, i, _ in tree.find_range(point, 3e-6):
                source_weights = {names[g.group]: g.weight for g in obj.data.vertices[i].groups if g.weight > 1e-6}
                if weights.keys() == source_weights.keys() and max(abs(weights[n] - source_weights[n]) for n in weights) < 1e-5:
                    # Coincident seams may share skin weights but have different corrective offsets.
                    shape_error = max((obj.matrix_world @ key.data[i].co - other.matrix_world @ other.data.shape_keys.key_blocks[key.name].data[vertex.index].co).length
                                      for key in obj.data.shape_keys.key_blocks)
                    if shape_error < 3e-6:
                        matches.append(i)
            assert matches, (vertex.index, point.tolist(), weights, tree.find(point)[1:],
                             {names[g.group]: g.weight for g in obj.data.vertices[tree.find(point)[1]].groups})
            mapping.append(matches[0])
        mapping = np.array(mapping)
        rest_error = float(np.abs(target - p[mapping]).max())
        pose_error = 0.
        roundtrip_poses = {}
        for name, t in [('Walk', .3), ('ArmsUp', .4), ('ArmsUp', 2.), ('Sit', .4), ('Sit', 2.), ('LieDown', .4), ('LieDown', 2.)]:
            bpy.context.window.scene = new
            expected = sample(obj, arm, name, t, True)[mapping]
            bpy.context.window.scene = imported
            actual = sample(other, other_arm, name, t, True)
            error = float(np.abs(actual - expected).max())
            roundtrip_poses[f'{name}:{t}'] = error
            pose_error = max(pose_error, error)
        assert rest_error < 1e-5 and pose_error < 1e-5, (rest_error, roundtrip_poses)
        report = {'platform': platform.platform(), 'blender': bpy.app.version_string, 'bones': 103, 'new_bones': 0,
                  'bone_matrices_and_parents_unchanged': True, 'original_triangles_preserved': 18525,
                  'added_triangles': 134, 'triangles': 18659, 'original_positions_uv_unchanged': True,
                  'embedded_images_byte_identical': True,
                  'weight_conflicts': conflicts, 'unweighted': 0, 'max_influences': 4, 'correctives': 5,
                  'saved_blend_nla_roundtrip': saved_nla,
                  'baseline_poses': before, 'refined_poses': after, 'roundtrip_rest_error': rest_error,
                  'roundtrip_pose_error': pose_error, 'runtime_bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        (root / 'art/resident/tripo-dynamics/polish/blender-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2))
        return report
    finally:
        bpy.context.window.scene = previous
        for scene in scenes:
            for obj in list(scene.objects): bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.scenes.remove(scene)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--workspace', required=True); parser.add_argument('--baseline', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    validate(args.workspace, args.baseline)
