import bpy,json,math,struct
from pathlib import Path
from mathutils import Vector as V,Matrix,Quaternion as Q
ROOT=Path(__file__).resolve().parents[1];S=1.43
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/models/resident/luna-bed-v3.blend'))
s=bpy.context.scene;r=bpy.data.objects['Luna_Retarget']
raw=(ROOT/'assets/public/models/resident/luna-walk-room.glb').read_bytes();doc=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
# Read original glTF rest transforms rather than Blender's automatically chosen bone axes.
mat=lambda a:Matrix([a[i:i+4] for i in range(0,16,4)]).transposed()
parent={child:i for i,node in enumerate(doc['nodes']) for child in node.get('children',[])}
bind={}
def bind_world(i):
 if i in bind:return bind[i]
 node=doc['nodes'][i]
 if 'matrix' in node:local=mat(node['matrix'])
 else:
  q=node.get('rotation',[0,0,0,1])
  local=Matrix.LocRotScale(V(node.get('translation',[0,0,0])),Q((q[3],q[0],q[1],q[2])),V(node.get('scale',[1,1,1])))
 bind[i]=bind_world(parent[i])@local if i in parent else local
 return bind[i]
D={'bind':{n.get('name','').replace(':',''):list(v for col in bind_world(i).transposed() for v in col) for i,n in enumerate(doc['nodes'])}}

C=Matrix.Rotation(math.pi/2,4,'X');Ci=C.inverted()
names={p.name.replace(':',''):p for p in r.pose.bones}
indices=[i for i,n in enumerate(doc['nodes']) if n.get('name','').replace(':','') in names]
index={old:new for new,old in enumerate(indices)};nodes=[]
for i in indices:
 n=doc['nodes'][i];nodes.append({k:v for k,v in n.items() if k in ['name','translation','rotation','scale']})
 nodes[-1]['children']=[index[j] for j in n.get('children',[]) if j in index]
 if not nodes[-1]['children']:del nodes[-1]['children']
parents={c:i for i,n in enumerate(nodes) for c in n.get('children',[])}
roots=[i for i in range(len(nodes)) if i not in parents]
# Bone poses in original glTF basis; convert world-authored pelvis to fixed runtime entry.
entry=V((-1.48,0,.73));rootInv=Matrix.Rotation(-math.pi/2,4,'Y')@Matrix.Translation(-entry/S)
samples={i:{'translation':[],'rotation':[]} for i in range(len(nodes))};last={}
landmarks={}
for f in range(223):
 s.frame_set(f);bpy.context.view_layer.update();world={}
 for i,n in enumerate(nodes):
  key=n['name'].replace(':','');p=names[key]
  world[i]=Ci@p.matrix@p.bone.matrix_local.inverted()@C@mat(D['bind'][key])
 for i,n in enumerate(nodes):
  m=world[parents[i]].inverted()@world[i] if i in parents else rootInv@world[i]
  q=m.to_quaternion()
  if i in last and q.dot(last[i])<0:q.negate()
  last[i]=q.copy();samples[i]['translation'].extend(m.translation);samples[i]['rotation'].extend([q.x,q.y,q.z,q.w])
 if f in [0,15,26,37,48,61,79,95,141,192,222]:
  landmarks[f]={n:list(r.matrix_world@r.pose.bones['mixamorig:'+n].head) for n in ['Hips','LeftFoot','RightFoot','LeftToeBase','RightToeBase','Head']}
binary=bytearray();views=[];access=[]
def add(values,kind):
 offset=len(binary);binary.extend(struct.pack('<'+'f'*len(values),*values));width={'SCALAR':1,'VEC3':3,'VEC4':4}[kind]
 views.append({'buffer':0,'byteOffset':offset,'byteLength':len(values)*4})
 a={'bufferView':len(views)-1,'componentType':5126,'count':len(values)//width,'type':kind}
 if kind=='SCALAR':a.update(min=[min(values)],max=[max(values)])
 access.append(a);return len(access)-1
time=add([f/24 for f in range(223)],'SCALAR');samplers=[];channels=[]
for i in range(len(nodes)):
 for prop,kind in [('translation','VEC3'),('rotation','VEC4')]:
  out=add(samples[i][prop],kind);samplers.append({'input':time,'output':out,'interpolation':'LINEAR'});channels.append({'sampler':len(samplers)-1,'target':{'node':i,'path':prop}})
result={'asset':{'version':'2.0','generator':'PocketWorld Blender V3 bone-only bake'},'scene':0,'scenes':[{'nodes':roots}],'nodes':nodes,'animations':[{'name':'Luna_Bed_V3_DirectSeat','samplers':samplers,'channels':channels}],'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':access}
js=json.dumps(result,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
out=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
path=ROOT/'assets/public/models/resident/luna-bed-v3.glb';path.write_bytes(out)

print('EXPORTED',len(out),len(nodes),len(channels),flush=True)

