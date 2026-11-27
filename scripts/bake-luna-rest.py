"""Author editable relaxed arm poses in Blender; append compatible rotation clips.
Input snapshots come from sample-luna-rest.mjs. Mesh, skin and old animation data
are preserved byte-for-byte when appending the three small runtime pose clips.
"""
import argparse, json, math, struct, sys
from pathlib import Path
import bpy
from mathutils import Vector, Matrix, Quaternion

C = Matrix.Rotation(math.pi / 2, 4, 'X')
CI = C.inverted()
SCALE = 1.43
PARTS = ('Shoulder','Arm','ForeArm','Hand')
OWNED = ['mixamorig'+s+p for s in ('Left','Right') for p in PARTS]
OWNED += ['mixamorig'+s+'Hand'+f+str(i) for s in ('Left','Right') for f in ('Index','Middle','Ring','Pinky','Thumb') for i in (1,2,3)]
SPINES = ['mixamorig'+s for s in ('Spine','Spine1','Spine2','Neck','Head')]

def mat(values):
    return Matrix([values[i:i+4] for i in range(0,16,4)]).transposed()

def glb_append(base, output, clips):
    raw=base.read_bytes(); size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]); binary=bytearray(raw[28+size:])
    indices={n.get('name','').replace(':',''):i for i,n in enumerate(doc['nodes'])}
    marker=doc.get('extras',{}).get('pocketworldRestPoseBase')
    if marker:
        # Texture repacking changes byte offsets; derive the base end from live views.
        base_views=doc['bufferViews'][:marker['views']]
        base_end=max(v.get('byteOffset',0)+v['byteLength'] for v in base_views)
        binary=binary[:(base_end+3)//4*4]
        doc['bufferViews']=doc['bufferViews'][:marker['views']]
        doc['accessors']=doc['accessors'][:marker['accessors']]
    doc.setdefault('extras',{})['pocketworldRestPoseBase']={'bytes':len(binary),'views':len(doc['bufferViews']),'accessors':len(doc['accessors'])}
    def acc(values,width):
        while len(binary)%4: binary.append(0)
        start=len(binary); binary.extend(struct.pack('<'+'f'*len(values),*values))
        v=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(values)*4})
        a={'bufferView':v,'componentType':5126,'count':len(values)//width,'type':'SCALAR' if width==1 else 'VEC4'}
        if width==1:a.update(min=[min(values)],max=[max(values)])
        i=len(doc['accessors']);doc['accessors'].append(a);return i
    times=acc([0,1/30],1)
    for name, rotations in clips.items():
        # Re-export replaces this named clip without touching any existing track.
        doc['animations']=[a for a in doc.get('animations',[]) if a['name']!=name]
        animation={'name':name,'channels':[],'samplers':[]}
        for bone,quaternion in rotations.items():
            output_index=acc(quaternion*2,4); sampler=len(animation['samplers'])
            animation['samplers'].append({'input':times,'output':output_index,'interpolation':'LINEAR'})
            animation['channels'].append({'sampler':sampler,'target':{'node':indices[bone],'path':'rotation'}})
        doc['animations'].append(animation)
    doc['buffers'][0]['byteLength']=len(binary)
    js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)

class Pose:
    def __init__(self,rig,record):
        self.rig=rig;self.record=record
        self.bones={b.name.replace(':',''):b for b in rig.pose.bones}
        self.bind={name:mat(value) for name,value in record['bind'].items()}
        self.bbind={name:rig.matrix_world@b.bone.matrix_local for name,b in self.bones.items()}
    def world(self,name):
        b=self.bones[name]
        return CI@(self.rig.matrix_world@b.matrix)@self.bbind[name].inverted()@C@self.bind[name]
    def set_world(self,name,w):
        b=self.bones[name]
        target=self.rig.matrix_world.inverted()@C@w@self.bind[name].inverted()@CI@self.bbind[name]
        b.matrix=target
        bpy.context.view_layer.update()
    def pos(self,name):return self.world('mixamorig'+name).translation*SCALE
    def quat(self,name):return self.world('mixamorig'+name).to_quaternion()
    def rotate(self,name,q):
        key='mixamorig'+name;w=self.world(key);location,rotation,scale=w.decompose()
        self.set_world(key,Matrix.LocRotScale(location,q@rotation,scale))
    def orient(self,name,q):
        key='mixamorig'+name;w=self.world(key);location,_,scale=w.decompose()
        self.set_world(key,Matrix.LocRotScale(location,q,scale))
    def reset(self,kind):
        self.rig.animation_data_clear()
        for name,b in self.bones.items():
            if name in self.record[kind]:self.set_world(name,mat(self.record[kind][name]['world']))
    def aim(self,name,child,target):
        a=self.pos(name);old=self.pos(child)-a;new=target-a
        self.rotate(name,old.normalized().rotation_difference(new.normalized()))
    def palm_root(self,side):
        # RightMiddle1 is displaced inward on the cardigan rig; use the
        # surrounding knuckle row, which also follows the visible palm surface.
        return sum((self.pos(side+'Hand'+finger+'1') for finger in ('Index','Ring','Pinky')),Vector())/3
    def basis(self,side):
        q=self.quat(side+'Hand').inverted();w=self.pos(side+'Hand')
        tangent=(q@(self.palm_root(side)-w)).normalized()
        across=q@(self.pos(side+'HandIndex1')-self.pos(side+'HandPinky1'))
        normal=tangent.cross(across).normalized()*(1 if side=='Left' else -1)
        cross=tangent.cross(normal).normalized()
        return Matrix((cross,tangent,normal)).transposed().to_quaternion().inverted()
    def hand(self,side,tangent,normal,invbasis):
        tangent=tangent.normalized();normal=(normal-tangent*normal.dot(tangent)).normalized()
        cross=tangent.cross(normal).normalized()
        target=Matrix((cross,tangent,normal)).transposed().to_quaternion()@invbasis
        axis=(self.pos(side+'Hand')-self.pos(side+'ForeArm')).normalized()
        hand='mixamorig'+side+'Hand';forearm='mixamorig'+side+'ForeArm'
        bind_local=(self.bind[forearm].inverted()@self.bind[hand]).to_quaternion()
        delta=target@(self.quat(side+'ForeArm')@bind_local).inverted()
        if delta.w<0:delta.negate()
        projection=Vector((delta.x,delta.y,delta.z)).dot(axis)
        twist=2*math.atan2(projection,delta.w)
        self.rotate(side+'ForeArm',Quaternion(axis,max(-1.65,min(1.65,twist*.90))))
        self.orient(side+'Hand',target)
    def fingers(self,side,amount):
        # Rebuild fingers from the real bind pose, not the backward-flexed default.
        for finger in ('Index','Middle','Ring','Pinky','Thumb'):
            for segment in (1,2,3):
                name='mixamorig'+side+'Hand'+finger+str(segment)
                parent=self.record['standing'][name]['parent']
                self.set_world(name,self.world(parent)@self.bind[parent].inverted()@self.bind[name])
        sign=1 if side=='Left' else -1
        axis=(self.pos(side+'HandIndex1')-self.pos(side+'HandPinky1')).normalized()*(-sign)
        for fi,finger in enumerate(('Index','Middle','Ring','Pinky')):
            for segment in (1,2,3):self.rotate(side+'Hand'+finger+str(segment),Quaternion(axis,amount*(.85+.06*fi)))
    def standing(self,outfit):
        self.reset('standing')
        for side in ('Left','Right'):
            sign=1 if side=='Left' else -1; inv=self.basis(side)
            a=self.pos(side+'Arm');e=self.pos(side+'ForeArm');w=self.pos(side+'Hand')
            u=(e-a).length;l=(w-e).length
            # Only the third outfit needs extra sleeve clearance; keep the first two original poses.
            upper=Vector((sign*.29,-.957,-.035) if outfit=='cardigan' else (sign*.16,-.985,-.035)).normalized()
            lower=Vector((sign*.12,-.98,.16) if outfit=='cardigan' else (sign*.04,-.987,.16)).normalized()
            self.aim(side+'Arm',side+'ForeArm',a+upper*u)
            e=self.pos(side+'ForeArm');self.aim(side+'ForeArm',side+'Hand',e+lower*l)
            self.hand(side,Vector((sign*.02,-1,.12)),Vector((-sign,0,.10)),inv)
            self.fingers(side,.12)
    def lap(self,outfit):
        self.reset('seated')
        for name,angle in [('Spine',.34),('Spine1',.12),('Spine2',.045)]:self.rotate(name,Quaternion((1,0,0),angle))
        along,height={'everyday':(.61,.137),'ribbon':(.55,.043),'cardigan':(.57,.068)}[outfit]
        for side in ('Left','Right'):
            sign=1 if side=='Left' else -1; inv=self.basis(side)
            hip=self.pos(side+'UpLeg');knee=self.pos(side+'Leg');thigh=(knee-hip).normalized()
            up=Vector((0,1,0));up=(up-thigh*up.dot(thigh)).normalized()
            tangent=(thigh+Vector((-sign*.13,0,0))).normalized();normal=-up
            tangent=(tangent-normal*tangent.dot(normal)).normalized()
            q=Matrix((tangent.cross(normal),tangent,normal)).transposed().to_quaternion()@inv
            current=self.quat(side+'Hand');mid=current.inverted()@(self.palm_root(side)-self.pos(side+'Hand'))
            palm=(current.inverted()@( (self.palm_root(side)-self.pos(side+'Hand')).cross(self.pos(side+'HandIndex1')-self.pos(side+'HandPinky1')).normalized()))*sign
            offset=mid*.57+palm*.012
            target=hip.lerp(knee,along)+up*height+Vector((sign*.012,0,0))-q@offset
            a=self.pos(side+'Arm');e=self.pos(side+'ForeArm');w=self.pos(side+'Hand')
            u=(e-a).length;l=(w-e).length;line=target-a;reach=min(line.length,u+l-.001);line.normalize()
            pole=Vector((sign*.055,-.21,-.08));pole=(pole-line*pole.dot(line)).normalized()
            dist=(u*u-l*l+reach*reach)/(2*reach)
            elbow=a+line*dist+pole*math.sqrt(max(0,u*u-dist*dist))
            self.aim(side+'Arm',side+'ForeArm',elbow)
            self.aim(side+'ForeArm',side+'Hand',target)
            self.hand(side,tangent,normal,inv);self.fingers(side,.10)
    def cheek(self,outfit):
        self.lap(outfit)
        self.rotate('Neck',Quaternion((0,0,1),-.12))
        self.rotate('Head',Quaternion((1,0,0),.15))
        side='Left';inv=self.basis(side)
        normal=Vector((-1,.30,-.28)).normalized()
        tangent=Vector((0,1,.30));tangent=(tangent-normal*tangent.dot(normal)).normalized()
        q=Matrix((tangent.cross(normal),tangent,normal)).transposed().to_quaternion()@inv
        cheek=Vector((.058,.018,-.055) if outfit=='cardigan' else (.053,.014,-.045))
        contact=(self.world('mixamorigHead')@cheek)*SCALE+Vector((.004,-.025,0))
        handq=self.quat(side+'Hand');mid=handq.inverted()@(self.palm_root(side)-self.pos(side+'Hand'))
        localnormal=(mid.cross(handq.inverted()@(self.pos(side+'HandIndex1')-self.pos(side+'HandPinky1')))).normalized()
        target=contact-q@(mid*.57+localnormal*.012)
        a=self.pos(side+'Arm');e=self.pos(side+'ForeArm');w=self.pos(side+'Hand')
        u=(e-a).length;l=(w-e).length;line=target-a;reach=min(line.length,u+l-.001);line.normalize()
        pole=self.pos('LeftUpLeg').lerp(self.pos('LeftLeg'),.49)+Vector((.068,.065,0))-a
        pole=(pole-line*pole.dot(line)).normalized();dist=(u*u-l*l+reach*reach)/(2*reach)
        elbow=a+line*dist+pole*math.sqrt(max(0,u*u-dist*dist))
        self.aim(side+'Arm',side+'ForeArm',elbow)
        self.aim(side+'ForeArm',side+'Hand',target)
        self.hand(side,tangent,normal,inv)
        self.fingers(side,.14)
    def capture(self,names):
        result={}
        for name in names:
            if name not in self.bones:continue
            w=self.world(name);parent=self.record['standing'][name]['parent']
            local=self.world(parent).inverted()@w if parent else w
            q=local.to_quaternion().normalized();result[name]=[q.x,q.y,q.z,q.w]
        return result
    def key(self,frame):
        for b in self.bones.values():
            b.rotation_mode='QUATERNION'
            for channel in ('location','rotation_quaternion','scale'):b.keyframe_insert(channel,frame=frame)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--input');parser.add_argument('--blend',required=True);parser.add_argument('--output-dir',required=True);parser.add_argument('--base-dir');parser.add_argument('--from-blend',action='store_true');parser.add_argument('--update-standing',action='store_true',help='Reauthor frame 1 only, preserving the existing seated poses')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.root).resolve();out=Path(args.output_dir).resolve()
    if args.from_blend:
        bpy.ops.wm.open_mainfile(filepath=args.blend)
        data=json.loads(bpy.data.texts['RuntimeReference.json'].as_string())
    else:
        data=json.loads(Path(args.input).read_text());bpy.data.texts.new('RuntimeReference.json').write(json.dumps(data))
    report={}
    for outfit,record in data['outfits'].items():
        if args.from_blend:
            scene=bpy.data.scenes['Relaxed_'+outfit];bpy.context.window.scene=scene
            rig=next(o for o in scene.objects if o.type=='ARMATURE')
        else:
            scene=bpy.data.scenes.new('Relaxed_'+outfit);bpy.context.window.scene=scene
            bpy.ops.import_scene.gltf(filepath=str(root/'assets/public/models/resident'/record['file']))
            rig=next(o for o in scene.objects if o.type=='ARMATURE')
            rig.animation_data_clear()
            for ob in scene.objects:
                if ob.type=='MESH' and ob.data.shape_keys:ob.data.shape_keys.animation_data_clear()
        scene.render.fps=30;scene.frame_start=1;scene.frame_end=61
        pose=Pose(rig,record);clips={}
        for kind,frame,name in [('standing',1,'Luna_Relaxed_Standing'),('seated',31,'Luna_Sofa_Lap'),('cheek',61,'Luna_Sofa_Cheek')]:
            scene.frame_set(frame)
            if not args.from_blend or (args.update_standing and kind=='standing'):
                old=rig.animation_data.action if rig.animation_data else None
                if kind=='standing':pose.standing(outfit)
                elif kind=='seated':pose.lap(outfit)
                else:pose.cheek(outfit)
                # reset() disconnects the Action while authoring; retain both poses.
                if old:rig.animation_data_create();rig.animation_data.action=old
                pose.key(frame)
                rig.animation_data.action.name='Luna_Relaxed_'+outfit
            clips[name]=pose.capture(OWNED+(SPINES if kind!='standing' else []))
        scene.frame_set(1)
        glb_append((Path(args.base_dir) if args.base_dir else root/'assets/public/models/resident')/record['file'],out/record['file'],clips)
        report[outfit]={'clips':{k:len(v) for k,v in clips.items()},'objects':len(scene.objects),'triangles':sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in scene.objects if ob.type=='MESH')}
    bpy.context.window.scene=bpy.data.scenes['Relaxed_cardigan']
    bpy.ops.wm.save_as_mainfile(filepath=args.blend,compress=True)
    (out/'poses.json').write_text(json.dumps(report,indent=2));print('REST_POSES',json.dumps(report))
if __name__=='__main__':main()
