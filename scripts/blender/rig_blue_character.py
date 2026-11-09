from pathlib import Path
import bpy
import bmesh
import numpy as np
import math
import json
from mathutils import Vector, Quaternion

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'art/characters/blue-haired-girl'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'character.blend'))
if bpy.data.objects.get('CharacterRig'):
    raise SystemExit('This file is already rigged. Export it directly; do not overwrite hand-edited weights.')
scene=bpy.context.scene
CHAR=bpy.data.collections['CHARACTER · export']
scene.cycles.samples=40
for name,power in [('Key',55),('Fill',23),('Rim',48)]:bpy.data.objects[name].data.energy=power
for obj in CHAR.objects:
    if obj.type!='MESH':continue
    if obj.name.startswith(('Face','Eye','Iris','Upper','Lower','Lash','Ear','Mouth','Lip')) or obj.name.startswith('Hair'):
        # Widen the head and upper locks towards the board's soft, large-head silhouette.
        if obj.data.shape_keys:
            for block in obj.data.shape_keys.key_blocks:
                for v in block.data:
                    p=obj.matrix_world@v.co
                    f=np.clip((p.z-1.1)/.12,0,1)
                    p.x*=1+.10*f
                    v.co=obj.matrix_world.inverted()@p
        else:
            for v in obj.data.vertices:
                p=obj.matrix_world@v.co
                f=np.clip((p.z-1.1)/.12,0,1)
                p.x*=1+.10*f
                v.co=obj.matrix_world.inverted()@p

specs=[]
def bone(name,head,tail,parent=None,group='Body'):
    specs.append(dict(name=name,head=list(head),tail=list(tail),parent=parent,group=group))
bone('Root',(0,0,0),(0,0,.12))
bone('Hips',(0,0,.79),(0,0,.90),'Root')
bone('Spine',(0,0,.90),(0,0,.995),'Hips')
bone('Chest',(0,0,.995),(0,0,1.105),'Spine')
bone('Neck',(0,0,1.105),(0,0,1.18),'Chest')
bone('Head',(0,0,1.18),(0,0,1.40),'Neck')
for sign,side in [(1,'L'),(-1,'R')]:
    shoulder=(sign*.116,0,1.10);elbow=(sign*.211,-.005,.947);wrist=(sign*.288,-.012,.808)
    direction=np.array([sign*.49,0,-.872]);cross=np.array([sign*.872,0,.49]);w=np.array(wrist)
    bone('Shoulder.'+side,(sign*.025,0,1.101),shoulder,'Chest')
    bone('UpperArm.'+side,shoulder,elbow,'Shoulder.'+side)
    bone('LowerArm.'+side,elbow,wrist,'UpperArm.'+side)
    bone('Hand.'+side,w,w+direction*.058,'LowerArm.'+side)
    for digit,offset,length in [('Index',-.016,.048),('Middle',-.005,.055),('Ring',.006,.051),('Little',.017,.040),('Thumb',0,0)]:
        if digit=='Thumb':
            base=w+direction*.018-cross*.022;tip=base+direction*.032-cross*.026+np.array([0,-.003,0])
        else:
            base=w+direction*.052+cross*offset;tip=base+direction*length+cross*(offset*.16)+np.array([0,-.004,0])
        for j in range(3):
            bone(f'{digit}.{j+1:02d}.{side}',base+(tip-base)*j/3,base+(tip-base)*(j+1)/3,'Hand.'+side if j==0 else f'{digit}.{j:02d}.{side}','Fingers')
    hip=(sign*.055,0,.79);knee=(sign*.067,-.008,.435);ankle=(sign*.06,0,.075);toes=(sign*.06,-.083,.024)
    bone('UpperLeg.'+side,hip,knee,'Hips')
    bone('LowerLeg.'+side,knee,ankle,'UpperLeg.'+side)
    bone('Foot.'+side,ankle,toes,'LowerLeg.'+side)
    bone('Toes.'+side,toes,(sign*.06,-.12,.021),'Foot.'+side)
    bone('Eye.'+side,(sign*.0484,-.064,1.264),(sign*.0484,-.10,1.264),'Head','Face')

hair_chains={}
for obj in list(CHAR.objects):
    if not obj.name.startswith(('Hair.Back','Hair.Side','Hair.Cheek')):continue
    points=np.array([v.co[:] for v in obj.data.vertices]).reshape(40,12,3).mean(1)
    name=obj.name.replace('Hair.','')
    nodes=[]
    for j,(start,end) in enumerate([(10,20),(20,30),(30,39)]):
        namebone=f'Hair.{name}.{j+1:02d}'
        bone(namebone,points[start],points[end],'Head' if j==0 else nodes[-1],'Hair')
        nodes.append(namebone)
    hair_chains[obj.name]=nodes
for i in range(8):
    a=math.tau*i/8
    nodes=[(.08,.054,.943),(.13,.087,.80),(.176,.12,.66),(.215,.149,.51)]
    for j in range(3):
        rx,ry,z=nodes[j];rx2,ry2,z2=nodes[j+1]
        bone(f'Skirt.{i:02d}.{j+1:02d}',(rx*math.sin(a),-ry*math.cos(a),z),(rx2*math.sin(a),-ry2*math.cos(a),z2),'Hips' if j==0 else f'Skirt.{i:02d}.{j:02d}','Skirt')

adata=bpy.data.armatures.new('BlueGirl humanoid and secondary chains')
rig=bpy.data.objects.new('CharacterRig',adata);CHAR.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for s in specs:
    b=adata.edit_bones.new(s['name']);b.head=s['head'];b.tail=s['tail']
    if s['parent']:b.parent=adata.edit_bones[s['parent']]
    b.align_roll(Vector((0,-1,0)))
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for group in ['Body','Fingers','Face','Hair','Skirt']:
    collection=adata.collections.new(group)
    for s in specs:
        if s['group']==group:collection.assign(adata.bones[s['name']])
index={s['name']:i for i,s in enumerate(specs)}

def distances(points,names):
    chosen=[specs[index[n]] for n in names]
    h=np.array([s['head'] for s in chosen]);d=np.array([s['tail'] for s in chosen])-h
    t=np.clip(np.sum((points[:,None]-h)*d,axis=2)/np.sum(d*d,axis=1),0,1)
    return np.linalg.norm(points[:,None]-h-t[:,:,None]*d,axis=2)

def bind(obj):
    points=np.array([obj.matrix_world@v.co for v in obj.data.vertices]);n=len(points)
    weights=np.zeros((n,len(specs)),np.float32)
    x,y,z=points.T
    def group(mask,names,soft=.012):
        ids=np.flatnonzero(mask)
        if not len(ids):return
        ds=distances(points[ids],names)
        vals=1/(ds*ds+soft*soft)**3
        vals/=vals.sum(1)[:,None]
        weights[np.ix_(ids,[index[v] for v in names])]=vals
    allmask=np.ones(n,bool)
    name=obj.name
    if name.startswith('Body'):
        upper=z>1.13
        group(upper,['Neck','Head'],.012)
        for side,sign in [('L',1),('R',-1)]:
            onside=x*sign>=0
            hand=(z<.83)&(np.abs(x)>.26)&onside
            fingers=[s['name'] for s in specs if s['group']=='Fingers' and s['name'].endswith(side)]
            group(hand,['Hand.'+side]+fingers,.004)
            arm=(np.abs(x)>.10)&(z>.78)&~hand&~upper&onside
            group(arm,['Chest','Shoulder.'+side,'UpperArm.'+side,'LowerArm.'+side,'Hand.'+side],.012)
            leg=(z<.78)&(np.abs(x)<.13)&onside
            group(leg,['Hips','UpperLeg.'+side,'LowerLeg.'+side,'Foot.'+side,'Toes.'+side],.013)
        missing=weights.sum(1)==0;group(missing,['Hips','Spine','Chest','Neck'],.025)
    elif name in hair_chains:
        group(allmask,['Head']+hair_chains[name],.016)
        top=z>1.23;weights[top]=0;weights[top,index['Head']]=1
    elif name.startswith(('Eye globe','Iris curved','Eye catchlight')):
        side='L' if '.L' in name else 'R';weights[:,index['Eye.'+side]]=1
    elif name.startswith(('Dress.Main','Dress.Hem')):
        angles=np.arctan2(x,-y)%(math.tau);sectors=angles/math.tau*8
        for vi in range(n):
            sec=int(sectors[vi]);f=sectors[vi]-sec
            # Two angular chains and two adjacent chain segments limit skinning to four joints.
            long=np.clip((.943-z[vi])/.433*3-.45,0,2)
            step=min(int(long),1);g=long-step
            for si,sw in [(sec,1-f),((sec+1)%8,f)]:
                weights[vi,index[f'Skirt.{si:02d}.{step+1:02d}']]=sw*(1-g)
                weights[vi,index[f'Skirt.{si:02d}.{step+2:02d}']]=sw*g
    elif name.startswith(('Dress','Bow')):
        group(allmask,['Spine','Chest'],.02)
    else:
        weights[:,index['Head']]=1
    order=np.argsort(weights,axis=1)
    np.put_along_axis(weights,order[:,:-4],0,axis=1)
    weights/=np.maximum(weights.sum(1)[:,None],1e-10)
    for col,s in enumerate(specs):
        ids=np.flatnonzero(weights[:,col]>.00001)
        if len(ids):
            vg=obj.vertex_groups.new(name=s['name'])
            for vi in ids:vg.add([int(vi)],float(weights[vi,col]),'REPLACE')
    mod=obj.modifiers.new('Character skinning','ARMATURE');mod.object=rig
    # Deformation occurs before subdivision and shell thickness.
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_move_to_index(modifier=mod.name,index=0)
    obj.parent=rig
    obj['max_influences']=4
    obj['export_role']='character'

for obj in list(CHAR.objects):
    if obj.type=='MESH':bind(obj)

for side in ['L','R']:
    bpy.ops.object.empty_add(type='PLAIN_AXES')
    o=bpy.context.object;o.name='Grip.'+side
    for c in list(o.users_collection):c.objects.unlink(o)
    CHAR.objects.link(o);o.parent=rig;o.parent_type='BONE';o.parent_bone='Hand.'+side;o.location=(0,-.02,-.012)
    o.empty_display_size=.015
    o['purpose']='Hand-held object attachment; calibrate palm contact against prop geometry'

for obj in CHAR.objects:
    if obj.type=='MESH' and obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:
            if key.name!='Basis':key.value=0
        obj.active_shape_key_index=0

# Animation clips are modest deformation checks, not authored production performances.
rig.animation_data_create()
for pb in rig.pose.bones:pb.rotation_mode='QUATERNION'

def reset():
    for pb in rig.pose.bones:pb.rotation_quaternion=Quaternion();pb.location=(0,0,0)

def rotate(name,axis,angle):
    pb=rig.pose.bones[name]
    rest=pb.bone.matrix_local.to_3x3()
    local=rest.inverted()@Vector(axis)
    pb.rotation_quaternion=Quaternion(local,angle)

clips={}
for name,frames in [('Idle',[1,31,61]),('Walk',[1,9,17,25,33]),('Sit',[1,20,40]),('LieDown',[1,20,40]),('HoldObject',[1,20,40]),('EyeLook',[1,15,30,45])]:
    act=bpy.data.actions.new(name);rig.animation_data.action=act
    for frame in frames:
        reset();t=(frame-1)/(frames[-1]-1);wave=math.sin(t*math.tau)
        if name=='Idle':rotate('Chest',(1,0,0),wave*.012);rotate('Head',(0,0,1),wave*.015)
        if name=='Walk':
            for sign,side in [(1,'L'),(-1,'R')]:
                angle=wave*.30*sign
                rotate('UpperLeg.'+side,(1,0,0),angle)
                rotate('LowerLeg.'+side,(1,0,0),max(0,-angle)*.55)
                rotate('UpperArm.'+side,(1,0,0),-angle*.3)
            for i in range(8):rotate(f'Skirt.{i:02d}.01',(1,0,0),wave*.11*math.cos(math.tau*i/8))
        if name=='Sit':
            bend=min(t*2,1)
            rig.pose.bones['Root'].location.y=-.35*bend
            for side in ['L','R']:
                rotate('UpperLeg.'+side,(1,0,0),-math.pi/2*bend);rotate('LowerLeg.'+side,(1,0,0),math.pi/2*bend)
            for i in range(8):
                a=math.tau*i/8;front=max(0,math.cos(a))**.25
                rotate(f'Skirt.{i:02d}.01',(1,0,0),-1.22*bend*front)
                rotate(f'Skirt.{i:02d}.02',(1,0,0),-.08*bend*front)
                rotate(f'Skirt.{i:02d}.03',(1,0,0),.55*bend*front)
        if name=='LieDown':
            bend=min(t*2,1)
            rotate('Root',(1,0,0),-math.pi/2*bend)
            rig.pose.bones['Root'].location.y=.19*bend
            for side in ['L','R']:rotate('UpperArm.'+side,(0,1,0),(.28 if side=='L' else -.28)*bend)
        if name=='HoldObject':
            blend=min(t*2,1)
            for sign,side in [(1,'L'),(-1,'R')]:
                rotate('UpperArm.'+side,(1,0,0),-.40*blend)
                rotate('LowerArm.'+side,(1,0,0),-1.0*blend)
                for digit in ['Index','Middle','Ring','Little']:
                    for j in range(1,4):rotate(f'{digit}.{j:02d}.{side}',(1,0,0),-.35*blend)
        if name=='EyeLook':
            for side in ['L','R']:rotate('Eye.'+side,(0,0,1),math.sin(t*math.tau)*.16)
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
            if pb.name=='Root':pb.keyframe_insert('location',frame=frame,group=pb.name)
    track=rig.animation_data.nla_tracks.new();track.name=name
    strip=track.strips.new(name,1,act);strip.action_frame_start=1;strip.action_frame_end=frames[-1]
    track.mute=True
    clips[name]=[1,frames[-1]]
rig.animation_data.action=None
reset();scene.frame_set(1)
for track in rig.animation_data.nla_tracks:track.mute=True

# JSON is the stable interface for runtime spring chains, expressions and attachments.
interface={'version':1,'units':'meters','upAxis':'Y (GLB)','forwardAxis':'+Z (GLB)','height':1.43,'hipsHeight':.79,
           'humanoid':{s['name']:s['name'] for s in specs if s['group'] in ['Body','Fingers','Face']},
           'hairChains':list(hair_chains.values()),'skirtChains':[[f'Skirt.{i:02d}.{j:02d}' for j in range(1,4)] for i in range(8)],
           'expressions':['Neutral','Blink','Smile','MouthOpen'],'eyeLookBones':['Eye.L','Eye.R'],
           'gripNodes':['Grip.L','Grip.R'],'animations':list(clips),
           'secondaryMotion':'Chains are skinned; runtime spring solver and capsule collision are not implemented.',
           'status':'Review candidate. Extreme joint and cloth poses require further weight painting.'}
(OUT/'rig-interface.json').write_text(json.dumps(interface,ensure_ascii=False,indent=2)+'\n')
rig['rig_interface']='rig-interface.json';rig['asset_version']=1
scene['delivery_status']='制作版：相似度与大幅坐卧变形未通过最终验收，不用于默认替换'
refs=bpy.data.collections.new('REFERENCE · user board');scene.collection.children.link(refs)
ref=bpy.data.objects.new('Approved reference board',None);refs.objects.link(ref)
ref.empty_display_type='IMAGE';ref.data=bpy.data.images.load(str(OUT/'references/board.png'));ref.data.pack();ref.data.filepath='//references/board.png';ref.empty_display_size=1.6;ref.location=(1.3,.4,.75);ref.rotation_euler=(math.pi/2,0,0);ref.hide_render=True
refs.hide_viewport=True

for image in bpy.data.images:
    if image.packed_file and image!=ref.data:image.filepath='//textures/'+image.name+'.png'
scene.render.resolution_x=900;scene.render.resolution_y=1100
scene.camera.location=(0,-3,.78);scene.camera.rotation_euler=(Vector((0,0,.72))-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.ortho_scale=1.65
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'character.blend'))

exec(compile((Path(__file__).with_name('export_blue_character.py')).read_text(),str(Path(__file__).with_name('export_blue_character.py')),'exec'))
