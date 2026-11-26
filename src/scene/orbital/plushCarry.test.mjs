import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, DoubleSide, Group, Raycaster, Vector3 } from 'three';
import { applyCabinPerformance, createCabinActionPlayer, PICKUP_GRIP_TIME } from './cabinActions.ts';
import { PLUSH_DOLLS } from './cabinLayout.ts';
import { load } from './load-for-validation.mjs';
import { createPlushPose, createPlushShape, gripPlush } from './plushCarry.ts';
import { createPlushBodies } from './plushMotion.ts';
import { createResidentRig } from './residentRig.ts';

const model = path => new URL('../../../assets/public/models/' + path, import.meta.url);

const outfits = {
  everyday: ['luna-walk-room.glb', 'Luna_Surface'],
  ribbon: ['luna-ribbon.glb', 'Luna_|_Ribbon_jacket'],
  cardigan: ['luna-cardigan.glb', 'Luna_Cardigan_Surface'],
};
const cases = PLUSH_DOLLS.flatMap(placement => (placement.id === 'plush-bear' ? Object.keys(outfits) : ['everyday'])
  .map(outfit => ({ placement, outfit })));

for (const { placement, outfit } of cases) test(placement.id + ' stays clear of ' + outfit + ' while both hands support it', async () => {
  const [file, surface] = outfits[outfit];
  const [{ gltf: luna }, { gltf: actions }, { gltf: plush }] = await Promise.all([
    load(model('resident/' + file)), load(model('resident/luna-cabin-actions-' + outfit + '.glb')),
    load(model(placement.path)),
  ]);
  const rig = createResidentRig(luna.scene, luna.animations.find(clip => clip.name === 'Walk_Grounded_Loop'), outfit === 'cardigan');
  const deck = new Group(), root = new Group(), toy = new Group();
  deck.position.set(3.4, 2, -1);
  deck.add(root);
  root.rotation.y = Math.PI / 2;
  root.add(rig.mesh);
  const [body] = createPlushBodies([placement]);
  body.x = .50;
  body.z = 0;
  const shape = createPlushShape(plush.scene, placement.height), grip = gripPlush(body, shape);
  const display = plush.scene.clone(true);
  display.position.copy(shape.origin).multiplyScalar(-shape.scale);
  display.scale.setScalar(shape.scale);
  toy.add(display);
  const meshes = [];
  display.traverse(part => {
    if (part.isMesh) {
      part.material = part.material.clone();
      part.material.side = DoubleSide;
      meshes.push(part);
    }
  });
  const clips = Object.fromEntries(actions.animations.map(clip => [clip.name, clip]));
  const animate = createCabinActionPlayer(rig.mesh, clips), hold = createPlushPose(rig.mesh);
  const skin = rig.mesh.getObjectByName(surface), geometry = skin.geometry;
  const joints = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const samples = [];
  for (let i = 0; i < joints.count; i += 4) {
    let strongest = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, strongest)) strongest = k;
    const name = skin.skeleton.bones[joints.getComponent(i, strongest)].name;
    samples.push({ i, foot: /Foot|Toe/.test(name), hand: name.includes('Hand'), arm: /Hand|Arm/.test(name), side: name.includes('Left') ? 1 : -1 });
  }
  const support = ['Left', 'Right'].flatMap(side => ['Foot', 'ToeBase'].map(part =>
    luna.scene.getObjectByName('mixamorig' + side + part)));
  const bounds = new Box3(), point = new Vector3(), outward = new Vector3(), hits = [], ray = new Raycaster();
  try {
    const times = [PICKUP_GRIP_TIME, 2.25, 2.45, 2.50, 2.55, 2.60, 2.65, 2.72, 3.3];
    const frames = times.map(time => ({ time }));
    for (const stride of placement.id === 'plush-bear' ? [0, .25, .50, .75] : [.28]) {
      frames.push({ time: clips.pickUp.duration, stride });
    }
    frames.push(...times.slice().reverse().map(time => ({ time })));
    for (const { time: t, stride } of frames) {
      const walking = stride !== undefined;
      rig.applyPose(stride ?? .28, walking ? 1 : 0);
      if (!walking) applyCabinPerformance({ kind: 'plush', time: t }, clips, animate);
      deck.updateMatrixWorld(true);
      const footPositions = support.map(bone => bone.getWorldPosition(new Vector3()));
      hold(root, grip, t, PICKUP_GRIP_TIME);
      toy.position.copy(grip.center);
      toy.rotation.copy(grip.rotation);
      toy.updateMatrixWorld(true);
      deck.updateMatrixWorld(true);
      skin.skeleton.update();
      if (t === PICKUP_GRIP_TIME) {
        const ground = deck.localToWorld(new Vector3(body.x, placement.height / 2, body.z));
        assert.ok(toy.position.distanceTo(ground) < 1e-6, 'floor contact survives deck placement and reversed playback');
      }
      bounds.setFromObject(toy).expandByScalar(.025);
      const contact = new Set(), soles = [Infinity, Infinity];
      for (const { i, arm, hand, side, foot } of samples) {
        skin.getVertexPosition(i, point).applyMatrix4(skin.matrixWorld);
        if (foot) {
          const index = side === 1 ? 1 : 0;
          soles[index] = Math.min(soles[index], point.y - deck.position.y);
        }
        if (!bounds.containsPoint(point)) continue;
        outward.set(arm ? side : 0, 0, arm ? 0 : -1).applyQuaternion(root.quaternion);
        ray.set(point, outward);
        for (const part of meshes) {
          hits.length = 0;
          ray.intersectObject(part, false, hits);
          const hit = hits[0];
          // A first hit on the inside of a closed piece measures the depth of the skin in that piece.
          if (hit && hit.face.normal.clone().transformDirection(part.matrixWorld).dot(outward) > 0)
            assert.ok(hit.distance < .004, `skin vertex ${i} penetrates ${part.name} by ${hit.distance} m at ${t} s`);
        }
        if (hand && !contact.has(side)) {
          ray.set(point, outward.negate());
          hits.length = 0;
          ray.intersectObject(toy, true, hits);
          if (hits[0]?.distance < .022) contact.add(side);
        }
      }
      if (!walking) {
        support.forEach((bone, index) => assert.ok(bone.getWorldPosition(point).distanceTo(footPositions[index]) < 1e-6, bone.name));
        if (outfit === 'everyday') assert.ok(soles.every(y => Math.abs(y) < .005), 'both soles stay planted at ' + t);
      }
      assert.equal(contact.size, 2, 'both hands remain at the fabric at ' + t);
    }
    if (placement.id === 'plush-bear' && outfit === 'cardigan') {
      const joints = ['Right', 'Left'].flatMap(side => ['Arm', 'ForeArm', 'Hand'].map(part =>
        luna.scene.getObjectByName(`mixamorig${side}${part}`)));
      // Include the previously abrupt elbow at first reach, and both passes near full arm extension.
      const windows = [[.61, .86], [1.43, 1.74], [3.65, clips.pickUp.duration]];
      for (const hz of [30, 60, 120]) for (const reverse of [false, true]) for (const [start, end] of windows) {
        const count = Math.ceil((end - start) * hz);
        let last;
        for (let i = 0; i <= count; i++) {
          const time = start + (end - start) * (reverse ? count - i : i) / count;
          rig.applyPose(0, 0);
          applyCabinPerformance({ kind: 'plush', time }, clips, animate);
          hold(root, grip, time, PICKUP_GRIP_TIME);
          if (last) joints.forEach((joint, j) => assert.ok(joint.quaternion.angleTo(last[j]) < 12 / hz,
            `${joint.name} jumps at ${time.toFixed(3)}s (${hz}Hz, reversed ${reverse})`));
          last = joints.map(joint => joint.quaternion.clone());
        }
      }
    }
  } finally { rig.dispose(); }
});
