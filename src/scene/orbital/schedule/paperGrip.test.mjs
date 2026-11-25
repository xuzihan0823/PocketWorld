import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { applyCabinPerformance, createCabinActionPlayer, PICKUP_GRIP_TIME } from '../cabinActions.ts';
import { load } from '../load-for-validation.mjs';
import { createResidentRig } from '../residentRig.ts';
import { paperGeometry } from './paperGeometry.ts';
import { createPaperPose } from './paperGrip.ts';

test('the right hand lifts the seeded paper ball from its surface and retraces the grip on cancel', async () => {
  const asset = name => new URL('../../../../assets/public/models/resident/luna-' + name + '.glb', import.meta.url);
  const [{ gltf: luna }, { gltf: actions }] = await Promise.all([load(asset('walk-room')), load(asset('cabin-actions-everyday'))]);
  const rig = createResidentRig(luna.scene, luna.animations.find(clip => clip.name === 'Walk_Grounded_Loop'));
  const root = new Group();
  root.add(rig.mesh);
  root.rotation.y = .08;
  const clips = Object.fromEntries(actions.animations.map(clip => [clip.name, clip]));
  const animate = createCabinActionPlayer(rig.mesh, clips), grip = createPaperPose(rig.mesh);
  const paper = new Mesh(paperGeometry(true).geometry, new MeshBasicMaterial({ side: DoubleSide }));
  paper.rotation.set(.4, 3, .3);
  const skin = rig.mesh.getObjectByName('Luna_Surface');
  const { skinIndex, skinWeight } = skin.geometry.attributes;
  const samples = [];
  for (let i = 0; i < skinIndex.count; i++) {
    let joint = 0;
    for (let j = 1; j < 4; j++) if (skinWeight.getComponent(i, j) > skinWeight.getComponent(i, joint)) joint = j;
    if (skin.skeleton.bones[skinIndex.getComponent(i, joint)].name.includes('RightHand')) samples.push(i);
  }
  const ray = new Raycaster(), vertex = new Vector3(), direction = new Vector3(), hits = [];
  try {
    for (const distance of [.29, .37, .44]) {
      const floor = new Vector3(0, .105, distance);
      const frames = [1.65, 1.80, PICKUP_GRIP_TIME, ...Array.from({ length: 41 }, (_, i) => 1.95 + .05 * i), clips.pickUp.duration];
      for (const time of [...frames, ...frames.slice().reverse()]) {
        rig.applyPose(0, 0);
        applyCabinPerformance({ kind: 'paper', time }, clips, animate);
        grip(floor, time, paper.position);
        if (time <= PICKUP_GRIP_TIME) assert.ok(paper.position.distanceTo(floor) < 1e-6);
        root.updateMatrixWorld(true);
        skin.skeleton.update();
        paper.updateMatrixWorld(true);
        let closest = Infinity;
        for (const i of samples) {
          skin.getVertexPosition(i, vertex).applyMatrix4(skin.matrixWorld);
          direction.subVectors(vertex, paper.position);
          const radius = direction.length();
          if (radius > .13) continue;
          ray.set(paper.position, direction.normalize());
          hits.length = 0;
          ray.intersectObject(paper, false, hits);
          if (hits.length) closest = Math.min(closest, radius - hits[0].distance);
        }
        const pose = time + ' s at reach ' + distance + ' m: ' + closest;
        assert.ok(closest >= -.004, 'paper penetration at ' + pose);
        if (time >= PICKUP_GRIP_TIME) assert.ok(closest < .018, 'lost contact at ' + pose);
      }
    }
  } finally { rig.dispose(); paper.geometry.dispose(); paper.material.dispose(); }
});
