"""Author the reference-board character with native Blender meshes and modifiers."""
from pathlib import Path
import bpy
import bmesh
import math
import json
import sys
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/characters/blue-haired-girl'
TAU = math.tau
PI = math.pi
if (OUT/'character.blend').exists() and '--overwrite-generated' not in sys.argv:
    raise SystemExit('Refusing to replace character.blend; use a new output directory or --overwrite-generated explicitly.')
for folder in ('renders', 'textures'):
    (OUT / folder).mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = 'BlueGirl_Reference_Reconstruction'
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new('Soft lavender studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.42, .46, .56, 1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value = .35
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
CHAR = bpy.data.collections.new('CHARACTER · export')
scene.collection.children.link(CHAR)
STUDIO = bpy.data.collections.new('STUDIO · not exported')
scene.collection.children.link(STUDIO)


def move_collection(obj, collection=CHAR):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)


def linear(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def rgb(hex):
    return tuple(int(hex[i:i+2], 16) / 255 for i in (0, 2, 4))


def material(name, hex, rough=.65, emission=.08):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = tuple(linear(v) for v in rgb(hex))
    n.inputs['Base Color'].default_value = (*c, 1)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Specular IOR Level'].default_value = .22
    n.inputs['Emission Color'].default_value = (*c, 1)
    n.inputs['Emission Strength'].default_value = emission
    m.diffuse_color = (*c, 1)
    return m


SKIN = material('Skin · warm porcelain', 'ffe1d5', .76, .14)
HAIR = material('Hair · ice blue satin', 'bad7ff', .39, .15)
FABRIC = material('Dress · lavender white cotton', 'f5f0ff', .88, .12)
PINK = material('Bow · rose silk', 'ee9db9', .53, .10)
INK = material('Lashes · plum charcoal', '46364e', .88, .1)
WHITE = material('Eyes · warm sclera', 'fff7f3', .3, .22)
IRIS = material('Eyes · blue violet gradient', '809bea', .3, .38)
HIGHLIGHT = material('Eyes · catchlight', 'ffffff', .22, .8)
MOUTH = material('Mouth · inner rose', 'a45d71', .95, .05)
LIP = material('Lips · soft pink', 'efb4b4', .8, .15)


def texture(mat, name, pixels):
    h, w = pixels.shape[:2]
    im = bpy.data.images.new(name, width=w, height=h, alpha=True)
    im.pixels.foreach_set(pixels.astype(np.float32).ravel())
    im.filepath_raw = str(OUT / 'textures' / (name + '.png'))
    im.file_format = 'PNG'
    im.save()
    im.pack()
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = im
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Emission Color'])
    return im


h, w = 1024, 256
v, u = np.mgrid[0:1:complex(h), 0:1:complex(w)]
base = np.zeros((h, w, 4))
shade = .94 + .06 * np.sin(u * TAU) ** 2 + .025 * np.cos(u * TAU * 5) + .015 * np.sin(u * TAU * 11 + v * 4)
for i, (a, b) in enumerate(zip(rgb('99baf1'), rgb('cee2ff'))):
    base[:,:,i] = np.clip((a + (b-a) * (v*.7 + .3)) * shade, 0, 1)
base[:,:,3] = 1
texture(HAIR, 'hair-blue-gradient', base)
FACE = SKIN.copy()
FACE.name = 'Face · soft cheek blush'
h, w = 512, 1024
v, u = np.mgrid[0:1:complex(h), 0:1:complex(w)]
base = np.ones((h, w, 4))
for i, c in enumerate(rgb('ffe1d5')):
    base[:,:,i] = c
blush = np.exp(-(((u-.401)/.038)**2 + ((v-.22)/.085)**2)) + np.exp(-(((u-.599)/.038)**2 + ((v-.22)/.085)**2))
for i, c in enumerate(rgb('ee9fae')):
    base[:,:,i] = base[:,:,i]*(1-blush*.34) + c*blush*.34
texture(FACE, 'face-blush', base)
h = w = 512
v, u = np.mgrid[0:1:complex(h), 0:1:complex(w)]
x, z = (u-.5)*2, (v-.5)*2
r = np.sqrt(x*x+z*z)
a = np.arctan2(z,x)
base = np.ones((h,w,4))
low, high = np.array(rgb('a0d1ff')), np.array(rgb('464b9a'))
grad = np.clip((z+1)/2,0,1)
base[:,:,:3] = low[None,None,:]*(1-grad[:,:,None])+high[None,None,:]*grad[:,:,None]
fibers = (.5+.5*np.sin(a*65+r*9)) * np.clip((r-.28)*2,0,.28)
base[:,:,:3] *= (1-fibers[:,:,None]*.3)
edge = np.clip((r-.78)/.2,0,1)
base[:,:,:3] *= (1-edge[:,:,None]*.55)
pupil = np.exp(-((x/.24)**6+(z/.47)**6))
base[:,:,:3] = base[:,:,:3]*(1-pupil[:,:,None]) + np.array(rgb('313d77'))*pupil[:,:,None]
texture(IRIS, 'iris-blue-violet', base)



h,w=512,1024
v,u=np.mgrid[0:1:complex(h),0:1:complex(w)]
a=u*TAU
fold=np.sin(a*9+.35*np.sin(a*3))+.35*np.sin(a*13+1.2)
shadow=np.clip(-fold,0,1.3)*(1-v*.5)*.13 + .025*np.sin(a*24+.7*np.sin(a*5))**4
base=np.ones((h,w,4))
for i,(light,dark) in enumerate(zip(rgb('fffaff'),rgb('a99ac5'))):
    base[:,:,i]=light*(1-shadow)+dark*shadow
texture(FABRIC,'fabric-soft-folds',base)


def mesh(name, verts, faces, mat, uv=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    CHAR.objects.link(obj)
    if mat:
        data.materials.append(mat)
    for p in data.polygons:
        p.use_smooth = True
    if uv:
        layer = data.uv_layers.new(name='UVMap')
        for p in data.polygons:
            coords = [uv[data.loops[i].vertex_index] for i in p.loop_indices]
            wrap = max(c[0] for c in coords)-min(c[0] for c in coords) > .8
            for i, c in zip(p.loop_indices, coords):
                layer.data[i].uv = (c[0]+(1 if wrap and c[0]<.2 else 0),c[1])
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0000001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    return obj


def subdiv(obj, level=1, apply=False):
    m = obj.modifiers.new('Silhouette subdivision', 'SUBSURF')
    m.levels = m.render_levels = level
    if apply:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)


def solid(obj, thickness=.0015):
    m = obj.modifiers.new('Fabric thickness', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = 0


def sphere(name, loc, scale, mat, seg=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    move_collection(obj)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def catmull(points, count):
    p = [np.array(q, dtype=float) for q in points]
    out=[]
    for t in np.linspace(0,len(p)-1,count):
        i = min(int(t),len(p)-2)
        f = t-i
        a,b,c,d = p[max(i-1,0)],p[i],p[i+1],p[min(i+2,len(p)-1)]
        out.append(.5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f))
    return np.array(out)


def tube(name, points, radii, mat, count=28, sides=16, flatten=1, normal=(0,-1,0)):
    path = catmull(points,count)
    rr = np.interp(np.linspace(0,1,count),np.linspace(0,1,len(radii)),radii)
    verts=[];faces=[];uv=[]
    for j,c in enumerate(path):
        tangent=path[min(j+1,count-1)]-path[max(j-1,0)]
        tangent/=np.linalg.norm(tangent)
        n=np.array(normal,dtype=float)
        n-=tangent*np.dot(n,tangent)
        n/=np.linalg.norm(n)
        cross=np.cross(tangent,n)
        for k in range(sides):
            t=TAU*k/sides
            verts.append(c+rr[j]*(cross*np.cos(t)+n*np.sin(t)*flatten))
            uv.append((k/sides,j/(count-1)))
    for j in range(count-1):
        for k in range(sides):
            n=(k+1)%sides
            faces.append((j*sides+k,j*sides+n,(j+1)*sides+n,(j+1)*sides+k))
    faces.extend([tuple(reversed(range(sides))),tuple((count-1)*sides+k for k in range(sides))])
    return mesh(name,verts,faces,mat,uv)


def curve(name, points, radius, mat):
    return tube(name,points,[radius]*len(points),mat,count=max(12,len(points)*5),sides=8)


def loft(name, sections, sides, mat):
    verts=[];faces=[];uv=[]
    profiles = catmull(sections,max(len(sections)*3,30))
    for j,(z,rx,ry,cy) in enumerate(profiles):
        rx=max(rx,.001);ry=max(ry,.001)
        for k in range(sides):
            t=TAU*k/sides
            verts.append((rx*math.sin(t),cy-ry*math.cos(t),z))
            uv.append((k/sides,j/(len(profiles)-1)))
    for j in range(len(profiles)-1):
        for k in range(sides):
            n=(k+1)%sides
            faces.append((j*sides+k,j*sides+n,(j+1)*sides+n,(j+1)*sides+k))
    faces.extend([tuple(reversed(range(sides))),tuple((len(profiles)-1)*sides+k for k in range(sides))])
    return mesh(name,verts,faces,mat,uv)


# Join and voxel-unify the anatomical construction before deforming or exporting.
body_parts=[]
body_parts.append(loft('Body construction · torso',[(.73,.054,.041,0),(.77,.086,.052,0),(.82,.092,.056,.004),(.9,.072,.044,0),(.97,.075,.045,0),(1.035,.094,.051,-.002),(1.082,.102,.045,0),(1.107,.091,.036,0),(1.13,.036,.027,0),(1.18,.028,.025,0)],48,SKIN))
arm_points={};finger_points={};leg_points={}
for sign,side in [(1,'L'),(-1,'R')]:
    arm=[(sign*.098,0,1.10),(sign*.135,0,1.083),(sign*.177,-.002,1.01),(sign*.211,-.005,.947),(sign*.251,-.01,.876),(sign*.288,-.012,.808)]
    arm_points[side]=arm
    body_parts.append(tube('Arm construction '+side,arm,[.031,.032,.025,.022,.02,.014],SKIN,44,24))
    wrist=np.array(arm[-1]);direction=np.array([sign*.49,0,-.872]);cross=np.array([sign*.872,0,.49])
    palm=wrist+direction*.031
    obj=sphere('Palm construction '+side,palm,(.024,.012,.036),SKIN)
    obj.rotation_euler[1]=sign*math.radians(-29)
    body_parts.append(obj)
    for i,(digit,offset,length) in enumerate([('Index',-.016,.048),('Middle',-.005,.055),('Ring',.006,.051),('Little',.017,.040)]):
        base=wrist+direction*.052+cross*offset
        tip=base+direction*length+cross*(offset*.16)+np.array([0,-.004,0])
        pts=[base,base+(tip-base)*.33,base+(tip-base)*.68,tip]
        finger_points[(side,digit)]=pts
        body_parts.append(tube(digit+' construction '+side,pts,[.0055,.0049,.0042,.0017],SKIN,20,12))
    thumb=wrist+direction*.018-cross*.022
    tip=thumb+direction*.032-cross*.026+np.array([0,-.003,0])
    finger_points[(side,'Thumb')]=[thumb,thumb+(tip-thumb)*.33,thumb+(tip-thumb)*.67,tip]
    body_parts.append(tube('Thumb construction '+side,finger_points[(side,'Thumb')],[.008,.007,.005,.002],SKIN,20,12))
    leg=[(sign*.055,0,.79),(sign*.063,0,.714),(sign*.067,-.004,.58),(sign*.067,-.008,.435),(sign*.066,.008,.34),(sign*.064,.008,.25),(sign*.06,0,.054)]
    leg_points[side]=leg
    body_parts.append(tube('Leg construction '+side,leg,[.044,.049,.041,.029,.035,.03,.017],SKIN,52,32,flatten=1.03))
    foot=tube('Foot construction '+side,[(sign*.06,.026,.035),(sign*.06,-.015,.038),(sign*.06,-.060,.024),(sign*.06,-.09,.020)],[.017,.026,.027,.023],SKIN,32,24,flatten=.65,normal=(0,0,1))
    body_parts.append(foot)
    body_parts.append(sphere('Heel construction '+side,(sign*.06,.009,.039),(.022,.028,.031),SKIN))
    for j in range(5):
        xx=sign*(.037+j*.012)
        length=.022-j*.002
        cy=-.095+(j*.004)
        body_parts.append(sphere('Toe construction '+side+str(j),(xx,cy,.022),(.007-j*.0006,length,.010-j*.0007),SKIN,20,12))

bpy.ops.object.select_all(action='DESELECT')
for obj in body_parts: obj.select_set(True)
bpy.context.view_layer.objects.active=body_parts[0]
bpy.ops.object.join()
body=bpy.context.object
body.name='Body · continuous skin'
mod=body.modifiers.new('Continuous anatomy voxel union','REMESH');mod.mode='VOXEL';mod.voxel_size=.0025;mod.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=body.modifiers.new('Anatomy relaxation','SMOOTH');mod.factor=.5;mod.iterations=5
bpy.ops.object.modifier_apply(modifier=mod.name)
body['topology']='Continuous voxel-retopologized body, editable surface; joint loops need manual refinement for extreme poses'
# Explicit UV unwrap is retained even for the constant skin material.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.1519,island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')

lining=body.copy();lining.data=body.data.copy();CHAR.objects.link(lining);lining.name='Body.Lining · concealed cotton shorts'
bm=bmesh.new();bm.from_mesh(lining.data)
bmesh.ops.delete(bm,geom=[f for f in bm.faces if not (.71<f.calc_center_median().z<.855 and abs(f.calc_center_median().x)<.13)],context='FACES')
bm.to_mesh(lining.data);bm.free();lining.data.materials.clear();lining.data.materials.append(FABRIC)
solid(lining,.002)

head_sections=[(1.173,.008,.014,-.034),(1.184,.035,.037,-.023),(1.202,.061,.054,-.01),(1.224,.080,.066,-.003),(1.251,.092,.075,0),(1.283,.098,.082,.002),(1.32,.099,.087,.005),(1.355,.088,.081,.007),(1.388,.068,.065,.008),(1.408,.037,.039,.008),(1.416,.001,.002,.008)]
profiles=catmull(head_sections,70)
verts=[];faces=[];uv=[]
for j,(z,rx,ry,cy) in enumerate(profiles):
    for k in range(96):
        t=-PI+TAU*k/96
        x=rx*math.sin(t)
        c=math.cos(t)
        y=cy-ry*(max(c,0)**.52 if c>0 else c)
        if c>0:
            nose=.012*math.exp(-((x/.013)**2+((z-1.236)/.016)**2))
            bridge=.003*math.exp(-((x/.011)**2+((z-1.257)/.027)**2))
            y-=nose+bridge
            y+=.004*math.exp(-(((abs(x)-.045)/.026)**4+((z-1.266)/.022)**4))
        verts.append((x,y,z));uv.append((k/96,(z-1.173)/.243))
for j in range(len(profiles)-1):
    for k in range(96):
        n=(k+1)%96;faces.append((j*96+k,j*96+n,(j+1)*96+n,(j+1)*96+k))
faces.extend([tuple(reversed(range(96))),tuple((len(profiles)-1)*96+k for k in range(96))])
head=mesh('Face · shaped quad head',verts,faces,FACE,uv)
for sign,side in [(1,'L'),(-1,'R')]:
    cutter_v=[];cutter_f=[]
    for yy in [-.14,-.049]:
        for k in range(64):
            a=TAU*k/64
            cutter_v.append((sign*.044+.028*math.cos(a),yy,1.264+(.0135 if math.sin(a)>0 else .0115)*math.sin(a)))
    for k in range(64):
        n=(k+1)%64;cutter_f.append((k,n,64+n,64+k))
    cutter_f.extend([tuple(reversed(range(64))),tuple(64+k for k in range(64))])
    cutter=mesh('Eye aperture cutter',cutter_v,cutter_f,None)
    bpy.context.view_layer.objects.active=head
    mod=head.modifiers.new('Recessed eye aperture','BOOLEAN');mod.object=cutter;mod.operation='DIFFERENCE'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
head.shape_key_add(name='Basis', from_mix=False);head.shape_key_add(name='Neutral', from_mix=False)
smile=head.shape_key_add(name='Smile', from_mix=False)
for p in smile.data:
    x,y,z=p.co
    if y<-.025:
        amount=math.exp(-(((abs(x)-.018)/.020)**2+((z-1.214)/.015)**2))
        p.co.z+=.004*amount;p.co.y-=.0015*amount
opened=head.shape_key_add(name='MouthOpen', from_mix=False)
for p in opened.data:
    x,y,z=p.co
    amount=math.exp(-((x/.027)**4+((z-1.205)/.021)**4)) if y<-.02 else 0
    p.co.z-=.008*amount
for sign,side in [(1,'L'),(-1,'R')]:
    ear=sphere('Ear.'+side,(sign*.091,-.001,1.246),(.014,.011,.023),SKIN)
    sphere('Ear concha.'+side,(sign*.100,-.008,1.246),(.005,.003,.012),LIP)

face_objects=[];eye_objects={};lid_objects=[]
def face_y(x,z):
    rx=np.interp(z,profiles[:,0],profiles[:,1]);ry=np.interp(z,profiles[:,0],profiles[:,2]);cy=np.interp(z,profiles[:,0],profiles[:,3])
    c=math.sqrt(max(.001,1-(x/rx)**2))
    return cy-ry*c**.52-.012*math.exp(-((x/.013)**2+((z-1.236)/.016)**2))-.003*math.exp(-((x/.011)**2+((z-1.257)/.027)**2))+.004*math.exp(-(((abs(x)-.045)/.026)**4+((z-1.266)/.022)**4))

for sign,side in [(1,'L'),(-1,'R')]:
    cx=sign*.044;cz=1.264;cy=-.052
    eye=sphere('Eye globe.'+side,(cx,cy,cz),(.030,.024,.022),WHITE,48,32)
    eye_objects[side]=[eye]
    # A curved iris is mapped onto the anterior spherical surface, with real depth.
    vv=[];ff=[];uvv=[]
    for j in range(13):
        rr=j/12
        for k in range(64):
            a=TAU*k/64
            xx=.0140*rr*math.cos(a);zz=.0170*rr*math.sin(a)
            yy=cy-.024*math.sqrt(max(.01,1-(xx/.030)**2-(zz/.022)**2))-.0005
            vv.append((cx+xx,yy,cz+zz));uvv.append((.5+.5*rr*math.cos(a),.5+.5*rr*math.sin(a)))
    for j in range(12):
        for k in range(64):
            n=(k+1)%64;ff.append((j*64+k,j*64+n,(j+1)*64+n,(j+1)*64+k))
    iris=mesh('Iris curved surface.'+side,vv,ff,IRIS,uvv);eye_objects[side].append(iris)
    for dx,dz,sz in [(-.0055,.007,.0041),(.005,-.007,.0017)]:
        hi=sphere('Eye catchlight.'+side,(cx+dx,-.077,cz+dz),(sz,.0011,sz*1.12),HIGHLIGHT,20,12)
        eye_objects[side].append(hi)
    upper=[];lower=[];rim=[];brow=[]
    for t in np.linspace(0,1,15):
        xlocal=-.029+.058*t
        top=.0135*math.sin(PI*t)**.75+.002*(t-.5)
        bottom=-.0115*math.sin(PI*t)**.85+.002*(t-.5)
        y=face_y(cx+sign*xlocal,cz+top)-.0012
        upper.append((cx+sign*xlocal,y,cz+top))
        lower.append((cx+sign*xlocal,face_y(cx+sign*xlocal,cz+bottom)-.0005,cz+bottom))
        brow.append((cx+sign*xlocal*.88,-.074,cz+.036+.004*math.sin(PI*t)))
    eyelash=tube('Upper eyelash.'+side,upper,[.0005,.0015,.002,.0025,.0014],INK,40,8,flatten=.6)
    lid_objects.append((eyelash,cz,1))
    lowerline=tube('Lower eyelid.'+side,lower,[.0004,.00065,.0006,.00065,.0005],LIP,36,8,flatten=.6)
    lid_objects.append((lowerline,cz,-1))
    rim=[(x,y+.001,z+.0013) for x,y,z in upper]
    lid=curve('Upper skin lid.'+side,rim,.0013,SKIN);lid_objects.append((lid,cz,1))
    curve('Eyebrow.'+side,brow,.0011,material('Brow tint.'+side,'8b8fae',.9))
    for j in range(3):
        p=Vector(upper[-2-j]);tip=p+Vector((sign*(.006-j*.001),.001,.003+j*.0005))
        lash=tube('Lash tip.'+side+str(j),[p,p.lerp(tip,.5),tip],[.0014,.0009,.0001],INK,8,6)
        lid_objects.append((lash,cz,1))
    for obj in eye_objects[side]:
        obj.shape_key_add(name='Basis', from_mix=False);key=obj.shape_key_add(name='Blink', from_mix=False)
        for p in key.data:
            world=obj.matrix_world@p.co
            world.z=cz+(world.z-cz)*.035
            p.co=obj.matrix_world.inverted()@world
    for obj,z,upperflag in [i for i in lid_objects if i[0].name.endswith(side) or ('.'+side) in i[0].name]:
        obj.shape_key_add(name='Basis', from_mix=False);key=obj.shape_key_add(name='Blink', from_mix=False)
        for p in key.data: p.co.z=z+.001+(.001*math.cos((p.co.x-cx)/.03*PI/2))


blink_head=head.shape_key_add(name='Blink',from_mix=False)
for p in blink_head.data:
    x,y,z=p.co
    if y<-.045:
        dx=min(abs(x-.044),abs(x+.044));dz=z-1.264
        if dx<.036 and abs(dz)<.042:
            sidefade=max(0,1-(dx/.036)**6)
            vertical=max(0,1-max(0,abs(dz)-.014)/.028)
            p.co.z-=dz*sidefade*vertical*.98

mouth=sphere('Mouth · small open cavity',(0,-.0717,1.211),(.006,.0015,.0028),MOUTH,32,16)
mouth.shape_key_add(name='Basis', from_mix=False);mouth.shape_key_add(name='Neutral', from_mix=False)
key=mouth.shape_key_add(name='MouthOpen', from_mix=False)
for p in key.data:p.co.z*=3.0
key=mouth.shape_key_add(name='Smile', from_mix=False)
for p in key.data:p.co.x*=1.5;p.co.z+=.0012*(p.co.x/.006)**2
curve('Lower lip sheen',[(-.004,-.073,1.2075),(0,-.074,1.207),(.004,-.073,1.2075)],.00065,LIP)

# Closed lenticular ribbons use wide cross sections and tapering thickness, never round rods.
hair_chains={}
def strand(name, controls, widths, depth=.004, normal=(0,-1,0), chain=True):
    path=catmull(controls,40)
    widths=np.interp(np.linspace(0,1,40),np.linspace(0,1,len(widths)),widths)
    verts=[];faces=[];uv=[]
    for j,c in enumerate(path):
        tangent=path[min(j+1,39)]-path[max(j-1,0)];tangent/=np.linalg.norm(tangent)
        normal_v=np.array(normal,float);normal_v-=tangent*np.dot(tangent,normal_v);normal_v/=np.linalg.norm(normal_v)
        cross=np.cross(tangent,normal_v)
        for k in range(12):
            a=TAU*k/12
            width=max(widths[j],.0004)
            thick=depth*min(1,width/.012)
            p=c+cross*(width*math.cos(a))+normal_v*(thick*math.sin(a)*(1+.12*math.cos(a*6)))
            verts.append(p);uv.append((k/12,1-j/39))
    for j in range(39):
        for k in range(12):
            n=(k+1)%12;faces.append((j*12+k,j*12+n,(j+1)*12+n,(j+1)*12+k))
    faces.extend([tuple(reversed(range(12))),tuple(39*12+k for k in range(12))])
    obj=mesh(name,verts,faces,HAIR,uv)
    subdiv(obj,1)
    if chain: hair_chains[name]=path
    return obj

# Scalp shell sits below individual locks to avoid visible root gaps.
verts=[];faces=[];uv=[]
for j in range(22):
    t=j/21
    for k in range(96):
        a=-PI+TAU*k/96
        end=1.28 if math.cos(a)>.35 else 1.205
        zz=1.425*(1-t)+end*t
        fac=math.sqrt(max(.001,1-((zz-1.304)/.122)**2))
        verts.append((.107*fac*math.sin(a),.008-.095*fac*math.cos(a),zz))
        uv.append((k/96,1-t))
for j in range(21):
    for k in range(96):
        n=(k+1)%96;faces.append((j*96+k,j*96+n,(j+1)*96+n,(j+1)*96+k))
cap=mesh('Hair.Scalp · under layered roots',verts,faces,HAIR,uv)
subdiv(cap,1);solid(cap,.001)

# Back hair: overlapping layers, offset roots and irregular S waves.
for layer in range(2):
    count=11 if layer==0 else 8
    for i in range(count):
        q=-1+2*i/(count-1);phase=i*1.39+layer*.71
        startx=q*.040
        tipz=.785+.047*(.5+.5*math.sin(phase)) + layer*.032
        controls=[(startx,.012+layer*.005,1.418-abs(q)*.018),
                  (q*.088,.064+layer*.013,1.345),
                  (q*.104,.083+layer*.017,1.235),
                  (q*.10+.020*math.sin(phase),.137+layer*.019,1.12),
                  (q*.118+.025*math.sin(phase+1),.115+layer*.018,.997),
                  (q*.121+.019*math.sin(phase+3.0),.142+layer*.016,.89),
                  (q*.13+.025*math.sin(phase+4.4),.09+layer*.015,tipz)]
        strand(f'Hair.Back.{layer}.{i:02d}',controls,[.006,.022,.024,.022,.021,.015,.0005],.005,normal=(0,1,0))
# Side cascades frame the face and leave the arms free.
for sign,side in [(1,'L'),(-1,'R')]:
    for i in range(4):
        d=i*.010
        controls=[(sign*.06,.007,1.394),(sign*(.10+d*.3),-.01+i*.008,1.31),
                  (sign*(.105+d),-.015+i*.012,1.20),(sign*(.145+d*.7),-.010+i*.013,1.105+i*.009),
                  (sign*(.102+d),-.033+i*.014,1.015-i*.008),(sign*(.153+d*.5),-.006+i*.013,.924+i*.01),
                  (sign*(.131+d*.5),.004+i*.014,.86+i*.013)]
        strand(f'Hair.Side.{side}.{i}',controls,[.005,.020,.019,.021,.019,.014,.0005],.0042,normal=(sign*.6,-.8,0))
    strand('Hair.Cheek.'+side,[(sign*.082,-.046,1.344),(sign*.094,-.060,1.26),(sign*.085,-.065,1.18),(sign*.106,-.072,1.10),(sign*.096,-.072,1.043)],[.011,.015,.012,.009,.0003],.003)
# Temple locks bridge the forehead and side cascades without an exposed scalp strip.
for sign,side in [(1,'L'),(-1,'R')]:
    for i in range(4):
        angle=.70+i*.31
        pts=[]
        for polar in [.12,.60,1.05,1.52]:
            pts.append((sign*.111*math.sin(polar)*math.sin(angle),.008-.101*math.sin(polar)*math.cos(angle),1.304+.126*math.cos(polar)))
        pts.extend([(sign*(.115*math.sin(angle)+.007),.006-.095*math.cos(angle),1.23),(sign*(.108*math.sin(angle)+.011),-.008-.094*math.cos(angle),1.18+i*.007)])
        strand(f'Hair.Temple.{side}.{i}',pts,[.007,.021,.023,.021,.017,.0004],.0048,normal=(sign*math.sin(angle),-math.cos(angle),0),chain=False)

# Crown and bangs part slightly off centre with nonuniform tips.
bangs=[(-.075,-.083,1.258,.020),(-.047,-.062,1.275,.022),(-.022,-.035,1.253,.025),(.006,.003,1.291,.020),(.028,.034,1.275,.021),(.052,.064,1.257,.020),(.076,.091,1.241,.019)]
for i,(rootx,endx,endz,width) in enumerate(bangs):
    controls=[(rootx*.42,-.020,1.417-abs(rootx)*.22),(rootx*.85,-.070,1.373),(rootx,-.087,1.322),(endx,-.089,endz)]
    strand(f'Hair.Bangs.{i:02d}',controls,[.014,width*.9,width,.0004],.0042,chain=False)

# Keep each upper lock outside the scalp ellipsoid while preserving its sculpted section.
for layer_index,obj in enumerate([o for o in CHAR.objects if o.name.startswith('Hair.') and o!=cap]):
    for j in range(40):
        group=[obj.data.vertices[j*12+k] for k in range(12)]
        center=np.array([v.co[:] for v in group]).mean(0)
        if center[2]<1.27:continue
        p=center-np.array([0,.008,1.304])
        length=math.sqrt((p[0]/.107)**2+(p[1]/.095)**2+(p[2]/.122)**2)
        target=1.075+(layer_index%7)*.003
        if length<target:
            shift=p*(target/max(length,.001)-1)
            for vert in group:vert.co=Vector(vert.co)+Vector(shift)

# Dress shells are separately editable quad surfaces with real thickness.
def dress_surface(name,z_top,z_bottom,rx_top,rx_bottom,ry_top,ry_bottom,amp_top,amp_bottom,ruffle=False,phase=0):
    verts=[];faces=[];uv=[];nr=16 if ruffle else 36;ns=144
    for j in range(nr):
        v=j/(nr-1)
        for k in range(ns):
            a=TAU*k/ns
            broad=math.sin(a*9+.35*math.sin(a*3)+phase)+.35*math.sin(a*13+1.2)
            small=math.sin(a*24+.7*math.sin(a*5)+phase)
            amplitude=amp_top*(1-v)+amp_bottom*v
            ripple=amplitude*(broad*.65+small*(.7 if ruffle else .16))
            rx=rx_top+(rx_bottom-rx_top)*(v**.83)+ripple
            ry=ry_top+(ry_bottom-ry_top)*(v**.83)+ripple*.75
            z=z_top+(z_bottom-z_top)*v
            if ruffle:z+=.006*v**1.5*math.sin(a*24+.7*math.sin(a*5)+phase)
            else:z+=.003*v*math.sin(a*9+phase)
            verts.append((rx*math.sin(a),-ry*math.cos(a),z));uv.append((k/ns,1-v))
    for j in range(nr-1):
        for k in range(ns):
            n=(k+1)%ns;faces.append((j*ns+k,j*ns+n,(j+1)*ns+n,(j+1)*ns+k))
    obj=mesh(name,verts,faces,FABRIC,uv);subdiv(obj,1);solid(obj,.0013)
    return obj

main_skirt=dress_surface('Dress.Main · flowing panels',.947,.555,.080,.201,.052,.138,.0018,.014)
dress_surface('Dress.Hem.Upper · gathered flounce',.603,.546,.186,.220,.127,.150,.003,.011,True,.2)
dress_surface('Dress.Hem.Lower · gathered flounce',.558,.503,.198,.226,.137,.158,.003,.012,True,1.6)
dress_surface('Dress.Bodice · loose chest overlay',1.067,.973,.092,.106,.054,.066,.0018,.003)
dress_surface('Dress.Neckline · tiny ruffle',1.085,1.054,.091,.097,.054,.059,.002,.0038,True,.4)
dress_surface('Dress.Waist · short peplum',.977,.929,.078,.110,.053,.069,.002,.0055,True,1.4)
for sign,side in [(1,'L'),(-1,'R')]:
    points=[(sign*.071,-.05,1.071),(sign*.076,-.034,1.103),(sign*.078,-.01,1.12),(sign*.077,.017,1.112),(sign*.07,.045,1.074)]
    path=catmull(points,32);verts=[];uv=[];faces=[]
    for j,c in enumerate(path):
        for k in range(3):verts.append(c+np.array([(k-1)*.0025,0,0]));uv.append((k/2,j/31))
    for j in range(31):
        for k in range(2):a=j*3+k;faces.append((a,a+1,a+4,a+3))
    obj=mesh('Dress.Strap.'+side,verts,faces,FABRIC,uv);subdiv(obj,1);solid(obj,.0018)
for z in [1.046,1.023,1.000]:
    sphere('Dress pearl button',(0,-.060-(1.046-z)*.15,z),(.0037,.0022,.0037),HIGHLIGHT,20,12)

# Pinched bow loops are cloth patches, bowed forward and hemmed by their thickness.
for sign,side in [(1,'L'),(-1,'R')]:
    verts=[];faces=[];uv=[]
    for j in range(25):
        t=j/24
        width=.007+.023*math.sin(t*PI*.82)**.8
        for k in range(13):
            v=-1+2*k/12
            x=sign*(.004+.052*t)
            z=.966+v*width+.008*t
            y=-.078-.012*math.sin(PI*t)-.007*(1-v*v)*math.sin(PI*t)+.003*math.cos(v*PI*2)*math.sin(PI*t)
            verts.append((x,y,z));uv.append((t,(v+1)/2))
    for j in range(24):
        for k in range(12):a=j*13+k;faces.append((a,a+1,a+14,a+13))
    obj=mesh('Bow.Loop.'+side,verts,faces,PINK,uv);subdiv(obj,1);solid(obj,.0025)
    controls=[(sign*.009,-.078,.955),(sign*.018,-.085,.929),(sign*.026,-.086,.892),(sign*.038,-.078,.868)]
    path=catmull(controls,24);verts=[];faces=[];uv=[]
    for j,c in enumerate(path):
        t=j/23;ww=.010+.006*t
        for k in range(9):
            v=-1+2*k/8
            p=c+np.array([v*ww,-.003*math.cos(v*PI),.003*math.sin(t*PI*2)*v])
            if j==23:p[2]+=.009*(1-abs(v))
            verts.append(p);uv.append(((v+1)/2,t))
    for j in range(23):
        for k in range(8):a=j*9+k;faces.append((a,a+1,a+10,a+9))
    obj=mesh('Bow.Ribbon.'+side,verts,faces,PINK,uv);subdiv(obj,1);solid(obj,.0018)
sphere('Bow.Knot',(0,-.086,.964),(.010,.009,.012),PINK)

# Render setup is isolated from the export collection.
def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size,color in [('Key',(-2,-3,4),12,1.8,(1,.91,.88)),('Fill',(2,-1,2.5),5,2.4,(.81,.88,1)),('Rim',(0,2,3),15,1.4,(.85,.9,1))]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);STUDIO.objects.link(obj);obj.location=loc;aim(obj,(0,0,.8))
floor_mat=material('Studio · pearl grey','e9eaf2',.85,0)
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object;floor.name='Studio floor';move_collection(floor,STUDIO);floor.location.z=-.001;floor.data.materials.append(floor_mat)
data=bpy.data.cameras.new('Review orthographic');camera=bpy.data.objects.new('Review orthographic',data);STUDIO.objects.link(camera);scene.camera=camera;data.type='ORTHO';data.ortho_scale=1.65
camera.location=(0,-3,.78);aim(camera,(0,0,.72))
scene['reference']='references/board.png; approved sole appearance reference'
scene['delivery_status']='Work in progress: appearance review before rigging'
for obj in CHAR.objects:
    if obj.type=='MESH' and obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:
            if key.name!='Basis': key.value=0
        obj.active_shape_key_index=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'character.blend'))
scene.render.filepath=str(OUT/'renders/front.png');bpy.ops.render.render(write_still=True)
print('BUILD_STAGE_COMPLETE',len(CHAR.objects))
