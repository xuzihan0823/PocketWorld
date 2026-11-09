from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
scene=bpy.context.scene
scene.frame_set(1)
world=bpy.data.worlds.new('Luna Review World')
world.use_nodes=True
next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs['Color'].default_value=(.7,.75,.85,1)
next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs['Strength'].default_value=.45
scene.world=world
camera_data=bpy.data.cameras.new('Review Camera')
camera=bpy.data.objects.new('Review Camera',camera_data)
scene.collection.objects.link(camera)
camera_data.type='ORTHO'
scene.camera=camera
for name,location,power,size in [('Key',(-2,-3,4),350,4),('Fill',(3,-2,2),180,3),('Rim',(0,2,3),250,3)]:
    data=bpy.data.lights.new('Review '+name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    light=bpy.data.objects.new('Review '+name,data);scene.collection.objects.link(light);light.location=location
    light.rotation_euler=(Vector((0,0,.7))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=True
scene.render.resolution_x=1000
scene.render.resolution_y=1100
camera.location=(.20,-4,1.0)
camera.rotation_euler=(Vector((.14,0,.72))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.ortho_scale=1.72
scene.render.filepath=str(ROOT/'art/resident/overview.png')
bpy.ops.render.render(write_still=True)
