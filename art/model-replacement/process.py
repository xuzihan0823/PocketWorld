"""Reproducible source-only -> optimized GLB pipeline; run with Blender -b -P."""
import bpy, json, sys, pathlib, os
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = pathlib.Path(os.environ.get('POCKETWORLD_MODEL_SOURCE', pathlib.Path.home()/'Desktop'/'3d素材'))
OUT = ROOT / 'public/models/replaced'
WORK = ROOT / 'art/model-replacement/generated'
ASSETS = [('本子','planner'),('舱门','hatch'),('唱片机','turntable'),('床','bed'),('灯','lamp'),('电脑','computer'),('柜子','cabinet'),('滑轮椅','rolling-chair'),('键盘','keyboard'),('盆栽','plant'),('日记本','journal'),('收纳盒','storage-box'),('椅子','lounge-chair'),('游戏卡带','cartridge'),('桌子','desk')]
OUT.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)
report = []
selected = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for source, name in ASSETS:
    if selected and name not in selected: continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / (source+'.glb')))
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    before = sum(len(o.data.polygons) for o in objects)
    for o in objects:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        mod = o.modifiers.new('Runtime simplification', 'DECIMATE')
        mod.ratio = min(1.0, (65000 if name in ['plant','rolling-chair','desk','cabinet'] else 45000) / max(1,len(o.data.polygons)))
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.name = name
        for p in o.data.polygons: p.use_smooth = True
        o.select_set(False)
    for i,image in enumerate(list(bpy.data.images)):
        if image.size[0] < 1: continue
        if image.packed_file: image.unpack(method='REMOVE')
        image.scale(min(2048,image.size[0]),min(2048,image.size[1]))
        image.file_format='JPEG'
        image.filepath_raw = str(WORK / (name+'-'+str(i)+'.jpg'))
        image.save()
        image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(name+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',export_image_format='JPEG',export_jpeg_quality=88,export_keep_originals=False)
    bounds = [o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
    row = dict(name=name,source=source+'.glb',before=before,triangles=sum(len(o.data.polygons) for o in objects),bytes=(OUT/(name+'.glb')).stat().st_size,min=[min(p[k] for p in bounds) for k in range(3)],max=[max(p[k] for p in bounds) for k in range(3)])
    report.append(row)
    (WORK/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('ASSET_DONE',json.dumps(row,ensure_ascii=False),flush=True)
