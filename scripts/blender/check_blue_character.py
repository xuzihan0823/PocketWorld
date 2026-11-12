"""Run in Blender to audit the exported asset independently of its authoring scene."""
from pathlib import Path
import bpy
import bmesh
import json
import math

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'art/characters/blue-haired-girl'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'character.glb'))
armatures=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
print('Non-skinned import helpers:',[(o.name,len(o.data.vertices)) for o in bpy.context.scene.objects if o.type=='MESH' and o not in meshes])
keys=set();unweighted=0;max_influences=0;max_error=0;nonfinite=0;triangles=0
for obj in meshes:
    if obj.data.shape_keys:keys.update(k.name for k in obj.data.shape_keys.key_blocks if k.name!='Basis')
    obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    for v in obj.data.vertices:
        values=[g.weight for g in v.groups if g.weight>1e-6]
        unweighted+=not values
        max_influences=max(max_influences,len(values))
        max_error=max(max_error,abs(sum(values)-1))
        nonfinite+=not all(math.isfinite(n) for n in v.co)
report={'triangles':triangles,'skinnedMeshCount':len(meshes),'armatures':len(armatures),'bones':sum(len(a.data.bones) for a in armatures),'expressions':sorted(keys),'unweightedVertices':unweighted,'maxInfluences':max_influences,'maxWeightSumError':max_error,'nonfiniteVertices':nonfinite,'fileBytes':(OUT/'character.glb').stat().st_size,'externalImages':[im.filepath for im in bpy.data.images if im.source=='FILE' and not im.packed_file]}
print(json.dumps(report,indent=2))
assert report['bones']==165
assert {'Blink','Neutral','Smile','MouthOpen'}<=keys
assert not unweighted and not nonfinite and max_influences<=4 and max_error<.0001
assert not report['externalImages']
(OUT/'validation-blender.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(report,indent=2))
