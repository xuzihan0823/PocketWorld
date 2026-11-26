"""Run with Blender --background --python scripts/blender/build_luna_rig.py."""
from pathlib import Path
import hashlib
import json
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'public/models/resident/luna.glb'
OUTPUT = ROOT / 'art/resident'
SELECTION = json.loads(Path(__file__).with_name('luna-separation.json').read_text())


def flat_material(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    node = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Roughness'].default_value = .8
    m.diffuse_color = (*color, 1)
    return m


def texture_colors(mesh):
    image = next((n.image for n in mesh.materials[0].node_tree.nodes
                 if n.type == 'TEX_IMAGE' and n.image and n.image.size[0] == 2048), None)
    if image is None:
        return np.tile([.95,.82,.79], (len(mesh.vertices),1))
    pixels = np.array(image.pixels[:]).reshape(image.size[1], image.size[0], 4)
    uv = mesh.uv_layers.active.data
    colors = np.zeros((len(mesh.vertices), 3))
    counts = np.zeros(len(mesh.vertices))
    for loop in mesh.loops:
        u, v = uv[loop.index].uv
        colors[loop.vertex_index] += pixels[min(int(v * image.size[1]), image.size[1]-1),
                                           min(int(u * image.size[0]), image.size[0]-1), :3]
        counts[loop.vertex_index] += 1
    return colors / np.maximum(counts[:, None], 1)


def subset(source, name, keep):
    obj = bpy.data.objects.new(name, source.data.copy())
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context='FACES')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj['source'] = 'luna.glb: preserved textured surface; contact openings repaired'
    return obj


def ellipsoid(name, center, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj['reconstructed'] = 'Previously occluded plush surface'
    return obj


def finish_wrist(arm, hand, material):
    center=np.array([.112,-.176,.899]);direction=np.array([-.042,-.022,-.009]);direction/=np.linalg.norm(direction)
    u=np.cross(direction,[0.,0.,1.]);u/=np.linalg.norm(u);v=np.cross(direction,u)
    points=np.array([p.co[:] for p in hand.data.vertices]);points=points[np.abs((points-center)@direction)<.00001]
    xy=np.column_stack(((points-center)@u,(points-center)@v))
    angles=np.arctan2(xy[:,1],xy[:,0]);radii=np.linalg.norm(xy,axis=1);order=np.argsort(angles);angles=angles[order];radii=radii[order]
    def radius(angle):
        return np.interp(angle,np.r_[angles[-1]-math.tau,angles,angles[0]+math.tau],np.r_[radii[-1],radii,radii[0]])
    for vertex in arm.data.vertices:
        p=np.array(vertex.co[:])-center;axial=np.dot(p,direction)
        if axial>-.025:
            xx,yy=np.dot(p,u),np.dot(p,v);theta=math.atan2(yy,xx)
            t=np.clip((axial+.025)/.025,0,1);t=t*t*(3-2*t)
            desired=center+direction*axial+(u*math.cos(theta)+v*math.sin(theta))*radius(theta)
            vertex.co=Vector((1-t)*np.array(vertex.co[:])+t*desired)
    verts=[];faces=[];count=48
    for axial in [-.005,0,.004]:
        for i in range(count):
            angle=i*math.tau/count-math.pi
            verts.append(center+direction*axial+(u*math.cos(angle)+v*math.sin(angle))*radius(angle)*.995)
    for ring in range(2):
        for i in range(count):
            j=(i+1)%count;faces.append((ring*count+i,ring*count+j,(ring+1)*count+j,(ring+1)*count+i))
    mesh=bpy.data.meshes.new('Left wrist seam');mesh.from_pydata(verts,[],faces);mesh.materials.append(material)
    obj=bpy.data.objects.new('Luna_LeftWrist',mesh);bpy.context.scene.collection.objects.link(obj)
    for face in mesh.polygons:face.use_smooth=True
    return obj


def make_armature(name, specs):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    for spec in specs:
        bone = data.edit_bones.new(spec['name'])
        bone.head, bone.tail = spec['head'], spec['tail']
        if spec.get('parent'):
            bone.parent = data.edit_bones[spec['parent']]
        bone.use_deform = spec.get('deform', True)
        bone.align_roll(Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.show_in_front = True
    collections = {}
    for spec in specs:
        group = spec.get('group', 'Body')
        if group not in collections:
            collections[group] = data.collections.new(group)
        collections[group].assign(data.bones[spec['name']])
    return obj


def distance_to_segments(points, specs):
    head = np.array([s['head'] for s in specs])
    delta = np.array([s['tail'] for s in specs]) - head
    t = np.clip(np.sum((points[:, None]-head)*delta, axis=2) / np.sum(delta*delta, axis=1), 0, 1)
    return np.linalg.norm(points[:, None]-head-t[:, :, None]*delta, axis=2)


def assign_weights(obj, armature, specs, is_left_arm=False):
    positions = np.array([v.co[:] for v in obj.data.vertices])
    colors = texture_colors(obj.data)
    n = len(positions)
    index = {s['name']: i for i, s in enumerate(specs)}
    weights = np.zeros((n, len(specs)), dtype=np.float32)
    x, y, z = positions.T
    red, green, blue = colors.T
    hair = (blue-red > .105) & (blue-green > .04) & (z > .81)
    skin = (red-blue > .025) & (red > green) & ~hair
    if is_left_arm:
        skin[:] = True
        hair[:] = False
    legs = (z < .575) | ((z < .65) & skin & (np.abs(x)<.12) & (y>-.11) & (y<.085))
    right_distance=distance_to_segments(positions,[s for s in specs if s['name'] in ['upper_arm.R','forearm.R','hand.R'] or s['group']=='Fingers' and s['name'].endswith('.R')]).min(1)
    right_arm = (red-blue>-.015) & (red-green>.012) & ~hair & (x < -.09) & (z > .65) & (z < 1.165) & (right_distance<.08)
    left_arm = np.ones(n, dtype=bool) if is_left_arm else skin & (x > .08) & (z > .84) & (z < 1.15)
    skirt = ~legs & (z >= .575) & (z < .985) & ~hair & ~right_arm & ~left_arm
    head_mask = (z >= 1.185)
    torso = ~(legs | right_arm | left_arm | skirt | hair | head_mask)

    def bind(mask, names, softness=.015):
        ids = np.flatnonzero(mask)
        if not len(ids):
            return
        cols = [index[name] for name in names]
        ds = distance_to_segments(positions[ids], [specs[i] for i in cols])
        values = 1 / (ds*ds + softness*softness)**2
        values /= values.sum(1)[:, None]
        weights[np.ix_(ids, cols)] = values

    bind(torso, ['pelvis', 'spine.01', 'spine.02', 'chest', 'neck'], .035)
    weights[head_mask, index['head']] = 1
    for side, sign, arm_mask in [('L', 1, left_arm), ('R', -1, right_arm)]:
        leg_mask = legs & ((x >= 0) if sign == 1 else (x < 0))
        bind(leg_mask, [f'thigh.{side}', f'shin.{side}', f'foot.{side}', f'toe.{side}'], .025)
        fingers = arm_mask & (((positions-np.array([.112,-.176,.899])) @ (np.array([-.042,-.022,-.009])/.04826) > .034) if side == 'L' else (z < .749))
        bind(arm_mask & ~fingers, [f'clavicle.{side}', f'upper_arm.{side}', f'forearm.{side}', f'hand.{side}'], .016)
        ids = np.flatnonzero(fingers)
        if len(ids):
            digits = ['thumb', 'index', 'middle', 'ring', 'pinky']
            chain_dist = np.stack([distance_to_segments(positions[ids], [specs[index[f'{d}.{j:02d}.{side}']] for j in range(1, 4)]).min(1) for d in digits], axis=1)
            nearest = chain_dist.argmin(1)
            for k, digit in enumerate(digits):
                mask = np.zeros(n, dtype=bool)
                mask[ids[nearest == k]] = True
                bind(mask, [f'hand.{side}'] + [f'{digit}.{j:02d}.{side}' for j in range(1, 4)], .004)
    bind(skirt, [s['name'] for s in specs if s['group'] == 'Skirt'], .035)
    bind(hair & ~head_mask, ['head'] + [s['name'] for s in specs if s['group'] == 'Hair'], .025)
    weights[weights < .01] = 0
    order = np.argsort(weights, axis=1)
    np.put_along_axis(weights, order[:, :-4], 0, axis=1)
    empty = weights.sum(1) == 0
    weights[empty, index['pelvis']] = 1
    weights /= weights.sum(1)[:, None]
    for col, spec in enumerate(specs):
        if not np.any(weights[:, col]):
            continue
        group = obj.vertex_groups.new(name=spec['name'])
        for i in np.flatnonzero(weights[:, col]):
            group.add([int(i)], float(weights[i, col]), 'REPLACE')
    modifier = obj.modifiers.new('Luna deformation', 'ARMATURE')
    modifier.object = armature
    obj.parent = armature
    obj['max_influences'] = 4


def left_hand_transform(points):
    source_wrist = np.array([.19,-.061,.789])
    target_wrist = np.array([.112,-.176,.899])
    source_direction = np.array([.027,-.001,-.051])
    target_direction = np.array([-.042,-.022,-.009])
    def basis(direction, normal):
        direction = direction / np.linalg.norm(direction)
        normal = normal - direction*np.dot(direction,normal)
        normal = normal/np.linalg.norm(normal)
        return np.column_stack((direction,normal,np.cross(direction,normal)))
    rotation = basis(target_direction,np.array([0.,1.,0.])) @ basis(source_direction,np.array([-1.,0.,0.])).T
    scale = np.linalg.norm(target_direction)/np.linalg.norm(source_direction)
    mirrored = np.array(points,dtype=float)*[-1,1,1]
    return (mirrored-source_wrist) @ rotation.T*scale + target_wrist


def skeleton_specs():
    specs = []
    def bone(name, head, tail, parent=None, group='Body', deform=True):
        specs.append(dict(name=name, head=list(head), tail=list(tail), parent=parent, group=group, deform=deform))
    bone('root', (0,0,0), (0,0,.15), deform=False)
    bone('pelvis', (0,-.015,.76), (0,-.015,.88), 'root')
    bone('spine.01', (0,-.015,.88), (0,-.025,.98), 'pelvis')
    bone('spine.02', (0,-.025,.98), (0,-.03,1.065), 'spine.01')
    bone('chest', (0,-.03,1.065), (0,-.035,1.14), 'spine.02')
    bone('neck', (0,-.035,1.14), (0,-.045,1.205), 'chest')
    bone('head', (0,-.045,1.205), (0,-.045,1.405), 'neck')
    for side, sign in [('L',1),('R',-1)]:
        shoulder=(sign*.105,-.025,1.125)
        elbow=(.149,-.055,.935) if side=='L' else (-.144,-.044,.961)
        wrist=(.112,-.176,.899) if side=='L' else (-.19,-.061,.789)
        palm=(.07,-.198,.89) if side=='L' else (-.217,-.062,.738)
        bone(f'clavicle.{side}', (sign*.015,-.03,1.12), shoulder, 'chest')
        bone(f'upper_arm.{side}', shoulder, elbow, f'clavicle.{side}')
        bone(f'forearm.{side}', elbow, wrist, f'upper_arm.{side}')
        bone(f'hand.{side}', wrist, palm, f'forearm.{side}')
        hip=(sign*.055,-.015,.76);knee=(sign*.064,-.055,.435);ankle=(sign*.046,-.025,.075)
        bone(f'thigh.{side}', hip, knee, 'pelvis')
        bone(f'shin.{side}', knee, ankle, f'thigh.{side}')
        bone(f'foot.{side}', ankle, (sign*.046,-.12,.026), f'shin.{side}')
        bone(f'toe.{side}', (sign*.046,-.12,.026), (sign*.046,-.16,.018), f'foot.{side}')
        digits={'thumb':[(-.200,-.087,.761),(-.200,-.093,.741),(-.205,-.094,.717),(-.208,-.09,.703)]}
        for d,yy,tip in [('index',-.081,.673),('middle',-.062,.668),('ring',-.047,.678),('pinky',-.034,.691)]:
            digits[d]=[(-.224,yy,.734),(-.234,yy,.709),(-.233,yy,tip+.013),(-.230,yy,tip)]
        if side=='L':
            digits={name:left_hand_transform(points).tolist() for name,points in digits.items()}
        for digit, points in digits.items():
            parent=f'hand.{side}'
            for j in range(3):
                name=f'{digit}.{j+1:02d}.{side}'
                bone(name, points[j], points[j+1], parent, 'Fingers')
                parent=name
    for sector in range(8):
        theta=sector*math.tau/8
        points=[(r*math.cos(theta),-.025+r*math.sin(theta),z) for r,z in [(.082,.99),(.12,.86),(.165,.73),(.205,.602)]]
        parent='pelvis'
        for j in range(3):
            name=f'skirt.{sector:02d}.{j+1:02d}'
            bone(name,points[j],points[j+1],parent,'Skirt');parent=name
    for name,points in {
        'front.L':[(.09,-.085,1.25),(.087,-.103,1.13),(.082,-.10,1.03)],
        'front.R':[(-.09,-.085,1.25),(-.087,-.103,1.13),(-.082,-.10,1.03)],
        'back.L':[(.07,.075,1.29),(.12,.105,1.10),(.14,.09,.84)],
        'back.R':[(-.07,.075,1.29),(-.12,.105,1.10),(-.14,.09,.84)],
        'back.C':[(0,.10,1.29),(0,.14,1.10),(0,.11,.84)],
    }.items():
        parent='head'
        for j in range(len(points)-1):
            key=f'hair.{name}.{j+1:02d}';bone(key,points[j],points[j+1],parent,'Hair');parent=key
    return specs


def build():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SELECTION['source_sha256'], 'Source changed; repaint separation first'
    scene = bpy.data.scenes.new('Luna_Rig_Delivery')
    bpy.context.window.scene = scene
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    source = next(o for o in scene.objects if o.type == 'MESH')
    bm=bmesh.new();bm.from_mesh(source.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=SELECTION['weld_distance'])
    bm.to_mesh(source.data);bm.free();source.data.update()
    assert len(source.data.polygons)==SELECTION['face_count']
    vertices=np.array([v.co[:] for v in source.data.vertices])
    faces=np.array([p.vertices[:] for p in source.data.polygons])
    colors=texture_colors(source.data);centers=vertices[faces].mean(1);fc=colors[faces].mean(1)
    mask=np.zeros(len(faces),dtype=bool)
    for start,end in SELECTION['bunny_face_ranges']:mask[start:end]=True
    x,y,z=centers.T
    arm=((x>.075)&(z>.85)&(z<1.15) | (x>.008)&(y<-.17)&(z>.852)&(z<.925))&(fc[:,0]-fc[:,2]>-.085)&~mask
    arm_specs=[s for s in skeleton_specs() if s['name'] in ['upper_arm.L','forearm.L','hand.L'] or s['group']=='Fingers' and s['name'].endswith('.L')]
    arm &= (distance_to_segments(centers,arm_specs).min(1)<.034)&(fc[:,1]-fc[:,2]<.12)&(fc[:,0]-fc[:,1]<.22)
    hand_direction=np.array([-.042,-.022,-.009]);hand_direction/=np.linalg.norm(hand_direction)
    original_arm=arm.copy()
    skin=flat_material('Luna repair skin',(.87,.70,.65))
    dress=flat_material('Luna repair dress',(.73,.72,.85))
    white=flat_material('Bunny hidden white plush',(.79,.76,.70))
    repair = (x>-.003)&(x<.225)&(y<-.070)&(z>.585)&(z<1.114)
    body=subset(source,'Luna_Body',~mask&~original_arm&~repair&~((x>0)&(y<-.14)&(z>.84)&(z<.937)))
    left=subset(source,'Luna_LeftArm',arm)
    bm=bmesh.new();bm.from_mesh(left.data)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(.112,-.176,.899),plane_no=hand_direction,clear_outer=True)
    bm.to_mesh(left.data);bm.free()
    hand_mask=(x<-.16)&(z<.81)&(z>.65)&(fc[:,0]-fc[:,2]>-.005)
    new_hand=subset(source,'Luna_LeftHand',hand_mask)
    bm=bmesh.new();bm.from_mesh(new_hand.data)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(-.19,-.061,.789),plane_no=(.027,.001,.051),clear_outer=True)
    positions=left_hand_transform([v.co[:] for v in bm.verts])
    for v,position in zip(bm.verts,positions):v.co=Vector(position)
    bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(new_hand.data);bm.free()
    new_hand['reconstructed']='Complete left hand from mirrored original right hand, aligned to left wrist; original left palm was fused to bunny'
    mirror = ~((fc[:,0]-fc[:,2]>-.005)&(x<-.096)&(z>.65))
    patch=subset(source,'Luna_RepairedDressAndCurl',mirror)
    bm=bmesh.new();bm.from_mesh(patch.data)
    for axis,value,sign in [(0,.006,1),(0,-.24,-1),(1,-.060,1),(2,.58,-1),(2,1.12,1)]:
        point=[0,0,0];point[axis]=value;normal=[0,0,0];normal[axis]=sign
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=point,plane_no=normal,clear_outer=True)
    for v in bm.verts:v.co.x=-v.co.x
    bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(patch.data);bm.free()
    patch['reconstructed']='Occluded upper dress and front curl reconstructed from opposite side'
    wrist=finish_wrist(left,new_hand,skin)
    original_bunny = mask & (((z>1.002)&(x>.095)) | (y<-.135)) & (z>.935)
    bunny=subset(source,'Bunny_OriginalSurface',original_bunny)
    bm=bmesh.new();bm.from_mesh(bunny.data)
    boundary=[v for v in bm.verts if v.is_boundary]
    for _ in range(2):bmesh.ops.smooth_vert(bm,verts=boundary,factor=.35,use_axis_x=True,use_axis_y=True,use_axis_z=True)
    bm.to_mesh(bunny.data);bm.free()
    bunny_parts=[bunny]
    bunny_parts.append(ellipsoid('Bunny_RebuiltBody',(.095,-.152,.911),(.032,.031,.046),white))
    bunny_parts.append(ellipsoid('Bunny_RebuiltHeadBack',(.105,-.139,.991),(.044,.034,.033),white))
    for sign in [-1,1]:
        bunny_parts.append(ellipsoid('Bunny_RebuiltPaw',(.095+sign*.031,-.163,.92),(.014,.018,.023),white))
        bunny_parts.append(ellipsoid('Bunny_RebuiltFoot',(.095+sign*.018,-.164,.874),(.016,.022,.013),white))
    bunny_parts.append(ellipsoid('Bunny_RebuiltTail',(.095,-.117,.9),(.014,.014,.014),white))
    bpy.data.objects.remove(source,do_unlink=True)
    specs=skeleton_specs();rig=make_armature('Luna_Rig',specs)
    assign_weights(body,rig,specs)
    assign_weights(left,rig,specs,True)
    assign_weights(new_hand,rig,specs,True)
    assign_weights(wrist,rig,specs,True)
    assign_weights(patch,rig,specs)
    arm_fill=[]
    for name,head,tail,radius in [
        ('Luna_LeftUpperArmInner',(.105,-.025,1.128),(.148,-.055,.936),.028),
        ('Luna_LeftForearmInner',(.148,-.055,.936),(.117,-.162,.903),.015),
    ]:
        head,tail=Vector(head),Vector(tail)
        fill=ellipsoid(name,(head+tail)/2,(radius,radius,(tail-head).length/2+radius*.4),skin)
        fill.rotation_mode='QUATERNION';fill.rotation_quaternion=(tail-head).to_track_quat('Z','Y')
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        assign_weights(fill,rig,specs,True);arm_fill.append(fill)
    origin=Vector((.095,-.15,.861))
    rabbit_root=bpy.data.objects.new('Bunny',None);scene.collection.objects.link(rabbit_root)
    rabbit_root.location=(.48,0,0)
    for obj in bunny_parts:
        obj.location-=origin
        obj.parent=rabbit_root
    rabbit_root['source_contact_origin']=list(origin)
    rabbit_root['note']='Original face, ears and scarf; occluded body, back, paws and tail reconstructed'
    rig['rig_version']='Luna detailed rig 1'
    rig['rest_pose']='Original asymmetric carrying pose, metres, Blender Z up / glTF Y up'
    rig['bone_count']=len(specs)
    for obj in [body,left]:obj['original_source_sha256']=SELECTION['source_sha256']
    OUTPUT.mkdir(parents=True,exist_ok=True)
    (OUTPUT/'luna-bone-map.json').write_text(json.dumps(specs,ensure_ascii=False,indent=2)+'\n')
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.region_3d.view_location=Vector((.1,0,.75))
            area.spaces.active.region_3d.view_distance=2.2
    print(json.dumps({'scene':scene.name,'rig':rig.name,'bones':len(specs),'body_vertices':len(body.data.vertices),'arm_vertices':len(left.data.vertices),'bunny_original_faces':int(mask.sum())}))
    return scene,rig,[body,left,new_hand,wrist,patch]+arm_fill,rabbit_root,bunny_parts


def add_check_animation(rig):
    from mathutils import Quaternion
    scene=bpy.context.scene
    scene.render.fps=24
    scene.frame_start,scene.frame_end=1,97
    for frame in [1,25,49,73,97]:
        for pb in rig.pose.bones:
            pb.rotation_mode='QUATERNION'
            pb.rotation_quaternion=(1,0,0,0)
        poses=[]
        if frame==25:
            for side in ['L','R']:
                for digit in ['thumb','index','middle','ring','pinky']:
                    for joint in range(1,4):
                        poses.append((f'{digit}.{joint:02d}.{side}',(0,0,-1) if side=='L' else (0,-1,0),.25))
        if frame==73:
            poses=[('upper_arm.R',(0,1,0),.25),('forearm.R',(-1,0,0),.75),
                   ('forearm.L',(1,0,0),.35),('thigh.R',(-1,0,0),.35),('shin.R',(1,0,0),.65)]
        for name,axis,angle in poses:
            pb=rig.pose.bones[name]
            pb.rotation_quaternion=Quaternion(pb.bone.matrix_local.to_3x3().inverted()@Vector(axis),angle)
        for pb in rig.pose.bones:
            pb.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=pb.name)
    rig.animation_data.action.name='Rig_Check'
    rig.animation_data.action.use_fake_user=True
    scene.frame_set(1)
    for frame,label in [(1,'Rest'),(25,'Finger flex'),(49,'Rest'),(73,'Elbows and knee'),(97,'Rest')]:
        scene.timeline_markers.new(label,frame=frame)


def export_delivery(result):
    scene,rig,meshes,rabbit_root,bunny_parts=result
    scene.frame_set(1)
    directory=ROOT/'public/models/resident'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rig]+meshes:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(directory/'luna-rigged.glb'),use_selection=True,use_active_scene=True,
                             export_skins=True,export_all_influences=False,export_animations=True,
                             export_animation_mode='ACTIVE_ACTIONS',export_nla_strips_merged_animation_name='Rig_Check',export_extras=True)
    display_location=rabbit_root.location.copy()
    rabbit_root.location=(0,0,0)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rabbit_root]+bunny_parts:obj.select_set(True)
    bpy.context.view_layer.objects.active=rabbit_root
    bpy.ops.export_scene.gltf(filepath=str(directory/'luna-bunny.glb'),use_selection=True,use_active_scene=True,
                             export_animations=False,export_extras=True)
    rabbit_root.location=display_location
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.data.libraries.write(str(OUTPUT/'luna-detailed-rig.blend'),{scene},fake_user=True,compress=True)
    print('Saved Blender source, rigged character and independent bunny')


if __name__=='__main__':
    result=build()
    add_check_animation(result[1])
    export_delivery(result)
