import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from './load-for-validation.mjs';

function module(file, dependencies) {
  const context = { exports: {}, require: name => dependencies[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const { createResidentRig } = module('./residentRig.ts', { three: THREE });
const { createBedPlayer, advanceBedTime, BED_ENTRY, BED_YAW, BED_DURATION } = module('./bedMotion.ts',
  { three: THREE, 'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader } });
const raw = fs.readFileSync(new URL('../../../assets/public/models/resident/luna-bed-v3.glb', import.meta.url));
const doc = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)));
const animation = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
const clip = animation.animations[0];
const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
function instance() {
  const rig = createResidentRig(clone(gltf.scene), gltf.animations[0]);
  const root = new THREE.Group(); root.position.set(BED_ENTRY[0], 0, BED_ENTRY[1]); root.rotation.y = BED_YAW; root.add(rig.mesh);
  const apply = createBedPlayer(rig.mesh, clip, rig.neutralPose);
  const bone = name => rig.mesh.getObjectByName('mixamorig' + name);
  const sample = time => { apply(time); root.updateMatrixWorld(true); };
  return { rig, root, bone, sample };
}

test('bed library is animation-only and binds all 115 original joints', () => {
  assert.equal(doc.meshes, undefined); assert.equal(doc.images, undefined); assert.equal(doc.skins, undefined);
  assert.equal(doc.nodes.length, 115); assert.equal(clip.duration, BED_DURATION);
  assert(raw.length < 1000000);
  const { rig, sample } = instance(); sample(BED_DURATION); rig.dispose();
});

test('bed entry matches neutral stance and exit restores original walking', () => {
  const { rig, root, bone, sample } = instance();
  try {
    rig.applyPose(0, 0); root.updateMatrixWorld(true);
    const names = ['Hips', 'Head', 'LeftFoot', 'RightFoot', 'RightLeg', 'LeftHand', 'RightHand'];
    const neutral = names.map(n => bone(n).getWorldPosition(new THREE.Vector3()));
    sample(0);
    names.forEach((n, i) => assert(bone(n).getWorldPosition(new THREE.Vector3()).distanceTo(neutral[i]) < .00001, n));
    const original = root.matrixWorld.clone();
    sample(141 / 24); assert(root.matrixWorld.equals(original), 'parent must not add bed translation');
    assert(bone('Hips').getWorldPosition(new THREE.Vector3()).x < -2.5);
    sample(0); rig.applyPose(.37, 1); root.updateMatrixWorld(true);
    const walking = bone('RightFoot').quaternion.clone();
    sample(3); rig.applyPose(.37, 1);
    assert(walking.angleTo(bone('RightFoot').quaternion) < .00001);
  } finally { rig.dispose(); }
});

test('right ankle points forward while seated and never flips through the action', () => {
  const { rig, bone, sample } = instance();
  try {
    sample(2);
    const foot = side => bone(side + 'ToeBase').getWorldPosition(new THREE.Vector3()).sub(bone(side + 'Foot').getWorldPosition(new THREE.Vector3())).normalize();
    const left = foot('Left'), right = foot('Right');
    assert(right.x > .5, 'right foot must not point sideways or backwards');
    assert(left.dot(right) > .65, 'both feet should follow the seated facing');
    let previous = null, maximum = 0;
    for (let f = 0; f <= 444; f++) {
      sample(f / 48);
      const q = bone('RightFoot').getWorldQuaternion(new THREE.Quaternion());
      if (previous) maximum = Math.max(maximum, q.angleTo(previous));
      previous = q;
      for (const n of ['RightLeg', 'RightFoot', 'RightToeBase']) assert(bone(n).matrixWorld.elements.every(Number.isFinite));
    }
    assert(maximum < .08, 'right foot rotation exceeds 4.6 degrees per half frame');
  } finally { rig.dispose(); }
});

test('standing correction leaves authored bed contacts and sleeping pose unchanged', () => {
  const { rig, bone, sample } = instance();
  try {
    for (const time of [.6, 1.5, 3, 6, BED_DURATION]) {
      sample(time);
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const expected = track.createInterpolant().evaluate(time);
        const value = rig.mesh.getObjectByName(nodeName)[propertyName].toArray();
        value.forEach((v, i) => assert(Math.abs(v - expected[i]) < 1e-7, track.name));
      }
    }
    const forward = [];
    for (let f = 0; f <= 36; f++) {
      sample(f / 60);
      forward.push(['Hips', 'Head', 'LeftFoot', 'RightFoot'].map(n => bone(n).getWorldPosition(new THREE.Vector3())));
    }
    for (let f = 36; f >= 0; f--) {
      sample(f / 60);
      ['Hips', 'Head', 'LeftFoot', 'RightFoot'].forEach((n, i) => {
        const p = bone(n).getWorldPosition(new THREE.Vector3());
        assert(p.distanceTo(forward[f][i]) < 1e-7, 'cancellation retraces the same entry pose');
        if (f) assert(p.distanceTo(forward[f - 1][i]) < .02, n + ' entry continuity');
      });
    }
  } finally { rig.dispose(); }
});

test('bed clock is stable at 30/60/120 Hz, clamps background gaps and reverses on cancel', () => {
  for (const fps of [30, 60, 120]) {
    let time = 0;
    for (let i = 0; i < fps * 3; i++) time = advanceBedTime(time, 1 / fps, false, false);
    assert(Math.abs(time - 3) < 1e-10);
    const next = advanceBedTime(time, 1 / fps, true, false);
    assert(next < time && time - next < .05);
  }
  assert.equal(advanceBedTime(1, 30, false, false), 1.04);
  assert.equal(advanceBedTime(.01, .04, true, false), 0);
  assert.equal(advanceBedTime(BED_DURATION, .04, false, false), BED_DURATION);
  let reduced = 0;
  for (let i = 0; i < 12; i++) reduced = advanceBedTime(reduced, .04, false, true);
  assert.equal(reduced, BED_DURATION);
});

