import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Test the exported skin and interpolated clips, including half-frames between
// Blender's 30 fps keys. No browser-only pose correction participates here.
async function load(file) {
  const bytes = await fs.readFile(file), size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  doc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
  doc.images = []; doc.textures = [];
  const raw = Buffer.from(JSON.stringify(doc));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bin = bytes.subarray(20 + size), buffer = Buffer.alloc(20 + json.length + bin.length);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(json.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16);
  json.copy(buffer, 20); bin.copy(buffer, 20 + json.length);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
  let mesh; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const bone = name => mesh.skeleton.bones.find(b => b.name.replace(/[^\w]/g, '') === 'mixamorig' + name);
  function select(name) {
    mixer.stopAllAction(); mesh.skeleton.pose();
    const action = mixer.clipAction(gltf.animations.find(a => a.name === name));
    action.reset().setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    return time => { action.time = time; mixer.update(0); gltf.scene.updateMatrixWorld(true); mesh.skeleton.update(); };
  }
  return { gltf, mesh, bone, select, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function audit(model) {
  const points = ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'].map(model.bone);
  assert.ok(points.every(Boolean)); assert.equal(model.mesh.skeleton.bones.length, 103);
  model.select('SitCycle')(2.1);
  const anchors = points.map(b => b.getWorldPosition(new THREE.Vector3()));
  const orientations = points.map(b => b.getWorldQuaternion(new THREE.Quaternion()));
  const position = model.mesh.geometry.attributes.position;
  const p = new THREE.Vector3();
  const soles = [];
  for (let i = 0; i < position.count; i++) {
    model.mesh.getVertexPosition(i, p); model.mesh.localToWorld(p);
    // Only the actual underside near the floor, not the deforming ankle/heel top.
    if (p.y < .005) soles.push({ index: i, anchor: p.clone() });
  }
  assert.ok(soles.length > 100, 'The sole region must contain real surface samples');
  const result = {};
  for (const [clip, seconds] of [['SitCycle', 9], ['LieCycle', 13]]) {
    const pose = model.select(clip);
    let maxDrift = 0, maxSoleDrift = 0, maxAngle = 0, maxStep = 0, samples = 0;
    let floorMin = Infinity, floorMax = -Infinity, previous, maxDriftTime = 0;
    const intervals = clip === 'SitCycle' ? [[2.1, 9]] : [[0, 2.9], [9.9, 13]];
    for (let frame = 0; frame <= seconds * 60; frame++) {
      const time = frame / 60; pose(time);
      const feet = points.map(b => b.getWorldPosition(new THREE.Vector3()));
      assert.ok(feet.every(v => v.toArray().every(Number.isFinite)));
      if (previous) maxStep = Math.max(maxStep, ...feet.map((v, i) => v.distanceTo(previous[i])));
      previous = feet;
      if (!intervals.some(([start, end]) => time >= start && time <= end)) continue;
      samples++;
      const drift = Math.max(...feet.map((v, i) => v.distanceTo(anchors[i])));
      if (drift > maxDrift) { maxDrift = drift; maxDriftTime = time; }
      maxAngle = Math.max(maxAngle, ...points.map((b, i) => b.getWorldQuaternion(new THREE.Quaternion()).angleTo(orientations[i])));
      let minHeight = Infinity;
      for (const { index, anchor } of soles) {
        model.mesh.getVertexPosition(index, p); model.mesh.localToWorld(p);
        maxSoleDrift = Math.max(maxSoleDrift, p.distanceTo(anchor));
        minHeight = Math.min(minHeight, p.y);
      }
      floorMin = Math.min(floorMin, minHeight); floorMax = Math.max(floorMax, minHeight);
    }
    result[clip] = { samples, supportIntervals: intervals, maxAnkleAndToeDrift: maxDrift,
      maxDriftTime, maxSoleVertexDrift: maxSoleDrift, maxFootRotationRadians: maxAngle,
      maxFrameStep: maxStep, soleMinHeightRange: [floorMin, floorMax], soleVertices: soles.length };
  }
  return result;
}

const current = await load('public/models/resident/luna-tripo-transitions.glb');
for (const [name, duration] of [['SitCycle', 9], ['LieCycle', 13]]) {
  const clip = current.gltf.animations.find(a => a.name === name);
  assert.ok(Math.abs(clip.duration - duration) < 1e-5);
  for (const track of clip.tracks) assert.ok(Math.abs(track.times[0]) < 1e-6, track.name);
}
const after = audit(current);
for (const item of Object.values(after)) {
  assert.ok(item.maxAnkleAndToeDrift < .0005, JSON.stringify(item));
  assert.ok(item.maxSoleVertexDrift < .001, JSON.stringify(item));
  assert.ok(item.maxFootRotationRadians < .001, JSON.stringify(item));
  assert.ok(item.maxFrameStep < .025, JSON.stringify(item));
}
let before, baselineSha256;
if (process.env.BASELINE_GLB) {
  const old = await load(process.env.BASELINE_GLB); before = audit(old); baselineSha256 = old.sha256;
  for (const clip of ['Walk', 'ArmsUp', 'Sit', 'LieDown']) {
    const oldPose = old.select(clip), newPose = current.select(clip);
    for (const time of [.1, .4, .8, 1.1]) {
      oldPose(time); newPose(time);
      for (const b of current.mesh.skeleton.bones) {
        const original = old.mesh.skeleton.bones.find(a => a.name === b.name);
        assert.ok(original, b.name);
        const delta = b.matrixWorld.elements.map((v, i) => Math.abs(v - original.matrixWorld.elements[i]));
        assert.ok(Math.max(...delta) < 1e-6, clip + ':' + b.name);
      }
    }
  }
}
const report = { fps: 60, soleSelectionRestHeight: .005, metric: 'World-space ankle/toe anchors and actual sole vertices during planted intervals. Unit is model units; character height is approximately 0.98.',
  sha256: current.sha256, baselineSha256, before, after, legacyBonePoseSamplesUnchanged: Boolean(before) };
const out = process.env.FOOTPLANT_OUT || 'art/resident/tripo-transitions/footplant-validation.json';
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
