import bpy,bmesh,json,sys,struct
import numpy as np
from pathlib import Path
from mathutils import Matrix
from mathutils.bvhtree import BVHTree
import argparse
parser=argparse.ArgumentParser(description='Bake Luna seat contact into sparse pre-skin displacements.')
parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]/'assets/models/resident/Luna-Sit-ContactFixed.blend')
parser.add_argument('--output',type=Path,required=True,help='Temporary build directory outside the repository')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=args.output.resolve();SOURCE=args.source.resolve();OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
s=bpy.context.scene;rig=bpy.data.objects['Luna_ContactCorrected_Baked'];mesh=bpy.data.objects['Luna_Surface'];seat=bpy.data.objects['seat']
mesh.modifiers.remove(mesh.modifiers['Contact surface interpolation'])
mesh.modifiers['Full skirt cushion clearance'].offset=.006
mesh.modifiers['Skirt edge clearance'].offset=.006
mesh.modifiers['Underhem bridge clearance'].offset=.016
groups={g.index:g.name for g in mesh.vertex_groups};bone_names=set(rig.pose.bones.keys())
normals=np.zeros((len(mesh.data.vertices),3));counts=np.zeros(len(mesh.data.vertices))
for loop,normal in zip(mesh.data.loops,mesh.data.corner_normals):
 normals[loop.vertex_index]+=normal.vector;counts[loop.vertex_index]+=1
normals/=np.maximum(counts,1)[:,None]
normal_attribute=mesh.data.attributes.new('source_normal','FLOAT_VECTOR','POINT')
normal_attribute.data.foreach_set('vector',normals.ravel())
def refine(faces=None):
 contact={v.index for v in mesh.data.vertices if any(groups[g.group] in ['Lower contact envelope','Underhem transition','All skirt cushion contact'] and g.weight>.01 for g in v.groups)}
 bm=bmesh.new();bm.from_mesh(mesh.data);bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
 selected=[f for f in bm.faces if (f.index in faces if faces is not None else any(v.index in contact for v in f.verts))]
 edges={e for f in selected for e in f.edges}
 bmesh.ops.subdivide_edges(bm,edges=sorted(edges,key=lambda e:e.index),cuts=1,use_grid_fill=True)
 bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(mesh.data);bm.free();mesh.data.update()
 # glTF supports four weights in this runtime; clamp before solving, not at export.
 for v in mesh.data.vertices:
  w=sorted([(g.group,g.weight) for g in v.groups if groups[g.group] in bone_names],key=lambda x:-x[1])
  total=sum(a[1] for a in w[:4])
  for i,value in w[4:]:mesh.vertex_groups[i].remove([v.index])
  for i,value in w[:4]:mesh.vertex_groups[i].add([v.index],value/total,'REPLACE')
 print('REFINED',len(mesh.data.vertices),len(mesh.data.polygons),flush=True)
refine()
seat_points=[seat.matrix_world@v.co for v in seat.data.vertices];seat_bvh=BVHTree.FromPolygons(seat_points,[list(p.vertices) for p in seat.data.polygons])
def overlaps(frames):
 bad=set();rows=[]
 contact={v.index for v in mesh.data.vertices if any((groups[g.group] in ['Lower contact envelope','Underhem transition','All skirt cushion contact'] and g.weight>.01) or ('UpLeg' in groups[g.group] and g.weight>.4) for g in v.groups)}
 faces=[p for p in mesh.data.polygons if any(i in contact for i in p.vertices)];polys=[list(p.vertices) for p in faces]
 for f in frames:
  s.frame_set(f);ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();pts=[ev.matrix_world@v.co for v in me.vertices]
  pairs=BVHTree.FromPolygons(pts,polys).overlap(seat_bvh);bad.update(faces[a].index for a,b in pairs);rows.append([f,len(pairs)])
  ev.to_mesh_clear()
 print('OVERLAPS',len(bad),max(x[1] for x in rows),flush=True);return bad,rows
for iteration in range(10):
 bad,rows=overlaps(range(1,69,2))
 if not bad:break
 refine(bad)
bad,rows=overlaps(range(1,69))
(OUT/'runtime-native-contact.json').write_text(json.dumps(rows))
assert not bad,('unresolved intersections',len(bad))
bones=list(rig.pose.bones);bi={b.name:i for i,b in enumerate(bones)};n=len(mesh.data.vertices)
rest=np.empty(n*3);mesh.data.vertices.foreach_get('co',rest);rest=rest.reshape(n,3);weights=np.zeros((n,len(bones)))
for v in mesh.data.vertices:
 for g in v.groups:
  if groups[g.group] in bi:weights[v.index,bi[groups[g.group]]]=g.weight
weights/=weights.sum(axis=1)[:,None]
contact_mods=[m for m in mesh.modifiers if m.type=='SHRINKWRAP']
def evaluated():
 bpy.context.view_layer.update();ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();a=np.empty(n*3);me.vertices.foreach_get('co',a);ev.to_mesh_clear();return a.reshape(n,3)
deltas=[];maxerrors=[]
for f in range(1,69):
 s.frame_set(f)
 for m in contact_mods:m.show_viewport=False
 raw=evaluated()
 for m in contact_mods:m.show_viewport=True
 target=evaluated();matrices=np.array([np.array(p.matrix@p.bone.matrix_local.inverted()) for p in bones]);skin=np.einsum('nb,bij->nij',weights,matrices)
 error=float(np.max(np.linalg.norm(np.einsum('nij,nj->ni',skin[:,:3,:3],rest)+skin[:,:3,3]-raw,axis=1))*1.43);maxerrors.append(error)
 deltas.append(np.linalg.solve(skin[:,:3,:3],(target-raw)[...,None])[...,0].astype(np.float32))
 if f%20==0:print('BAKE',f,error,flush=True)
D=np.array(deltas);indices=np.where(np.max(np.abs(D),axis=(0,2))>1e-6)[0]
# glTF axes: Blender x,y,z -> x,z,-y. Quantized 16-bit displacement, independently sampled at 30 Hz.
cache=D[:,indices,:][:,:,[0,2,1]];cache[:,:,2]*=-1
quantum=float(np.max(np.abs(cache))/32760);quantized=np.rint(cache/quantum).astype('<i2')
header=struct.pack('<4sIII f',b'PWSC',1,68,len(indices),quantum)
(OUT/'luna-seat-contact.bin').write_bytes(header+quantized.tobytes())
attr=mesh.data.attributes.new('_CONTACT_ID','FLOAT','POINT');ids=np.full(n,-1,dtype=np.float32);ids[indices]=np.arange(len(indices),dtype=np.float32);attr.data.foreach_set('value',ids)
normals=np.empty(n*3);mesh.data.attributes['source_normal'].data.foreach_get('vector',normals);normals=normals.reshape(n,3);normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-9)
mesh.data.normals_split_custom_set_from_vertices(normals.tolist())
np.savez_compressed(OUT/'runtime-reference.npz',rest=rest,delta=D,indices=indices)
s.frame_start=1;s.frame_end=68;s.frame_set(1);bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'runtime-native.blend'))
for mod in list(contact_mods):mesh.modifiers.remove(mod)
rig.parent=None;rig.matrix_world=Matrix.Identity(4)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);mesh.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'luna-seat-runtime.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_nla_strips_merged_animation_name='ChairSit_Contact',export_frame_range=True,export_force_sampling=True,export_morph=False,export_attributes=True,export_optimize_animation_size=False)
(OUT/'runtime-summary.json').write_text(json.dumps({'vertices':n,'triangles':len(mesh.data.polygons),'contact_vertices':len(indices),'max_skin_error_m':max(maxerrors),'quantization_error_m':quantum*.5*1.43,'glb_bytes':(OUT/'luna-seat-runtime.glb').stat().st_size,'cache_bytes':(OUT/'luna-seat-contact.bin').stat().st_size},indent=2))
print('COMPLETE',flush=True)
