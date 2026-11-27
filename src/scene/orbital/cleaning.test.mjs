import test from 'node:test';
import assert from 'node:assert/strict';
import { cleaningSweepCount, cleaningTiming, cleaningTotal } from './cleaning.ts';
import { PLUSH_DOLLS } from './cabinLayout.ts';
import { createPlushBodies } from './plushMotion.ts';
import { createSlipperPair } from './slipperMotion.ts';

test('cleaning sequence keeps the screen black while items are reset', () => {
  const timing = cleaningTiming(false);
  assert.ok(timing.fadeIn > 0);
  assert.ok(timing.sweep > timing.fadeIn);
  assert.ok(timing.fadeOut > 0);
  assert.ok(timing.sweepInterval > 0);
  assert.equal(cleaningTotal(timing), timing.fadeIn + timing.sweep + timing.fadeOut);
  assert.ok(cleaningTotal(timing) < 6000, 'the whole clean-up should stay a short beat');
});

test('cleaning sweeps cover the black-out without piling up', () => {
  const timing = cleaningTiming(false);
  const strokes = cleaningSweepCount(timing);
  assert.ok(strokes >= 3);
  assert.ok(strokes <= 8);
  assert.ok((strokes - 1) * timing.sweepInterval < timing.sweep);
});

test('reduced motion shortens the clean-up instead of looping it', () => {
  const normal = cleaningTiming(false);
  const reduced = cleaningTiming(true);
  assert.ok(cleaningTotal(reduced) < cleaningTotal(normal));
  assert.ok(cleaningSweepCount(reduced) >= 1);
  assert.ok(cleaningTiming(true).fadeIn <= 200);
});

test('clean-up rebuilds loose props at their authored poses', () => {
  const dolls = createPlushBodies(PLUSH_DOLLS);
  assert.equal(dolls.length, PLUSH_DOLLS.length);
  dolls.forEach((body, index) => {
    const doll = PLUSH_DOLLS[index];
    assert.equal(body.x, doll.position[0]);
    assert.equal(body.z, doll.position[2]);
    assert.equal(body.y, 0);
    assert.equal(body.yaw, doll.yaw);
    assert.equal(body.roll, 0);
    assert.equal(body.pitch, 0);
    for (const velocity of [body.vx, body.vy, body.vz, body.spin, body.rollVel, body.pitchVel]) assert.equal(velocity, 0);
  });

  const slippers = createSlipperPair([[-4.05, 1.1], [-4.05, 0.86]], [0.1, 0.1]);
  slippers.forEach((body, index) => {
    assert.deepEqual([body.x, body.z], [[-4.05, 1.1], [-4.05, 0.86]][index]);
    assert.equal(body.y, 0);
    assert.equal(body.flipped, false);
    for (const velocity of [body.vx, body.vy, body.vz, body.spin, body.rollVel, body.pitchVel]) assert.equal(velocity, 0);
  });
});
