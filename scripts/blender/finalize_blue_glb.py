"""Normalize identity-only GLB scene parents without changing vertex or animation buffers."""
from pathlib import Path
import json
import struct

ROOT=Path(__file__).resolve().parents[2]
FILE=ROOT/'art/characters/blue-haired-girl/character.glb'
raw=FILE.read_bytes()
length,kind=struct.unpack_from('<II',raw,12)
assert kind==0x4e4f534a
model=json.loads(raw[20:20+length])
parents={child:i for i,node in enumerate(model['nodes']) for child in node.get('children',[])}
roots=model['scenes'][model.get('scene',0)]['nodes']
for i,node in enumerate(model['nodes']):
    if 'skin' not in node or i not in parents:continue
    parent=model['nodes'][parents[i]]
    assert parent.get('name')=='CharacterRig'
    assert parent.get('translation',[0,0,0])==[0,0,0]
    assert parent.get('rotation',[0,0,0,1])==[0,0,0,1]
    assert parent.get('scale',[1,1,1])==[1,1,1]
    assert 'matrix' not in parent
    parent['children'].remove(i)
    if i not in roots:roots.append(i)
encoded=json.dumps(model,separators=(',',':'),ensure_ascii=False).encode()
encoded+=b' '*((-len(encoded))%4)
rest=raw[20+length:]
FILE.write_bytes(struct.pack('<III',0x46546c67,2,20+len(encoded)+len(rest))+struct.pack('<II',len(encoded),kind)+encoded+rest)
print('Normalized skinned nodes under the scene root; binary payload unchanged.')
