"""Blender-author floorSit/floorStand hands, preserving all other GLB bytes.
Run sample-luna-floor-hands.mjs first. The editable blend stores both full-body
clips; --from-blend exports manual edits at the original sample times.
"""
import argparse, importlib.util, json, math, struct, sys, hashlib
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree


def smooth(a,b,t):
    x=max(0,min(1,(t-a)/(b-a)));return x*x*(3-2*x)


def main():
    p=argparse.ArgumentParser()
    for arg in ('root','base','blend','output','report'):p.add_argument('--'+arg,required=True)
    p.add_argument('--input',help='Runtime snapshots; not needed with --from-blend')
    p.add_argument('--from-blend',action='store_true');p.add_argument('--preview-only',action='store_true')
    p.add_argument('--along',type=float,default=.70);p.add_argument('--curl',type=float,default=.035)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.root)
    spec=importlib.util.spec_from_file_location('rest',root/'scripts/bake-luna-rest.py');rest=importlib.util.module_from_spec(spec);spec.loader.exec_module(rest)
    data=json.loads(Path(args.input).read_text()) if args.input else None;owned=rest.OWNED
    if args.from_blend:
        bpy.ops.wm.open_mainfile(filepath=args.blend)
        data=json.loads(bpy.data.texts['FloorReference.json'].as_string())
    else:
        if data is None:p.error('--input is required when authoring new clips')
        bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(root/'assets/public/models/resident/luna-cardigan.glb'))
        reference={**data,'clips':{name:{k:v for k,v in clip.items() if k!='frames'} for name,clip in data['clips'].items()}}
        bpy.data.texts.new('FloorReference.json').from_string(json.dumps(reference,indent=1))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    pose=rest.Pose(rig,data);scene=bpy.context.scene;scene.render.fps=30
    meshes=[o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
    for ob in scene.objects:
        if ob.type=='MESH' and ob not in meshes:ob.hide_render=True
    for ob in meshes:
        if ob.data.shape_keys:ob.data.shape_keys.animation_data_clear()
    modifiers=[m for ob in meshes for m in ob.modifiers if m.type=='ARMATURE']
    def deform(enabled):
        for m in modifiers:m.show_viewport=enabled
        bpy.context.view_layer.update()
    membership={}
    for ob in meshes:
        groups={g.index:g.name for g in ob.vertex_groups}
        membership[ob.name]={side:[v.index for v in ob.data.vertices if sum(g.weight for g in v.groups if side+'Hand' in groups[g.group])>.75] for side in ('Left','Right')}
        membership[ob.name]['lower']=[sum(g.weight for g in v.groups if any(k in groups[g.group] for k in ('Hips','Leg','Foot','ToeBase','Dress')))>.75 for v in ob.data.vertices]
    deform(False)
    def set_frame(record):
        # Batch matrix_basis conversion avoids one depsgraph update per bone.
        targets={name:rig.matrix_world.inverted()@rest.C@rest.mat(v['world'])@pose.bind[name].inverted()@rest.CI@pose.bbind[name] for name,v in record.items()}
        for name,b in pose.bones.items():
            if name not in targets:continue
            kw={} if not b.parent else {'parent_matrix':targets[b.parent.name.replace(':','')],'parent_matrix_local':b.parent.bone.matrix_local}
            b.matrix_basis=b.bone.convert_local_to_pose(targets[name],b.bone.matrix_local,invert=True,**kw)
        bpy.context.view_layer.update()
    def surface():
        deform(True);verts=[];faces=[]
        for ob in meshes:
            deps=bpy.context.evaluated_depsgraph_get();ev=ob.evaluated_get(deps);me=ev.to_mesh()
            offset=len(verts);verts.extend(rest.CI@(ev.matrix_world@v.co)*rest.SCALE for v in me.vertices)
            lower=membership[ob.name]['lower']
            faces.extend(tuple(offset+i for i in poly.vertices) for poly in me.polygons if all(lower[i] for i in poly.vertices))
            ev.to_mesh_clear()
        deform(False);return BVHTree.FromPolygons(verts,faces,all_triangles=False)
    skin_meta={}
    def skin_samples(side,all_hand=False):
        wrist=pose.pos(side+'Hand');mid=pose.palm_root(side);center=wrist.lerp(mid,.6)
        normal=(mid-wrist).cross(pose.pos(side+'HandIndex1')-pose.pos(side+'HandPinky1')).normalized()*(1 if side=='Left' else -1)
        samples=[];deform(True)
        if all_hand:skin_meta[side]=[]
        deps=bpy.context.evaluated_depsgraph_get()
        for ob in meshes:
            ev=ob.evaluated_get(deps);me=ev.to_mesh()
            for index in membership[ob.name][side]:
                point=rest.CI@(ev.matrix_world@me.vertices[index].co)*rest.SCALE
                if all_hand or ((point-center).length<.025 and (point-center).dot(normal)>.002):samples.append(point)
                if all_hand:skin_meta[side].append((point,[(ob.vertex_groups[g.group].name,g.weight) for g in ob.data.vertices[index].groups]))
            ev.to_mesh_clear()
        deform(False);return samples,normal
    def solve(side,target):
        a=pose.pos(side+'Arm');e=pose.pos(side+'ForeArm');w=pose.pos(side+'Hand')
        u=(e-a).length;l=(w-e).length;line=target-a;reach=min(line.length,u+l-.0001);line.normalize()
        sign=1 if side=='Left' else -1
        pole=Vector((sign*.12,-.30,-.10));pole=(pole-line*pole.dot(line)).normalized()
        dist=(u*u-l*l+reach*reach)/(2*reach);elbow=a+line*dist+pole*math.sqrt(max(0,u*u-dist*dist))
        pose.aim(side+'Arm',side+'ForeArm',elbow);pose.aim(side+'ForeArm',side+'Hand',target)
    def lap():
        tree=surface();rows={}
        for side in ('Left','Right'):
            sign=1 if side=='Left' else -1
            pose.aim(side+'Shoulder',side+'Arm',pose.pos(side+'Arm')+Vector((0,-.030,.025)))
            pose.fingers(side,args.curl);inv=pose.basis(side)
            hip=pose.pos(side+'UpLeg');knee=pose.pos(side+'Leg')
            probe=hip.lerp(knee,args.along)+Vector((sign*(.025 if side=='Left' else .035),.30,0))
            hit,up,_,_=tree.ray_cast(probe,Vector((0,-1,0)))
            if hit is None:raise RuntimeError('Thigh surface ray missed '+side)
            normals=[]
            for dx,dz in ((0,0),(.01,0),(-.01,0),(0,.01),(0,-.01)):
                _,n,_,_=tree.ray_cast(probe+Vector((dx,0,dz)),Vector((0,-1,0)))
                if n:normals.append(n if n.y>0 else -n)
            up=(sum(normals,Vector()).normalized()+Vector((0,1,0))*.65).normalized()
            # Follow the actual broad surface, including its transverse slope.
            tangent=Vector((-sign*.35,0,.94));tangent=(tangent-up*tangent.dot(up)).normalized()
            up=Quaternion(tangent,-sign*(.28 if side=='Left' else .32))@up;normal=-up
            q=Matrix((tangent.cross(normal),tangent,normal)).transposed().to_quaternion()@inv
            local=pose.quat(side+'Hand').inverted()@(pose.palm_root(side)-pose.pos(side+'Hand'))
            localnormal=pose.quat(side+'Hand').inverted()@((pose.palm_root(side)-pose.pos(side+'Hand')).cross(pose.pos(side+'HandIndex1')-pose.pos(side+'HandPinky1')).normalized()*sign)
            target=hit-q@(local*.6+localnormal*.012)+up*.003
            for iteration in range(4):
                solve(side,target);pose.hand(side,tangent,normal,inv);pose.fingers(side,args.curl)
                points,palmnormal=skin_samples(side)
                if len(points)<8:raise RuntimeError('Insufficient palm samples '+side+': '+str(len(points)))
                gaps=[(point-tree.find_nearest(point)[0]).dot(up) for point in points]
                target+=up*((.0030 if side=='Left' else .0032)-min(gaps))
            solve(side,target);pose.hand(side,tangent,normal,inv);pose.fingers(side,args.curl)
            # Lift only the individual digits that intersect the real thigh.
            for finger in ('Thumb','Index','Middle','Ring','Pinky'):
                for step in range(8):
                    skin_samples(side,True)
                    pads=[point for point,groups in skin_meta[side] if sum(w for n,w in groups if side+'Hand'+finger in n)>.20]
                    gap=min((point-tree.find_nearest(point)[0]).dot(tree.find_nearest(point)[1]) for point in pads)
                    if gap>=.0004:break
                    root_name=side+'Hand'+finger+'1'
                    direction=pose.pos(side+'Hand'+finger+'3')-pose.pos(root_name)
                    axis=direction.cross(up).normalized()
                    pose.rotate(root_name,Quaternion(axis,min(.06,max(.005,(.0004-gap)/max(.025,direction.length)))))
            points,palmnormal=skin_samples(side)
            distances=sorted(tree.find_nearest(point)[3] for point in points)
            rows[side]={'nearest':distances[0],'median':distances[len(distances)//2],'samples':len(points),'palmDown':palmnormal.dot(Vector((0,-1,0))),'wristAngle':(pose.palm_root(side)-pose.pos(side+'Hand')).angle(pose.pos(side+'Hand')-pose.pos(side+'ForeArm')),'wrist':list(pose.pos(side+'Hand'))}
            allpoints,_=skin_samples(side,True)
            rows[side]['handPenetration']=max(0,max(-(point-tree.find_nearest(point)[0]).dot(tree.find_nearest(point)[1]) for point in allpoints))
            worst=min(allpoints,key=lambda point:(point-tree.find_nearest(point)[0]).dot(tree.find_nearest(point)[1]))
            rows[side]['worstPoint']=list(worst)
            rows[side]['nearestFinger']=min((f+str(i) for f in ('Index','Middle','Ring','Pinky','Thumb') for i in (1,2,3)),key=lambda n:(worst-pose.pos(side+'Hand'+n)).length)
            rows[side]['worstGroups']=min(skin_meta[side],key=lambda pair:(pair[0]-worst).length)[1]
        return rows
    report={'compatibility':data['compatibility'],'baseSha256':data['baseSha256'],'clips':{}}
    baked={}
    if args.preview_only:
        rig.animation_data_clear();set_frame(data['clips']['floorSit']['frames'][-1]);report['preview']=lap()
        Path(args.report).write_text(json.dumps(report,indent=2));print(json.dumps(report));return
    for name,clip in data['clips'].items():
        if args.from_blend:
            action=bpy.data.actions[name];rig.animation_data_create();rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
        else:
            rig.animation_data_clear();action=None
        values=[];contact={}
        for i,time in enumerate(clip['times']):
            scene.frame_set(i+1)
            if not args.from_blend:
                rig.animation_data_clear();set_frame(clip['frames'][i]);before={n:pose.bones[n].rotation_quaternion.copy() for n in owned}
                weight=smooth(2.45,3.7,time) if name=='floorSit' else 1-smooth(.15,1.05,time)
                if weight>0:
                    rows=lap()
                    for n in owned:pose.bones[n].rotation_quaternion=before[n].slerp(pose.bones[n].rotation_quaternion,weight)
                    bpy.context.view_layer.update()
                    if weight==1 and (i==0 or i==len(clip['times'])-1):contact[str(time)]=rows
                if action:rig.animation_data_create();rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
                pose.key(i+1);action=rig.animation_data.action;action.name=name;action.use_fake_user=True
            values.append(pose.capture(owned))
        if not args.from_blend:
            # Smooth retargeted arm jitter while free, and skin-fit finger jitter throughout.
            bag=action.layers[0].strips[0].channelbags[0]
            for bone_name in owned:
                b=pose.bones[bone_name];curves=[next(fc for fc in bag.fcurves if fc.data_path==b.path_from_id('rotation_quaternion') and fc.array_index==axis) for axis in range(4)]
                qs=[Quaternion(tuple(fc.keyframe_points[i].co.y for fc in curves)).normalized() for i in range(len(clip['times']))]
                if name=='floorSit' and any('Hand'+finger in bone_name for finger in ('Thumb','Index','Middle','Ring','Pinky')):
                    # One relaxed digit pose clears the whole small seated leg sway.
                    # Using the envelope avoids per-frame closest-triangle switches.
                    hold=max((q for q,t in zip(qs,clip['times']) if t>=3.7),key=lambda q:2*math.acos(min(1,abs(q.w))))
                    qs=[q.slerp(hold,smooth(2.45,3.7,t)) for q,t in zip(qs,clip['times'])]
                for i,time in enumerate(clip['times']):
                    blend=(1-smooth(3.4,3.7,time))*smooth(0,.1,time) if name=='floorSit' else smooth(0,.15,time)*(1-smooth(clip['duration']-.1,clip['duration'],time))
                    if name=='floorSit' and any('Hand'+finger in bone_name for finger in ('Thumb','Index','Middle','Ring','Pinky')):blend=smooth(0,.1,time)
                    if blend==0:continue
                    acc=Vector((0,0,0,0))
                    radius=3 if name=='floorSit' else 12
                    for delta in range(-radius,radius+1):
                        weight=math.comb(2*radius,delta+radius)
                        q=qs[max(0,min(len(qs)-1,i+delta))].copy()
                        if q.dot(qs[i])<0:q.negate()
                        acc+=Vector(q)*weight
                    q=qs[i].slerp(Quaternion(acc).normalized(),blend)
                    for axis,fc in enumerate(curves):fc.keyframe_points[i].co.y=q[axis]
                for fc in curves:fc.update()
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        for k in fc.keyframe_points:k.interpolation='LINEAR'
        values=[]
        for i in range(len(clip['times'])):
            scene.frame_set(i+1);bpy.context.view_layer.update();values.append(pose.capture(owned))
        baked[name]=values;report['clips'][name]=contact
        print(name,json.dumps(contact),flush=True)
    raw=bytearray(Path(args.base).read_bytes());jslen=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jslen]);start=28+jslen
    # The original animation bundle and every unrelated channel remain byte-identical.
    changed=0
    for animation in doc['animations']:
        if animation['name'] not in baked:continue
        previous={}
        for channel in animation['channels']:
            name=doc['nodes'][channel['target']['node']]['name'].replace(':','')
            if name not in owned or channel['target']['path']!='rotation':continue
            acc=doc['accessors'][animation['samplers'][channel['sampler']]['output']];view=doc['bufferViews'][acc['bufferView']]
            assert acc['componentType']==5126 and acc['type']=='VEC4' and acc['count']==len(baked[animation['name']])
            offset=start+view.get('byteOffset',0)+acc.get('byteOffset',0)
            for i,frame in enumerate(baked[animation['name']]):
                q=frame[name]
                if name in previous and sum(a*b for a,b in zip(q,previous[name]))<0:q=[-v for v in q]
                previous[name]=q;struct.pack_into('<4f',raw,offset+16*i,*q)
            changed+=1
    Path(args.output).write_bytes(raw)
    rig.animation_data.action=bpy.data.actions['floorSit'];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
    deform(True)
    scene.frame_start=1;scene.frame_end=len(data['clips']['floorSit']['times']);scene.frame_set(scene.frame_end)
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=args.blend,compress=True)
    report.update(rotationChannels=changed,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),meshes={ob.name:{'triangles':sum(len(p.vertices)-2 for p in ob.data.polygons),'dimensions':list(ob.dimensions),'hiddenRender':ob.hide_render} for ob in meshes},objects=len(scene.objects),materials=len(bpy.data.materials))
    Path(args.report).write_text(json.dumps(report,indent=2));print('FLOOR_HANDS',json.dumps(report))

if __name__=='__main__':main()
