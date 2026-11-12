"""Rewrite embedded images in-place; preserve all glTF mesh/node/accessor data.
Blender's exporter can reuse packed JPEG originals even after Image.scale().
This final binary packing stage verifies the bytes actually shipped to browsers.
"""
import bpy,json,struct,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
WORK=ROOT/'art/model-replacement/generated/packing';WORK.mkdir(parents=True,exist_ok=True)
for path in sorted((ROOT/'public/models/replaced').glob('*.glb')):
    data=path.read_bytes();jlen=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+jlen]);start=20+jlen
    blen=struct.unpack_from('<I',data,start)[0];binary=data[start+8:start+8+blen]
    replacements={}
    for i,img in enumerate(doc.get('images',[])):
        vi=img['bufferView'];view=doc['bufferViews'][vi]
        suffix='.png' if img.get('mimeType')=='image/png' else '.jpg'
        source=WORK/(path.stem+'-'+str(i)+suffix)
        source.write_bytes(binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])
        image=bpy.data.images.load(str(source),check_existing=False)
        budget=1024 if any(t in img.get('name','').lower() for t in ['normal','_rm','rough','metal']) else 2048
        size=list(image.size)
        if max(size)<=budget:
            bpy.data.images.remove(image)
            continue
        if max(size)>budget:
            scale=budget/max(size);image.scale(round(size[0]*scale),round(size[1]*scale))
        dest=WORK/(path.stem+'-'+str(i)+'-packed.jpg')
        image.file_format='JPEG';image.filepath_raw=str(dest);image.save()
        replacements[vi]=dest.read_bytes();img['mimeType']='image/jpeg'
        bpy.data.images.remove(image)
    out=bytearray()
    for i,view in enumerate(doc['bufferViews']):
        content=replacements.get(i,binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])
        out.extend(b'\0'*(-len(out)%4));view['byteOffset']=len(out);view['byteLength']=len(content);out.extend(content)
    out.extend(b'\0'*(-len(out)%4));doc['buffers'][0]['byteLength']=len(out)
    text=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();text+=b' '*(-len(text)%4)
    path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(text)+len(out))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(out),0x004e4942)+out)
    print('PACKED',path.name,path.stat().st_size,flush=True)
