"""Author bear pickup timing in Blender and append a clip without duplicating poses.

Run with Blender --background --factory-startup --python-exit-code 1 --python
scripts/retime-bear-pickup.py -- --scratch <temporary-directory> [--from-blend].
The saved timing curve is the authority; original pickup poses remain unchanged.
"""
import argparse
import copy
import json
import struct
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUTFITS = {'everyday': 'luna-walk-room', 'ribbon': 'luna-ribbon', 'cardigan': 'luna-cardigan'}
FPS = 30
# Source seconds -> performance seconds. Ease into contact, then rise and settle.
TIMING = [(0, 0), (.45, .30), (1.35, .98), (1.9, 1.46),
          (2.15, 1.68), (2.72, 2.15), (3.3, 2.60), (119 / 30, 3.05)]


def read_glb(path):
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20 + size]), bytearray(raw[28 + size:])


def write_glb(path, doc, binary):
    doc['buffers'] = [{'byteLength': len(binary)}]
    data = json.dumps(doc, separators=(',', ':')).encode()
    data += b' ' * (-len(data) % 4)
    binary += b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(data) + len(binary))
                     + struct.pack('<II', len(data), 0x4e4f534a) + data
                     + struct.pack('<II', len(binary), 0x004e4942) + binary)


def scalar(doc, binary, index):
    accessor = doc['accessors'][index]
    view = doc['bufferViews'][accessor['bufferView']]
    assert accessor['componentType'] == 5126 and accessor['type'] == 'SCALAR'
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return list(struct.unpack_from('<' + 'f' * accessor['count'], binary, offset))


def curves(action):
    return [fc for layer in action.layers for strip in layer.strips
            for bag in strip.channelbags for fc in bag.fcurves]


def preview_model(outfit, doc, binary, scratch):
    """Import unchanged character skin with only the original pickup for editing."""
    model, model_bin = read_glb(ROOT / 'assets/public/models/resident' / (OUTFITS[outfit] + '.glb'))
    view_offset, accessor_offset, byte_offset = len(model['bufferViews']), len(model['accessors']), len(model_bin)
    for view in doc['bufferViews']:
        model['bufferViews'].append({**view, 'byteOffset': view.get('byteOffset', 0) + byte_offset})
    for accessor in doc['accessors']:
        model['accessors'].append({**accessor, 'bufferView': accessor['bufferView'] + view_offset})
    animation = copy.deepcopy(next(a for a in doc['animations'] if a['name'] == 'pickUp'))
    nodes = {n.get('name', '').replace(':', ''): i for i, n in enumerate(model['nodes'])}
    for sampler in animation['samplers']:
        for key in ('input', 'output'):
            sampler[key] += accessor_offset
    for channel in animation['channels']:
        channel['target']['node'] = nodes[doc['nodes'][channel['target']['node']]['name'].replace(':', '')]
    animation['name'] = outfit + '_pickUp'
    model['animations'] = [animation]
    temporary = scratch / (outfit + '-pickup-preview.glb')
    write_glb(temporary, model, model_bin + binary)
    scene = bpy.data.scenes.new(outfit)
    scene.render.fps = FPS
    bpy.context.window.scene = scene
    bpy.ops.import_scene.gltf(filepath=str(temporary))
    temporary.unlink()
    return scene


def retime_preview(outfit, clock):
    source = bpy.data.actions[outfit + '_pickUp']
    name = outfit + '_bearPickUp'
    previous = bpy.data.actions.get(name)
    if previous:
        bpy.data.actions.remove(previous)
    action = source.copy()
    action.name = name
    action.use_fake_user = source.use_fake_user = True
    for fc in curves(action):
        for point in fc.keyframe_points:
            target = clock.evaluate(point.co.x) * FPS
            point.co.x = target
            point.handle_left.x = target
            point.handle_right.x = target
            point.interpolation = 'LINEAR'
        fc.update()
    for original, retimed in zip(curves(source), curves(action)):
        for a, b in zip(original.keyframe_points, retimed.keyframe_points):
            assert abs(a.co.y - retimed.evaluate(b.co.x)) < 1e-5, 'Retiming changed a pose'
    scene = bpy.data.scenes[outfit]
    bpy.context.window.scene = scene
    for ob in scene.objects:
        if not ob.animation_data:
            continue
        for track in ob.animation_data.nla_tracks:
            track.mute = True
        if ob.animation_data.action == source or ob.type == 'ARMATURE':
            ob.animation_data.action = action
            ob.animation_data.action_slot = action.slots[0]
    scene.frame_start = 0
    scene.frame_end = int(clock.evaluate(119) * FPS + 1)
    scene.frame_set(44)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--from-blend', action='store_true')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'assets/public/models/resident')
    parser.add_argument('--timing-output', type=Path, default=ROOT / 'src/scene/orbital/bearPickupTiming.ts')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    blend = ROOT / 'assets/models/resident/Luna-Bear-Pickup.blend'
    if args.from_blend:
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        clock = curves(bpy.data.actions['Bear_Pickup_Timing'])[0]
    else:
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        timing = bpy.data.objects.new('Bear_Pickup_Timing', None)
        bpy.context.scene.collection.objects.link(timing)
        bpy.context.scene.name = 'Timing'
        bpy.context.scene.render.fps = FPS
        for source, target in TIMING:
            timing['seconds'] = target
            timing.keyframe_insert('["seconds"]', frame=source * FPS)
        timing.animation_data.action.name = 'Bear_Pickup_Timing'
        clock = curves(timing.animation_data.action)[0]
        for point in clock.keyframe_points:
            point.interpolation = 'BEZIER'
            point.handle_left_type = point.handle_right_type = 'AUTO_CLAMPED'
        clock.update()
        # Avoid a horizontal time-map tangent: it would accelerate the first/last poses.
        for index, neighbor in ((0, 1), (-1, -2)):
            point, adjacent = clock.keyframe_points[index], clock.keyframe_points[neighbor]
            delta = (adjacent.co - point.co) / 3
            point.handle_left_type = point.handle_right_type = 'FREE'
            point.handle_left = point.co - delta
            point.handle_right = point.co + delta
            if index == -1:
                point.handle_left = point.co + delta
                point.handle_right = point.co - delta
        clock.update()
    new_times = [clock.evaluate(i) for i in range(120)]
    assert all(b > a for a, b in zip(new_times, new_times[1:])), 'Timing must be strictly increasing'
    report = {}
    for outfit in OUTFITS:
        filename = 'luna-cabin-actions-' + outfit + '.glb'
        doc, binary = read_glb(ROOT / 'assets/public/models/resident' / filename)
        if not args.from_blend:
            preview_model(outfit, doc, binary, args.scratch)
        retime_preview(outfit, clock)
        old = next(a for a in doc['animations'] if a['name'] == 'pickUp')
        clip = copy.deepcopy(old)
        clip['name'] = 'bearPickUp'
        existing = next((a for a in doc['animations'] if a['name'] == 'bearPickUp'), None)
        # Reuse our previous input storage on re-export, keeping outputs deterministic.
        mapped = {}
        for i, sampler in enumerate(clip['samplers']):
            source = sampler['input']
            if source not in mapped:
                times = scalar(doc, binary, source)
                values = [clock.evaluate(t * FPS) for t in times]
                if existing:
                    index = existing['samplers'][i]['input']
                    accessor = doc['accessors'][index]
                    view = doc['bufferViews'][accessor['bufferView']]
                    assert accessor['count'] == len(values)
                    struct.pack_into('<' + 'f' * len(values), binary, view['byteOffset'], *values)
                    accessor.update(min=[values[0]], max=[values[-1]])
                else:
                    index = len(doc['accessors'])
                    doc['accessors'].append({'bufferView': len(doc['bufferViews']), 'componentType': 5126,
                        'count': len(values), 'type': 'SCALAR', 'min': [values[0]], 'max': [values[-1]]})
                    doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': 4 * len(values)})
                    binary.extend(struct.pack('<' + 'f' * len(values), *values))
                mapped[source] = index
            sampler['input'] = mapped[source]
        if existing:
            doc['animations'][doc['animations'].index(existing)] = clip
        else:
            doc['animations'].append(clip)
        output = args.output_dir / filename
        write_glb(output, doc, binary)
        scene = bpy.data.scenes[outfit]
        report[outfit] = {'bytes': output.stat().st_size, 'duration': new_times[-1],
            'channels': len(clip['channels']), 'objects': len(scene.objects),
            'meshes': {ob.name: {'triangles': sum(len(p.vertices) - 2 for p in ob.data.polygons),
                'dimensions': list(ob.dimensions)} for ob in scene.objects if ob.type == 'MESH'},
            'materials': len({m for ob in scene.objects if ob.type == 'MESH' for m in ob.data.materials})}
    args.timing_output.write_text('''// Generated from Luna-Bear-Pickup.blend by scripts/retime-bear-pickup.py.
// Each entry is the new time of an original 30 Hz pose; contact uses the same clock.
const times = ''' + json.dumps([round(t, 8) for t in new_times], separators=(',', ':')) + ''';
export const BEAR_PICKUP_DURATION = times[times.length - 1];
export function bearPickupSourceTime(time: number) {
  if (time <= 0) return 0;
  if (time >= BEAR_PICKUP_DURATION) return (times.length - 1) / 30;
  let low = 0, high = times.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (times[mid] <= time) low = mid; else high = mid;
  }
  return (low + (time - times[low]) / (times[high] - times[low])) / 30;
}
''', encoding='utf-8')
    if not args.from_blend:
        bpy.context.window.scene = bpy.data.scenes['cardigan']
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    (args.scratch / 'bear-pickup-export.json').write_text(json.dumps(report, indent=2))
    print('BEAR_PICKUP_EXPORT', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
