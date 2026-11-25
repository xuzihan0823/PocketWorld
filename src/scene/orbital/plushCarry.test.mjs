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

for (const placement of PLUSH_DOLLS) test(placement.id + ' stays clear of Luna while both hands support it', async () => {
  const [{ gltf: luna }, { gltf: actions }, { gltf: plush }] = await Promise.all([
    load(model('resident/luna-walk-room.glb')), load(model('resident/luna-cabin-actions-everyday.glb')),
    load(model(placement.path)),
  ]);
  const rig = createResidentRig(luna.scene, luna.animations.find(clip => clip.name === 'Walk_Grounded_Loop'));
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
  const skin = rig.mesh.getObjectByName('Luna_Surface'), geometry = skin.geometry;
  const joints = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const samples = [];
  for (let i = 0; i < joints.count; i += 4) {
    let strongest = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, strongest)) strongest = k;
    const name = skin.skeleton.bones[joints.getComponent(i, strongest)].name;
    samples.push({ i, foot: /Foot|Toe/.test(name), hand: name.includes('Hand'), arm: /Hand|Arm/.test(name), side: name.includes('Left') ? 1 : -1 });
  }
  const bounds = new Box3(), point = new Vector3(), outward = new Vector3(), hits = [], ray = new Raycaster();
  try {
    for (const t of [PICKUP_GRIP_TIME, 2.25, 2.45, 2.50, 2.55, 2.60, 2.65, 2.72, 3.3, clips.pickUp.duration, 2.55, PICKUP_GRIP_TIME]) {
      const walking = t === clips.pickUp.duration;
      rig.applyPose(.28, walking ? 1 : 0);
      if (!walking) applyCabinPerformance({ kind: 'plush', time: t }, clips, animate);
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
      if (!walking) assert.ok(soles.every(y => Math.abs(y) < .005), 'both soles stay planted at ' + t);
      assert.equal(contact.size, 2, 'both hands remain at the fabric at ' + t);
    }
  } finally { rig.dispose(); }
});
