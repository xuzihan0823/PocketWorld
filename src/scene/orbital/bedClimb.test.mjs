import test from 'node:test';
import assert from 'node:assert/strict';
import { BED_CLIMB_SECONDS, BED_LIE, bedClimbPose } from './bedClimb.ts';

const HIP = 0.69, THIGH = 0.39, SHIN = 0.235, ENTRY = [-1.48, 0.95];
const MATTRESS = { minX: -3.4, maxX: -1.8, minZ: -0.25, maxZ: 2.25, top: 0.79 };
const samples = (startYaw = -1.27) => Array.from({ length: 401 }, (_, i) => bedClimbPose(i / 400, ENTRY, startYaw, HIP));

function legPoints(pose) {
  const thigh = -pose.sit * Math.PI / 2 - pose.legLift - pose.lie * Math.PI / 2, shin = thigh + pose.sit * pose.bend * Math.PI / 2;
  const hipY = pose.y + HIP, knee = [THIGH * -Math.sin(thigh), hipY - THIGH * Math.cos(thigh)];
  const points = [0.5, 1].map(t => [THIGH * t * -Math.sin(thigh), hipY - THIGH * t * Math.cos(thigh)]);
  points.push(...[0.5, 1].map(t => [knee[0] + SHIN * t * -Math.sin(shin), knee[1] - SHIN * t * Math.cos(shin)]));
  return points.map(([forward, y]) => ({ x: pose.x + Math.sin(pose.yaw) * forward, z: pose.z + Math.cos(pose.yaw) * forward, y }));
}

test('the climb starts standing at the bed edge and ends lying at the bed rest pose', () => {
  const [first, last] = [bedClimbPose(0, ENTRY, 0.4, HIP), bedClimbPose(1, ENTRY, 0.4, HIP)];
  assert.deepEqual([first.x, first.y, first.z, first.yaw, first.sit, first.lie], [ENTRY[0], 0, ENTRY[1], 0.4, 0, 0]);
  assert.deepEqual([last.x, last.z, last.yaw, last.sit, last.lie, last.legLift], [BED_LIE[0], BED_LIE[1], 0, 0, 1, 0]);
  assert.ok(Math.abs(last.y - (0.929 - HIP)) < 1e-9);
});

test('no step of the climb moves faster than walking or snaps the posture', () => {
  const dt = BED_CLIMB_SECONDS / 400;
  for (const startYaw of [-1.27, 0, 2.8]) {
    const poses = samples(startYaw);
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1], b = poses[i];
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt < 2.15, `position jump at ${i}`);
      assert.ok(Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))) / dt < 9, `yaw jump at ${i}`);
      for (const key of ['sit', 'lie', 'bend', 'legLift']) assert.ok(Math.abs(b[key] - a[key]) / dt < 4, `${key} jump at ${i}`);
    }
  }
});

test('the resident sits on the edge, lifts both legs aboard, then lies back', () => {
  const poses = samples();
  const firstSeated = poses.findIndex(p => p.sit > 0.99), firstFacingFoot = poses.findIndex(p => Math.abs(p.yaw) < 0.01), firstLying = poses.findIndex(p => p.lie > 0.5);
  assert.ok(firstSeated > 0 && firstSeated < firstFacingFoot && firstFacingFoot < firstLying);
  assert.ok(poses[firstSeated].x > BED_LIE[0] + 0.4, 'sits near the edge before scooting in');
  assert.ok(poses.slice(firstSeated, firstFacingFoot).some(p => p.legLift > 0.2 && p.bend < 0.05), 'legs are raised straight while swinging');
});

test('legs stay above the mattress for the whole climb', () => {
  for (const pose of samples()) for (const point of legPoints(pose)) {
    const over = point.x > MATTRESS.minX && point.x < MATTRESS.maxX && point.z > MATTRESS.minZ && point.z < MATTRESS.maxZ;
    if (over) assert.ok(point.y > MATTRESS.top + 0.04, `leg at ${point.x.toFixed(2)},${point.y.toFixed(2)},${point.z.toFixed(2)}`);
  }
});
