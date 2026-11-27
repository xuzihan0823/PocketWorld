import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPER_BALL_MOVER_RADIUS,
  createPaperBallBody,
  resolveMoverAgainstPaperBalls,
  stepPaperBalls,
  syncPaperBallBodies,
} from './paperBallMotion.ts';
import { PAPER_BALL_RADIUS } from './schedule.ts';

const bounds = { left: -1.81, right: 4.02, back: -3.18, front: 3.02 };
const still = [{ x: -1.5, z: -2.0, vx: 0, vz: 0, radius: PAPER_BALL_MOVER_RADIUS, active: true }];

test('paper ball collider radius matches the ~8 cm crumpled mesh and tight mover contact', () => {
  assert.equal(PAPER_BALL_RADIUS, 0.08);
  assert.equal(PAPER_BALL_MOVER_RADIUS, 0.18);
  assert.ok(PAPER_BALL_MOVER_RADIUS + PAPER_BALL_RADIUS < 0.29, 'kick contact stays inside pickup minReach (0.29 m)');
});

test('walking into a paper ball kicks, hops and rolls it cleanly to rest', () => {
  const ball = createPaperBallBody({ id: 'b1', seed: 2 });
  ball.x = 0;
  ball.z = 0;
  let maxY = 0;
  const startPitch = ball.pitch;
  for (let i = 0; i < 6; i++) {
    stepPaperBalls([ball], 1 / 60, [{ x: -0.23 + i * 1.1 / 60, z: 0, vx: 1.1, vz: 0, radius: PAPER_BALL_MOVER_RADIUS, active: true }], [], bounds, false, () => 0.3);
    maxY = Math.max(maxY, ball.y);
  }
  for (let i = 0; i < 360; i++) {
    stepPaperBalls([ball], 1 / 60, still, [], bounds, false, () => 0.3);
    maxY = Math.max(maxY, ball.y);
  }
  assert.ok(ball.x > 0.3, `expected ball to roll east, got x=${ball.x}`);
  assert.ok(maxY > 0.02, `expected brisk kick hop, got maxY=${maxY}`);
  assert.notEqual(ball.pitch, startPitch);
  assert.equal(ball.vx, 0);
  assert.equal(ball.vz, 0);
  assert.equal(ball.y, 0);
  assert.equal(ball.vy, 0);
  assert.equal(ball.spin, 0);
});

test('reduced motion slides kicked paper balls grounded without hopping or spinning', () => {
  const ball = createPaperBallBody({ id: 'b1', seed: 2 });
  ball.x = 0;
  ball.z = 0;
  const startPitch = ball.pitch;
  const startYaw = ball.yaw;
  for (let i = 0; i < 8; i++) {
    stepPaperBalls([ball], 1 / 60, [{ x: -0.22, z: 0, vx: 1.4, vz: 0.2, radius: PAPER_BALL_MOVER_RADIUS, active: true }], [], bounds, true);
  }
  assert.ok(ball.vx > 0.4);
  assert.equal(ball.y, 0);
  assert.equal(ball.vy, 0);
  assert.equal(ball.spin, 0);
  assert.equal(ball.yaw, startYaw);
  assert.equal(ball.pitch, startPitch);
});

test('paper balls bounce off cabin walls, furniture and solid plush circles without clipping', () => {
  const wallBall = createPaperBallBody({ id: 'w', seed: 1 });
  wallBall.x = 3.85;
  wallBall.z = 0;
  wallBall.vx = 2.4;
  for (let i = 0; i < 120; i++) stepPaperBalls([wallBall], 1 / 60, still, [], bounds, false, () => 0.5);
  assert.ok(wallBall.x <= bounds.right - wallBall.radius + 1e-5, `wall respected: ${wallBall.x}`);

  const furnBall = createPaperBallBody({ id: 'f', seed: 1 });
  furnBall.x = -0.3;
  furnBall.z = 0;
  furnBall.vx = 2.2;
  const box = [0, 1, -1, 1];
  for (let i = 0; i < 120; i++) stepPaperBalls([furnBall], 1 / 60, still, [box], bounds, false, () => 0.5);
  assert.ok(furnBall.x <= box[0] - furnBall.radius + 1e-5, `furniture respected: ${furnBall.x}`);

  const dollBall = createPaperBallBody({ id: 'd', seed: 1 });
  dollBall.x = 0.5;
  dollBall.z = 0;
  dollBall.vx = 2.0;
  const dollCircle = { x: 1.0, z: 0, radius: 0.22 };
  for (let i = 0; i < 120; i++) stepPaperBalls([dollBall], 1 / 60, still, [], bounds, false, () => 0.5, [dollCircle]);
  const dist = Math.hypot(dollBall.x - dollCircle.x, dollBall.z - dollCircle.z);
  assert.ok(dist >= dollCircle.radius + dollBall.radius - 1e-4, `plush circle respected: dist=${dist}`);
});

test('kicking one paper ball into another transfers momentum and separates both cleanly', () => {
  const a = createPaperBallBody({ id: 'a', seed: 1 });
  const b = createPaperBallBody({ id: 'b', seed: 2 });
  a.x = 0; a.z = 0; a.vx = 2.0;
  b.x = 0.25; b.z = 0;
  for (let i = 0; i < 120; i++) stepPaperBalls([a, b], 1 / 60, still, [], bounds, false, () => 0.5);
  assert.ok(b.x > 0.35, `second ball should be knocked forward, got x=${b.x}`);
  const gap = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(gap >= a.radius + b.radius - 1e-4, `balls must not overlap: gap=${gap}`);
});

test('resolveMoverAgainstPaperBalls prevents clipping when a ball is pinned against a wall', () => {
  const ball = createPaperBallBody({ id: 'p', seed: 1 });
  ball.x = bounds.right - ball.radius;
  ball.z = 0;
  const mover = { x: ball.x - 0.15, z: 0 };
  const blocked = resolveMoverAgainstPaperBalls(mover, PAPER_BALL_MOVER_RADIUS, [ball], () => true);
  assert.equal(blocked, true);
  assert.ok(ball.x - mover.x >= PAPER_BALL_MOVER_RADIUS + ball.radius - 1e-4);
});

test('syncPaperBallBodies preserves kicked positions when other balls are added or collected', () => {
  const first = createPaperBallBody({ id: '1', seed: 4 });
  first.x = 1.25;
  first.z = 0.9;
  const synced = syncPaperBallBodies([first], [{ id: '1', seed: 4 }, { id: '2', seed: 5 }]);
  assert.equal(synced.length, 2);
  assert.equal(synced[0].x, 1.25);
  assert.equal(synced[0].z, 0.9);
  const collected = syncPaperBallBodies(synced, [{ id: '2', seed: 5 }]);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].id, '2');
});
