// Headless Three.js skin/clip regression; material rendering is checked in the browser.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

async function load(path) {
  const raw = await fs.readFile(path), size = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20, 20 + size));
  doc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }]; doc.images = []; doc.textures = [];
  const json = Buffer.from(JSON.stringify(doc)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const binary = raw.subarray(20 + size), buffer = Buffer.alloc(20 + padded.length + binary.length);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); padded.copy(buffer, 20); binary.copy(buffer, 20 + padded.length);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
  let mesh; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  const mixer = new THREE.AnimationMixer(gltf.scene), action = mixer.clipAction(gltf.animations[0]);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const update = () => { gltf.scene.updateMatrixWorld(true); mesh.skeleton.update(); };
  const sample = t => { action.time = t; mixer.update(0); update(); };
  const rest = () => { mixer.stopAllAction(); mesh.skeleton.pose(); update(); };
  return { gltf, mesh, sample, rest, update };
}
const [sourcePath, outputPath, reportPath] = process.argv.slice(2);
assert(sourcePath && outputPath && reportPath);
const source = await load(sourcePath), result = await load(outputPath);
assert.equal(result.mesh.skeleton.bones.length, 115); assert.equal(result.gltf.animations.length, 1);
const bones = new Map(result.mesh.skeleton.bones.map(b => [b.name, b]));
let matrixError = 0, maxVertexChange = 0, finite = true;
const count = source.mesh.geometry.attributes.position.count;
const a = new THREE.Vector3(), b = new THREE.Vector3();
for (let frame = 0; frame <= 238; frame++) {
  source.sample(frame / 48); result.sample(frame / 48);
  for (const bone of source.mesh.skeleton.bones) {
    const other = bones.get(bone.name); assert(other);
    for (let k = 0; k < 16; k++) matrixError = Math.max(matrixError, Math.abs(bone.matrixWorld.elements[k] - other.matrixWorld.elements[k]));
  }
  for (let i = 0; i < count; i += 7) {
    source.mesh.getVertexPosition(i, a); result.mesh.getVertexPosition(i, b);
    finite &&= b.toArray().every(Number.isFinite); maxVertexChange = Math.max(maxVertexChange, a.distanceTo(b));
  }
}
assert(matrixError < 1e-7); assert(finite);
source.rest(); result.rest();
let restError = 0;
for (let i = 0; i < count; i++) { source.mesh.getVertexPosition(i, a); result.mesh.getVertexPosition(i, b); restError = Math.max(restError, a.distanceTo(b)); }
assert(restError < 1e-5);
const controls = {};
for (const prefix of ['Hair_', 'Dress_']) {
  result.rest(); const baseline = [];
  for (let i = 0; i < count; i++) baseline.push(result.mesh.getVertexPosition(i, new THREE.Vector3()));
  const group = result.mesh.skeleton.bones.filter(bone => bone.name.startsWith(prefix));
  const index = result.mesh.geometry.attributes.skinIndex, weight = result.mesh.geometry.attributes.skinWeight;
  for (const bone of group) bone.rotateX(.12);
  result.update(); let affected = 0, maximum = 0, outsideError = 0;
  for (let i = 0; i < count; i++) {
    const distance = result.mesh.getVertexPosition(i, b).distanceTo(baseline[i]);
    const inside = [0, 1, 2, 3].some(k => weight.getComponent(i, k) > 1e-7 && result.mesh.skeleton.bones[index.getComponent(i, k)].name.startsWith(prefix));
    if (inside) { if (distance > 1e-6) affected++; maximum = Math.max(maximum, distance); }
    else outsideError = Math.max(outsideError, distance);
  }
  assert(affected > 1000); assert(outsideError < 1e-7);
  controls[prefix] = { bones: group.length, affectedVertices: affected, maximumDisplacement: maximum, outsideRegionError: outsideError };
}
const report = { bodyMatrixMaxError: matrixError, samples: 239, finite, restSurfaceMaxError: restError,
  animatedSurfaceMaxChange: maxVertexChange, controls, notes: 'Surface change is expected after replacing skirt/hair weights; not a collision clearance guarantee.' };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
