"""Separate supplied visual parts without changing the source or app's motion system.
Coordinates below are normalized Blender X/Y/Z; front is -Y, up is Z.
"""
import bpy, bmesh, pathlib, json, math, sys, numpy as np
from mathutils import Vector, Matrix
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT/'public/models/replaced'
WORK = ROOT/'art/model-replacement/generated'
rules = {
 'rolling-chair': lambda x,y,z: 'base' if z < .29 else 'seat',
 'lounge-chair': lambda x,y,z: 'base' if z < .36 else 'seat',
 'journal': lambda x,y,z: 'cover' if z > .84 else 'body',
 'planner': lambda x,y,z: 'cover' if z > .84 else 'body',
 'cabinet': lambda x,y,z: 'door' if .065 < x < .94 and .10 < z < .35 and y < .18 else 'body',
 'desk': lambda x,y,z: 'drawer' if .07 < x < .45 and .70 < z < .94 else 'body',
 'keyboard': lambda x,y,z: 'body' if z < .33 else 'keys',
 'turntable': lambda x,y,z: 'body' if z < .57 else 'mechanism',
 'lamp': lambda x,y,z: 'cord' if .43 < x < .52 and .48 < z < .685 else 'body',
}
report=[]
for name, rule in rules.items():
    if '--only' in sys.argv and name != sys.argv[sys.argv.index('--only')+1]:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source_path=OUT/(name+'.glb')
    if not source_path.exists(): source_path=WORK/'optimized'/(name+'.glb')
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    source=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    bpy.context.view_layer.objects.active=source
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if name in ['journal','planner']:
        points=np.array([tuple(v.co) for v in source.data.vertices])
        values,axes=np.linalg.eigh(np.cov(points.T))
        normal=Vector(axes[:,0]); normal *= 1 if normal.z>0 else -1
        x=Vector((1,0,0));x=(x-normal*x.dot(normal)).normalized()
        y=normal.cross(x).normalized()
        source.data.transform(Matrix((x,y,normal)).to_4x4())
        source.data.update()
        print('LEVEL',name,tuple(normal),flush=True)
    if name=='keyboard':
        source.rotation_euler.z=.88
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    lo=Vector([min(v.co[k] for v in source.data.vertices) for k in range(3)])
    hi=Vector([max(v.co[k] for v in source.data.vertices) for k in range(3)])
    def tag(co): return rule(*[(co[k]-lo[k])/(hi[k]-lo[k]) for k in range(3)])
    tags={tag(p.center) for p in source.data.polygons}
    # Slice the mesh at the actual part boundaries before classification. This
    # replaces the first-pass staircase cuts with exact planar boundaries.
    planes={
      'rolling-chair':[(2,.29)], 'lounge-chair':[(2,.36)],
      'journal':[(2,.84)], 'planner':[(2,.84)],
      'keyboard':[(2,.33)], 'turntable':[(2,.57)],
      'cabinet':[(0,.065),(0,.94),(2,.10),(2,.35),(1,.18)],
      'desk':[(0,.07),(0,.45),(2,.70),(2,.94)],
      'lamp':[(0,.43),(0,.52),(2,.48),(2,.685)]
    }[name]
    bm=bmesh.new();bm.from_mesh(source.data)
    for axis,value in planes:
        normal=Vector((0,0,0));normal[axis]=1
        point=Vector((0,0,0));point[axis]=lo[axis]+value*(hi[axis]-lo[axis])
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-6,plane_co=point,plane_no=normal)
    bm.to_mesh(source.data);bm.free();source.data.update()
    parts=[]
    for part in sorted(tags):
        obj=source.copy(); obj.data=source.data.copy(); obj.name=part
        bpy.context.collection.objects.link(obj)
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if tag(f.calc_center_median())!=part],context='FACES')
        # Seal only new planar cut boundaries, leaving original authored openings alone.
        if name in ['rolling-chair','lounge-chair','journal','planner','keyboard','turntable']:
            axis,value=planes[0]; height=lo[axis]+value*(hi[axis]-lo[axis])
            edges=[e for e in bm.edges if e.is_boundary and all(abs(v.co[axis]-height)<1e-5 for v in e.verts)]
            if edges:
                mat=bpy.data.materials.get('Cut surface') or bpy.data.materials.new('Cut surface')
                mat.diffuse_color=(.55,.49,.34,1);mat.use_nodes=True
                mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.55,.49,.34,1)
                obj.data.materials.append(mat)
                for face in bmesh.ops.holes_fill(bm,edges=edges,sides=0)['faces']:face.material_index=len(obj.data.materials)-1
        if name=='lamp' and part=='cord':
            print('LAMP_CORD',[(min(v.co[k] for v in bm.verts),max(v.co[k] for v in bm.verts)) for k in range(3)])
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        if name in ['cabinet','lamp']:
            # Fit the visual surfaces around the unchanged functional contacts.
            knots=([(0,0),(.10,.10),(.35,.38),(.38,.402),(.57,.585),(.77,.767),(1,1)]
                   if name=='cabinet' else [(0,0),(.48,.48),(.685,.80),(.88,.97),(1,1)])
            for v in obj.data.vertices:
                z=(v.co.z-lo.z)/(hi.z-lo.z)
                for (a,b),(c,d) in zip(knots,knots[1:]):
                    if a-1e-6<=z<=c+1e-6:
                        v.co.z=lo.z+(b+(z-a)/(c-a)*(d-b))*(hi.z-lo.z);break
            obj.data.update()
        parts.append({'name':part,'triangles':len(obj.data.polygons)})
    bpy.data.objects.remove(source,do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(name+'.parts.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.parts.glb')),export_format='GLB',export_image_format='AUTO')
    report.append({'asset':name,'parts':parts})
(WORK/'parts.json').write_text(json.dumps(report,indent=2),encoding='utf8')
