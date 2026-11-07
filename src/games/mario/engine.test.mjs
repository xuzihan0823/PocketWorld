import assert from 'node:assert/strict';
import test from 'node:test';
import { createRun, frontGap, stepRun, terrainAngle, terrainY } from './engine.ts';
import { emptyInput, TRAILS } from './model.ts';


const DT = 1 / 120;
function tick(state, input = {}, count = 1) {
  const events = [];
  for (let i = 0; i < count; i++) {
    stepRun(state, { ...emptyInput(), ...input, jumpPressed: i === 0 && !!input.jumpPressed }, DT);
    events.push(...state.events);
  }
  return events;
}
function clearRun(trail = 'valley') {
  const state = createRun(trail);
  state.features = [];
  state.nextSegment = 1e6;
  state.chasers = [];
  return state;
}
function addFeature(state, kind, x = state.player.x, width = 44) {
  state.features.push({ id: state.nextId++, kind, x, width, y: terrainY(x + width / 2, state.trail), used: false });
}
function airborne(state, height, vy = 0) {
  const p = state.player;
  p.grounded = false;
  p.coyote = 0;
  p.y = terrainY(p.x, state.trail) - height;
  p.vy = vy;
}

test('three trails start at x=200 with feet on a continuous, bounded slope', () => {
  for (const { id } of TRAILS) {
    const state = createRun(id);
    assert.equal(state.player.x, 200);
    assert.equal(state.player.y, terrainY(200, id));
    assert.equal(state.player.angle, terrainAngle(200, id));
    assert.equal(state.distance, 0);
    assert.equal(state.chasers.length, 8);
    assert.equal(frontGap(state), 280);
    assert.ok(!state.features.some(f => f.kind === 'gap' || f.kind === 'branch'));
    for (let x = -500; x < 20000; x += 71) {
      assert.ok(terrainY(x, id) > 375 && terrainY(x, id) < 465);
      const derivative = (terrainY(x + 0.01, id) - terrainY(x - 0.01, id)) / 0.02;
      assert.ok(Math.abs(Math.tan(terrainAngle(x, id)) - derivative) < 1e-8);
    }
  }
});

test('events are per call; zero, invalid dt, and ended runs freeze simulation', () => {
  const state = clearRun();
  state.events.push('coin');
  stepRun(state, emptyInput(), 0);
  assert.deepEqual(state.events, []);
  const snapshot = structuredClone(state);
  for (const dt of [-1, NaN, Infinity]) stepRun(state, emptyInput(), dt);
  assert.deepEqual(state, snapshot);
  state.over = true;
  const ended = structuredClone(state);
  tick(state, { jumpPressed: true }, 30);
  assert.deepEqual(state, ended);
});

test('holding jump gives more height than tapping, and flip starts once per flight', () => {
  const tap = clearRun();
  const hold = clearRun();
  tick(tap, { jump: true, jumpPressed: true });
  tick(hold, { jump: true, jumpPressed: true });
  const events = tick(hold, { jump: true }, 55);
  tick(tap, {}, 55);
  assert.ok(hold.player.y < tap.player.y - 25);
  assert.equal(events.filter(e => e === 'flip').length, 1);
  assert.equal(hold.flips, 0);
  assert.equal(hold.bonus, 0);
});

test('release assists upright landing and only landing banks completed rotations', () => {
  const state = clearRun();
  airborne(state, 210, -150);
  const events = tick(state, { jump: true }, 125);
  assert.equal(events.filter(e => e === 'flip').length, 1);
  assert.equal(state.flips, 0);
  assert.ok(Math.abs(state.player.rotation) >= Math.PI * 2);
  const landing = tick(state, {}, 180);
  assert.ok(landing.includes('land'));
  assert.ok(!landing.includes('crash'));
  assert.equal(state.flips, 1);
  assert.equal(state.bonus, 120);
  assert.equal(state.combo, 1);
  assert.ok(state.player.grounded);
});

test('a natural ground jump has enough airtime for one banked backflip', () => {
  const state = clearRun();
  let released = false;
  const events = [];
  for (let i = 0; i < 240; i++) {
    if (Math.abs(state.player.rotation) >= Math.PI * 2) released = true;
    events.push(...tick(state, { jump: !released, jumpPressed: i === 0 }));
  }
  assert.equal(state.flips, 1);
  assert.equal(state.bonus, 120);
  assert.equal(events.filter(e => e === 'flip').length, 1);
  assert.ok(!events.includes('crash'));
});

test('walking off an ice gap crashes at the rescue floor or far lip', () => {
  for (const width of [130, 180, 500]) {
    const state = clearRun();
    addFeature(state, 'gap', state.player.x + 20, width);
    const events = tick(state, {}, 250);
    assert.equal(events.filter(e => e === 'crash').length, 1, `gap width ${width}`);
    assert.ok(events.filter(e => e === 'land').length <= 1);
  }
});

test('upside-down landing crashes once, loses unbanked flips and resets combo', () => {
  const state = clearRun();
  airborne(state, 1, 150);
  state.player.angle = Math.PI;
  state.player.rotation = -Math.PI * 3;
  state.combo = 3;
  const events = tick(state, { tilt: 1 }, 10);
  assert.equal(events.filter(e => e === 'crash').length, 1);
  assert.equal(state.flips, 0);
  assert.equal(state.combo, 0);
  assert.equal(state.bonus, 0);
});

test('jump buffer and coyote grace both accept near-edge inputs', () => {
  const buffered = clearRun();
  airborne(buffered, 4, 100);
  tick(buffered, { jump: true, jumpPressed: true });
  assert.ok(buffered.player.jumpBuffer > 0);
  tick(buffered, { jump: true }, 5);
  assert.equal(buffered.player.grounded, false);
  assert.ok(buffered.player.vy < 0);
  const coyote = clearRun();
  airborne(coyote, 2);
  coyote.player.coyote = 0.07;
  tick(coyote, { jumpPressed: true, jump: true });
  assert.ok(coyote.player.vy < -300);
  const late = clearRun();
  airborne(late, 50);
  tick(late, { jumpPressed: true, jump: true });
  assert.ok(late.player.vy >= 0);
});

test('repeated fresh presses recover faster but holding a key does not retrigger', () => {
  const taps = clearRun();
  const hold = clearRun();
  addFeature(taps, 'rock');
  addFeature(hold, 'rock');
  tick(taps);
  tick(hold);
  assert.ok(taps.player.crashTime > 1);
  for (let i = 0; i < 5; i++) {
    tick(taps, { jumpPressed: true, jump: true });
    tick(taps, {}, 5);
  }
  tick(hold, { jump: true, jumpPressed: true }, 30);
  assert.equal(taps.player.crashTime, 0);
  assert.ok(hold.player.crashTime > 0.5);
  assert.ok(taps.player.invulnerable > 0);
});

test('slide mount has one shield, partner replacement never stacks, duration uses distance', () => {
  const state = clearRun();
  addFeature(state, 'slide');
  assert.ok(tick(state).includes('mount'));
  assert.equal(state.player.partner, 'slide');
  assert.equal(state.player.shield, true);
  assert.ok(Math.abs(state.player.y - (terrainY(state.player.x, state.trail) - 22)) < 0.1);
  const left = state.player.partnerLeft;
  const x = state.player.x;
  tick(state, {}, 10);
  assert.ok(Math.abs(left - state.player.partnerLeft - (state.player.x - x)) < 1e-8);
  addFeature(state, 'branch');
  assert.ok(!tick(state).includes('crash'));
  assert.equal(state.player.partner, null);
  assert.equal(state.player.shield, false);
  tick(state, {}, 45);
  addFeature(state, 'rock');
  assert.ok(tick(state).includes('crash'));

  const replacement = clearRun();
  addFeature(replacement, 'slide');
  tick(replacement);
  addFeature(replacement, 'charge');
  assert.ok(tick(replacement).includes('mount'));
  assert.equal(replacement.player.partner, 'charge');
  assert.equal(replacement.player.shield, false);
  assert.equal(replacement.player.partnerLeft, 1900);
  replacement.player.partnerLeft = 1;
  tick(replacement);
  assert.equal(replacement.player.partner, null);
});

test('charge destroys rocks but branches and gaps remain dangerous', () => {
  const rocks = clearRun();
  addFeature(rocks, 'charge');
  tick(rocks);
  addFeature(rocks, 'rock');
  const rock = rocks.features[rocks.features.length - 1];
  assert.ok(!tick(rocks).includes('crash'));
  assert.equal(rock.used, true);
  assert.equal(rocks.bonus, 30);
  assert.equal(rocks.player.partner, 'charge');
  addFeature(rocks, 'branch');
  assert.ok(tick(rocks).includes('crash'));
  for (const kind of ['slide', 'charge']) {
    const gap = clearRun();
    addFeature(gap, kind);
    tick(gap);
    addFeature(gap, 'gap', gap.player.x - 10, 500);
    const events = tick(gap, {}, 100);
    assert.ok(events.includes('crash'), `${kind} must not bridge an ice gap`);
    assert.equal(gap.player.partner, null);
  }
});

test('tucking passes under branches, normal stance crashes; ramp launches and coins score once', () => {
  const tucked = clearRun();
  const standing = clearRun();
  addFeature(tucked, 'branch');
  addFeature(standing, 'branch');
  assert.ok(!tick(tucked, { tuck: true }, 45).includes('crash'));
  assert.ok(tick(standing).includes('crash'));
  const ramp = clearRun();
  addFeature(ramp, 'ramp', ramp.player.x - 60, 76);
  tick(ramp);
  assert.equal(ramp.player.grounded, false);
  assert.ok(ramp.player.vy < -400);
  const coins = clearRun();
  addFeature(coins, 'coin');
  coins.features[0].y -= 32;
  const events = tick(coins, {}, 10);
  assert.equal(events.filter(e => e === 'coin').length, 1);
  assert.equal(coins.coins, 1);
  assert.equal(coins.score, Math.floor(coins.distance) + 25);
});

test('only body contact catches; airborne clearance and transparent margin are safe', () => {
  const state = clearRun();
  state.player.speed = 0;
  state.chasers = [{ x: state.player.x - 50, offset: 0, lane: 0, phase: 0 }];
  tick(state);
  assert.equal(state.over, false);
  const jumping = clearRun();
  airborne(jumping, 140);
  jumping.chasers = [{ x: jumping.player.x - 10, offset: 0, lane: 2, phase: 0 }];
  tick(jumping);
  assert.equal(jumping.over, false);
  const touching = clearRun();
  touching.chasers = [{ x: touching.player.x - 20, offset: 0, lane: 0, phase: 0 }];
  touching.player.invulnerable = 99;
  assert.deepEqual(tick(touching), ['caught']);
  assert.equal(touching.over, true);
  assert.deepEqual(tick(touching), []);
});

test('swept bodies catch crossings at extreme speed, including while riding', () => {
  const crossing = clearRun();
  crossing.player.speed = 30000;
  crossing.chasers = [{ x: crossing.player.x + 80, offset: 0, lane: 0, phase: 0 }];
  assert.ok(tick(crossing).includes('caught'));
  assert.ok(crossing.player.x > 350);
  for (const partner of ['slide', 'charge']) {
    const state = clearRun();
    state.player.partner = partner;
    state.player.partnerLeft = 1000;
    state.player.shield = true;
    state.player.invulnerable = 99;
    state.chasers = [{ x: state.player.x, offset: 0, lane: 0, phase: 0 }];
    assert.ok(tick(state).includes('caught'), partner);
    assert.equal(state.over, true);
  }
});

test('reduced motion preserves gameplay and limits only particles', () => {
  const full = clearRun();
  const reduced = clearRun();
  addFeature(full, 'slide');
  addFeature(reduced, 'slide');
  stepRun(full, emptyInput(), DT, false);
  stepRun(reduced, emptyInput(), DT, true);
  assert.ok(full.particles.length > 0);
  assert.equal(reduced.particles.length, 0);
  full.particles = [];
  assert.deepEqual(full, reduced);
});

test('one 1/60 call agrees with two 1/120 steps and an oversized frame is capped', () => {
  const one = clearRun();
  const two = clearRun();
  stepRun(one, { ...emptyInput(), jump: true, jumpPressed: true }, 1 / 60);
  tick(two, { jump: true, jumpPressed: true }, 2);
  assert.deepEqual(one.player, two.player);
  const capped = clearRun();
  stepRun(capped, emptyInput(), 10);
  assert.ok(Math.abs(capped.time - 0.1) < 1e-9);
});

test('idle players recover from the first rock but repeated mistakes end every trail', () => {
  for (const { id } of TRAILS) {
    const state = createRun(id);
    let crashes = 0;
    let caught = 0;
    let recoveredFirstCrash = false;
    for (let i = 0; i < 120 * 120 && !state.over; i++) {
      stepRun(state, emptyInput(), DT);
      crashes += Number(state.events.includes('crash'));
      caught += Number(state.events.includes('caught'));
      if (crashes === 1 && state.player.crashTime === 0 && !state.over) recoveredFirstCrash = true;
    }
    assert.equal(recoveredFirstCrash, true, id);
    assert.ok(crashes >= 2, id);
    assert.equal(state.over, true, id);
    assert.ok(state.time > 20 && state.time < 90, `${id}: ${state.time}s`);
    assert.equal(caught, 1, id);
    assert.deepEqual(tick(state), []);
  }
});

test('steady skiing maintains a close gap and partner boosts open a temporary lead', () => {
  for (const { id } of TRAILS) {
    for (const partner of ['slide', 'charge']) {
      const state = createRun(id);
      state.features = [];
      state.nextSegment = 1e6;
      state.time = 40;
      tick(state, {}, 60 * 120);
      const baseline = frontGap(state);
      assert.ok(baseline >= 200 && baseline <= 260, `${id}: baseline ${baseline}`);
      addFeature(state, partner);
      assert.ok(tick(state).includes('mount'));
      tick(state, {}, 2 * 120);
      assert.ok(frontGap(state) > baseline + 50, `${id}: ${partner} boost`);
      tick(state, {}, 18 * 120);
      assert.equal(state.player.partner, null);
      const restored = frontGap(state);
      assert.ok(restored >= 200 && restored <= 260, `${id}: restored ${restored}`);
      assert.equal(state.over, false);
    }
  }
});

test('hand-authored route patterns admit safe jump/tuck paths without invulnerability', () => {
  for (const { id } of TRAILS) {
    const state = createRun(id);
    let crashes = 0;
    for (let i = 0; i < 180 * 120 && !state.over; i++) {
      const p = state.player;
      const obstacle = state.features.find(f => !f.used
        && ((f.kind === 'rock' && !p.partner) || f.kind === 'gap' || (f.kind === 'branch' && p.partner))
        && f.x > p.x && f.x - p.x < 115);
      const tuck = !p.partner && state.features.some(f => f.kind === 'branch'
        && f.x - p.x < 120 && f.x + f.width > p.x - 30);
      const pressed = !!obstacle && p.grounded;
      stepRun(state, { jump: pressed || (!p.grounded && p.airTime < 0.2), jumpPressed: pressed, tuck: !!tuck, tilt: 0 }, DT);
      crashes += Number(state.events.includes('crash'));
    }
    assert.equal(state.over, false, id);
    assert.equal(crashes, 0, id);
    assert.ok(state.distance > 5000, id);
  }
});

test('thirty-minute runs keep every live collection bounded with finite capped difficulty', () => {
  for (const { id } of TRAILS) {
    const state = createRun(id);
    let maxFeatures = 0;
    let maxParticles = 0;
    for (let i = 0; i < 30 * 60 * 120; i++) {
      // Isolate streaming/resource lifetime from failure; collision/recovery are tested above.
      state.player.invulnerable = 1;
      if (frontGap(state) < 160) {
        for (const chaser of state.chasers) chaser.x -= 300;
      }
      const obstacle = state.features.find(f => !f.used && ['rock', 'gap'].includes(f.kind)
        && f.x > state.player.x && f.x - state.player.x < 115);
      const branch = state.features.some(f => f.kind === 'branch' && f.x - state.player.x < 120
        && f.x + f.width > state.player.x - 30);
      stepRun(state, { jump: false, jumpPressed: !!obstacle && state.player.grounded, tuck: branch, tilt: 0 }, DT, i % 2 === 0);
      assert.equal(state.over, false);
      maxFeatures = Math.max(maxFeatures, state.features.length);
      maxParticles = Math.max(maxParticles, state.particles.length);
      assert.equal(state.chasers.length, 8);
      assert.ok(state.events.length <= 8);
    }
    assert.ok(state.distance > 50000);
    assert.ok(maxFeatures <= 72);
    assert.ok(maxParticles <= 80);
    assert.ok(state.player.speed <= 470);
    assert.ok(Number.isFinite(state.player.y));
    assert.ok(Number.isFinite(state.score));
    assert.ok(state.features.every(f => f.x + f.width > state.player.x - 450));
    assert.ok(state.nextSegment < state.player.x / 2400 + 2);
  }
});
