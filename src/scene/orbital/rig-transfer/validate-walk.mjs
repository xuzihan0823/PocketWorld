import { load } from './load-for-validation.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const [path, reportPath] = process.argv.slice(2);
const rig = await load(path), clip = rig.gltf.animations[0];
assert.equal(rig.gltf.animations.length, 1);
assert.equal(clip.name, 'Walk_Grounded_Loop');
assert.equal(rig.mesh.skeleton.bones.length, 115);
assert(Math.abs(clip.duration - 1) < 1e-6);
const p = new THREE.Vector3();
let finite = true, seam = 0, minY = Infinity;
const samples = [];
for (let f = 0; f <= 240; f++) {
  rig.sample(f / 240);
  const matrices = rig.mesh.skeleton.bones.map(b => [...b.matrixWorld.elements]);
  for (let i = 0; i < rig.mesh.geometry.attributes.position.count; i++) {
    rig.mesh.getVertexPosition(i, p);
    finite &&= p.toArray().every(Number.isFinite);
    minY = Math.min(minY, p.y);
  }
  samples.push(matrices);
}
for (let b = 0; b < 115; b++) for (let k = 0; k < 16; k++) seam = Math.max(seam, Math.abs(samples[0][b][k] - samples[240][b][k]));
assert(finite); assert(seam < 1e-6); assert(minY > -.0005);
let seamSpeedChange = 0, seamSpeedBone = '';
for (let b = 0; b < 115; b++) for (const k of [12, 13, 14]) {
  const incoming = (samples[240][b][k] - samples[239][b][k]) * 240;
  const outgoing = (samples[1][b][k] - samples[0][b][k]) * 240;
  if (Math.abs(incoming - outgoing) > seamSpeedChange) { seamSpeedChange = Math.abs(incoming - outgoing); seamSpeedBone = rig.mesh.skeleton.bones[b].name; }
}
const report = { clip: clip.name, duration: clip.duration, bones: 115, samples: 241, allVerticesFinite: finite, minSurfaceY: minY, seamMatrixMaxError: seam, maxSeamPositionVelocityComponentChange: seamSpeedChange, seamSpeedBone, bytes: (await fs.stat(path)).size };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); console.log(report);
