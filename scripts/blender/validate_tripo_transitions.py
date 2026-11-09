"""Compare the saved continuous Blender project with the preserved phase-two source."""
import hashlib
import importlib.util
import json
from pathlib import Path
import platform

import bpy
import numpy as np

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
        for a, b in zip(mesh.data.vertices, old_mesh.data.vertices):
            assert [(g.group, g.weight) for g in a.groups] == [(g.group, g.weight) for g in b.groups]
        keys = mesh.data.shape_keys
        assert len(keys.key_blocks) == 16
        for before in old_mesh.data.shape_keys.key_blocks:
            assert np.array_equal(vector_data(before.data, 'co'), vector_data(keys.key_blocks[before.name].data, 'co'))
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
                assert not playback[name][0]['morphs'] and not playback[name][-1]['morphs']
                assert any(any('_Contact_' in key for key in item['morphs']) for item in playback[name]), (name, playback[name])
                assert min(item['hips'][2] for item in playback[name]) < .35
        report = {'platform': platform.platform(), 'blender': bpy.app.version_string, 'bones': 103,
                  'original_geometry_uv_weights_and_correctives_unchanged': True,
                  'source_and_saved_nla_tracks': list(frames), 'playback': playback,
                  'blend_sha256': hashlib.sha256((out / 'luna-tripo-transitions.blend').read_bytes()).hexdigest()}
        (out / 'blender-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        return report
    finally:
        bpy.context.window.scene = previous
        for temporary in [old, scene]:
            for item in list(temporary.objects):
                bpy.data.objects.remove(item, do_unlink=True)
            bpy.data.scenes.remove(temporary)
