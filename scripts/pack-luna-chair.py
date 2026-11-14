import json,struct,copy,argparse,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description='Combine the seat export with the existing Walk and compressed textures.')
parser.add_argument('--output',type=Path,required=True,help='The external directory used by bake-luna-chair.py')
parser.add_argument('--original',type=Path,help='Optional original walk GLB; otherwise read the baseline Git object')
parser.add_argument('--base-ref',default='6f6df88')
args=parser.parse_args();OUT=args.output.resolve();REPO=Path(__file__).resolve().parents[1]
def read(p):
 raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];return json.loads(raw[20:20+n]),raw[28+n:]
original_path=args.original
if original_path is None:
 original_path=OUT/'luna-walk-original.glb'
 original_path.write_bytes(subprocess.run(['git','show',args.base_ref+':assets/public/models/resident/luna-walk-room.glb'],cwd=REPO,check=True,capture_output=True).stdout)
original,ob=read(original_path)
doc,db=read(OUT/'luna-seat-runtime.glb')
# Blender exports scene frames 1..68 at times 1/30..68/30. The cache starts at
# frame 1, so rebase every sit sampler to zero before merging the Walk clip.
db=bytearray(db)
for i in {sam['input'] for anim in doc['animations'] for sam in anim['samplers']}:
 a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
 offset=v.get('byteOffset',0)+a.get('byteOffset',0)
 times=struct.unpack_from('<'+str(a['count'])+'f',db,offset);origin=times[0]
 rebased=[t-origin for t in times]
 struct.pack_into('<'+str(a['count'])+'f',db,offset,*rebased)
 a['min']=[min(rebased)];a['max']=[max(rebased)]
# Repack only referenced data; use the exact original compressed texture and Walk samplers.
bins=bytearray();views={};accs={}
def view(src,blob,i,key):
 if (key,i) in views:return views[key,i]
 v=copy.deepcopy(src['bufferViews'][i]);start=v.get('byteOffset',0);data=blob[start:start+v['byteLength']]
 while len(bins)%4:bins.append(0)
 v['byteOffset']=len(bins);v['buffer']=0;bins.extend(data)
 index=len(newviews);newviews.append(v);views[key,i]=index;return index
def accessor(src,blob,i,key):
 if (key,i) in accs:return accs[key,i]
 a=copy.deepcopy(src['accessors'][i])
 if 'bufferView' in a:a['bufferView']=view(src,blob,a['bufferView'],key)
 if 'sparse' in a:
  for t in ['indices','values']:a['sparse'][t]['bufferView']=view(src,blob,a['sparse'][t]['bufferView'],key)
 index=len(newaccs);newaccs.append(a);accs[key,i]=index;return index
newviews=[];newaccs=[]
for mesh in doc['meshes']:
 mesh.pop('extras',None)
 for p in mesh['primitives']:
  p['attributes']={k:accessor(doc,db,v,'new') for k,v in p['attributes'].items()}
  p['indices']=accessor(doc,db,p['indices'],'new');p['material']=0
for skin in doc['skins']:skin['inverseBindMatrices']=accessor(doc,db,skin['inverseBindMatrices'],'new')
for anim in doc['animations']:
 for sam in anim['samplers']:
  for key in ['input','output']:sam[key]=accessor(doc,db,sam[key],'new')
walk=copy.deepcopy(next(a for a in original['animations'] if a['name']=='Walk_Grounded_Loop'))
node_map={n.get('name'):i for i,n in enumerate(doc['nodes'])}
for ch in walk['channels']:ch['target']['node']=node_map[original['nodes'][ch['target']['node']]['name']]
for sam in walk['samplers']:
 for key in ['input','output']:sam[key]=accessor(original,ob,sam[key],'old')
doc['animations'].insert(0,walk)
for name in ['images','textures','samplers','materials']:doc[name]=copy.deepcopy(original.get(name,[]))
for im in doc['images']:
 if 'bufferView' in im:im['bufferView']=view(original,ob,im['bufferView'],'old')
doc['bufferViews']=newviews;doc['accessors']=newaccs
while len(bins)%4:bins.append(0)
doc['buffers']=[{'byteLength':len(bins)}]
doc.pop('extensionsUsed',None);doc.pop('extensionsRequired',None)
for n in doc['nodes']:n.pop('extras',None)
j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
raw=struct.pack('<III',0x46546c67,2,28+len(j)+len(bins))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(bins),0x004e4942)+bins
(OUT/'luna-room-contact.glb').write_bytes(raw)
print('PACKED',len(raw),'original', original_path.stat().st_size,'images',doc['images'])
