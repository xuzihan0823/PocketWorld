"""Author cardigan stair hands and plush grip in Blender; export an animation-only GLB.
Snapshots use the production stair solver. Existing skin, feet and body assets are untouched.
"""
import argparse, json, math, struct, sys, copy
from pathlib import Path
import bpy
from mathutils import Vector, Matrix, Quaternion

def xyzw(q): return [q.x,q.y,q.z,q.w]
def export_glb(base, output, animations, extras):
    raw=base.read_bytes();n=struct.unpack_from('<I',raw,12)[0];source=json.loads(raw[20:20+n])
    nodes=copy.deepcopy(source['nodes'])
    for node in nodes:
        for key in ('mesh','skin','weights','camera'):node.pop(key,None)
    doc={'asset':{'version':'2.0','generator':'PocketWorld Blender contact hand authoring'},'nodes':nodes,'scene':0,
         'scenes':[{'nodes':source['scenes'][source.get('scene',0)]['nodes'],'extras':{'contactHands':extras}}],
         'buffers':[{'byteLength':0}],'bufferViews':[],'accessors':[],'animations':[]}
    indices={node.get('name','').replace(':',''):i for i,node in enumerate(nodes)};binary=bytearray()
    def acc(values,width):
        while len(binary)%4:binary.append(0)
        start=len(binary);binary.extend(struct.pack('<'+'f'*len(values),*values));vi=len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(values)*4})
        a={'bufferView':vi,'componentType':5126,'count':len(values)//width,'type':'SCALAR' if width==1 else 'VEC4'}
        if width==1:a.update(min=[min(values)],max=[max(values)])
        ai=len(doc['accessors']);doc['accessors'].append(a);return ai
    for name,samples in animations.items():
        times=acc([i/(len(samples)-1) for i in range(len(samples))],1)
        animation={'name':name,'channels':[],'samplers':[]}
        for bone in samples[0]:
            values=[];previous=None
            for sample in samples:
                q=sample[bone]
                if previous and sum(a*b for a,b in zip(previous,q))<0:q=[-v for v in q]
                values+=q;previous=q
            sampler=len(animation['samplers']);animation['samplers'].append({'input':times,'output':acc(values,4),'interpolation':'LINEAR'})
            animation['channels'].append({'sampler':sampler,'target':{'node':indices[bone],'path':'rotation'}})
        doc['animations'].append(animation)
    doc['buffers'][0]['byteLength']=len(binary)
    js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--input');p.add_argument('--blend',required=True);p.add_argument('--output',required=True);p.add_argument('--from-blend',action='store_true')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.root)
    sys.path.insert(0,str(root/'scripts'));import importlib
    mod=importlib.import_module('bake-luna-rest');Pose=mod.Pose;OWNED=mod.OWNED
    class FastPose(Pose):
        def reset(self,kind):
            self.rig.animation_data_clear()
            targets={name:self.rig.matrix_world.inverted()@mod.C@mod.mat(value['world'])@self.bind[name].inverted()@mod.CI@self.bbind[name] for name,value in self.record[kind].items() if name in self.bones}
            for name,b in self.bones.items():
                if name not in targets:continue
                kw={'parent_matrix':targets[b.parent.name.replace(':','')], 'parent_matrix_local':b.parent.bone.matrix_local} if b.parent else {}
                b.matrix_basis=b.bone.convert_local_to_pose(targets[name],b.bone.matrix_local,invert=True,**kw)
            bpy.context.view_layer.update()
    if args.from_blend:
        bpy.ops.wm.open_mainfile(filepath=args.blend);record=json.loads(bpy.data.texts['ContactReference.json'].as_string())['record']
    else:
        data=json.loads(Path(args.input).read_text());record=data['record']
        bpy.data.texts.new('ContactReference.json').write(json.dumps({'record':{k:record[k] for k in ('file','bind','standing')}},indent=1))
        print('REFERENCE_READY',flush=True)
        for ob in list(bpy.data.objects):bpy.data.objects.remove(ob,do_unlink=True)
    animations={};extras={'palms':[], 'fingers':{}, 'guides':[]};report={}
    for kind in ('up','down','grip'):
        if args.from_blend:
            scene=bpy.data.scenes['Contact_'+kind];bpy.context.window.scene=scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
        else:
            scene=bpy.data.scenes.new('Contact_'+kind);bpy.context.window.scene=scene
            bpy.ops.import_scene.gltf(filepath=str(root/'assets/public/models/resident'/record['file']))
            rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data_clear()
            for ob in scene.objects:
                if ob.type=='MESH' and ob.data.shape_keys:ob.data.shape_keys.animation_data_clear()
        print('AUTHOR',kind,flush=True)
        for ob in scene.objects:
            if ob.type=='MESH':ob.hide_viewport=True
        pose=FastPose(rig,record);samples=[]
        scene.render.fps=30;scene.frame_start=1;scene.frame_end=65 if kind!='grip' else 31
        count=65 if kind!='grip' else 2
        if kind=='grip' and not args.from_blend:
            cradle=bpy.data.objects.new('Bear_Cradle',None);scene.collection.objects.link(cradle)
            for name,value in {'raise':.04,'forward':.055,'arc':.10,'reach':.27}.items():cradle[name]=value
            for i,(level,depth) in enumerate([(.45,-.30),(.30,.25)]):
                ob=bpy.data.objects.new(f'Bear_Contact_{i}',None);scene.collection.objects.link(ob)
                ob.location=(0,level,depth);ob.empty_display_type='SPHERE';ob.empty_display_size=.03
        for i in range(count):
            frame=i+1 if kind!='grip' else 1+i*30;scene.frame_set(frame)
            if not args.from_blend:
                old=rig.animation_data.action if rig.animation_data else None
                record['working']=record[kind][i] if kind!='grip' else record['standing'];pose.reset('working')
                for side in ('Right','Left'):
                    sign=-1 if side=='Right' else 1;inv=pose.basis(side)
                    if kind!='grip':
                        fore=(pose.pos(side+'Hand')-pose.pos(side+'ForeArm')).normalized()
                        tangent=fore.lerp(Vector((sign*.02,-1,.12)).normalized(),.10).normalized()
                        normal=Vector((-sign,0,.08))
                    else:
                        tangent=Vector((0,-1,.15) if i==0 else (-sign*.50,-.22,1))
                        normal=Vector((-sign,0,.40) if i==0 else (-sign,.12,-.20))
                        # Editable grip demonstration; runtime solves wrists against the moving toy.
                        target=Vector((sign*.235,.91,.29))
                        a=pose.pos(side+'Arm');e=pose.pos(side+'ForeArm');w=pose.pos(side+'Hand');u=(e-a).length;l=(w-e).length
                        line=target-a;distance=min(line.length,u+l-.001);line.normalize();pole=Vector((sign,-.55,-.45));pole=(pole-line*pole.dot(line)).normalized()
                        along=(u*u-l*l+distance*distance)/(2*distance)
                        pose.aim(side+'Arm',side+'ForeArm',a+line*along+pole*math.sqrt(max(0,u*u-along*along)))
                        pose.aim(side+'ForeArm',side+'Hand',target)
                    pose.hand(side,tangent,normal,inv);pose.fingers(side,.12 if kind!='grip' else -.22)
                    if kind=='grip':
                        # Let the thumb wrap along the toy, instead of projecting into it
                        # and holding the entire palm away from the surface.
                        thumb=pose.pos(side+'HandThumb1');end=pose.pos(side+'HandThumb3')
                        across=(pose.pos(side+'HandIndex1')-pose.pos(side+'HandPinky1')).normalized()
                        direction=(tangent.normalized()*.70+across*.70).normalized()
                        pose.aim(side+'HandThumb1',side+'HandThumb3',thumb+direction*(end-thumb).length)
                    if kind=='grip':
                        # Store authorable world-space direction guides, used by the contact solver.
                        for name,vec in [('tangent',tangent.normalized()),('normal',(normal-tangent.normalized()*normal.dot(tangent.normalized())).normalized())]:
                            ob=bpy.data.objects.new(f'{side}_{i}_{name}',None);scene.collection.objects.link(ob);ob.location=mod.C.to_3x3()@vec;ob.empty_display_type='ARROWS';ob.empty_display_size=.12
                if old:rig.animation_data_create();rig.animation_data.action=old
                pose.key(frame);rig.animation_data.action.name='Cardigan_'+kind
            samples.append(pose.capture(OWNED))
            if i%16==0:print('FRAME',kind,i,flush=True)
        if kind!='grip':
            # Identical endpoints are required by the two-step cyclic runtime clock.
            if not args.from_blend:
                scene.frame_set(1)
                matrices={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
                scene.frame_set(65)
                for b in rig.pose.bones:b.matrix_basis=matrices[b.name]
                pose.key(65);samples[-1]=pose.capture(OWNED)
            animations['Luna_Stair_'+kind.title()]=samples
        else:
            animations['Luna_Plush_Grip']=samples
            scene.frame_set(1)
            for side in ('Right','Left'):
                q=pose.quat(side+'Hand');center=q.inverted()@(pose.palm_root(side)-pose.pos(side+'Hand'))/mod.SCALE
                extras['palms'].append({'basis':xyzw(pose.basis(side)),'knuckle':list(center)})
            extras['fingers']={k:v for k,v in samples[0].items() if 'Hand' in k and not k.endswith('Hand')}
            for i in range(2):
                extras['guides'].append([{name:list(mod.CI.to_3x3()@scene.objects[f'{side}_{i}_{name}'].location) for name in ('tangent','normal')} for side in ('Right','Left')])
            extras['contacts']=[list(scene.objects[f'Bear_Contact_{i}'].location)[1:] for i in range(2)]
            extras['cradle']={key:float(scene.objects['Bear_Cradle'][key]) for key in ('raise','forward','arc','reach')}
        scene.frame_set(1)
        for ob in scene.objects:
            if ob.type=='MESH':ob.hide_viewport=False
        report[kind]={'objects':len(scene.objects),'triangles':sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in scene.objects if ob.type=='MESH'),'samples':len(samples)}
    export_glb(root/'assets/public/models/resident'/record['file'],Path(args.output),animations,extras)
    bpy.context.window.scene=bpy.data.scenes['Contact_up'];bpy.ops.wm.save_as_mainfile(filepath=args.blend,compress=True)
    print('CONTACT_HANDS',json.dumps(report),Path(args.output).stat().st_size)
if __name__=='__main__':main()
