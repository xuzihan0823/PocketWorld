import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from './load-for-validation.mjs';

function compile(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const context = { exports: {}, require: name => name === 'three' ? THREE : { GLTFLoader } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const { createIdleState, stepIdle, createIdlePlayer } = compile('./standingIdle.ts');
const { createResidentRig } = compile('./residentRig.ts');
const random = () => .5;
const raw = readFileSync(new URL('../../../assets/public/models/resident/luna-yawn.glb', import.meta.url));
const { animations: [clip] } = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');

test('ordinary idle dominates ten minutes at 30/60/120 Hz and yawns play once in full', () => {
  for (const hz of [30, 60, 120]) {
    const state = createIdleState(random);
    let yawnSeconds = 0, first = 0, count = 0, previous = -1;
    for (let frame = 0; frame < hz * 600; frame++) {
      stepIdle(state, 1 / hz, true, clip.duration, random);
      if (frame < hz * 5) assert.equal(state.weight, 0);
      if (state.yawnTime >= 0) {
        yawnSeconds += 1 / hz;
        if (previous < 0) { count++; first ||= frame / hz; }
      }
      previous = state.yawnTime;
    }
    assert(first >= 59.9 && first <= 60.1);
    assert.equal(count, 7);
    assert(Math.abs(yawnSeconds - count * clip.duration) < .3);
    assert(yawnSeconds < 600 * .12);
  }
});

test('interruptions reset eligibility and fade the held gesture without restarting it', () => {
  const state = createIdleState(random);
  for (let i = 0; i < 62 * 60; i++) stepIdle(state, 1 / 60, true, clip.duration, random);
  assert(state.yawnTime > 1);
  const held = state.yawnTime;
  stepIdle(state, 1 / 60, false, clip.duration, random);
  assert.equal(state.elapsed, 0);
  assert.equal(state.yawnTime, held);
  for (let i = 0; i < 30; i++) stepIdle(state, 1 / 60, true, clip.duration, random);
  assert.equal(state.yawnTime, -1);
  assert.equal(state.yawnWeight, 0);
  stepIdle(state, 300, true, clip.duration, random);
  assert(state.elapsed < 1);
});

test('exported yawn binds to Luna and preserves every foot and root transform', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  const player = createIdlePlayer(rig.mesh, clip);
  rig.applyPose(0, 0);
  rig.mesh.updateMatrixWorld(true);
  const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(name => rig.mesh.getObjectByName('mixamorig' + name));
  const anchors = feet.map(bone => bone.matrixWorld.clone());
  const state = createIdleState(random);
  state.weight = 1;
  state.yawnWeight = 1;
  for (let frame = 0; frame <= 1000; frame++) {
    rig.applyPose(0, 0);
    state.elapsed = frame / 120;
    state.yawnTime = Math.min(frame / 120, clip.duration);
    player(state);
    rig.mesh.updateMatrixWorld(true);
    feet.forEach((bone, i) => assert.deepEqual(bone.matrixWorld.elements, anchors[i].elements));
    rig.mesh.traverse(bone => { if (bone.isBone) assert(bone.quaternion.toArray().every(Number.isFinite)); });
  }
  assert(Math.abs(clip.duration - 250 / 30) < 1e-6);
  assert.equal(clip.tracks.length, 54);
  rig.dispose();
});
