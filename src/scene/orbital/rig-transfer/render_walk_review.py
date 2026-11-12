import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'art/resident/animated-transfer/walk-repair/video-frames'; OUT.mkdir(exist_ok=True)
for version in ['original','repaired']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 path=OUT.parent.parent/'luna-tripo-animated.glb' if version=='original' else OUT.parent/'luna-walk-repaired.glb'
 bpy.ops.import_scene.gltf(filepath=str(path))
 for o in list(bpy.data.objects):
  if o.type=='MESH' and len(o.vertex_groups)==0:bpy.data.objects.remove(o,do_unlink=True)
 sc=bpy.context.scene
 sc.render.engine='BLENDER_EEVEE'; sc.render.resolution_x=384; sc.render.resolution_y=576; sc.render.resolution_percentage=100
 sc.render.image_settings.file_format='PNG'; sc.world=bpy.data.worlds.new('ReviewWorld'); sc.world.color=(.18,.18,.18)
 sc.world.use_nodes=True
 bg=next(n for n in sc.world.node_tree.nodes if n.type=='BACKGROUND'); bg.inputs[0].default_value=(.36,.42,.5,1); bg.inputs[1].default_value=.6
 sc.view_settings.view_transform='AgX'
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.0002)); floor=bpy.context.object
 mat=bpy.data.materials.new('ReviewFloor'); mat.diffuse_color=(.2,.24,.29,1); floor.data.materials.append(mat)
 for loc,power,size in [((2,-3,4),350,3),((-2,-1,2),160,2),((1,3,3),300,2)]:
  bpy.ops.object.light_add(type='AREA',location=loc); light=bpy.context.object; light.data.energy=power; light.data.shape='DISK'; light.data.size=size
  light.rotation_euler=(Vector((0,0,.5))-light.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(); camera=bpy.context.object; sc.camera=camera; camera.data.type='ORTHO'; camera.data.ortho_scale=1.15
 for view,loc in [('front',(0,-3,.65)),('side',(3,0,.65))]:
  camera.location=loc; camera.rotation_euler=(Vector((0,0,.48))-camera.location).to_track_quat('-Z','Y').to_euler()
  for f in range(24):
   sc.frame_set(f+28 if version=='original' else f)
   sc.render.filepath=str(OUT/f'{version}-{view}-{f:03d}.png')
   bpy.ops.render.render(write_still=True)
print('REVIEW_FRAMES',OUT)
