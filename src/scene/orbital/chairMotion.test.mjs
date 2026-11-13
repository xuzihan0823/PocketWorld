import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from './load-for-validation.mjs';

function compile(file) {
  const module = { exports: {}, require: () => THREE };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, module);
  return module.exports;
}
const { createChairMotion, advanceChairMotion } = compile('./chairMotion.ts');
for (const fps of [30, 60, 144]) test(`original sit, idle and recovery complete at ${fps} FPS`, () => {
  const motion = createChairMotion(.8);
  let elapsed = 0;
  while (motion.phase !== 'seated' && elapsed < 10) {
    advanceChairMotion(motion, 1 / fps, false, false, .53); elapsed += 1 / fps;
  }
  assert.equal(motion.phase, 'seated');
  assert.ok(elapsed > 4 && elapsed < 4.4);
  for (let i = 0; i < fps * 4; i++) advanceChairMotion(motion, 1 / fps, false, false, .53);
  assert.ok(motion.time >= 3 && motion.time <= 6);
  for (let i = 0; i < fps * 7 && motion.phase !== 'done'; i++) advanceChairMotion(motion, 1 / fps, true, false, .53);
  assert.equal(motion.phase, 'done'); assert.equal(motion.weight, 0); assert.equal(motion.offset, .8);
});
test('every approach, blend and descent phase can be cancelled and reduced motion settles', () => {
  for (const seconds of [.2, 1.05, 1.5, 2.5, 4.5]) {
    const motion = createChairMotion(.8);
    for (let t = 0; t < seconds; t += 1 / 60) advanceChairMotion(motion, 1 / 60, false, false, .53);
    for (let t = 0; t < 8; t += 1 / 60) advanceChairMotion(motion, 1 / 60, true, false, .53);
    assert.equal(motion.phase, 'done'); assert.equal(motion.time, 0); assert.equal(motion.weight, 0);
  }
  const reduced = createChairMotion(.8);
  for (let t = 0; t < 8; t += 1 / 60) advanceChairMotion(reduced, 1 / 60, false, true, .53);
  assert.equal(reduced.phase, 'seated'); assert.equal(reduced.time, 3);
});

const raw = readFileSync(new URL('../../../assets/public/models/resident/luna-chair-original.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
const clip = gltf.animations[0];
const walk = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
const { createResidentRig } = compile('./residentRig.ts');
test('caster chair keeps a full-sized seat and back with a short fixed post', () => {
  const data = readFileSync(new URL('../../../assets/public/models/replaced/rolling-chair.parts.glb', import.meta.url));
  const jsonLength = data.readUInt32LE(12), doc = JSON.parse(data.subarray(20, 20 + jsonLength));
  const bin = data.subarray(28 + jsonLength), bounds = new THREE.Box3();
  let cushion = 0, backrest = 0;
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
    const a = doc.accessors[primitive.attributes.POSITION], view = doc.bufferViews[a.bufferView];
    const n = doc.accessors[primitive.attributes.NORMAL], nv = doc.bufferViews[n.bufferView];
    for (let i = 0; i < a.count; i++) {
      const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? 12);
      const p = new THREE.Vector3(...[0, 1, 2].map(axis => bin.readFloatLE(offset + axis * 4)));
      assert.ok(p.toArray().every(Number.isFinite)); bounds.expandByPoint(p);
      if (p.y > .27 && p.y < .33 && p.z > -.10 && p.z < .25) cushion++;
      if (p.y > .60 && p.z < 0) backrest++;
      const no = (nv.byteOffset ?? 0) + (n.byteOffset ?? 0) + i * (nv.byteStride ?? 12);
      assert.ok(Math.abs(Math.hypot(...[0, 1, 2].map(axis => bin.readFloatLE(no + axis * 4))) - 1) < .00001);
    }
  }
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > .8 && size.z > .7 && size.y > .75, 'preserve furniture scale instead of shrinking the entire chair');
  assert.ok(size.distanceTo(new THREE.Vector3(.85, .79, .75)) < .00001);
  assert.ok(Math.abs(bounds.min.y) < .00001);
  assert.ok(cushion > 500 && backrest > 500, 'retain both the low cushion and full backrest');
  assert.deepEqual(doc.nodes.map(n => n.name), ['base', 'seat']);
});
test('original 191-frame motion is retained as a small independent animation library', () => {
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'a48f34da176a5e3eba2b173cdb782a268c9dd3245360e6fff584dd7ca9486b7c');
  assert.equal(clip.name, 'ChairSit_Original'); assert.equal(clip.tracks.length, 195);
  assert.ok(Math.abs(clip.duration - 191 / 24) < .00001); assert.ok(raw.length < 150000);
});
test('independent foot plants, original bone lengths and walk recovery survive sitting and scooting', () => {
  const asset = clone(walk.gltf.scene), rig = createResidentRig(asset, walk.gltf.animations[0], clip);
  const skin = asset.getObjectByProperty('isSkinnedMesh', true);
  const chains = ['Left', 'Right'].map(side => ['UpLeg', 'Leg', 'Foot'].map(n => asset.getObjectByName('mixamorig' + side + n)));
  const pos = bone => bone.getWorldPosition(new THREE.Vector3());
  const update = () => { rig.mesh.updateMatrixWorld(true); skin.skeleton.update(); };
  const render = (time, perch = 0, sole = .03, soleLift = 0) => { rig.applyPose(0, 0, { time, weight: 1, perch, sole, soleLift }); update(); };
  try {
    render(1.6);
    const anchors = chains.map(c => pos(c[2]));
    const lengths = chains.map(c => [pos(c[0]).distanceTo(pos(c[1])), pos(c[1]).distanceTo(pos(c[2]))]);
    let maxDrift = 0, maxLengthError = 0;
    for (let i = 192; i <= 720; i++) {
      render(i / 120);
      chains.forEach((c, j) => {
        maxDrift = Math.max(maxDrift, pos(c[2]).distanceTo(anchors[j]));
        maxLengthError = Math.max(maxLengthError, Math.abs(pos(c[0]).distanceTo(pos(c[1])) - lengths[j][0]), Math.abs(pos(c[1]).distanceTo(pos(c[2])) - lengths[j][1]));
      });
    }
    assert.ok(maxDrift < .00001, `foot drift ${maxDrift}`);
    assert.ok(maxLengthError < .00001, `bone stretch ${maxLengthError}`);
    for (let i = 0; i <= 60; i++) {
      render(3, i / 60, .03 + .17 * i / 60, .06 * Math.sin(Math.PI * i / 60));
      for (let j = 0; j < skin.geometry.attributes.position.count; j += 19)
        assert.ok(skin.getVertexPosition(j, new THREE.Vector3()).toArray().every(Number.isFinite));
      assert.equal(rig.mesh.position.y, 0);
    }
    const reference = createResidentRig(clone(walk.gltf.scene), walk.gltf.animations[0]);
    try {
      rig.applyPose(.4, 1); reference.applyPose(.4, 1); update(); reference.mesh.updateMatrixWorld(true);
      for (const c of chains) for (const bone of c)
        assert.deepEqual(bone.quaternion.toArray(), reference.mesh.getObjectByName(bone.name).quaternion.toArray());
    } finally { reference.dispose(); }
  } finally { rig.dispose(); }
});
