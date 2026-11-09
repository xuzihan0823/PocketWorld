from pathlib import Path
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'art/characters/blue-haired-girl'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'character.blend'))
scene=bpy.context.scene
char=bpy.data.collections['CHARACTER · export']
rig=bpy.data.objects['CharacterRig']
for obj in char.objects:
    for mod in obj.modifiers:
        if mod.type=='SUBSURF':mod.show_viewport=False;mod.show_render=False
    if obj.name.startswith('Body'):
        bpy.context.view_layer.objects.active=obj
        dec=obj.modifiers.new('Web body budget','DECIMATE');dec.ratio=.22
        bpy.ops.object.modifier_apply(modifier=dec.name)
bpy.ops.object.select_all(action='DESELECT')
for obj in char.objects:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'character.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_frame_range=False,export_skins=True,export_morph=True,export_extras=True,export_yup=True,export_materials='EXPORT',export_image_format='AUTO',export_texcoords=True,export_normals=True,export_cameras=False,export_lights=False)
exec(compile(Path(__file__).with_name('finalize_blue_glb.py').read_text(),str(Path(__file__).with_name('finalize_blue_glb.py')),'exec'))
# Review renders use the authoring mesh, while WebGL screenshots validate exported geometry.
bpy.ops.wm.open_mainfile(filepath=str(OUT/'character.blend'))
scene=bpy.context.scene
scene.cycles.samples=40
scene.render.resolution_x=900;scene.render.resolution_y=1100;scene.camera.data.ortho_scale=1.65
for name,loc in [('front',(0,-3,.78)),('side',(3,0,.78)),('back',(0,3,.78)),('three-quarter',(2,-3,.88))]:
    scene.camera.location=loc;scene.camera.rotation_euler=(Vector((0,0,.72))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
scene.camera.location=(0,-3,1.29);scene.camera.rotation_euler=(Vector((0,0,1.29))-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.ortho_scale=.36
scene.render.resolution_x=scene.render.resolution_y=900
scene.render.filepath=str(OUT/'renders/face.png');bpy.ops.render.render(write_still=True)
print('EXPORT_COMPLETE')
