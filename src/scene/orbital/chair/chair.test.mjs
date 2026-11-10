import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { load as loadAsset } from '../../../../scripts/resident-glb-loader.mjs';

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === 'three' ? THREE : dependencies[name] });
  return exports;
}
const mode = load('../secondary/residentMode.ts');
const poses = load('../chairPose.ts', { './secondary/residentMode': mode });
const seatingModule = load('./ChairSeating.ts', { '../chairPose': poses, '../secondary/residentMode': mode });
const { ChairSeating, OFFICE_CHAIR } = seatingModule;
const turnModule = load('./TurnFootPlant.ts');
const { ImportedPose } = load('./ImportedPose.ts');
const { ChairContact } = load('./ChairContact.ts', { '../chairPose': poses, './ChairSeating': seatingModule, './TurnFootPlant': turnModule });
const pose = () => ({ x: 0, z: 0, yaw: .2 - Math.PI, vx: 0, vz: 0, spin: 0, drop: 0 });

for (const fps of [30, 60, 144]) test(`${fps} FPS: enter, bind, stand and repeat without moving the ground root vertically`, () => {
  const actor = new THREE.Group(), chair = pose(), seating = new ChairSeating();
  actor.position.set(-.7, 0, 1.1);
  let seated = 0;
  for (let repeat = 0; repeat < 2; repeat++) {
    assert.ok(seating.begin(actor, chair, [[0, OFFICE_CHAIR.approachAhead]], () => seated++));
    const phases = [];
    for (let i = 0; i < 15 * fps && seating.phase !== 'SEATED_IDLE'; i++) {
      if (phases.at(-1) !== seating.phase) phases.push(seating.phase);
      seating.update(actor, chair, 1 / fps, () => true);
      assert.equal(actor.position.y, 0);
    }
    assert.deepEqual(phases, ['APPROACH', 'ALIGN', 'TURN', 'SIT_DOWN']);
    assert.equal(seating.phase, 'SEATED_IDLE'); assert.ok(seating.bound);
    const position = actor.position.clone();
    for (let i = 0; i < fps; i++) seating.update(actor, chair, 1 / fps, () => true);
    assert.ok(actor.position.distanceTo(position) < 1e-8);
    seating.requestExit();
    for (let i = 0; i < 8 * fps && seating.active; i++) seating.update(actor, chair, 1 / fps, () => true);
    assert.equal(seating.active, false); assert.equal(actor.position.y, 0);
    assert.ok(Math.abs(actor.position.z - OFFICE_CHAIR.approachAhead) < 1e-6);
  }
  assert.equal(seated, 2);
});

test('cancel during lowering finishes a supported sit then rises; a blocked route aborts without teleporting', () => {
  const actor = new THREE.Group(), chair = pose(), seating = new ChairSeating();
  actor.position.set(0, 0, .76);
  let callbacks = 0; seating.begin(actor, chair, [[0, .76]], () => callbacks++);
  while (seating.phase !== 'SIT_DOWN') seating.update(actor, chair, 1 / 60, () => true);
  seating.update(actor, chair, .05, () => true);
  const atCancel = actor.position.clone(); seating.requestExit();
  assert.equal(seating.phase, 'SIT_DOWN');
  assert.ok(actor.position.equals(atCancel));
  for (let i = 0; i < 600 && seating.active; i++) seating.update(actor, chair, 1 / 60, () => true);
  assert.equal(callbacks, 0); assert.equal(seating.active, false);
  seating.begin(actor, chair, [[1, 1]], () => callbacks++);
  const before = actor.position.clone(); seating.update(actor, chair, .03, () => false);
  assert.equal(seating.active, false); assert.ok(actor.position.equals(before));
});

test('the preserved SitCycle plants real sole vertices and the contact correction clears the seat', async () => {
  const m = await loadAsset('public/models/resident/luna-tripo-transitions.glb');
  assert.equal(m.sha256, '5e1da819d580426618934abf4fc29acc9b92264fff2d9bacf20565a255272ec6');
  const room = new THREE.Group(), actor = new THREE.Group(); room.add(actor); actor.add(m.gltf.scene); m.gltf.scene.scale.setScalar(1.45);
  Object.assign(poses.CHAIR_POSES.habitat, pose()); actor.position.z = OFFICE_CHAIR.rootAhead;
  const sample = m.select('SitCycle'), originalGeometry = m.mesh.geometry, originalUV = originalGeometry.attributes.uv.array.slice();
  m.gltf.scene.scale.setScalar(1.45); // select() restores GLB TRS; test the actual room scale.
  const contact = new ChairContact(m.mesh, actor), seating = new ChairSeating();
  let min = Infinity, max = -Infinity, contacts = 0;
  const soles = [];
  sample(2.4); room.updateMatrixWorld(true); m.mesh.skeleton.update();
  const body = new ImportedPose(m.gltf.scene);
  for (let i = 0; i < originalGeometry.attributes.position.count; i++) {
    const p = m.mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.mesh.matrixWorld);
    if (p.y < .005) soles.push(i);
  }
  for (const [phase, start] of [['SIT_DOWN', 2.4], ['STAND_UP', 5.8]]) for (let i = 0; i <= 102; i++) {
    seating.phase = phase; seating.clipTime = start + i / 60;
    body.sample(() => sample(seating.clipTime)); contact.poseDress(seating); contact.poseArms(seating); room.updateMatrixWorld(true); m.mesh.skeleton.update(); contact.update(seating);
    const height = Math.min(...soles.map(index => m.mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(m.mesh.matrixWorld).y));
    min = Math.min(min, height); max = Math.max(max, height);
    if (i !== 102 || phase !== 'SIT_DOWN') continue;
    for (let index = 0; index < contact.regions.length; index++) {
      if (contact.regions[index] !== 1) continue;
      const p = m.mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(m.mesh.matrixWorld);
      if (Math.abs(p.x) < .23 && Math.abs(p.z) < .215) { assert.ok(p.y >= OFFICE_CHAIR.seatHeight + .0039, `${index}: ${p.y}`); contacts++; }
    }
  }
  assert.ok(min > -.001 && max < .001, `${min} / ${max}`); assert.ok(contacts > 300);
  assert.deepEqual(m.mesh.geometry.attributes.uv.array, originalUV);
  assert.deepEqual(m.mesh.geometry.attributes.skinWeight.array, originalGeometry.attributes.skinWeight.array);
  contact.dispose(); assert.equal(m.mesh.geometry, originalGeometry);
  console.log(JSON.stringify({ soleMinimum: min, soleMaximum: max, seatSurfaceSamples: contacts }));
});

test('alternating turn steps preserve limb lengths and keep the support ankle planted', async () => {
  const m = await loadAsset('public/models/resident/luna-tripo-transitions.glb');
  const room = new THREE.Group(), actor = new THREE.Group(); room.add(actor); actor.add(m.gltf.scene); m.gltf.scene.scale.setScalar(1.45);
  actor.rotation.y = Math.PI; const sample = m.select('SitCycle'); sample(9); room.updateMatrixWorld(true);
  m.gltf.scene.scale.setScalar(1.45); room.updateMatrixWorld(true);
  const body = new ImportedPose(m.gltf.scene);
  const turn = new turnModule.TurnFootPlant(m.gltf.scene, actor), seating = new ChairSeating();
  seating.phase = 'TURN'; seating.turnFrom = Math.PI; seating.turnAngle = -Math.PI;
  const lengths = ['Left', 'Right'].map(side => [m.bone(side + 'UpLeg').getWorldPosition(new THREE.Vector3()).distanceTo(m.bone(side + 'Leg').getWorldPosition(new THREE.Vector3())), m.bone(side + 'Leg').getWorldPosition(new THREE.Vector3()).distanceTo(m.bone(side + 'Foot').getWorldPosition(new THREE.Vector3()))]);
  let maxSupportDrift = 0;
  for (let i = 0; i <= 240; i++) {
    seating.turnProgress = i / 240; const t = Math.min(1, seating.turnProgress * 1.5);
    actor.rotation.y = Math.PI - Math.PI * t * t * (3 - 2 * t);
    body.sample(() => sample(9)); turn.apply(seating); room.updateMatrixWorld(true);
    const step = Math.min(5, Math.floor(seating.turnProgress * 6));
    turn.legs.forEach((leg, side) => {
      const hip = leg.thigh.getWorldPosition(new THREE.Vector3()), knee = leg.shin.getWorldPosition(new THREE.Vector3()), foot = leg.foot.getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(hip.distanceTo(knee) - lengths[side][0]) < 1e-6);
      assert.ok(Math.abs(knee.distanceTo(foot) - lengths[side][1]) < 1e-6);
      if (side !== step % 2) maxSupportDrift = Math.max(maxSupportDrift, foot.distanceTo(leg.anchor));
    });
  }
  assert.ok(maxSupportDrift < .003, `${maxSupportDrift}`);
  console.log(JSON.stringify({ maxSupportAnkleDrift: maxSupportDrift }));
});

test('walk/idle crossfades correct sole penetration without lifting the actor root', async () => {
  const m = await loadAsset('public/models/resident/luna-tripo-transitions.glb');
  const room = new THREE.Group(), actor = new THREE.Group(); room.add(actor); actor.add(m.gltf.scene); m.gltf.scene.scale.setScalar(1.45);
  const mixer = new THREE.AnimationMixer(m.gltf.scene);
  const walk = mixer.clipAction(m.gltf.animations.find(c => c.name === 'Walk'));
  const idle = mixer.clipAction(m.gltf.animations.find(c => c.name === 'SitCycle'));
  walk.play(); idle.play(); walk.paused = idle.paused = true; walk.weight = 0; idle.weight = 1; idle.time = 9; mixer.update(0);
  const body = new ImportedPose(m.gltf.scene), turn = new turnModule.TurnFootPlant(m.gltf.scene, actor);
  const point = new THREE.Vector3(); let before = Infinity, after = Infinity;
  for (const weight of [.15, .35, .6, .85]) for (let frame = 0; frame < 72; frame++) {
    walk.time = frame / 60; walk.weight = weight; idle.weight = 1 - weight;
    body.sample(() => mixer.update(0)); room.updateMatrixWorld(true);
    for (const indices of turn.soles) for (const index of indices) before = Math.min(before, m.mesh.getVertexPosition(index, point).applyMatrix4(m.mesh.matrixWorld).y);
    turn.keepSolesAboveFloor(); room.updateMatrixWorld(true);
    for (const indices of turn.soles) for (const index of indices) after = Math.min(after, m.mesh.getVertexPosition(index, point).applyMatrix4(m.mesh.matrixWorld).y);
    assert.equal(actor.position.y, 0);
  }
  assert.ok(before < -.002); assert.ok(after > -.0002, `${after}`);
  console.log(JSON.stringify({ blendedSoleBefore: before, blendedSoleAfter: after }));
});
