"""Build continuous sit and recline review clips from the preserved phase-two asset."""
import argparse
import hashlib
import importlib.util
import json
import math
import struct
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
KNOTS = {'Sit': [0., .08, .22, .45, .7, 1.], 'Recline': [0., .2, .4, .6, .8, 1.]}
WALK_SAMPLES = {'Walk': [i / 10 for i in range(12)], 'Approach': [i / 10 for i in range(22)]}


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


def orient_bone(bone, rotation):
    matrix = bone.matrix.copy()
    position = matrix.translation.copy()
    matrix = rotation.to_matrix().to_4x4() @ matrix
    matrix.translation = position
    bone.matrix = matrix
    bone.location = (0, 0, 0)
    bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def plant_feet(state, sit, recline):
    """Bake a two-bone leg solve; no helpers, constraints or runtime IK needed."""
    arm = state['arm']
    release = section(recline, 0., .65)
    if release >= 1:
        return
    forward = arm.matrix_world.to_3x3().inverted() @ Vector((0, -1, 0))
    for side in ['Left', 'Right']:
        thigh, shin, foot = [arm.pose.bones['mixamorig:' + side + suffix]
                             for suffix in ['UpLeg', 'Leg', 'Foot']]
        anchor, orientation, rest_pole = state['feet'][side]
        goal = anchor.lerp(foot.head, release)
        foot_rotation = orientation.slerp(foot.matrix.to_quaternion(), release)
        hip, knee, ankle = thigh.head.copy(), shin.head.copy(), foot.head.copy()
        upper, lower = (knee - hip).length, (ankle - knee).length
        axis = goal - hip
        distance = max(1e-9, axis.length)
        axis.normalize()
        reach = min(upper + lower - 1e-8, max(abs(upper - lower) + 1e-8, distance))
        along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
        height = math.sqrt(max(0., upper * upper - along * along))
        preferred = rest_pole.lerp(forward.normalized(), section(sit, 0., .2))
        pole = preferred - axis * preferred.dot(axis)
        pole.normalize()
        target_knee = hip + axis * along + pole * height
        orient_bone(thigh, (knee - hip).rotation_difference(target_knee - hip))
        orient_bone(shin, (foot.head - shin.head).rotation_difference(goal - shin.head))
        orient_bone(foot, foot_rotation @ foot.matrix.to_quaternion().inverted())


def basis(state, sit, recline, walk=None, offset=0.):
    arm = state['arm']
    if walk is not None:
        polish.phase2.walk_gait.apply(state['gait'], walk, approach=True)
        return
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
        if 'feet' in state:
            hips.location += state['hip_space'] @ Vector((0, .14 * sit * (1 - recline), 0))
            bpy.context.view_layer.update()
            plant_feet(state, sit, recline)


def weights(sit, recline, contacts):
    result = {'Sit_Clearance': sit * (1 - recline), 'LieDown_Clearance': recline}
    if not contacts:
        return result
    # Adjacent sculpted shapes blend on the continuous pose parameter, not on
    # elapsed time. The return path therefore samples exactly the same surface.
    for kind, progress in [('Sit', sit), ('Recline', recline)]:
        knots = KNOTS[kind]
        for i, knot in enumerate(knots[1:], 1):
            left, right = knots[i - 1], knots[min(i + 1, len(knots) - 1)]
            weight = ((progress - left) / (knot - left) if progress <= knot
                      else (right - progress) / max(1e-9, right - knot))
            result[f'{kind}_Contact_{i}'] = max(0., min(1., weight)) * (
                1 - min(1., recline * 5) if kind == 'Sit' else 1.)
    return result


def set_keys(obj, values):
    for key in list(obj.data.shape_keys.key_blocks)[1:]:
        key.value = values.get(key.name, 0.)


def walk_weights(kind, time):
    samples = WALK_SAMPLES[kind]
    t = time % 1.2 if kind == 'Walk' else min(2.1, max(0., time))
    index = min(len(samples)-1, int((t + 1e-9)*10))
    fraction = max(0., min(1., (t - samples[index])*10))
    following = (index+1) % len(samples) if kind == 'Walk' else min(index+1, len(samples)-1)
    return {f'{kind}_Contact_{index}': 1-fraction, f'{kind}_Contact_{following}': fraction} if following != index else {f'{kind}_Contact_{index}': 1.}


def sculpt_walk(state):
    obj, arm = state['obj'], state['arm']
    positions, _, dress = polish.surface_data(obj)
    # Only the loose skirt reaches the thighs. The attached bodice overlaps
    # conservative torso capsules by design and must not be inflated.
    dress &= positions[:, 2] < .56
    groups, _, neighbors, _ = polish.body_graph(obj, positions, ~dress, np.zeros(len(dress), dtype=bool))
    results = {}
    for kind, samples in WALK_SAMPLES.items():
        for index, time in enumerate(samples):
            polish.phase2.walk_gait.apply(state['gait'], time, approach=kind == 'Approach')
            set_keys(obj, {})
            bpy.context.view_layer.update()
            posed = polish.evaluated_coords(obj)
            capsules = polish.body_capsules(arm)
            target = polish.project_contacts(posed, dress, capsules, 'dress', clearance=.006)
            delta = target-posed
            if kind == 'Approach':
                delta *= polish.phase2.walk_gait.smooth(time/.18) * (1-polish.phase2.walk_gait.smooth((time-1.85)/.25))
            offsets = np.array([delta[ids].mean(0) for ids in groups])
            for _ in range(2):
                old = offsets.copy()
                for i in neighbors:
                    offsets[i] = .7*old[i] + .3*old[sorted(neighbors[i])].mean(0)
            for i, ids in enumerate(groups):
                delta[ids] = offsets[i]
            target = polish.project_contacts(posed+delta, dress, capsules, 'dress', clearance=.005)
            delta = target-posed
            delta *= np.clip((.56-positions[:, 2])/.04, 0., 1.)[:, None]
            if kind == 'Approach':
                delta *= polish.phase2.walk_gait.smooth(time/.18) * (1-polish.phase2.walk_gait.smooth((time-1.85)/.25))
            ids = np.flatnonzero(np.linalg.norm(delta, axis=1)>1e-6)
            matrices = polish.skin_matrices(obj, arm)
            local = np.linalg.solve(matrices[ids], delta[ids,:,None])[...,0]
            key = obj.shape_key_add(name=f'{kind}_Contact_{index}', from_mix=False)
            coordinates = np.array([v.co[:] for v in obj.data.shape_keys.reference_key.data])
            coordinates[ids] += local
            key.data.foreach_set('co', coordinates.flatten())
            results[key.name] = {'vertices': len(ids), 'max_world_offset': float(np.linalg.norm(delta,axis=1).max())}
    set_keys(obj,{})
    return results


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
        for index, progress in enumerate(KNOTS[kind][1:], 1):
            sit, recline = (progress, 0.) if kind == 'Sit' else (1., progress)
            basis(state, sit, recline)
            set_keys(obj, weights(sit, recline, False))
            bpy.context.view_layer.update()
            posed = polish.evaluated_coords(obj)
            capsules = polish.body_capsules(arm)
            delta = np.zeros_like(posed)
            support = .047 * section(recline, .5, 1.)
            for (mask, part), (groups, neighbors) in zip(regions, graphs):
                target = polish.project_contacts(posed, mask, capsules, part, clearance=.006)
                if recline > .5:
                    target[mask, 2] = np.maximum(target[mask, 2], support)
                offsets = np.array([(target[ids] - posed[ids]).mean(0) for ids in groups])
                for _ in range(2):
                    previous = offsets.copy()
                    for i in neighbors:
                        offsets[i] = .7 * previous[i] + .3 * previous[sorted(neighbors[i])].mean(0)
                for i, ids in enumerate(groups):
                    delta[ids] = offsets[i]
                fixed = polish.project_contacts(posed + delta, mask, capsules, part, clearance=.005)
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
    for frame in range(1, last + 1):
        t = (frame - 1) / FPS
        if name == 'Walk':
            polish.phase2.walk_gait.apply(state['gait'], t)
            values = walk_weights('Walk', t)
        else:
            sit, recline, walk, offset = timeline(name, t)
            basis(state, sit, recline, walk, offset)
            values = weights(sit, recline, True)
            if walk is not None:
                values.update(walk_weights('Approach', t))
        set_keys(obj, values)
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
    root = Path(workspace).resolve()
    source = root / 'art/resident/tripo-dynamics/luna-tripo-dynamics.blend'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_HASH
    scene = polish.phase2.load_scene(source)
    scene.name = 'Tripo_Continuous_Review'
    bpy.context.window.scene = scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    obj = next(o for o in scene.objects if o.type == 'MESH')
    assert len(arm.data.bones) == 103 and len(obj.data.polygons) == 18659
    repair = polish.phase2.repair_hair_islands(obj)
    for owner in [arm, obj.data.shape_keys]:
        owner.animation_data.action = None
        for track in owner.animation_data.nla_tracks:
            track.mute = True
        for track in list(owner.animation_data.nla_tracks):
            if track.name == 'Walk':
                owner.animation_data.nla_tracks.remove(track)
    polish.phase2.pose(arm, 'Rest', 0.)
    rest = capture(arm)
    ankle = min((arm.matrix_world @ arm.pose.bones['mixamorig:' + side + 'Foot'].head).z for side in ['Left', 'Right'])
    hip_space = (arm.matrix_world.to_3x3() @ arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()).inverted()
    polish.phase2.pose(arm, 'Sit', 2.)
    sit = capture(arm)
    polish.phase2.pose(arm, 'LieDown', 2.)
    state = dict(root=root, scene=scene, obj=obj, arm=arm, rest=rest, sit=sit, lie=capture(arm),
                 ankle=ankle, hip_space=hip_space, weight_repair=repair)
    state['gait'] = polish.phase2.walk_gait.setup(arm)
    basis(state, 0., 0.)
    state['feet'] = {}
    for side in ['Left', 'Right']:
        thigh, shin, foot = [arm.pose.bones['mixamorig:' + side + suffix]
                             for suffix in ['UpLeg', 'Leg', 'Foot']]
        axis = (foot.head - thigh.head).normalized()
        pole = shin.head - thigh.head
        pole = (pole - axis * pole.dot(axis)).normalized()
        state['feet'][side] = (foot.head.copy(), foot.matrix.to_quaternion(), pole)
    return state


def export(state):
    root, scene, arm, obj = (state[k] for k in ['root', 'scene', 'arm', 'obj'])
    polish.phase2.pose(arm, 'Rest', 0.)
    arm['asset_version'] = 'tripo-continuous-review'
    arm['walk_speed'] = polish.phase2.walk_gait.SPEED
    arm['walk_period'] = polish.phase2.walk_gait.PERIOD
    arm['walk_in_place'] = True
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
    align_cycle_times(runtime)
    sparsify_morph_normals(runtime)
    polish.bake_morph_channels(runtime, obj, last_frames)
    polish.phase2.pose(arm, 'Rest', 0.)
    set_keys(obj, {})
    scene.frame_set(1)
    bpy.data.libraries.write(str(folder / 'luna-tripo-transitions.blend'), {scene},
                             path_remap='RELATIVE', fake_user=True, compress=True)
    return runtime


def sparsify_morph_normals(filepath):
    """Drop exporter roundoff (<1e-6) in morph normal deltas.

    Blender otherwise writes ~17k numerical-noise normals per local target.
    Position deltas, UVs, texture bytes and meaningful normals stay untouched.
    The subsequent morph bake compacts the now-unreferenced buffer views.
    """
    data = filepath.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20+size])
    binary = bytearray(data[28+size:])
    def read(view, dtype, count, offset=0):
        start = doc['bufferViews'][view].get('byteOffset', 0) + offset
        return np.frombuffer(binary, dtype=dtype, count=count, offset=start).copy()
    def append(array):
        binary.extend(b'\0' * (-len(binary) % 4))
        view = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': array.nbytes})
        binary.extend(array.tobytes())
        return view
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            for target in primitive.get('targets', []):
                if 'NORMAL' not in target:
                    continue
                a = doc['accessors'][target['NORMAL']]
                values = np.zeros((a['count'], 3), dtype='<f4')
                if 'bufferView' in a:
                    values[:] = read(a['bufferView'], '<f4', a['count']*3, a.get('byteOffset',0)).reshape(-1,3)
                if 'sparse' in a:
                    s = a['sparse']; indices = s['indices']; val = s['values']
                    ids = read(indices['bufferView'], {5121:'u1',5123:'<u2',5125:'<u4'}[indices['componentType']], s['count'], indices.get('byteOffset',0))
                    values[ids] = read(val['bufferView'], '<f4', s['count']*3, val.get('byteOffset',0)).reshape(-1,3)
                ids = np.flatnonzero(np.linalg.norm(values,axis=1)>1e-6).astype('<u2')
                for key in ['bufferView','byteOffset','sparse']:
                    a.pop(key,None)
                if len(ids):
                    a['sparse'] = {'count':len(ids), 'indices':{'bufferView':append(ids),'componentType':5123},
                                   'values':{'bufferView':append(values[ids])}}
    binary.extend(b'\0' * (-len(binary) % 4))
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(doc,separators=(',',':')).encode('utf-8')
    encoded += b' ' * (-len(encoded)%4)
    filepath.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+
                         struct.pack('<II',len(encoded),0x4e4f534a)+encoded+
                         struct.pack('<II',len(binary),0x004e4942)+binary)


def align_cycle_times(filepath):
    """Align Blender frame 1 with glTF t=0 for both bones and morph weights.

    This exporter starts the bone tracks at 1/30 s while authored Key curves
    start at zero. Allocate separate time accessors so the four legacy clips
    and any shared buffer data remain untouched.
    """
    data = filepath.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    order = ['Walk', 'ArmsUp', 'Sit', 'LieDown', 'SitCycle', 'LieCycle']
    doc['animations'].sort(key=lambda action: order.index(action['name']))
    binary = bytearray(data[28 + size:])
    for animation in doc['animations']:
        if animation['name'] not in [*CLIPS, 'Walk']:
            continue
        inputs = sorted({sampler['input'] for sampler in animation['samplers']})
        times = {}
        for index in inputs:
            accessor = doc['accessors'][index]
            view = doc['bufferViews'][accessor['bufferView']]
            assert accessor['componentType'] == 5126 and accessor['type'] == 'SCALAR'
            start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            times[index] = np.frombuffer(binary, dtype='<f4', count=accessor['count'], offset=start).copy()
        origin = min(float(values[0]) for values in times.values())
        assert abs(origin - 1 / FPS) < 1e-6 or abs(origin) < 1e-6, origin
        remap = {}
        for index, values in times.items():
            values -= origin
            view_index = len(doc['bufferViews'])
            doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': values.nbytes})
            binary.extend(values.tobytes())
            remap[index] = len(doc['accessors'])
            doc['accessors'].append({'bufferView': view_index, 'componentType': 5126,
                'count': len(values), 'type': 'SCALAR', 'min': [float(values.min())], 'max': [float(values.max())]})
        for sampler in animation['samplers']:
            sampler['input'] = remap[sampler['input']]
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    filepath.write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(binary)) +
                         struct.pack('<II', len(encoded), 0x4e4f534a) + encoded +
                         struct.pack('<II', len(binary), 0x004e4942) + binary)


def build(workspace):
    state = prepare(workspace)
    state['corrections'] = sculpt(state)
    state['corrections'].update(sculpt_walk(state))
    author(state, 'Walk', 1.2)
    for name, duration in CLIPS.items():
        author(state, name, duration)
    state['runtime'] = export(state)
    report = {'source_sha256': SOURCE_HASH, 'fps': FPS, 'clips_seconds': CLIPS,
              'bone_count': len(state['arm'].data.bones), 'corrections': state['corrections'],
              'contact_knots': KNOTS, 'baked_footplant': True,
              'weight_repair': state['weight_repair'], 'walk_samples': WALK_SAMPLES,
              'walk_speed': polish.phase2.walk_gait.SPEED,
              'cycle_bone_and_morph_time_origin': 0}
    (state['root'] / 'art/resident/tripo-transitions/authoring.json').write_text(
        json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return state


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    print(json.dumps(build(args.workspace)['corrections'], indent=2))
