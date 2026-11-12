"""Resize Luna's base color for the room without re-exporting the rig or motion."""
import json
from pathlib import Path
import struct
import subprocess
import sys

source, destination = map(Path, sys.argv[1:])
raw = source.read_bytes()
magic, version, size, json_size, json_type = struct.unpack_from('<5I', raw)
assert (magic, version, size, json_type) == (0x46546C67, 2, len(raw), 0x4E4F534A)
doc = json.loads(raw[20:20 + json_size])
assert len(doc['buffers']) == 1
bin_start = 28 + json_size
texture = doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
image = doc['images'][doc['textures'][texture]['source']]
assert image['mimeType'] == 'image/jpeg'
result = bytearray()
for index, view in enumerate(doc['bufferViews']):
    assert view['buffer'] == 0
    start = bin_start + view.get('byteOffset', 0)
    payload = raw[start:start + view['byteLength']]
    if index == image['bufferView']:
        payload = subprocess.run(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1',
             '-vf', 'scale=2048:2048:flags=lanczos', '-c:v', 'mjpeg', '-q:v', '2',
             '-f', 'image2pipe', 'pipe:1'],
            input=payload, stdout=subprocess.PIPE, check=True,
        ).stdout
        assert payload.startswith(b'\xff\xd8')
    view['byteOffset'], view['byteLength'] = len(result), len(payload)
    result.extend(payload)
    result.extend(b'\0' * (-len(result) % 4))
doc['buffers'][0]['byteLength'] = len(result)
header = json.dumps(doc, ensure_ascii=True, separators=(',', ':')).encode()
header += b' ' * (-len(header) % 4)
destination.write_bytes(struct.pack('<5I', magic, version, 28 + len(header) + len(result),
                                    len(header), json_type)
                        + header + struct.pack('<2I', len(result), 0x004E4942) + result)
