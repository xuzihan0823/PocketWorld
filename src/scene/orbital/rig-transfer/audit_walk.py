import bpy, json, sys, math
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
root=Path(__file__).resolve().parents[4]
args=sys.argv[sys.argv.index('--')+1:]
path=Path(args[0]); out=Path(args[-1]); cycle='cycle' in args
sample_count=int(args[args.index('--samples')+1]) if '--samples' in args else 97
assert sample_count>=3
bpy.ops.wm.read_factory_settings(use_empty=True)
if path.suffix=='.blend': bpy.ops.wm.open_mainfile(filepath=str(path))
else: bpy.ops.import_scene.gltf(filepath=str(path))
sc=bpy.context.scene; arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh=next(o for o in bpy.data.objects if o.type=='MESH' and len(o.vertex_groups)>50)
end=arm.animation_data.action.frame_range[1]; fps=sc.render.fps
start=28 if cycle else 0
if cycle:end=52
def ids(prefixes,threshold=.5):
 gs={g.index for g in mesh.vertex_groups if any(g.name.startswith(p) for p in prefixes)}
 return [v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in gs)>threshold]
feet={s:ids(['mixamorig:'+s+'Foot','mixamorig:'+s+'Toe'],.65) for s in ['Left','Right']}
patches={}
for side,indices in feet.items():
 rest={k:mesh.matrix_world@mesh.data.vertices[k].co for k in indices}
 # Freeze two small lower-surface patches in bind geometry, then track the same vertices.
 for name,y in [('heel',.013),('ball',-.055)]:
  candidates=sorted(indices,key=lambda k:abs(rest[k].y-y)*.4+rest[k].z)
  patches[side+'_'+name]=candidates[:8]
collision_prefixes=['mixamorig:LeftHand','mixamorig:RightHand']
if '--include-forearms' in args:collision_prefixes+=['mixamorig:LeftForeArm','mixamorig:RightForeArm']
hands=ids(collision_prefixes,.5)
dress=set(ids(['Dress_'],.4)); handset=set(hands)
mesh.data.calc_loop_triangles()
dt=[tuple(t.vertices) for t in mesh.data.loop_triangles if all(v in dress for v in t.vertices)]
ht=[tuple(t.vertices) for t in mesh.data.loop_triangles if all(v in handset for v in t.vertices)]
def crosses(aa,bb):
 for tri,other in [(aa,bb),(bb,aa)]:
  for j in range(3):
   start=tri[j]; delta=tri[(j+1)%3]-start
   hit=intersect_ray_tri(*other,delta,start,True)
   if hit is not None and 1e-6<(hit-start).dot(delta)/max(delta.length_squared,1e-15)<1-1e-6:return True
 return False
rows=[]; poses=[]
for i in range(sample_count):
 f=start+(float(end)-start)*i/(sample_count-1); sc.frame_set(int(f),subframe=f-int(f))
 ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
 vs=[ev.matrix_world@v.co for v in ev.data.vertices]
 tree=BVHTree.FromPolygons(vs,dt,all_triangles=True)
 handtree=BVHTree.FromPolygons(vs,ht,all_triangles=True)
 pairs=handtree.overlap(tree)
 intersections=sum(crosses([vs[v] for v in ht[a]],[vs[v] for v in dt[b]]) for a,b in pairs)
 minimum=min(tree.find_nearest(vs[v])[3] for v in hands)
 row={'t':(f-start)/fps,'hand_dress_distance':minimum,'hand_dress_intersections':intersections,'feet':{},'patches':{}}
 for key,indices in patches.items():row['patches'][key]=list(sum((vs[k] for k in indices),Vector())/len(indices))
 for side,indices in feet.items():
  pts=[vs[k] for k in indices]
  foot=arm.pose.bones['mixamorig:'+side+'Foot']; toe=arm.pose.bones['mixamorig:'+side+'ToeBase']
  row['feet'][side]={'min_z':min(p.z for p in pts),'ankle':list(foot.head),'ball':list(toe.head)}
 rows.append(row); poses.append({b.name:(b.matrix.translation.copy(),b.matrix.to_quaternion()) for b in arm.pose.bones})
summary={'asset':str(path),'fps':fps,'duration':(float(end)-start)/fps,'samples':len(rows),'collision_region_prefixes':collision_prefixes,
 'min_foot_z':min(r['feet'][s]['min_z'] for r in rows for s in feet),
 'max_lowest_foot_z':max(min(r['feet'][s]['min_z'] for s in feet) for r in rows),
 'min_hand_dress_distance':min(r['hand_dress_distance'] for r in rows),
 'max_hand_dress_intersections':max(r['hand_dress_intersections'] for r in rows),
 'seam_max_bone_position':max((poses[0][n][0]-poses[-1][n][0]).length for n in poses[0]),
 'seam_max_bone_angle_deg':max(math.degrees(min(a,abs(2*math.pi-a))) for n in poses[0] for a in [poses[0][n][1].rotation_difference(poses[-1][n][1]).angle])}
if cycle or end/fps<1.1:
 summary['support_drift']={}
 for side,offset in [('Left',0),('Right',.5)]:
  support=[r for r in rows if 2/24<=r['t']-offset<=9/24]
  for name in ['heel','ball']:
   key=side+'_'+name; a=support[0]; anchor=np.array(a['patches'][key])[:2]+[0,-.576*a['t']]
   errors=[float(np.linalg.norm(np.array(r['patches'][key])[:2]+[0,-.576*r['t']]-anchor)) for r in support]
   summary['support_drift'][key]={'max_tangent_drift':max(errors),'start':a['t'],'end':support[-1]['t'],'root_speed':.576}
out.write_text(json.dumps({'summary':summary,'rows':rows},indent=2)); print(json.dumps(summary,indent=2))
