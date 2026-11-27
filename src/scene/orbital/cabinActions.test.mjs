import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Raycaster, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CABIN_ACTIONS, advanceCabinPerformance, applyCabinPerformance, createCabinActionPlayer,
  leaveCabinPerformance, newRugPerformance,
} from './cabinActions.ts';
import { createIdleState, stepIdle } from './standingIdle.ts';
import { createResidentRig } from './residentRig.ts';
import { load } from './load-for-validation.mjs';

const model = name => new URL('../../../assets/public/models/resident/luna-' + name + '.glb', import.meta.url);

test('rug exit undoes a partial sit and uses the authored rise after sitting cross-legged', () => {
  const clips = { floorSit: { duration: 5 }, floorStand: { duration: 5 } };
  const partial = newRugPerformance();
  advanceCabinPerformance(partial, .9, clips);
  leaveCabinPerformance(partial);
  assert.equal(partial.phase, 'undo-sit');
  assert.equal(advanceCabinPerformance(partial, .9, clips), true);
  const rest = newRugPerformance();
  advanceCabinPerformance(rest, 5, clips);
  assert.equal(rest.phase, 'seated');
  leaveCabinPerformance(rest);
  assert.equal(rest.phase, 'rise');
  const applied = [];
  applyCabinPerformance(rest, clips, (...args) => applied.push(args));
  assert.deepEqual(applied, [['floorSit', 5], ['floorStand', 0, 0]]);
  assert.equal(advanceCabinPerformance(rest, 5, clips), true);
});

test('the rug holds the last cross-legged frame until the resident leaves', () => {
  const clips = { floorSit: { duration: 5 } };
  const seat = newRugPerformance();
  advanceCabinPerformance(seat, 5, clips);
  assert.equal(advanceCabinPerformance(seat, 60, clips), false);
  assert.equal(seat.phase, 'seated');
  const applied = [];
  applyCabinPerformance(seat, clips, (...args) => applied.push(args));
  assert.deepEqual(applied, [['floorSit', 5]]);
});

test('interrupted pickup returns to the start without visiting the completion pose', () => {
  const pickup = { kind: 'paper', time: 0, leaving: false };
  const clips = { pickUp: { duration: 4 } };
  assert.equal(advanceCabinPerformance(pickup, 2.4, clips), false);
  leaveCabinPerformance(pickup);
  assert.equal(advanceCabinPerformance(pickup, 2.4, clips), true);
  assert.equal(pickup.time, 0);
});

test('pickup and placement play opposite directions and cancellation returns to the original endpoint', () => {
  const clips = { pickUp: { duration: 4 } };
  for (const placing of [false, true]) {
    const performance = { kind: 'plush', placing, time: placing ? 4 : 0, leaving: false };
    assert.equal(advanceCabinPerformance(performance, 1.5, clips), false);
    assert.equal(performance.time, placing ? 2.5 : 1.5);
    leaveCabinPerformance(performance);
    assert.equal(advanceCabinPerformance(performance, 2, clips), true);
    assert.equal(performance.time, placing ? 4 : 0);
  }
});

test('rub eye remains a standing idle while thinking is reserved for choosing a book', () => {
  const idle = createIdleState(() => 0);
  const seen = new Set();
  for (let i = 0; i < 3600; i++) {
    stepIdle(idle, .05, true, 8, () => 0, true, { rubEye: { duration: 3 } });
    assert.ok([idle.yawnTime, idle.shortTime].filter(time => time >= 0).length <= 1);
    if (idle.shortTime >= 0) seen.add(idle.shortKind);
  }
  assert.deepEqual([...seen], ['listen', 'clasp', 'rubEye']);
  stepIdle(idle, .05, false, 8, () => 0);
  assert.equal(idle.elapsed, 0);
});

test('the new standing gestures use the same rotation and interruptible fade as the existing idles', () => {
  const idle = createIdleState(() => 0);
  const clips = { rubEye: { duration: 3 }, shiftWeight: { duration: 6 }, stretchNeck: { duration: 5 } };
  const seen = new Set();
  for (let i = 0; i < 60 * 200; i++) {
    stepIdle(idle, 1 / 60, true, 0, () => 0, true, clips);
    if (idle.shortTime > .9) seen.add(idle.shortKind);
    if (idle.shortKind === 'stretchNeck' && idle.shortWeight === 1) break;
  }
  assert.deepEqual([...seen], ['listen', 'clasp', 'rubEye', 'shiftWeight', 'stretchNeck']);
  const time = idle.shortTime;
  stepIdle(idle, .05, false, 0, () => 0, false, clips);
  assert.equal(idle.shortTime, time);
  assert.equal(idle.elapsed, 0);
  assert.ok(idle.shortWeight > 0 && idle.shortWeight < 1);
  for (let i = 0; i < 6; i++) stepIdle(idle, .05, false, 0, () => 0, false, clips);
  assert.equal(idle.shortTime, -1);
  assert.equal(idle.shortWeight, 0);
});

function checkLapCoverage(root) {
  root.updateMatrixWorld(true);
  const surfaces = [];
  root.traverse(mesh => {
    if (mesh.isSkinnedMesh) {
      mesh.skeleton.update();
      mesh.computeBoundingSphere();
      surfaces.push(mesh);
    }
  });
  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  for (const side of ['Left', 'Right']) {
    const point = bone => root.getObjectByName('mixamorig' + side + bone).getWorldPosition(new Vector3());
    const hip = point('UpLeg'), knee = point('Leg');
    for (const fraction of [.85, .96]) {
      const origin = hip.clone().lerp(knee, fraction);
      origin.y = 1;
      ray.set(origin, down);
      const hits = [];
      for (const mesh of surfaces) SkinnedMesh.prototype.raycast.call(mesh, ray, hits);
      hits.sort((a, b) => a.distance - b.distance);
      const joint = hit => {
        const { skinIndex, skinWeight } = hit.object.geometry.attributes;
        const vertex = hit.face.a;
        let strongest = 0;
        for (let slot = 1; slot < 4; slot++) {
          if (skinWeight.getComponent(vertex, slot) > skinWeight.getComponent(vertex, strongest)) strongest = slot;
        }
        return hit.object.skeleton.bones[skinIndex.getComponent(vertex, strongest)].name;
      };
      const cloth = hits.find(hit => joint(hit).startsWith('Dress_Front'));
      const leg = hits.find(hit => ['mixamorig' + side + 'Leg', 'mixamorig' + side + 'UpLeg'].includes(joint(hit)));
      assert.ok(cloth && leg && cloth.point.y > leg.point.y + .002, side + ' front skirt clears the bent knee at ' + fraction);
    }
  }
}

test(`MotionSmith takes bind and keep everyday close to the rug during floor holds`, async () => {
  const data = await readFile(model('cabin-actions-everyday'));
  const { animations } = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  assert.deepEqual(animations.map(clip => clip.name), CABIN_ACTIONS);
  const { gltf } = await load(model('walk-room'));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'));
  try {
    const clips = Object.fromEntries(animations.map(clip => [clip.name, clip]));
    const apply = createCabinActionPlayer(rig.mesh, clips);
    const point = new Vector3();
    const boneY = name => rig.mesh.getObjectByName('mixamorig' + name).getWorldPosition(point).y;
    for (const clip of animations) {
      assert.ok(clip.duration > 2.9 && clip.duration < 6.1);
      assert.ok(clip.tracks.every(track => track.values.every(Number.isFinite)));
      rig.applyPose(0, 0);
      apply(clip.name, clip.duration * .5);
      assert.ok(Number.isFinite(boneY('Hips')));
    }
    rig.applyPose(0, 0);
    apply('floorSit', clips.floorSit.duration);
    assert.ok(boneY('Hips') < .23, 'seated pelvis stays close to the rug');
    assert.ok(Math.min(boneY('LeftFoot'), boneY('RightFoot')) < .16);
    checkLapCoverage(rig.mesh);
    apply('floorGlance', 2.5);
    checkLapCoverage(rig.mesh);
    for (const name of ['shiftWeight', 'stretchNeck']) {
      rig.applyPose(0, 0);
      const fixed = ['Hips', 'LeftFoot', 'RightFoot'].map(name => boneY(name));
      apply(name, 2.5);
      assert.deepEqual(['Hips', 'LeftFoot', 'RightFoot'].map(name => boneY(name)), fixed);
    }
    rig.applyPose(0, 0);
    apply('floorStand', clips.floorStand.duration);
    assert.ok(boneY('Hips') > .65);
    rig.applyPose(0, 0);
    apply('pickUp', 1.90);
    assert.ok(boneY('RightHand') < .25);
  } finally { rig.dispose(); }
});
