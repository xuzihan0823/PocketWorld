import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleSide, Group, Quaternion, Raycaster, Triangle, Vector3 } from 'three';
import { load } from './load-for-validation.mjs';
import { createResidentRig } from './residentRig.ts';
import { sampleStairGait, stairTreadSurface } from './stairGait.ts';
import { CABIN_STAIRS, STAIR_RISE, STAIR_TREAD_RUN } from './cabinStairs.ts';
import { createPlushPose, createPlushShape, gripPlush } from './plushCarry.ts';
import { createPlushBodies } from './plushMotion.ts';
import { PLUSH_DOLLS } from './cabinLayout.ts';
import { applyCabinPerformance, createCabinActionPlayer, PICKUP_GRIP_TIME } from './cabinActions.ts';
import { bearPickupSourceTime } from './bearPickupTiming.ts';

const model = name => new URL('../../../assets/public/models/' + name, import.meta.url);
async function resident(authored = true) {
  const [{ gltf: luna }, { gltf: hands }] = await Promise.all([
    load(model('resident/luna-cardigan.glb')), load(model('resident/luna-cardigan-hands.glb')),
  ]);
  return createResidentRig(luna.scene, luna.animations.find(c => c.name === 'Walk_Grounded_Loop'), true, authored ? hands : undefined);
}
const position = (rig, name) => rig.mesh.getObjectByName('mixamorig' + name).getWorldPosition(new Vector3());
function palm(rig, side) {
  const wrist = position(rig, side + 'Hand');
  // Middle1 is misplaced inside this model's palm. Use the actual knuckle row.
  const knuckle = position(rig, side + 'HandIndex1').add(position(rig, side + 'HandRing1'))
    .add(position(rig, side + 'HandPinky1')).multiplyScalar(1 / 3);
  const axis = knuckle.clone().sub(wrist);
  return { wrist, axis, center: wrist.clone().lerp(knuckle, .6), normal: axis.clone()
    .cross(position(rig, side + 'HandIndex1').sub(position(rig, side + 'HandPinky1'))).normalize()
    .multiplyScalar(side === 'Left' ? 1 : -1) };
}

test('cardigan stair palms face inward through both cycles without changing legs', async () => {
  const rig = await resident(), baseline = await resident(false);
  try {
    for (const up of [true, false]) {
      let previous;
      for (let i = 0; i <= 240; i++) {
        const progress = 6 + 2 * i / 240, gait = sampleStairGait(progress, up);
        for (const r of [rig, baseline]) {
          r.mesh.rotation.y = gait.yaw;
          r.mesh.position.set(CABIN_STAIRS.x, progress * STAIR_RISE, CABIN_STAIRS.lowerZ - progress * STAIR_TREAD_RUN);
          r.applyPose(gait.phase, 0); r.applyStairPose(gait, CABIN_STAIRS.x, stairTreadSurface);
          r.mesh.updateMatrixWorld(true);
        }
        const rotations = [];
        for (const side of ['Right', 'Left']) {
          const p = palm(rig, side);
          const angle = p.axis.angleTo(p.wrist.clone().sub(position(rig, side + 'ForeArm')));
          assert.ok(angle < 8 * Math.PI / 180, `stair wrist bends ${angle * 180 / Math.PI} degrees`);
          assert.ok(p.normal.applyQuaternion(rig.mesh.quaternion.clone().invert()).x * (side === 'Left' ? -1 : 1) > .9);
          for (const part of ['Arm', 'ForeArm', 'Hand']) rotations.push(rig.mesh.getObjectByName('mixamorig' + side + part).quaternion.clone());
          for (const part of ['UpLeg', 'Leg', 'Foot', 'ToeBase'])
            assert.ok(position(rig, side + part).distanceTo(position(baseline, side + part)) < 1e-6, 'leg trajectory is unchanged');
        }
        if (previous) rotations.forEach((q, j) => assert.ok(q.angleTo(previous[j]) < .04, 'stair hand has no cycle seam'));
        previous = rotations;
      }
    }
  } finally { rig.dispose(); baseline.dispose(); }
});

// Keep triangles in toy-local space; measure the rendered skin, not joints or proxy pads.
function surfaces(scene) {
  const result = [];
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.material = mesh.material.clone(); mesh.material.side = DoubleSide;
    const { position: p } = mesh.geometry.attributes, index = mesh.geometry.index, triangles = [];
    for (let i = 0; i < (index?.count ?? p.count); i += 3) triangles.push(new Triangle(...[0, 1, 2]
      .map(k => new Vector3().fromBufferAttribute(p, index ? index.getX(i + k) : i + k))));
    result.push({ mesh, triangles });
  });
  return result;
}
function nearest(point, parts) {
  let best = Infinity;
  const near = new Vector3();
  for (const { mesh, triangles } of parts) {
    const local = mesh.worldToLocal(point.clone());
    for (const triangle of triangles) {
      triangle.closestPointToPoint(local, near);
      best = Math.min(best, mesh.localToWorld(near).distanceTo(point));
    }
  }
  return best;
}

test('cardigan bear grip seats real palms during pickup, carry and reversed release', async () => {
  const rig = await resident();
  const [{ gltf: actions }, { gltf: bear }] = await Promise.all([
    load(model('resident/luna-cabin-actions-cardigan.glb')), load(model('furniture/plush-bear.glb')),
  ]);
  const deck = new Group(), root = new Group(); deck.add(root); root.add(rig.mesh);
  deck.position.set(2.3, 1.7, -.8); root.rotation.y = Math.PI / 2;
  const placement = PLUSH_DOLLS.find(p => p.id === 'plush-bear'), [body] = createPlushBodies([placement]);
  body.x = .5; body.z = 0; body.yaw = Math.PI / 2;
  const shape = createPlushShape(bear.scene, placement.height), grip = gripPlush(body, shape), toy = new Group();
  const display = bear.scene.clone(true); display.scale.setScalar(shape.scale);
  display.position.copy(shape.origin).multiplyScalar(-shape.scale); toy.add(display);
  const parts = surfaces(display), clips = Object.fromEntries(actions.animations.map(c => [c.name, c]));
  rig.applyPose(0, 0); deck.updateMatrixWorld(true);
  const animate = createCabinActionPlayer(rig.mesh, clips), hold = createPlushPose(rig.mesh);
  const samples = { Right: [], Left: [] };
  rig.mesh.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < skinIndex.count; i++) for (const side of ['Right', 'Left']) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (mesh.skeleton.bones[skinIndex.getComponent(i, k)].name.includes(side + 'Hand')) weight += skinWeight.getComponent(i, k);
      if (weight > .7) samples[side].push([mesh, i]);
    }
  });
  const ray = new Raycaster(), hits = [], point = new Vector3();
  const times = [1.46, 1.64, 1.81, 1.98, 2.14, 2.30, 2.60, clips.bearPickUp.duration];
  const forward = new Map();
  try {
    for (const time of [...times, ...times.toReversed()]) {
      const walking = time === clips.bearPickUp.duration;
      rig.applyPose(.28, walking ? 1 : 0);
      if (!walking) applyCabinPerformance({ kind: 'plush', time, bearPickup: true }, clips, animate);
      hold(root, grip, bearPickupSourceTime(time), PICKUP_GRIP_TIME);
      toy.position.copy(grip.center); toy.rotation.copy(grip.rotation); toy.updateMatrixWorld(true); deck.updateMatrixWorld(true);
      const snapshots = [];
      for (const side of ['Right', 'Left']) {
        const p = palm(rig, side), distances = [], out = new Vector3(side === 'Left' ? 1 : -1, 0, 0).applyQuaternion(root.quaternion);
        for (const [mesh, i] of samples[side]) {
          mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
          const relative = point.clone().sub(p.center);
          if (relative.length() < .027 && relative.dot(p.normal) > .002) distances.push(nearest(point, parts));
          ray.set(point, out); hits.length = 0; ray.intersectObject(toy, true, hits);
          if (hits[0] && hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).dot(out) > 0)
            assert.ok(hits[0].distance < .004, `${side} skin penetrates bear by ${hits[0].distance} at ${time}`);
        }
        distances.sort((a, b) => a - b);
        assert.ok(distances.length > 25, 'test includes actual palm surface');
        assert.ok(distances[0] < (bearPickupSourceTime(time) >= 2.7 ? .0045 : .008), `${side} palm floats ${distances[0]} m at ${time}`);
        assert.ok(distances[Math.floor(distances.length / 2)] < .015, `${side} palm broadly separates from bear`);
        snapshots.push(p.wrist.toArray(), p.normal.toArray());
      }
      if (forward.has(time)) snapshots.flat().forEach((v, i) => assert.ok(Math.abs(v - forward.get(time)[i]) < 1e-5, 'reverse playback has identical contact'));
      else forward.set(time, snapshots.flat());
    }
  } finally { rig.dispose(); }
});

for (const id of ['plush-bunny', 'plush-penguin']) test(`cardigan hand calibration leaves ${id} unchanged`, async () => {
  const rigs = [await resident(), await resident(false)];
  const placement = PLUSH_DOLLS.find(p => p.id === id), { gltf: toy } = await load(model(placement.path));
  const results = [];
  try {
    for (const rig of rigs) {
      const deck = new Group(), root = new Group(); deck.add(root); root.add(rig.mesh);
      rig.applyPose(0, 0); deck.updateMatrixWorld(true);
      const [body] = createPlushBodies([placement]); body.x = 0; body.z = .5; body.yaw = 0;
      const grip = gripPlush(body, createPlushShape(toy.scene, placement.height));
      createPlushPose(rig.mesh)(root, grip, 4, PICKUP_GRIP_TIME);
      results.push([grip.center.toArray(), ...['Right', 'Left'].flatMap(side => ['Arm', 'ForeArm', 'Hand']
        .map(part => rig.mesh.getObjectByName('mixamorig' + side + part).quaternion.toArray()))].flat());
    }
    results[0].forEach((v, i) => assert.ok(Math.abs(v - results[1][i]) < 1e-7));
  } finally { rigs.forEach(r => r.dispose()); }
});

test('cardigan bear wrist trajectories are continuous at 30, 60 and 120 Hz', async () => {
  const rig = await resident(), root = new Group(), deck = new Group(); deck.add(root); root.add(rig.mesh);
  const [{ gltf: actions }, { gltf: bear }] = await Promise.all([
    load(model('resident/luna-cabin-actions-cardigan.glb')), load(model('furniture/plush-bear.glb')),
  ]);
  const clips = Object.fromEntries(actions.animations.map(c => [c.name, c])), animate = createCabinActionPlayer(rig.mesh, clips);
  const placement = PLUSH_DOLLS.find(p => p.id === 'plush-bear'), [body] = createPlushBodies([placement]);
  body.x = 0; body.z = .5; body.yaw = 0;
  rig.applyPose(0, 0); deck.updateMatrixWorld(true);
  const hold = createPlushPose(rig.mesh), shape = createPlushShape(bear.scene, placement.height);
  try {
    for (const hz of [30, 60, 120]) for (const reverse of [false, true]) {
      const grip = gripPlush(body, shape); let previous;
      const count = Math.ceil(clips.bearPickUp.duration * hz);
      for (let i = 0; i <= count; i++) {
        const t = Math.min(clips.bearPickUp.duration, (reverse ? count - i : i) / hz);
        rig.applyPose(0, 0); applyCabinPerformance({ kind: 'plush', time: t, bearPickup: true }, clips, animate);
        hold(root, grip, bearPickupSourceTime(t), PICKUP_GRIP_TIME); deck.updateMatrixWorld(true);
        const state = ['Right', 'Left'].map(side => ({
          position: position(rig, side + 'Hand'), rotation: rig.mesh.getObjectByName('mixamorig' + side + 'Hand').getWorldQuaternion(new Quaternion()),
        }));
        if (previous) state.forEach((s, index) => {
          assert.ok(s.position.distanceTo(previous[index].position) < .07, `wrist position jumps at ${t}, ${hz} Hz`);
          assert.ok(s.rotation.angleTo(previous[index].rotation) < .25, `wrist rotation jumps at ${t}, ${hz} Hz`);
        });
        previous = state;
      }
    }
  } finally { rig.dispose(); }
});
