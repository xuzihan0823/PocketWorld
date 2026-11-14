from pathlib import Path
import hashlib
import json
import struct
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
report={}
for name in ['luna-rigged.glb','luna-bunny.glb']:
    path=ROOT/'public/models/resident'/name
    blob=path.read_bytes()
    assert blob[:4]==b'glTF'
    length=struct.unpack_from('<I',blob,12)[0]
    document=json.loads(blob[20:20+length])
    binary=blob[28+length:]
    def accessor(index):
        item=document['accessors'][index]
        view=document['bufferViews'][item['bufferView']]
        dtype={5126:'<f4',5123:'<u2',5121:'u1',5125:'<u4'}[item['componentType']]
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[item['type']]
        assert 'byteStride' not in view
        return np.frombuffer(binary,dtype=dtype,count=item['count']*width,
                             offset=view.get('byteOffset',0)+item.get('byteOffset',0)).reshape(-1,width)
    assert len(document['scenes'])==1
    assert all('uri' not in image for image in document.get('images',[]))
    names=[node.get('name','') for node in document['nodes']]
    assert 'Cube' not in names
    vertices=0
    weight_error=0
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            attributes=primitive['attributes']
            positions=accessor(attributes['POSITION'])
            assert np.isfinite(positions).all()
            vertices+=len(positions)
            if 'WEIGHTS_0' in attributes:
                weights=accessor(attributes['WEIGHTS_0'])
                assert weights.shape[1]==4 and np.isfinite(weights).all()
                assert (weights>=0).all()
                weight_error=max(weight_error,float(abs(weights.sum(1)-1).max()))
                assert weight_error<1e-5
                assert accessor(attributes['JOINTS_0']).max()<87
    if name=='luna-rigged.glb':
        assert len(document['skins'])==1 and len(document['skins'][0]['joints'])==87
        assert [a['name'] for a in document['animations']]==['Rig_Check']
        fingers=[n for n in names if n.split('.')[0] in ['thumb','index','middle','ring','pinky']]
        assert len(fingers)==30
        for animation in document['animations']:
            for sampler in animation['samplers']:
                assert np.isfinite(accessor(sampler['output'])).all()
    else:
        assert not document.get('skins') and not document.get('animations')
    report[name]={'bytes':len(blob),'meshes':len(document['meshes']),
                  'vertices_with_uv_seams':vertices,
                  'joints':len(document.get('skins',[{'joints':[]}])[0]['joints']),
                  'weight_sum_max_error':weight_error,
                  'clips':[a['name'] for a in document.get('animations',[])]}
assert hashlib.sha256((ROOT/'public/models/resident/luna.glb').read_bytes()).hexdigest()=='e34bb73e7935b9520de767e575eb9226a14fa05b15dd56904bf6780de443a4bb'
(ROOT/'art/resident/glb-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
