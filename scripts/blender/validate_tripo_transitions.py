"""Compare the saved continuous Blender project with the preserved phase-two source."""
import hashlib
import importlib.util
import json
from pathlib import Path
import platform

import bpy
import numpy as np
from mathutils.kdtree import KDTree

spec = importlib.util.spec_from_file_location('transitions', Path(__file__).with_name('build_tripo_transitions.py'))
transitions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transitions)


def load(path):
    scene = transitions.polish.phase2.load_scene(path)
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    mesh = next(o for o in scene.objects if o.type == 'MESH')
    return scene, arm, mesh


def vector_data(items, name):
    values = np.empty(len(items) * 3, dtype=np.float32)
    items.foreach_get(name, values)
    return values


def roundtrip(root, scene, arm, mesh):
    """Compare saved NLA playback with actual imported GLB at matching times."""
    imported = bpy.data.scenes.new('Continuous_Roundtrip')
    previous = bpy.context.window.scene
    try:
        bpy.context.window.scene = imported
        imported.render.fps = 30
        bpy.ops.import_scene.gltf(filepath=str(root / 'public/models/resident/luna-tripo-transitions.glb'))
        other = next(o for o in imported.objects if o.type == 'MESH')
        other_arm = next(o for o in imported.objects if o.type == 'ARMATURE')
        rest = np.array([mesh.matrix_world @ v.co for v in mesh.data.vertices])
        tree = KDTree(len(rest))
        for i, point in enumerate(rest): tree.insert(point, i)
        tree.balance()
        mapping = []
        for v in other.data.vertices:
            point = other.matrix_world @ v.co
            weights = {other.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 1e-6}
            matches = []
            for _, i, _ in tree.find_range(point, 3e-6):
                original = {mesh.vertex_groups[g.group].name: g.weight for g in mesh.data.vertices[i].groups if g.weight > 1e-6}
                if weights.keys() != original.keys() or any(abs(weights[n] - original[n]) > 1e-5 for n in weights):
                    continue
                error = max((mesh.matrix_world @ key.data[i].co - other.matrix_world @
                    other.data.shape_keys.key_blocks[key.name].data[v.index].co).length
                    for key in mesh.data.shape_keys.key_blocks)
                if error < 3e-6: matches.append(i)
            assert matches, ('Unmatched exported vertex', v.index)
            mapping.append(matches[0])
        errors = {}
        for name, times in {'Walk': [0., .15, .6, .92, 1.2], 'SitCycle': [0., .3, .92, 1.46, 2.1, 2.8, 3.5, 5., 6.5, 9.],
                            'LieCycle': [0., 1.3, 3.7, 5., 8.8, 11.5, 13.]}.items():
            for world, rig, obj in [(scene, arm, mesh), (imported, other_arm, other)]:
                bpy.context.window.scene = world
                for owner in [rig, obj.data.shape_keys]:
                    owner.animation_data.action = None
                    for track in owner.animation_data.nla_tracks:
                        track.mute = track.name != name
                    assert any(not track.mute for track in owner.animation_data.nla_tracks), name
                    owner.update_tag()
            for time in times:
                samples = []
                # The importer places the glTF t=0 action into an NLA strip at frame 1.
                for world, obj, frame in [(scene, mesh, time * 30 + 1), (imported, other, time * 30 + 1)]:
                    bpy.context.window.scene = world
                    world.frame_set(int(frame), subframe=frame - int(frame))
                    bpy.context.view_layer.update()
                    samples.append(transitions.polish.evaluated_coords(obj))
                error = float(np.abs(samples[0][mapping] - samples[1]).max())
                errors[f'{name}:{time}'] = error
        assert max(errors.values()) < 1e-5, errors
        return {'vertices': len(mapping), 'max_surface_error': max(errors.values()), 'samples': errors}
    finally:
        bpy.context.window.scene = previous
        for item in list(imported.objects): bpy.data.objects.remove(item, do_unlink=True)
        bpy.data.scenes.remove(imported)


def validate(workspace):
    root = Path(workspace)
    out = root / 'art/resident/tripo-transitions'
    previous = bpy.context.window.scene
    old, old_arm, old_mesh = load(root / 'art/resident/tripo-dynamics/luna-tripo-dynamics.blend')
    scene, arm, mesh = load(out / 'luna-tripo-transitions.blend')
    try:
        assert list(arm.data.bones.keys()) == list(old_arm.data.bones.keys())
        assert len(arm.data.bones) == 103
        for a, b in zip(arm.data.bones, old_arm.data.bones):
            assert a.matrix_local == b.matrix_local
            assert (a.parent.name if a.parent else '') == (b.parent.name if b.parent else '')
        assert np.array_equal(vector_data(mesh.data.vertices, 'co'), vector_data(old_mesh.data.vertices, 'co'))
        assert len(mesh.data.polygons) == len(old_mesh.data.polygons) == 18659
        assert all(tuple(a.vertices) == tuple(b.vertices) for a, b in zip(mesh.data.polygons, old_mesh.data.polygons))
        assert all(tuple(a.uv) == tuple(b.uv) for a, b in zip(mesh.data.uv_layers.active.data, old_mesh.data.uv_layers.active.data))
        assert list(mesh.vertex_groups.keys()) == list(old_mesh.vertex_groups.keys())
        authoring = json.loads((out / 'authoring.json').read_text(encoding='utf-8'))
        repaired = set(authoring['weight_repair']['vertex_ids'])
        changed = set()
        for a, b in zip(mesh.data.vertices, old_mesh.data.vertices):
            if [(g.group, g.weight) for g in a.groups] != [(g.group, g.weight) for g in b.groups]:
                changed.add(a.index)
                assert a.index in repaired
                assert all(mesh.vertex_groups[g.group].name in ['mixamorig:Spine1', 'mixamorig:Spine2'] for g in a.groups)
                assert not mesh.data.attributes['Secondary_Hair_Region'].data[a.index].value
        assert changed == repaired
        keys = mesh.data.shape_keys
        assert len(keys.key_blocks) == 50
        for before in old_mesh.data.shape_keys.key_blocks:
            previous_values = vector_data(before.data, 'co').reshape(-1, 3)
            current_values = vector_data(keys.key_blocks[before.name].data, 'co').reshape(-1, 3)
            allowed = repaired if before.name in ['Sit_Clearance', 'LieDown_Clearance'] else set()
            assert set(np.flatnonzero(np.any(previous_values != current_values, axis=1))).issubset(allowed)
        bpy.context.window.scene = scene
        frames = {'Walk': [1, 14, 37], 'ArmsUp': [1, 61, 121], 'Sit': [1, 61, 121], 'LieDown': [1, 61, 121],
                  'SitCycle': [1, 100, 150, 271], 'LieCycle': [1, 61, 121, 181, 271, 391]}
        playback = {}
        for name, frame_numbers in frames.items():
            for owner in [arm, keys]:
                owner.animation_data.action = None
                for track in owner.animation_data.nla_tracks:
                    track.mute = track.name != name
                owner.update_tag()
            scene.frame_set(1)
            bpy.context.view_layer.update()
            playback[name] = []
            for frame in frame_numbers:
                scene.frame_set(frame)
                bpy.context.view_layer.update()
                hip = arm.matrix_world @ arm.pose.bones['mixamorig:Hips'].head
                values = {k.name: k.value for k in list(keys.key_blocks)[1:] if abs(k.value) > 1e-5}
                assert all(0 <= v <= 1 for v in values.values())
                playback[name].append({'frame': frame, 'hips': list(hip), 'morphs': values})
            if name in transitions.CLIPS:
                assert not {k: v for k, v in playback[name][0]['morphs'].items() if k != 'Approach_Contact_0'}
                assert not playback[name][-1]['morphs']
                assert any(any('_Contact_' in key for key in item['morphs']) for item in playback[name]), (name, playback[name])
                assert min(item['hips'][2] for item in playback[name]) < .35
        exported = roundtrip(root, scene, arm, mesh)
        report = {'platform': platform.platform(), 'blender': bpy.app.version_string, 'bones': 103,
                  'original_geometry_uv_rest_bones_unchanged': True,
                  'only_expected_back_weights_and_hair_correctives_changed': True,
                  'repaired_back_vertices': len(repaired),
                  'source_and_saved_nla_tracks': list(frames), 'playback': playback, 'glb_roundtrip': exported,
                  'blend_sha256': hashlib.sha256((out / 'luna-tripo-transitions.blend').read_bytes()).hexdigest()}
        (out / 'blender-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        return report
    finally:
        bpy.context.window.scene = previous
        for temporary in [old, scene]:
            for item in list(temporary.objects):
                bpy.data.objects.remove(item, do_unlink=True)
            bpy.data.scenes.remove(temporary)
