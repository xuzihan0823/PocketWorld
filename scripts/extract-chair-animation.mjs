// Extract animation buffers verbatim; the supplied source is never rewritten.
// node scripts/extract-chair-animation.mjs <source.glb> <output.glb>
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [source, output] = process.argv.slice(2);
assert(source && output, 'Supply source and output paths');
const raw = await fs.readFile(source);
assert.equal(createHash('sha256').update(raw).digest('hex'), '6a0dd05b9ff9904aa059e05ee09422f875a0372376197fc036a3134b94dc5c0d', 'Expected original sit animation');
const jsonLength = raw.readUInt32LE(12);
const sourceDoc = JSON.parse(raw.subarray(20, 20 + jsonLength));
const binary = raw.subarray(28 + jsonLength);
const animation = structuredClone(sourceDoc.animations[0]);
animation.name = 'ChairSit_Original';
const accessors = [], bufferViews = [], parts = [], mapping = new Map();
let byteLength = 0;
for (const sampler of animation.samplers) for (const key of ['input', 'output']) {
  const old = sampler[key];
  if (!mapping.has(old)) {
    const accessor = structuredClone(sourceDoc.accessors[old]);
    const view = sourceDoc.bufferViews[accessor.bufferView];
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); bytes.copy(padded);
    accessor.bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(view.byteStride ? { byteStride: view.byteStride } : {}) });
    mapping.set(old, accessors.length); accessors.push(accessor); parts.push(padded); byteLength += padded.length;
  }
  sampler[key] = mapping.get(old);
}
const nodes = sourceDoc.nodes.map(({ mesh, skin, camera, ...node }) => node);
const doc = { asset: { version: '2.0', generator: 'PocketWorld original chair motion extraction' }, scene: sourceDoc.scene ?? 0,
  scenes: sourceDoc.scenes, nodes, animations: [animation], accessors, bufferViews, buffers: [{ byteLength }] };
const json = Buffer.from(JSON.stringify(doc));
const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
const result = Buffer.alloc(28 + padded.length + byteLength);
result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
result.writeUInt32LE(padded.length, 12); result.writeUInt32LE(0x4e4f534a, 16); padded.copy(result, 20);
result.writeUInt32LE(byteLength, 20 + padded.length); result.writeUInt32LE(0x004e4942, 24 + padded.length);
Buffer.concat(parts).copy(result, 28 + padded.length);
await fs.writeFile(output, result);
console.log(JSON.stringify({ bytes: result.length, sha256: createHash('sha256').update(result).digest('hex'), tracks: animation.channels.length }));
