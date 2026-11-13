// node scripts/fit-chair-post.mjs <original-optimized-chair.glb> <output.glb>
// Input is rolling-chair.parts.glb from commit f6d26ec (before this task).
// Preserve the cushion/backrest dimensions; shorten only the fixed central post.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [source, output] = process.argv.slice(2);
assert(source && output, 'Supply source and output paths');
const raw = await fs.readFile(source);
assert.equal(createHash('sha256').update(raw).digest('hex'), '79c2c559740d0f7e4ac744420d7879563eb318a1e97fbbceeb79619237253749');
const jsonLength = raw.readUInt32LE(12), doc = JSON.parse(raw.subarray(20, 20 + jsonLength));
const binary = Buffer.from(raw.subarray(28 + jsonLength));
const primitives = doc.meshes.flatMap(mesh => mesh.primitives);
const positions = primitives.map(p => doc.accessors[p.attributes.POSITION]);
const min = [0, 1, 2].map(i => Math.min(...positions.map(a => a.min[i])));
const max = [0, 1, 2].map(i => Math.max(...positions.map(a => a.max[i])));
const scale = [.85, 1.10, .75].map((n, i) => n / (max[i] - min[i]));
const center = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
const postBottom = .11, postTop = .44, shortening = .31;
const postScale = 1 - shortening / (postTop - postBottom);
const offset = (a, i) => (doc.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (doc.bufferViews[a.bufferView].byteStride ?? 12);
for (const primitive of primitives) {
  const position = doc.accessors[primitive.attributes.POSITION], normal = doc.accessors[primitive.attributes.NORMAL];
  assert.equal(position.componentType, 5126); assert.equal(normal.componentType, 5126);
  position.min = [Infinity, Infinity, Infinity]; position.max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.count; i++) {
    const p = offset(position, i), n = offset(normal, i);
    const y = (binary.readFloatLE(p + 4) - center[1]) * scale[1];
    const fitY = y <= postBottom ? y : y < postTop ? postBottom + (y - postBottom) * postScale : y - shortening;
    const slope = y > postBottom && y < postTop ? postScale : 1;
    const fitted = [(binary.readFloatLE(p) - center[0]) * scale[0], fitY, (binary.readFloatLE(p + 8) - center[2]) * scale[2]];
    const direction = [0, 1, 2].map(axis => binary.readFloatLE(n + axis * 4) / scale[axis] / (axis === 1 ? slope : 1));
    const length = Math.hypot(...direction);
    for (let axis = 0; axis < 3; axis++) {
      binary.writeFloatLE(fitted[axis], p + axis * 4);
      binary.writeFloatLE(direction[axis] / length, n + axis * 4);
      position.min[axis] = Math.min(position.min[axis], fitted[axis]);
      position.max[axis] = Math.max(position.max[axis], fitted[axis]);
    }
  }
}
doc.asset.generator = 'PocketWorld fixed-post chair fit';
doc.asset.extras = { fittedSize: [.85, .79, .75], postBottom, postTop, shortening };
const json = Buffer.from(JSON.stringify(doc)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
const result = Buffer.alloc(28 + padded.length + binary.length);
result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
result.writeUInt32LE(padded.length, 12); result.writeUInt32LE(0x4e4f534a, 16); padded.copy(result, 20);
result.writeUInt32LE(binary.length, 20 + padded.length); result.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(result, 28 + padded.length);
await fs.writeFile(output, result);
console.log(JSON.stringify({ bytes: result.length, sha256: createHash('sha256').update(result).digest('hex') }));
