"""Fresh-process import gate for the 15 actual runtime GLBs."""
import bpy,pathlib,json,math
ROOT=pathlib.Path(__file__).resolve().parents[2]
names=['bed','plant','hatch','storage-box','cartridge','computer.fitted','rolling-chair.parts','lounge-chair.parts','journal.parts','planner.parts','cabinet.parts','desk.parts','keyboard.parts','turntable.parts','lamp.parts']
results=[]
for name in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path=ROOT/'public/models/replaced'/f'{name}.glb'
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    images=[{'name':i.name,'size':list(i.size)} for i in bpy.data.images if i.size[0]]
    row={'asset':name,'bytes':path.stat().st_size,'parts':[o.name for o in meshes],'triangles':sum(len(o.data.polygons) for o in meshes),'images':images}
    row['finite']=all(math.isfinite(c) for o in meshes for v in o.data.vertices for c in v.co)
    row['materials']=all(len(o.data.materials)>0 and len(o.data.uv_layers)>0 for o in meshes)
    row['pass']=bool(meshes) and row['finite'] and row['materials'] and row['bytes']<10*1024*1024 and all(max(i['size'])<=2048 for i in images)
    results.append(row)
out=ROOT/'art/model-replacement/fresh-import.json'
out.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
assert all(r['pass'] for r in results), str([r['asset'] for r in results if not r['pass']])
print('VERIFIED',len(results),'assets',sum(r['bytes'] for r in results),'bytes',sum(r['triangles'] for r in results),'triangles',flush=True)
