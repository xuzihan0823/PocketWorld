import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CABIN_STAIRS, STAIR_RISE, STAIR_TREAD_RUN } from './cabinStairs.ts';
import { createResidentRig } from './residentRig.ts';
import { sampleStairGait, stairFootfall, stairTreadSurface } from './stairGait.ts';
import { load } from './load-for-validation.mjs';

const sides = ['Right', 'Left'];

test('the two stair gaits alternate support and place a contact on all 18 treads', () => {
  for (const ascending of [true, false]) {
    const contacts = new Set();
    const supportSides = new Set();
    for (let i = 0; i <= 18 * 24; i++) {
      const travel = i / 24;
      const progress = ascending ? travel : CABIN_STAIRS.steps - travel;
      const pose = sampleStairGait(progress, ascending);
      assert.equal(pose.footfall, stairFootfall(progress, ascending));
      const support = pose.feet.findIndex(foot => !foot.swing);
      assert.notEqual(support, -1);
      assert.equal(pose.feet.filter(foot => foot.swing).length, 1);
      assert.ok(Math.abs(stairTreadSurface(pose.feet[support].z) - pose.feet[support].y) < 1e-10);
      const tread = Math.round(pose.feet[support].y / STAIR_RISE);
      contacts.add(tread);
      supportSides.add(support);
      if (i === 0 || i === 18 * 24) assert.equal(pose.weight, 1);
    }
    assert.deepEqual([...contacts].sort((a, b) => a - b), Array.from({ length: 19 }, (_, i) => i));
    assert.equal(supportSides.size, 2);
  }
  assert.notEqual(sampleStairGait(5.4, true).lean, sampleStairGait(12.6, false).lean);
});

// Independent same-side knee measurements (degrees) from the two 30 Hz Manny GLBs.
test('the baked gait preserves the right and left knee curves of each MotionSmith Take 1', () => {
  for (const [ascending, travel, reference] of [
    [true, 8 + 8 / 16 - .78, [91.1, 18.9]],   // ascent frame 56
    [true, 9 + 8 / 16 - .78, [27.8, 91.7]],   // ascent frame 72
    [false, (9 + 5 / 19 + .18) / (1 + .4 / 18), [83.7, 14.9]],  // descent frame 62
    [false, (10 + 5 / 18 + .18) / (1 + .4 / 18), [12.8, 83.0]], // descent frame 81
  ]) {
    const gait = sampleStairGait(ascending ? travel : CABIN_STAIRS.steps - travel, ascending);
    gait.legs.forEach((leg, side) => assert(Math.abs(leg.flexion * 180 / Math.PI - reference[side]) < .1));
  }
});

test('both elbows and wrists articulate as the hands exchange leading sides', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
  const asset = clone(gltf.scene);
  const rig = createResidentRig(asset, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'));
  try {
    for (const ascending of [true, false]) {
      rig.mesh.rotation.y = ascending ? Math.PI : 0;
      const angles = sides.map(() => [[], []]), leads = [];
      for (let i = 0; i <= 48; i++) {
        const progress = 6 + i / 24, gait = sampleStairGait(progress, ascending);
        rig.mesh.position.set(CABIN_STAIRS.x, progress * STAIR_RISE, CABIN_STAIRS.lowerZ - progress * STAIR_TREAD_RUN);
        rig.applyPose(gait.phase, 0);
        rig.applyStairPose(gait, CABIN_STAIRS.x, stairTreadSurface);
        const hands = sides.map((side, index) => {
          const [elbow, wrist] = ['ForeArm', 'Hand'].map(name => asset.getObjectByName('mixamorig' + side + name));
          for (const [jointIndex, joint] of [elbow, wrist].entries()) angles[index][jointIndex].push(joint.quaternion.clone());
          return wrist.getWorldPosition(new Vector3()).z;
        });
        leads.push(hands[0] - hands[1]);
      }
      assert.ok(Math.min(...leads) < -.10 && Math.max(...leads) > .10);
      for (const arm of angles) for (const samples of arm)
        assert.ok(samples.some(rotation => rotation.angleTo(samples[0]) > .045), 'the elbow and wrist must articulate locally');
    }
  } finally { rig.dispose(); }
});

test('the ascending pelvis, neck and head advance through both support exchanges', async () => {
  // Pelvis-to-neck pitch in degrees from ascent frames 48, 52, …, 76 in the original GLB.
  const sourcePitch = [-.10, -1.81, -2.37, -.10, .77, .16, -.51, .17];
  for (const outfit of ['walk-room', 'cardigan']) {
    const { gltf } = await load(new URL(`../../../assets/public/models/resident/luna-${outfit}.glb`, import.meta.url));
    const rig = createResidentRig(gltf.scene, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'), outfit !== 'walk-room');
    const joints = ['Hips', 'Neck', 'Head'].map(name => gltf.scene.getObjectByName('mixamorig' + name));
    try {
      rig.mesh.rotation.y = Math.PI;
      const furthest = joints.map(() => -Infinity);
      const headHeights = [];
      // At 60 Hz each tread takes 36 frames. Sample three steps to cross both seams.
      for (let frame = 0; frame <= 108; frame++) {
        const progress = 8 - .78 + frame / 36;
        const gait = sampleStairGait(progress, true);
        rig.mesh.position.set(CABIN_STAIRS.x, progress * STAIR_RISE, CABIN_STAIRS.lowerZ - progress * STAIR_TREAD_RUN);
        rig.applyPose(gait.phase, 0);
        rig.applyStairPose(gait, CABIN_STAIRS.x, stairTreadSurface);
        const points = joints.map(joint => joint.getWorldPosition(new Vector3()));
        for (const [i, point] of points.entries()) {
          const forward = -point.z;
          furthest[i] = Math.max(furthest[i], forward);
          assert(furthest[i] - forward < .003, `${outfit} ${joints[i].name} rocked back during ascent`);
        }
        headHeights.push(points[2].y);
        if (frame >= 4) assert(points[2].y - headHeights[frame - 4] < .09, 'spread the uphill lift through weight transfer');
        if (frame % 9 === 0) {
          const trunk = points[1].clone().sub(points[0]);
          const pitch = Math.atan2(-trunk.z, trunk.y) * 180 / Math.PI;
          assert(Math.abs(pitch - sourcePitch[frame / 9 % 8]) < 1, 'keep the small recorded torso tilt through the step');
        }
      }
    } finally { rig.dispose(); }
  }
});

test('the descending torso and its balance above the planted ankle match the side view of Take 1', async () => {
  // Source frames 57, 63, 70, 76, 81 and 90. Positive sagittal angles lean downhill.
  const poses = [
    [9, -14.38, -8.13], [9 + 6 / 19, -11.65, -2.68], [9 + 13 / 19, -12.85, 2.43],
    [10, -15.43, -6.80], [10 + 5 / 18, -13.41, -2.46], [10 + 14 / 18, -12.55, 5.37],
  ];
  const angle = (from, to) => Math.atan2(to.z - from.z, to.y - from.y) * 180 / Math.PI;
  for (const outfit of ['walk-room', 'cardigan']) {
    const { gltf } = await load(new URL(`../../../assets/public/models/resident/luna-${outfit}.glb`, import.meta.url));
    const rig = createResidentRig(gltf.scene, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'), outfit !== 'walk-room');
    const point = name => gltf.scene.getObjectByName('mixamorig' + name).getWorldPosition(new Vector3());
    try {
      for (const [cycle, trunkAngle, balanceAngle] of poses) {
        const progress = 18 - (cycle + .18) / (1 + .4 / 18);
        const gait = sampleStairGait(progress, false);
        rig.mesh.position.set(CABIN_STAIRS.x, progress * STAIR_RISE, CABIN_STAIRS.lowerZ - progress * STAIR_TREAD_RUN);
        rig.applyPose(gait.phase, 0);
        rig.applyStairPose(gait, CABIN_STAIRS.x, stairTreadSurface);
        const neck = point('Neck'), ankle = point(sides[gait.feet.findIndex(foot => !foot.swing)] + 'Foot');
        assert(Math.abs(angle(point('Hips'), neck) - trunkAngle) < 2, 'retarget the full torso rather than bending only the chest');
        assert(Math.abs(angle(ankle, neck) - balanceAngle) < 4, 'the whole body must stay balanced over the step');
      }
    } finally { rig.dispose(); }
  }
});

test('descending moves the pelvis forward and brakes each receiving foot before contact', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'));
  const pelvis = gltf.scene.getObjectByName('mixamorigHips');
  const feet = sides.map(side => gltf.scene.getObjectByName('mixamorig' + side + 'Foot'));
  const history = [];
  try {
    // 60 Hz at the production cadence of 0.6 seconds per tread, through both left and right transfers.
    for (let frame = 0; frame <= 3 * 36; frame++) {
      const progress = 11 - frame / 36;
      const gait = sampleStairGait(progress, false);
      rig.mesh.position.set(CABIN_STAIRS.x, progress * STAIR_RISE, CABIN_STAIRS.lowerZ - progress * STAIR_TREAD_RUN);
      rig.applyPose(gait.phase, 0);
      rig.applyStairPose(gait, CABIN_STAIRS.x, stairTreadSurface);
      const hip = pelvis.getWorldPosition(new Vector3());
      const ankles = feet.map(joint => joint.getWorldPosition(new Vector3()));
      if (frame >= 6) {
        const previous = history[frame - 1];
        assert(hip.z >= previous.hip.z - .0003, 'the torso must not rock backward at a support exchange');
        if (previous.footfall !== gait.footfall) {
          const landing = gait.feet.findIndex(foot => !foot.swing);
          const before = history[frame - 6];
          assert(before.hip.y - hip.y < .08, 'do not drop the torso suddenly in the last 100 ms');
          assert(before.ankles[landing].y - ankles[landing].y < .07, 'the landing foot must already be braking');
          const [thigh, shin] = ['UpLeg', 'Leg'].map(name => gltf.scene.getObjectByName('mixamorig' + sides[landing] + name).getWorldPosition(new Vector3()));
          assert(shin.clone().sub(thigh).angleTo(ankles[landing].clone().sub(shin)) > .16, 'keep a soft knee on contact');
        }
      }
      history.push({ hip, ankles, footfall: gait.footfall });
    }
    assert(history.at(-1).footfall - history[0].footfall >= 3);
  } finally { rig.dispose(); }
});

function soleVertices(asset) {
  const position = new Vector3();
  const vertices = [[], []];
  asset.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    for (const [side, name] of sides.entries()) {
      const joints = ['Foot', 'ToeBase'].map(bone => mesh.skeleton.bones.findIndex(joint => joint.name === 'mixamorig' + name + bone));
      for (let vertex = 0; vertex < skinIndex.count; vertex++) {
        let weight = 0;
        for (let channel = 0; channel < 4; channel++) {
          if (joints.includes(skinIndex.getComponent(vertex, channel))) weight += skinWeight.getComponent(vertex, channel);
        }
        if (weight < .5) continue;
        mesh.getVertexPosition(vertex, position).applyMatrix4(mesh.matrixWorld);
        if (position.y < .026) vertices[side].push({ mesh, vertex });
      }
    }
  });
  return vertices;
}

for (const file of ['luna-walk-room.glb', 'luna-ribbon.glb', 'luna-cardigan.glb']) {
  test(`${file} keeps the supporting sole on the tread during both gaits`, async () => {
    const { gltf } = await load(new URL(`../../../assets/public/models/resident/${file}`, import.meta.url));
    const asset = clone(gltf.scene);
    const rig = createResidentRig(asset, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'), file === 'luna-cardigan.glb');
    try {
      rig.applyPose(0, 0);
      rig.mesh.updateMatrixWorld(true);
      const soles = soleVertices(asset);
      assert(soles.every(vertices => vertices.length > 100));
      const position = new Vector3();
      for (const ascending of [true, false]) {
        rig.mesh.rotation.y = ascending ? Math.PI : 0;
        const kneeError = [0, 0], sampleCount = [0, 0];
        let maxSwing = 0;
        const arms = sides.map(side => ['ForeArm', 'Hand', 'HandMiddle1'].map(name =>
          asset.getObjectByName('mixamorig' + side + name)));
        for (let i = -30; i <= 18 * 24 + 30; i++) {
          const travel = i / 24;
          const progress = ascending ? travel : CABIN_STAIRS.steps - travel;
          const gait = sampleStairGait(progress, ascending);

          rig.mesh.position.set(CABIN_STAIRS.x, Math.max(0, Math.min(progress, 18)) * STAIR_RISE, CABIN_STAIRS.lowerZ - progress * STAIR_TREAD_RUN);
          rig.applyPose(gait.phase, 1 - gait.weight);
          rig.applyStairPose(gait, CABIN_STAIRS.x, stairTreadSurface);
          rig.mesh.updateMatrixWorld(true);
          if (gait.weight === 1) for (const [elbow, hand, knuckle] of arms) {
            const wrist = hand.getWorldPosition(new Vector3());
            const forearm = wrist.clone().sub(elbow.getWorldPosition(new Vector3()));
            const palm = knuckle.getWorldPosition(new Vector3()).sub(wrist);
            assert(forearm.angleTo(palm) < .55, 'stair arm swing keeps the wrist aligned with the forearm');
          }
          for (const [side, vertices] of soles.entries()) {
            const foot = gait.feet[side];
            if (travel >= 7 && travel < 9) {
              const [hip, knee, ankle] = ['UpLeg', 'Leg', 'Foot'].map(name =>
                asset.getObjectByName('mixamorig' + sides[side] + name).getWorldPosition(new Vector3()));
              const angle = knee.clone().sub(hip).angleTo(ankle.sub(knee));
              const role = foot.swing ? 1 : 0;
              kneeError[role] += Math.abs(angle - gait.legs[side].flexion) * 180 / Math.PI;
              sampleCount[role]++;
              if (foot.swing) maxSwing = Math.max(maxSwing, angle * 180 / Math.PI);
            }
            let gap = Infinity;
            for (const { mesh, vertex } of vertices) {
              mesh.getVertexPosition(vertex, position).applyMatrix4(mesh.matrixWorld);
              gap = Math.min(gap, position.y - foot.y);
              assert(position.y >= stairTreadSurface(position.z) - .003,
                `${sides[side]} sole intersected a riser at ${progress.toFixed(3)} while walking ${ascending ? 'up' : 'down'}`);
            }
            if (!foot.swing && gait.weight === 1) assert(gap >= -.002 && gap < .005, `supporting sole is ${gap} m from the tread`);
          }
        }
        assert(kneeError[0] / sampleCount[0] < 7, 'support knee must follow the recorded bend through weight transfer');
        assert(kneeError[1] / sampleCount[1] < 9, 'swing knee must track the reference through the step');
        if (!ascending) assert(maxSwing < 99, 'the descending heel must not kick back into the skirt');
      }
    } finally { rig.dispose(); }
  });
}
