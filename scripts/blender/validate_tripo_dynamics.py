"""Check the phase-two source, exported skin and diagnostic poses in Blender."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils.kdtree import KDTree

spec = importlib.util.spec_from_file_location('phase2', Path(__file__).with_name('refine_tripo_dynamics.py'))
phase2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(phase2)


def coords(obj, evaluated=False):
    if not evaluated:
        return np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
    instance = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = instance.to_mesh()
    positions = np.array([instance.matrix_world @ v.co for v in mesh.vertices])
    instance.to_mesh_clear()
    return positions


def pose_metrics(scene, arm, obj):
    bpy.context.window.scene = scene
    phase2.reset(arm)
    base = coords(obj)
    edges = np.array([e.vertices[:] for e in obj.data.edges])
    rest = np.linalg.norm(base[edges[:, 0]] - base[edges[:, 1]], axis=1)
    results = {}
    for name in ['Walk', 'ArmsUp', 'Sit', 'LieDown']:
        worst, p99, long_edges = 0., 0., 0
        for t in ([.3, .6, .9] if name == 'Walk' else [.4, .8, 2.]):
            phase2.pose(arm, name, t)
            points = coords(obj, True)
            assert np.isfinite(points).all()
            lengths = np.linalg.norm(points[edges[:, 0]] - points[edges[:, 1]], axis=1)
            ratio = lengths / np.maximum(rest, 1e-6)
            worst = max(worst, float(ratio.max()))
            p99 = max(p99, float(np.percentile(ratio, 99)))
            long_edges = max(long_edges, int(((ratio > 2) & (lengths - rest > .015)).sum()))
        results[name] = {'max_edge_ratio': worst, 'p99_edge_ratio': p99, 'long_stretched_edges': long_edges}
    phase2.reset(arm)
    return results


def validate(workspace):
    root = Path(workspace)
    previous = bpy.context.window.scene
    scenes = []
    try:
        baseline = phase2.load_scene(root / 'art/resident/tripo-secondary/luna-tripo-secondary.blend')
        refined = phase2.load_scene(root / 'art/resident/tripo-dynamics/luna-tripo-dynamics.blend')
        scenes.extend([baseline, refined])
        old_arm = next(o for o in baseline.objects if o.type == 'ARMATURE')
        old_obj = next(o for o in baseline.objects if o.type == 'MESH')
        arm = next(o for o in refined.objects if o.type == 'ARMATURE')
        obj = next(o for o in refined.objects if o.type == 'MESH')
        assert len(arm.data.bones) == len(old_arm.data.bones) == 103
        assert all(np.max(np.abs(np.array(b.matrix_local) - np.array(old_arm.data.bones[b.name].matrix_local))) < 1e-7
                   and (b.parent.name if b.parent else None) == (old_arm.data.bones[b.name].parent.name if old_arm.data.bones[b.name].parent else None)
                   for b in arm.data.bones)
        mapping = np.array([v.value for v in obj.data.attributes['Phase1_Vertex'].data])
        geometry_error = float(np.abs(coords(obj) - coords(old_obj)[mapping]).max())
        assert geometry_error < 1e-7
        assert len(obj.data.polygons) == len(old_obj.data.polygons) == 18525
        assert all(tuple(mapping[list(face.vertices)]) == tuple(old_obj.data.polygons[i].vertices) for i, face in enumerate(obj.data.polygons))
        uv_error = max(abs(a.uv[j] - b.uv[j]) for a, b in zip(obj.data.uv_layers.active.data, old_obj.data.uv_layers.active.data) for j in (0, 1))
        assert uv_error == 0
        hair = np.array([v.value for v in obj.data.attributes['Secondary_Hair_Region'].data])
        dress = np.array([v.value for v in obj.data.attributes['Secondary_Dress_Region'].data])
        names = [g.name for g in obj.vertex_groups]
        conflicts = {'hair_body': 0, 'dress_leg_or_arm': 0, 'body_secondary': 0}
        for v in obj.data.vertices:
            assert 1 <= len(v.groups) <= 4
            assert abs(sum(g.weight for g in v.groups) - 1) < 1e-6
            for g in v.groups:
                name = names[g.group]
                if hair[v.index] and not (name.startswith('Hair_') or name == 'mixamorig:Head'):
                    conflicts['hair_body'] += 1
                if dress[v.index] and any(s in name for s in ['Arm', 'Leg', 'Hand', 'Shoulder']):
                    conflicts['dress_leg_or_arm'] += 1
                if not (hair[v.index] or dress[v.index]) and name.startswith(('Hair_', 'Dress_')):
                    conflicts['body_secondary'] += 1
        assert not any(conflicts.values())
        before = pose_metrics(baseline, old_arm, old_obj)
        after = pose_metrics(refined, arm, obj)
        for name, limit in [('Walk', 0), ('ArmsUp', 5), ('Sit', 0), ('LieDown', 0)]:
            assert after[name]['long_stretched_edges'] <= limit, (name, after[name])
            assert after[name]['max_edge_ratio'] < 4
        bpy.context.window.scene = refined
        phase2.pose(arm, 'ArmsUp', 2)
        displacement = float(np.abs(coords(obj, True)[hair] - coords(obj)[hair]).max())
        assert displacement < 1e-5, 'Arms must not pull hair vertices'
        phase2.reset(arm)
        runtime = root / 'public/models/resident/luna-tripo-dynamics.glb'
        data = runtime.read_bytes()
        manifest = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])
        assert len(manifest['skins']) == 1 and len(manifest['skins'][0]['joints']) == 103
        assert [a['name'] for a in manifest['animations']] == ['Walk', 'ArmsUp', 'Sit', 'LieDown']
        imported = bpy.data.scenes.new('Phase2_Roundtrip'); scenes.append(imported)
        bpy.context.window.scene = imported
        bpy.ops.import_scene.gltf(filepath=str(runtime))
        other = next(o for o in imported.objects if o.type == 'MESH')
        other_arm = next(o for o in imported.objects if o.type == 'ARMATURE')
        phase2.reset(other_arm)
        source = coords(obj); target = coords(other)
        tree = KDTree(len(source))
        for i, point in enumerate(source): tree.insert(point, i)
        tree.balance()
        groups = [g.name for g in other.vertex_groups]
        # Split seams can share positions but have different skinning: match both.
        maps = []
        for vertex, point in zip(other.data.vertices, target):
            weights = {groups[g.group]: g.weight for g in vertex.groups if g.weight > 1e-6}
            candidates = tree.find_range(point, 2e-6)
            matches = []
            for _, i, _ in candidates:
                source_weights = {names[g.group]: g.weight for g in obj.data.vertices[i].groups if g.weight > 1e-6}
                if weights.keys() == source_weights.keys() and max(abs(weights[n] - source_weights[n]) for n in weights) < 1e-5:
                    matches.append(i)
            assert matches, (vertex.index, list(point), weights, [(i, {names[g.group]: g.weight for g in obj.data.vertices[i].groups}) for _, i, _ in candidates])
            maps.append(matches[0])
        maps = np.array(maps)
        rest_error = float(np.abs(target - source[maps]).max())
        pose_error = 0.
        for name in ['Walk', 'ArmsUp', 'Sit', 'LieDown']:
            bpy.context.window.scene = refined; phase2.pose(arm, name, 1.)
            expected = coords(obj, True)[maps]
            bpy.context.window.scene = imported; phase2.pose(other_arm, name, 1.)
            pose_error = max(pose_error, float(np.abs(coords(other, True) - expected).max()))
        assert rest_error < 1e-5 and pose_error < 1e-5
        report = {'blender': bpy.app.version_string, 'bones': 103, 'new_bones': 0,
                  'bone_matrices_and_parents_unchanged': True, 'triangles': 18525,
                  'geometry_error': geometry_error, 'uv_error': uv_error, 'weight_conflicts': conflicts,
                  'max_influences': 4, 'unweighted': 0, 'arms_up_hair_displacement': displacement,
                  'baseline_poses': before, 'refined_poses': after, 'roundtrip_rest_error': rest_error,
                  'roundtrip_pose_error': pose_error, 'clips': [a['name'] for a in manifest['animations']],
                  'runtime_bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        (root / 'art/resident/tripo-dynamics/blender-validation.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
        return report
    finally:
        bpy.context.window.scene = previous
        for scene in scenes:
            for obj in list(scene.objects): bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.scenes.remove(scene)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--workspace', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    validate(args.workspace)
