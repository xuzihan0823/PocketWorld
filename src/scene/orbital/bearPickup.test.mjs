import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { load } from './load-for-validation.mjs';
import { bearPickupSourceTime, BEAR_PICKUP_DURATION } from './bearPickupTiming.ts';
import { advanceCabinPerformance, applyCabinPerformance, leaveCabinPerformance, pickupPoseTime } from './cabinActions.ts';

for (const outfit of ['everyday', 'ribbon', 'cardigan']) {
  test(`${outfit} bear clip retimes every original pose and keeps the contact clock aligned`, async () => {
    const path = new URL(`../../../assets/public/models/resident/luna-cabin-actions-${outfit}.glb`, import.meta.url);
    const { gltf } = await load(path);
    const old = gltf.animations.find(c => c.name === 'pickUp');
    const clip = gltf.animations.find(c => c.name === 'bearPickUp');
    assert.ok(Math.abs(clip.duration - 3.05) < 1e-6);
    assert.ok(clip.duration / old.duration > .75 && clip.duration / old.duration < .8);
    assert.equal(clip.tracks.length, old.tracks.length);
    for (const track of clip.tracks) {
      const original = old.tracks.find(t => t.name === track.name);
      assert.deepEqual(track.values, original.values, 'all poses, including foot contact, stay intact');
      const current = track.createInterpolant(), previous = original.createInterpolant();
      for (const hz of [15, 20, 30, 60, 120]) for (let i = 0; i <= Math.ceil(clip.duration * hz); i++) {
        const time = Math.min(clip.duration, i / hz);
        const actual = current.evaluate(time), expected = previous.evaluate(bearPickupSourceTime(time));
        actual.forEach((v, axis) => assert.ok(Math.abs(v - expected[axis]) < 2e-5,
          `${track.name} loses contact synchronization at ${time}s, ${hz} Hz`));
      }
    }
    const raw = await readFile(path), doc = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)));
    const source = doc.animations.find(c => c.name === 'pickUp');
    const target = doc.animations.find(c => c.name === 'bearPickUp');
    target.samplers.forEach((sampler, i) => assert.equal(sampler.output, source.samplers[i].output,
      'retiming shares pose data instead of duplicating it'));
  });
}

test('bear pickup completes sooner, cancels along the same clock, and leaves placement unchanged', () => {
  const clips = { pickUp: { duration: 119 / 30 }, bearPickUp: { duration: BEAR_PICKUP_DURATION } };
  for (const hz of [15, 20, 30, 60, 120]) {
    const pickup = { kind: 'plush', placing: false, time: 0, leaving: false, bearPickup: true };
    let frames = 0;
    while (!advanceCabinPerformance(pickup, 1 / hz, clips)) assert.ok(++frames < 4 * hz);
    assert.ok(Math.abs((frames + 1) / hz - 3.05) <= 1 / hz + 1e-6);
    assert.ok(Math.abs(pickupPoseTime(pickup) - clips.pickUp.duration) < 1e-6);
    for (const time of [.8, 1.46, 2.4]) {
      Object.assign(pickup, { time, leaving: false });
      const forward = [];
      applyCabinPerformance(pickup, clips, (...args) => forward.push(args));
      leaveCabinPerformance(pickup);
      const reverse = [];
      applyCabinPerformance(pickup, clips, (...args) => reverse.push(args));
      assert.deepEqual(reverse, forward, 'cancelling does not switch poses or timing');
      assert.equal(advanceCabinPerformance(pickup, time + 1, clips), true);
      assert.equal(pickup.time, 0);
    }
  }
  const placing = { kind: 'plush', placing: true, time: clips.pickUp.duration, leaving: false };
  assert.equal(advanceCabinPerformance(placing, 3.05, clips), false);
  assert.equal(pickupPoseTime(placing), placing.time);
});
