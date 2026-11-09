import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const validator = await import(process.env.GLTF_VALIDATOR_MODULE || 'gltf-validator');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function load(name) {
  const bytes = await fs.readFile('public/models/resident/' + name + '.glb');
  const jsonSize = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const binary = bytes.subarray(28 + jsonSize);
  const view = i => {
    const entry = doc.bufferViews[i], start = entry.byteOffset ?? 0;
    return binary.subarray(start, start + entry.byteLength);
  };
  return { bytes, doc, view };
}

const baseline = await load('luna-tripo-dynamics');
const current = await load('luna-tripo-transitions');
const old = baseline.doc, model = current.doc;
const skinJoints = doc => doc.skins[0].joints.map(index => doc.nodes[index].name);
const imageHashes = data => data.doc.images.map(image => sha256(data.view(image.bufferView))).sort();
assert.equal(model.skins.length, 1);
assert.equal(model.skins[0].joints.length, 103);
assert.deepEqual(skinJoints(model), skinJoints(old));
assert.deepEqual(imageHashes(current), imageHashes(baseline));
assert.equal(model.images.length, 3);
assert.equal(model.meshes.length, 1);
assert.equal(model.meshes[0].primitives.length, 1);
const geometry = model.meshes[0].primitives[0];
assert.equal(model.accessors[geometry.indices].count / 3, 18659);
assert.equal(geometry.targets.length, 15);
assert.deepEqual(model.animations.map(a => a.name), ['Walk', 'ArmsUp', 'Sit', 'LieDown', 'SitCycle', 'LieCycle']);
assert.ok(model.animations.every(a => a.channels.some(channel => channel.target.path === 'weights')));
const validateBytes = validator.validateBytes ?? validator.default.validateBytes;
const result = await validateBytes(new Uint8Array(current.bytes), { uri: 'luna-tripo-transitions.glb', maxIssues: 100 });
assert.equal(result.issues.numErrors, 0);
const report = { ...result, sha256: sha256(current.bytes), bones: 103, triangles: 18659, morphTargets: 15,
  embeddedImagesByteIdentical: true, bytes: current.bytes.length };
await fs.writeFile('art/resident/tripo-transitions/gltf-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ errors: result.issues.numErrors, warnings: result.issues.numWarnings, bytes: report.bytes,
  warningCodes: result.issues.messages.filter(m => m.severity === 1).map(m => m.code) }));
