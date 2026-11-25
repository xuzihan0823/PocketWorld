import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from './load-for-validation.mjs';
import { createCabinActionPlayer } from './cabinActions.ts';

const modules = new Map([['three', THREE], ['three/examples/jsm/loaders/GLTFLoader.js', { GLTFLoader }]]);
function local(name) {
  if (!modules.has(name)) {
    const code = readFileSync(new URL(name + '.ts', import.meta.url), 'utf8');
    const scope = { exports: {}, require: local };
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope);
    modules.set(name, scope.exports);
  }
  return modules.get(name);
}

const { createSeatedIdle, seatedIdleWeight, stepSeatedIdle, createSeatedIdlePlayer } = local('./seatedIdle');
const { createResidentRig } = local('./residentRig');
const { createChairAnimation, readSeatContactCache } = local('./chairAnimation');
const { CHAIR_SIT_SECONDS } = local('./chairMotion');
const { sofaPlayer } = local('./sofaMotion');

test('the sofa blends into its first gesture immediately and releases smoothly on exit', () => {
  const idle = createSeatedIdle();
  for (const fps of [30, 60, 120]) {
    const dt = 1 / fps;
    stepSeatedIdle(idle, dt, 'sofa', false);
    assert.ok(idle.weight > 0 && idle.weight < .05, 'ease in on the first frame of every sit');
    while (idle.time < .35) stepSeatedIdle(idle, dt, 'sofa', false);
    assert.ok(idle.weight > 0 && idle.weight < .15, 'the hand is only starting to rise as the cushion settles');
    while (idle.time < .8) stepSeatedIdle(idle, dt, 'sofa', false);
    assert.ok(idle.weight > .45 && idle.weight < .55);
    const time = idle.time, weight = idle.weight;
    assert.equal(stepSeatedIdle(idle, dt, 'sofa', true), true);
    assert.ok(seatedIdleWeight(idle) < weight);
    while (stepSeatedIdle(idle, dt, 'sofa', true)) assert.equal(idle.time, time);
    assert.equal(seatedIdleWeight(idle), 0);
    stepSeatedIdle(idle, dt, null, false);
    assert.deepEqual(idle, createSeatedIdle());
  }
});

test('the chair waits before its first swing and rests between gestures', () => {
  const idle = createSeatedIdle();
  for (let frame = 0; frame < 30; frame++) stepSeatedIdle(idle, 1 / 60, 'chair', false);
  assert.equal(idle.weight, 0);
  const releaseTimes = [1 / 30, 1 / 60, 1 / 120].map(dt => {
    for (let frame = 0; frame < 2 / dt; frame++) stepSeatedIdle(idle, dt, 'chair', false);
    let releaseTime = dt;
    while (stepSeatedIdle(idle, dt, 'chair', true)) releaseTime += dt;
    assert.equal(idle.weight, 0);
    stepSeatedIdle(idle, dt, null, false);
    return releaseTime;
  });
  assert(releaseTimes.every(seconds => seconds >= .32 && seconds <= .36));
  for (let frame = 0; frame < 5 * 60; frame++) stepSeatedIdle(idle, 1 / 60, 'chair', false);
  assert.equal(idle.weight, 0, 'the chair stops swinging for a while');
  for (let frame = 0; frame < 4 * 60; frame++) stepSeatedIdle(idle, 1 / 60, 'chair', false);
  assert.equal(idle.weight, 1, 'a new chair gesture can begin after the rest');
});

test('seated gestures cycle in order and release before the seat is left', () => {
  const clips = { sofaDoze: { duration: 6 }, chairGlance: { duration: 6 }, floorGlance: { duration: 6 } };
  for (const [seat, overlay] of Object.entries({ sofa: 'sofaDoze', chair: 'chairGlance', floor: 'floorGlance' })) {
    const idle = createSeatedIdle(), gestures = [];
    for (let i = 0; i < 60 * 55; i++) {
      assert.equal(stepSeatedIdle(idle, 1 / 60, seat, false, clips), false);
      if (idle.weight > 0 && gestures.at(-1) !== idle.gesture) gestures.push(idle.gesture);
    }
    const expected = seat === 'sofa' ? ['cheekRest', 'sofaSwing', overlay, 'cheekRest']
      : seat === 'chair' ? ['chairSwing', overlay, 'chairSwing'] : [overlay];
    assert.deepEqual(gestures.slice(0, expected.length), expected);
    for (let i = 0; i < 60 * 45 && (idle.gesture !== overlay || idle.weight !== 1); i++) {
      stepSeatedIdle(idle, 1 / 60, seat, false, clips);
    }
    assert.equal(idle.gesture, overlay);
    assert.equal(idle.weight, 1);
    const time = idle.time;
    let previous = 1;
    let heldFrames = 0;
    while (stepSeatedIdle(idle, 1 / 60, seat, true, clips)) {
      assert.ok(++heldFrames < 60);
      assert.equal(idle.time, time);
      const weight = seatedIdleWeight(idle);
      assert(weight <= previous);
      previous = weight;
    }
    assert.ok(heldFrames / 60 >= (seat === 'sofa' ? .75 : .30));
    assert.equal(seatedIdleWeight(idle), 0);
    stepSeatedIdle(idle, 1 / 60, null, false, clips);
    assert.deepEqual(idle, createSeatedIdle());
  }
});

const assets = new URL('../../../assets/public/models/resident/', import.meta.url);
const raw = readFileSync(new URL('luna-sofa-low-sit.glb', assets));
const { animations: [sofa] } = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
const outfits = {
  everyday: ['luna-walk-room', 'luna-seat-contact'],
  cardigan: ['luna-cardigan', 'luna-cardigan-seat'],
};
for (const [outfit, [model, seatCache]] of Object.entries(outfits)) {
  test(`${outfit} keeps the hips and planted feet on the sofa, and swings both feet below fixed knees on the chair`, async () => {
    const { gltf: { scene, animations } } = await load(new URL(model + '.glb', assets));
    const clip = name => animations.find(clip => clip.name === name);
    const rig = createResidentRig(scene, clip('Walk_Grounded_Loop'), outfit !== 'everyday');
    const data = readFileSync(new URL(seatCache + '.bin', assets));
    const chair = createChairAnimation(scene, clip('ChairSit_Contact'),
      readSeatContactCache(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
    const sofaClip = clip('Luna_CMU_75_20') ?? sofa;
    const applySofa = sofaPlayer(rig.mesh, sofaClip);
    const applyIdle = createSeatedIdlePlayer(rig, outfit);
    const bone = name => scene.getObjectByName('mixamorig' + name);
    const position = name => bone(name).getWorldPosition(new THREE.Vector3());
    const feet = ['LeftFoot', 'RightFoot'];
    try {
      const sample = (seat, time, release = 0) => {
        rig.applyPose(0, 0);
        chair.apply(CHAIR_SIT_SECONDS, Number(seat === 'chair'));
        if (seat === 'sofa') applySofa(sofaClip.duration);
        if (time !== undefined) applyIdle({ seat, gesture: seat === 'sofa' ? 'cheekRest' : 'chairSwing', time, weight: 1, release });
      };
      const supports = ['Hips', ...feet, 'LeftToeBase', 'RightToeBase'];
      sample('sofa');
      const sofaSupports = supports.map(position);
      const cheek = position('Head'), wrist = position('LeftHand');
      const armLength = position('LeftHand').distanceTo(position('LeftForeArm'));
      for (let i = 0; i <= 48; i++) {
        sample('sofa', i / 10);
        supports.forEach((name, index) => assert(position(name).distanceTo(sofaSupports[index]) < 1e-5, name));
        assert(Math.abs(position('LeftHand').distanceTo(position('LeftForeArm')) - armLength) < 1e-5);
        if (i === 20) {
          assert(position('Head').distanceTo(cheek) > .18);
          assert(position('LeftHand').distanceTo(position('Head')) < .14);
          if (outfit === 'cardigan') assert(position('RightHand').y < .64);
          else assert(position('RightHand').distanceTo(position('LeftForeArm')) < .10);
        }
      }
      sample('sofa', 2, 1);
      assert(position('LeftHand').distanceTo(wrist) < 1e-5, 'release returns to the seat contact pose');

      sample('chair');
      const knees = ['LeftLeg', 'RightLeg'];
      const kneePositions = knees.map(position);
      const footPositions = feet.map(position);
      const chairHips = position('Hips');
      const range = feet.map(() => ({ min: Infinity, max: -Infinity }));
      for (let i = 0; i <= 62; i++) {
        sample('chair', i / 20);
        assert(position('Hips').distanceTo(chairHips) < 1e-5);
        knees.forEach((name, j) => assert(position(name).distanceTo(kneePositions[j]) < 1e-5));
        feet.forEach((name, j) => {
          const foot = position(name);
          assert(foot.y > .25 && position(name.replace('Foot', 'ToeBase')).y > .16);
          range[j].min = Math.min(range[j].min, foot.z);
          range[j].max = Math.max(range[j].max, foot.z);
        });
      }
      assert(range.every(({ min, max }) => max - min > .12));
      sample('chair', 1.6, 1);
      feet.forEach((name, j) => assert(position(name).distanceTo(footPositions[j]) < 1e-5));
    } finally {
      chair.dispose();
      rig.dispose();
    }
  });
}

for (const [outfit, model] of Object.entries({ everyday: 'luna-walk-room', ribbon: 'luna-ribbon', cardigan: 'luna-cardigan' })) {
  test(`${outfit} swings the shins from fixed knees and returns to the sofa pose`, async () => {
    const { gltf: { scene, animations } } = await load(new URL(model + '.glb', assets));
    const rig = createResidentRig(scene, animations.find(c => c.name === 'Walk_Grounded_Loop'), outfit === 'cardigan');
    try {
      const clip = animations.find(c => c.name === 'Luna_CMU_75_20') ?? sofa;
      const apply = sofaPlayer(rig.mesh, clip), play = createSeatedIdlePlayer(rig, outfit);
      const idle = createSeatedIdle();
      const point = name => scene.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
      const sides = ['Left', 'Right'];
      const sample = () => { rig.applyPose(0, 0); apply(clip.duration); play(idle); };
      sample();
      const supports = ['Hips', ...sides.flatMap(side => [side + 'UpLeg', side + 'Leg'])];
      const supportPositions = supports.map(point);
      const rest = sides.map(side => point(side + 'Foot'));
      const toeHeights = sides.map(side => point(side + 'ToeBase').y);
      const heights = [[], []];
      for (let frame = 0; frame < 24 * 30; frame++) {
        stepSeatedIdle(idle, 1 / 30, 'sofa', false);
        if (idle.gesture !== 'sofaSwing') {
          if (heights[0].length) break;
          continue;
        }
        sample();
        supports.forEach((name, i) => assert.ok(point(name).distanceTo(supportPositions[i]) < 1e-5, name));
        sides.forEach((side, i) => {
          const thigh = point(side + 'UpLeg'), knee = point(side + 'Leg'), foot = point(side + 'Foot');
          const flex = knee.clone().sub(thigh).angleTo(foot.clone().sub(knee));
          assert.ok(flex > .29, 'knees stay bent');
          assert.ok(foot.z >= rest[i].z - .001, 'feet only swing forward from their starting positions');
          assert.ok(point(side + 'ToeBase').y >= toeHeights[i] - .001, 'toes clear the floor');
          heights[i].push(foot.y);
        });
      }
      for (const values of heights) {
        const peaks = values.filter((y, i) => y > values[i - 1] && y > values[i + 1]);
        assert.equal(peaks.length, 2, 'each foot rises twice');
        assert.ok(Math.min(...peaks) - Math.min(...values) > .03, 'each swing is visible');
      }
      sample();
      sides.forEach((side, i) => assert.ok(point(side + 'Foot').distanceTo(rest[i]) < 1e-5));
    } finally { rig.dispose(); }
  });
}

test(`everyday composes the authored overlays without altering seated contacts`, async () => {
  const { gltf: { scene, animations } } = await load(new URL('luna-walk-room.glb', assets));
  const clip = name => animations.find(clip => clip.name === name);
  const rig = createResidentRig(scene, clip('Walk_Grounded_Loop'), false);
  const data = readFileSync(new URL('luna-seat-contact.bin', assets));
  const cache = readSeatContactCache(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const chair = createChairAnimation(scene, clip('ChairSit_Contact'), cache);
  const sofaClip = clip('Luna_CMU_75_20') ?? sofa;
  const applySofa = sofaPlayer(rig.mesh, sofaClip);
  const raw = readFileSync(new URL('luna-cabin-actions-everyday.glb', assets));
  const fitted = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
  const clips = Object.fromEntries(fitted.animations.map(clip => [clip.name, clip]));
  const apply = createCabinActionPlayer(rig.mesh, clips);
  const bone = name => scene.getObjectByName('mixamorig' + name);
  const supports = ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
  const matrix = name => bone(name).matrixWorld.clone();
  try {
    for (const [gesture, base] of [
      ['chairGlance', () => chair.apply(CHAIR_SIT_SECONDS, 1)],
      ['sofaDoze', () => applySofa(sofaClip.duration)],
      ['floorGlance', () => apply('floorSit', clips.floorSit.duration)],
    ]) {
      const reset = () => { rig.applyPose(0, 0); chair.apply(0, 0); base(); scene.updateMatrixWorld(true); };
      reset();
      const initial = supports.map(matrix), head = bone('Head').getWorldQuaternion(new THREE.Quaternion());
      const arms = ['LeftHand', 'RightHand'].map(matrix);
      let maxHeadTurn = 0;
      for (let i = 0; i <= 20; i++) {
        reset();
        apply(gesture, clips[gesture].duration * i / 20);
        scene.updateMatrixWorld(true);
        supports.forEach((name, index) => assert(matrix(name).equals(initial[index]), name));
        if (gesture === 'chairGlance') {
          ['LeftHand', 'RightHand'].forEach((name, index) => assert(matrix(name).equals(arms[index]), name));
        }
        maxHeadTurn = Math.max(maxHeadTurn, head.angleTo(bone('Head').getWorldQuaternion(new THREE.Quaternion())));
      }
      assert.ok(maxHeadTurn >= .10 && maxHeadTurn < .58, gesture + ' moves the head within its fitted range');
    }
  } finally { chair.dispose(); rig.dispose(); }
});

test('the ribbon outfit grounds its sock soles and binds its fitted chair, sofa, book and cabin actions', async () => {
  const { gltf: { scene, animations } } = await load(new URL('luna-ribbon.glb', assets));
  const clip = name => animations.find(value => value.name === name);
  const rig = createResidentRig(scene, clip('Walk_Grounded_Loop'));
  const raw = readFileSync(new URL('luna-ribbon-seat.bin', assets));
  const contact = readSeatContactCache(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const chair = createChairAnimation(scene, clip('ChairSit_Contact'), contact);
  const point = new THREE.Vector3();
  const height = name => scene.getObjectByName('mixamorig' + name).getWorldPosition(point).y;
  const sole = scene.getObjectByProperty('isSkinnedMesh', true);
  try {
    assert.equal(sole.skeleton.bones.length, 91);
    const contacts = Object.values(sole.geometry.userData.soleContacts);
    for (const weight of [0, .45, 1]) for (const phase of [0, .2, .37, .55, .7, .89]) {
      rig.applyPose(phase, weight);
      rig.mesh.updateMatrixWorld(true);
      const feet = contacts.map(vertices => Math.min(...vertices.map(i =>
        sole.localToWorld(sole.getVertexPosition(i, point)).y)));
      assert(Math.min(...feet) >= -.003 && Math.min(...feet) < .012, `sock support at ${phase}/${weight}: ${feet}`);
      if (weight === 0) assert(Math.max(...feet) < .009, 'both feet support the neutral pose');
    }
    rig.applyPose(0, 0);
    const standing = height('Hips');
    chair.apply(CHAIR_SIT_SECONDS, 1);
    assert(height('Hips') < standing - .06);
    assert(height('LeftFoot') > .24 && height('RightFoot') > .24, 'both socked feet clear the floor on the tall chair');
    chair.apply(0, 0);
    rig.applyPose(0, 0);
    const sofa = clip('Luna_CMU_75_20');
    sofaPlayer(rig.mesh, sofa)(sofa.duration);
    assert(height('Hips') < standing - .15);
    for (let row = 0; row < 3; row++) {
      const pickup = clip('Library_Pickup_' + row);
      assert(pickup.tracks.some(track => track.name === 'LibraryBook.position'));
      for (const track of pickup.tracks) assert(scene.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName), track.name);
    }
    const bytes = readFileSync(new URL('luna-cabin-actions-ribbon.glb', assets));
    const cabin = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const actions = Object.fromEntries(cabin.animations.map(action => [action.name, action]));
    const play = createCabinActionPlayer(rig.mesh, actions);
    rig.applyPose(0, 0);
    play('floorSit', actions.floorSit.duration);
    assert(height('Hips') < .24);
    play('floorStand', actions.floorStand.duration);
    assert(height('Hips') > .65);
  } finally {
    chair.dispose();
    rig.dispose();
  }
});
