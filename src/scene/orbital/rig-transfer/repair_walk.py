"""Source-clip repair, sampled at 96 Hz; no replacement procedural gait."""
import bpy, math, json
import numpy as np
from mathutils import Vector, Quaternion, Matrix
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'art/resident/animated-transfer/walk-repair'
OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT.parent/'luna-tripo-animated.glb'))
sc=bpy.context.scene
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh=next(o for o in bpy.data.objects if o.type=='MESH' and len(o.vertex_groups)>50)
for o in list(bpy.data.objects):
 if o not in (mesh,arm) and o.type in ('MESH','CAMERA','LIGHT'): bpy.data.objects.remove(o,do_unlink=True)
bones=list(arm.pose.bones)
def setframe(f):
 sc.frame_set(int(f),subframe=f-int(f))
def update(): bpy.context.view_layer.update()

def aim_bone(bone, direction):
 """Change swing about the joint, preserving the source axial twist and length."""
 pivot=bone.head.copy()
 turn=(bone.tail-pivot).rotation_difference(direction)
 bone.matrix=Matrix.Translation(pivot)@turn.to_matrix().to_4x4()@Matrix.Translation(-pivot)@bone.matrix
 update()

def relaxed_arms(t):
 # The captured upper arms barely swing; adding abduction only amplified its
 # static A-pose. Author a restrained counter-swing in the moving chest frame.
 # Left foot contacts at 0, right at .5; the same-side arm trails at contact.
 chest=arm.pose.bones['mixamorig:Spine2']
 frame=chest.matrix.to_quaternion()@chest.bone.matrix_local.to_quaternion().inverted()
 for side,sign,phase in [('Left',1,0),('Right',-1,.5)]:
  cycle=2*math.pi*(t-phase-.06)
  upper_angle=math.radians(-3+16*math.cos(cycle))
  lower_angle=math.radians(-3+16*math.cos(cycle-.16)-(12-3*math.cos(cycle-.16)))
  upper=Vector((sign*math.sin(math.radians(12)), math.sin(upper_angle)*math.cos(math.radians(12)), -math.cos(upper_angle)*math.cos(math.radians(12))))
  # A small elliptical arc clears the wide side of the skirt while passing;
  # it relaxes inward at each swing extreme instead of holding the shoulder out.
  lower_out=math.radians(26+5*math.sin(cycle-.16)**2)
  lower=Vector((sign*math.sin(lower_out), math.sin(lower_angle)*math.cos(lower_out), -math.cos(lower_angle)*math.cos(lower_out)))
  aim_bone(arm.pose.bones['mixamorig:'+side+'Arm'],frame@upper)
  aim_bone(arm.pose.bones['mixamorig:'+side+'ForeArm'],frame@lower)
  hand=arm.pose.bones['mixamorig:'+side+'Hand']
  # Mostly neutral wrist, with a little captured softness; fingers keep a
  # relaxed open curve. No wrist translation or bone stretching.
  hand.rotation_quaternion=hand.rotation_quaternion.slerp(Quaternion(),.8)
  wrist_angle=math.radians(-3+16*math.cos(cycle-.24)-(12-3*math.cos(cycle-.24)))
  hand_out=lower_out+math.radians(3)
  aim_bone(hand,frame@Vector((sign*math.sin(hand_out),math.sin(wrist_angle)*math.cos(hand_out),-math.cos(wrist_angle)*math.cos(hand_out))))
  for b in bones:
   if b.name.startswith('mixamorig:'+side+'Hand') and b!=hand:
    b.rotation_quaternion=b.rotation_quaternion.slerp(Quaternion(),.5)
  update()
  # The scan's splayed thumb is the last part to catch the skirt. Bring its
  # base softly toward the index base instead of moving the entire arm out.
  thumb=arm.pose.bones['mixamorig:'+side+'HandThumb1']
  index=arm.pose.bones['mixamorig:'+side+'HandIndex1']
  direction=(thumb.tail-thumb.head).normalized().lerp((index.head-thumb.head).normalized(),.35).normalized()
  aim_bone(thumb,direction)
 update()

def skirt_passage(t):
 # Authored local fold, not a cloth simulation. Only the lateral panels tuck
 # in as each hand passes. This shares clearance with the garment instead of
 # spending it entirely on a lifted shoulder. The waist anchors stay fixed.
 for side,sign,phase in [('Left',1,0),('Right',-1,.5)]:
  pulse=math.exp(5*(math.cos(2*math.pi*(t-phase-.27))-1))
  for panel,axis,strength in [(side,Vector((0,sign,0)),1),('Back_'+side[0],Vector((-1,sign,0)).normalized(),.7),('Front_'+side[0],Vector((1,sign,0)).normalized(),.7)]:
   for section,degrees in [('01',4.5),('02',2)]:
    b=arm.pose.bones['Dress_'+panel+'_'+section]; pivot=b.head.copy()
    b.matrix=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(degrees)*pulse*strength,4,axis)@Matrix.Translation(-pivot)@b.matrix
    update()
def smooth(t): return max(0,min(1,t))**2*(3-2*max(0,min(1,t)))
base=[]
for i in range(97):
 setframe(28+i/4)
 base.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy()) for b in bones})
arm.animation_data_clear()
arm.animation_data_create()
action=bpy.data.actions.new('Walk_Grounded_Loop')
arm.animation_data.action=action
footids={}
for side in ['Left','Right']:
 groups={g.index for g in mesh.vertex_groups if g.name in ['mixamorig:'+side+'Foot','mixamorig:'+side+'ToeBase','mixamorig:'+side+'Toe_End']}
 footids[side]=[v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.65]
 print('FOOT',side,groups,len(footids[side]),[(g.name,g.index) for g in mesh.vertex_groups][:12],flush=True)
def coords(ids):
 ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
 return [ev.matrix_world@ev.data.vertices[i].co for i in ids]
def solve(side,target):
 up=arm.pose.bones['mixamorig:'+side+'UpLeg']; lo=arm.pose.bones['mixamorig:'+side+'Leg']; foot=arm.pose.bones['mixamorig:'+side+'Foot']
 h=up.head.copy(); k=lo.head.copy(); a=foot.head.copy()
 l1=(k-h).length; l2=(a-k).length
 d=target-h; dist=min(d.length,l1+l2-.0001); axis=d.normalized()
 pole=k-h-axis*(k-h).dot(axis)
 if pole.length<1e-5: pole=Vector((0,-1,0))-axis*axis.dot(Vector((0,-1,0)))
 pole.normalize(); along=(l1*l1-l2*l2+dist*dist)/(2*dist)
 knee=h+axis*along+pole*math.sqrt(max(0,l1*l1-along*along))
 m=up.matrix.copy(); m=Matrix.Translation(h)@(k-h).rotation_difference(knee-h).to_matrix().to_4x4()@Matrix.Translation(-h)@m
 up.matrix=m; update()
 k=lo.head.copy(); a=foot.head.copy()
 lo.matrix=Matrix.Translation(k)@(a-k).rotation_difference(target-k).to_matrix().to_4x4()@Matrix.Translation(-k)@lo.matrix
 update()
records=[]; repaired=[]
for i in range(97):
 t=i/96
 for b in bones:
  p,q,s=base[i][b.name]; p0,q0,s0=base[0][b.name]; p1,q1,s1=base[-1][b.name]
  # Distribute the small mismatch over the captured cycle; endpoints exact.
  w=smooth(t)
  b.location=p+(p0-p1)*w
  b.rotation_mode='QUATERNION'
  b.rotation_quaternion=q @ Quaternion().slerp(q1.inverted()@q0,w)
  b.scale=s+(s0-s1)*w
 update()
 hips=arm.pose.bones['mixamorig:Hips']
 hm=hips.matrix.copy(); hm.translation.z-=.028
 # Small support-synchronous weight transfer; legs still come from the captured clip.
 hm.translation.x+=.008*math.sin(2*math.pi*t)
 hips.matrix=hm; update()
 chest=arm.pose.bones['mixamorig:Spine2']; pivot=chest.head.copy()
 chest.matrix=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(1.5)*math.sin(2*math.pi*t),4,'Z')@Matrix.Translation(-pivot)@chest.matrix
 update()
 relaxed_arms(t)
 skirt_passage(t)
 for side,off in [('Left',0),('Right',12)]:
  phase=(i/4-off)%24
  foot=arm.pose.bones['mixamorig:'+side+'Foot']
  sourceq=foot.matrix.to_quaternion(); target=foot.head.copy()
  # Preserve original swing, soften excessive ankle droop. Full sole during support.
  plant=(1-smooth((phase-10)/5)) if phase<15 else smooth((phase-22)/2)
  flat=smooth(phase/2)*(1-smooth((phase-9)/5)) if phase<14 else 0
  # Bind-pose soles slope downward toward the toes by ~14 degrees.
  # Neutral bone rotation is therefore NOT a flat sole on this character.
  restq=Quaternion((1,0,0),math.radians(-14))@foot.bone.matrix_local.to_quaternion()
  q=sourceq.slerp(restq,.35+.65*flat)
  toe=arm.pose.bones['mixamorig:'+side+'ToeBase']
  toe.rotation_quaternion=toe.rotation_quaternion.slerp(Quaternion(),flat)
  foot.matrix=Matrix.LocRotScale(target,q,Vector((1,1,1))); update()
  points=coords(footids[side]); floor=min(p.z for p in points)
  # Actual evaluated foot skin, not ankle position, defines vertical contact.
  correction=Vector((0,0,(-floor+.001)*plant))
  # Remove the constant source floating offset during swing too.
  correction.z-=.006*(1-plant)
  correction.y+=(-.15+.024*phase-target.y)*flat
  correction.x+=((.045 if side=='Left' else -.04)-target.x)*flat
  target+=correction
  solve(side,target)
  foot.matrix=Matrix.LocRotScale(foot.head.copy(),q,Vector((1,1,1))); update()
  # Correct remaining skin displacement from knee deformation; never penetrate ground.
  for iteration in range(2):
   gap=min(p.z for p in coords(footids[side]))
   dz=(.001-gap)*plant if gap>=.001 else .001-gap
   solve(side,foot.head+Vector((0,0,dz)))
   foot.matrix=Matrix.LocRotScale(foot.head.copy(),q,Vector((1,1,1))); update()
  points=coords(footids[side])
  records.append(dict(frame=i,side=side,phase=phase,plant=plant,min_z=min(p.z for p in points),ankle=list(foot.head)))
 repaired.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy()) for b in bones})
# A short circular filter joins the incoming/outgoing motion at the seam.
filtered=[]
for i in range(97):
 row={}
 for b in bones:
  samples=[repaired[(i+j)%96][b.name] for j in range(-2,3)]
  weights=[1,2,3,2,1]
  b.location=sum((p*w for (p,q,s),w in zip(samples,weights)),Vector())/9
  ref=samples[2][1]; acc=np.zeros(4)
  for (_,q,_),w in zip(samples,weights):
   arr=np.array(q); acc+=arr*w*(1 if q.dot(ref)>=0 else -1)
  b.rotation_quaternion=Quaternion(acc/np.linalg.norm(acc))
  b.scale=samples[2][2]
  row[b.name]=(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())
 filtered.append(row)
# Match the adjacent endpoint tangents, as well as the endpoint pose.
for b in bones:
 p0,q0,s0=filtered[0][b.name]; pa,qa,sa=filtered[1][b.name]; pz,qz,sz=filtered[95][b.name]
 da=q0.inverted()@qa; dz=qz.inverted()@q0
 if da.w<0:da.negate()
 if dz.w<0:dz.negate()
 axis_a,angle_a=da.to_axis_angle(); axis_z,angle_z=dz.to_axis_angle()
 rv=(axis_a*angle_a+axis_z*angle_z)*.5
 dq=Quaternion(rv.normalized(),rv.length) if rv.length>1e-8 else Quaternion()
 dp=(pa-pz)*.5
 filtered[1][b.name]=(p0+dp,q0@dq,sa)
 filtered[95][b.name]=(p0-dp,q0@dq.inverted(),sz)
for i in range(97):
 for b in bones:
  b.location,b.rotation_quaternion,b.scale=filtered[i][b.name]
  b.keyframe_insert('location',frame=i)
  b.keyframe_insert('rotation_quaternion',frame=i)
  b.keyframe_insert('scale',frame=i)
sc.render.fps=96; sc.frame_start=0; sc.frame_end=96
sc.frame_set(0)
for unused in list(bpy.data.actions):
 if unused!=action:bpy.data.actions.remove(unused)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'luna-walk-repaired.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'luna-walk-repaired.glb'),export_format='GLB',export_animations=True,export_frame_range=True,export_force_sampling=True)
(OUT/'contact-samples.json').write_text(json.dumps(records,indent=2))
print('OUTPUT',OUT)
