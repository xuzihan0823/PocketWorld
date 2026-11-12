"""Fit CRT opening to the unchanged 0.92 x 0.69 screen; keep the foot on the desk."""
import bpy,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
source=ROOT/'public/models/replaced/computer.glb'
if not source.exists(): source=ROOT/'art/model-replacement/generated/optimized/computer.glb'
bpy.ops.import_scene.gltf(filepath=str(source))
o=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.context.view_layer.objects.active=o
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
lo=min(v.co.z for v in o.data.vertices);hi=max(v.co.z for v in o.data.vertices)
knots=[(0,0),(.18,.09),(.34,.205),(.87,.87),(1,1)]
for v in o.data.vertices:
    y=(v.co.z-lo)/(hi-lo)
    for (a,b),(c,d) in zip(knots,knots[1:]):
        if a-1e-6<=y<=c+1e-6:
            v.co.z=lo+(b+(y-a)/(c-a)*(d-b))*(hi-lo);break
o.data.update()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/model-replacement/generated/computer.fitted.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/replaced/computer.fitted.glb'),export_format='GLB',export_image_format='AUTO')
