"""Build continuous sit and recline review clips from the preserved phase-two asset."""
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

spec = importlib.util.spec_from_file_location('polish', Path(__file__).with_name('polish_tripo_dynamics.py'))
polish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(polish)

SOURCE_HASH = 'cf27f3a2780a1ac5f3472ee6721f85733ea083b1cc60df8cdb60360621482b7b'
FPS = 30
CLIPS = {'SitCycle': 9., 'LieCycle': 13.}
KNOTS = [0., .2, .4, .6, .8, 1.]


def smooth(x):
    x = min(1., max(0., x))
    return x * x * (3 - 2 * x)


def section(t, start, end):
    return smooth((t - start) / (end - start))


def timeline(name, t):
    if name == 'SitCycle':
        if t < 2.1:
            return 0., 0., t, .25 * (1 - section(t, .15, 2.1))
        return section(t, 2.4, 4.1) * (1 - section(t, 5.8, 7.5)), 0., None, 0.
    sit = section(t, .6, 2.3) * (1 - section(t, 10.7, 12.4))
    recline = section(t, 2.9, 5.) * (1 - section(t, 7.8, 9.9))
    return sit, recline, None, 0.


def capture(arm):
    return [bone.rotation_quaternion.copy() for bone in arm.pose.bones]


def basis(state, sit, recline, walk=None, offset=0.):
    arm = state['arm']
    if walk is not None:
        # Fade the gait on at the first step and off across the last step.
        polish.phase2.pose(arm, 'Walk', walk)
        strength = section(walk, 0., .36) * (1 - section(walk, 1.44, 2.1))
        for bone, rest in zip(arm.pose.bones, state['rest']):
            bone.rotation_quaternion = rest.slerp(bone.rotation_quaternion, strength)
        displacement = Vector((0, offset, 0))
    else:
        for bone, rest, seated, supine in zip(arm.pose.bones, state['rest'], state['sit'], state['lie']):
            bone.rotation_quaternion = rest.slerp(seated, sit).slerp(supine, recline)
        # Lean forward over the feet when lowering and rising; tuck the chin before reclining.
        rotate = lambda name, angle: polish.phase2.v1.rotate_world(arm, 'mixamorig:' + name, (1, 0, 0), angle)
        rotate('Spine', .20 * math.sin(math.pi * sit) + .09 * math.sin(math.pi * recline))
        rotate('Head', -.08 * math.sin(math.pi * sit) + .17 * math.sin(math.pi * recline))
        for side in ['Left', 'Right']:
            rotate(side + 'ForeArm', -.29 * math.sin(math.pi * sit) - .36 * math.sin(math.pi * recline))
        displacement = Vector((0, .062 * sit + .096 * recline,
                               -.21 * sit * (1 - recline) - .39 * recline + .025 * math.sin(math.pi * recline)))
    hips = arm.pose.bones['mixamorig:Hips']
    hips.location = state['hip_space'] @ displacement
    bpy.context.view_layer.update()
    if walk is None:
        ankle = min((arm.matrix_world @ arm.pose.bones['mixamorig:' + side + 'Foot'].head).z for side in ['Left', 'Right'])
        correction = state['ankle'] - ankle
        # Keep the soles near their standing height on the sit path. On recline,
        # release the ankle support as the legs extend onto the platform.
        hips.location += state['hip_space'] @ Vector((0, 0, correction * (1 - recline)))
        bpy.context.view_layer.update()


def weights(sit, recline, contacts):
    result = {'Sit_Clearance': sit * (1 - recline), 'LieDown_Clearance': recline}
    if not contacts:
        return result
    # Adjacent sculpted shapes blend on the continuous pose parameter, not on
    # elapsed time. The return path therefore samples exactly the same surface.
    for i, knot in enumerate(KNOTS[1:], 1):
        result[f'Sit_Contact_{i}'] = max(0., 1 - abs(sit - knot) * 5) * (1 - min(1., recline * 5))
        result[f'Recline_Contact_{i}'] = max(0., 1 - abs(recline - knot) * 5)
    return result


def set_keys(obj, values):
    for key in list(obj.data.shape_keys.key_blocks)[1:]:
        key.value = values.get(key.name, 0.)


def sculpt(state):
    obj, arm = state['obj'], state['arm']
    positions, hair, dress = polish.surface_data(obj)
    hair &= positions[:, 2] < .84
    regions = [(hair, 'hair'), (dress, 'dress')]
    graphs = []
    for mask, part in regions:
        groups, _, neighbors, _ = polish.body_graph(obj, positions, ~mask, np.zeros(len(mask), dtype=bool))
        graphs.append((groups, neighbors))
    results = {}
    for kind in ['Sit', 'Recline']:
        for index, progress in enumerate(KNOTS[1:], 1):
            sit, recline = (progress, 0.) if kind == 'Sit' else (1., progress)
            basis(state, sit, recline)
            set_keys(obj, weights(sit, recline, False))
            bpy.context.view_layer.update()
            posed = polish.evaluated_coords(obj)
            capsules = polish.body_capsules(arm)
            delta = np.zeros_like(posed)
            support = .047 * section(recline, .5, 1.)
            for (mask, part), (groups, neighbors) in zip(regions, graphs):
                target = polish.project_contacts(posed, mask, capsules, part, clearance=.004)
                if recline > .5:
                    target[mask, 2] = np.maximum(target[mask, 2], support)
                offsets = np.array([(target[ids] - posed[ids]).mean(0) for ids in groups])
                for _ in range(2):
                    previous = offsets.copy()
                    for i in neighbors:
                        offsets[i] = .7 * previous[i] + .3 * previous[sorted(neighbors[i])].mean(0)
                for i, ids in enumerate(groups):
                    delta[ids] = offsets[i]
                fixed = polish.project_contacts(posed + delta, mask, capsules, part, clearance=.003)
                if recline > .5:
                    fixed[mask, 2] = np.maximum(fixed[mask, 2], support)
                delta[mask] = (fixed - posed)[mask]
            distance = np.linalg.norm(delta, axis=1)
            limit = .065 if recline > .5 else .038
            delta *= np.minimum(1., limit / np.maximum(distance, 1e-9))[:, None]
            ids = np.flatnonzero(np.linalg.norm(delta, axis=1) > 1e-5)
            matrices = polish.skin_matrices(obj, arm)
            local = np.linalg.solve(matrices[ids], delta[ids, :, None])[..., 0]
            key = obj.shape_key_add(name=f'{kind}_Contact_{index}', from_mix=False)
            coordinates = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
            obj.data.shape_keys.reference_key.data.foreach_get('co', coordinates)
            coordinates.reshape(-1, 3)[ids] += local
            key.data.foreach_set('co', coordinates)
            key.value = 0.
            results[key.name] = {'vertices': len(ids), 'max_world_offset': float(np.linalg.norm(delta, axis=1).max())}
    set_keys(obj, {})
    return results


def attach_track(owner, name, action, shape=False):
    owner.animation_data.action = None
    track = owner.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    if shape:
        strip.use_animated_influence = True
        strip.influence = 1.
        strip.keyframe_insert('influence', frame=1)
    track.mute = True
    action.use_fake_user = True


def author(state, name, duration):
    arm, obj, scene = state['arm'], state['obj'], state['scene']
    keys = obj.data.shape_keys
    bone_action = bpy.data.actions.new(name)
    morph_action = bpy.data.actions.new('Correctives_' + name)
    arm.animation_data.action = bone_action
    keys.animation_data.action = morph_action
    # Dense keys are cheap here: glTF omits constant bone channels on export.
    last = round(duration * FPS) + 1
    for frame in range(1, last + 1, 2):
        t = (frame - 1) / FPS
        sit, recline, walk, offset = timeline(name, t)
        basis(state, sit, recline, walk, offset)
        set_keys(obj, weights(sit, recline, True))
        for bone in arm.pose.bones:
            bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
        arm.pose.bones['mixamorig:Hips'].keyframe_insert('location', frame=frame)
        for key in list(keys.key_blocks)[1:]:
            key.keyframe_insert('value', frame=frame)
    for action in [bone_action, morph_action]:
        for layer in action.layers:
            for strip in layer.strips:
                for channelbag in strip.channelbags:
                    for curve in channelbag.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = 'LINEAR'
    attach_track(arm, name, bone_action)
    attach_track(keys, name, morph_action, shape=True)
    scene.frame_end = max(scene.frame_end, last)


def prepare(workspace):
    root = Path(workspace)
    source = root / 'art/resident/tripo-dynamics/luna-tripo-dynamics.blend'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_HASH
    scene = polish.phase2.load_scene(source)
    scene.name = 'Tripo_Continuous_Review'
    bpy.context.window.scene = scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    obj = next(o for o in scene.objects if o.type == 'MESH')
    assert len(arm.data.bones) == 103 and len(obj.data.polygons) == 18659
    for owner in [arm, obj.data.shape_keys]:
        owner.animation_data.action = None
        for track in owner.animation_data.nla_tracks:
            track.mute = True
    polish.phase2.pose(arm, 'Rest', 0.)
    rest = capture(arm)
    ankle = min((arm.matrix_world @ arm.pose.bones['mixamorig:' + side + 'Foot'].head).z for side in ['Left', 'Right'])
    hip_space = (arm.matrix_world.to_3x3() @ arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()).inverted()
    polish.phase2.pose(arm, 'Sit', 2.)
    sit = capture(arm)
    polish.phase2.pose(arm, 'LieDown', 2.)
    return dict(root=root, scene=scene, obj=obj, arm=arm, rest=rest, sit=sit, lie=capture(arm),
                ankle=ankle, hip_space=hip_space)


def export(state):
    root, scene, arm, obj = (state[k] for k in ['root', 'scene', 'arm', 'obj'])
    polish.phase2.pose(arm, 'Rest', 0.)
    arm['asset_version'] = 'tripo-continuous-review'
    set_keys(obj, {})
    scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    for item in scene.objects:
        item.hide_set(False)
        item.select_set(True)
    bpy.context.view_layer.objects.active = arm
    folder = root / 'art/resident/tripo-transitions'
    folder.mkdir(parents=True, exist_ok=True)
    runtime = root / 'public/models/resident/luna-tripo-transitions.glb'
    bpy.ops.export_scene.gltf(filepath=str(runtime), use_selection=True, use_active_scene=True,
                             export_animations=True, export_animation_mode='NLA_TRACKS',
                             export_merge_animation='NLA_TRACK', export_bake_animation=True,
                             export_nla_strips=True, export_morph=True, export_morph_animation=True,
                             export_morph_reset_sk_data=False, export_try_sparse_sk=True,
                             export_try_omit_sparse_sk=True, export_extras=True, export_skins=True,
                             export_all_influences=False, export_influence_nb=4,
                             export_yup=True, export_image_format='AUTO')
    last_frames = dict(Walk=37, ArmsUp=121, Sit=121, LieDown=121,
                       **{name: round(duration * FPS) + 1 for name, duration in CLIPS.items()})
    polish.bake_morph_channels(runtime, obj, last_frames)
    polish.phase2.pose(arm, 'Rest', 0.)
    set_keys(obj, {})
    scene.frame_set(1)
    bpy.data.libraries.write(str(folder / 'luna-tripo-transitions.blend'), {scene},
                             path_remap='RELATIVE', fake_user=True, compress=True)
    return runtime


def build(workspace):
    state = prepare(workspace)
    state['corrections'] = sculpt(state)
    for name, duration in CLIPS.items():
        author(state, name, duration)
    state['runtime'] = export(state)
    report = {'source_sha256': SOURCE_HASH, 'fps': FPS, 'clips_seconds': CLIPS,
              'bone_count': len(state['arm'].data.bones), 'corrections': state['corrections']}
    (state['root'] / 'art/resident/tripo-transitions/authoring.json').write_text(
        json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return state


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    print(json.dumps(build(args.workspace)['corrections'], indent=2))
