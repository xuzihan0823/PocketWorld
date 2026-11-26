import test from 'node:test';
import { EARTH_RADIUS, earthPositionForAspect } from './cabinView.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./sunCycle.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, URLSearchParams });
const {
  createSunOrbit, createOrbitSunRig, sampleSun, sampleOrbitSun, startPhase, sunAngle, roomLightDirection, readSunOverrides,
  BASE_SUN_DIRECTION, ECLIPSE_FRACTION, SUN_CYCLE_SECONDS, ROOM_LIGHT_MIN_ELEVATION,
} = module.exports;

// Mirrors the Earth layouts in Cosmos.tsx.
const LAYOUTS = {
  wide: createSunOrbit(earthPositionForAspect(1440 / 900), EARTH_RADIUS),
  narrow: createSunOrbit(earthPositionForAspect(390 / 844), EARTH_RADIUS),
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angleBetween = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180 / Math.PI;

test('the Sun is hidden behind Earth for the configured share of each lap', () => {
  for (const [name, orbit] of Object.entries(LAYOUTS)) {
    const steps = 20000;
    let dark = 0;
    for (let i = 0; i < steps; i++) {
      const sun = sampleSun(orbit, i / steps);
      if (sun.daylight < 0.5) {
        dark++;
        assert.ok(angleBetween(sun.direction, orbit.earth) < orbit.angularRadius + 1, `${name}: dark Sun must sit behind Earth`);
      }
    }
    assert.ok(Math.abs(dark / steps - ECLIPSE_FRACTION) < 0.02, `${name}: eclipse share ${dark / steps}`);
    assert.equal(sampleSun(orbit, 0.5).daylight, 0);
    assert.equal(sampleSun(orbit, 0).daylight, 1);
  }
});

test('every visit starts in daylight with the original key-light direction', () => {
  for (const orbit of Object.values(LAYOUTS)) {
    const phase = startPhase(orbit);
    const sun = sampleSun(orbit, phase);
    assert.ok(angleBetween(sun.direction, BASE_SUN_DIRECTION) < 0.5);
    assert.equal(sun.daylight, 1);
    assert.equal(sun.warmth, 0);
  }
  const wide = LAYOUTS.wide;
  let phase = startPhase(wide);
  let seconds = 0;
  while (sampleSun(wide, phase).daylight > 0.5) { phase += 1 / (SUN_CYCLE_SECONDS * 10); seconds += 0.1; }
  assert.ok(seconds > 60 && seconds < 180, `first sunset after ${seconds.toFixed(1)}s`);
});

test('the Sun moves smoothly, slowest next to Earth and with no jump at noon', () => {
  for (const orbit of Object.values(LAYOUTS)) {
    const steps = 4800;
    let previous = sampleSun(orbit, 0).direction;
    let maxStep = 0;
    for (let i = 1; i <= steps; i++) {
      const next = sampleSun(orbit, i / steps).direction;
      assert.ok(Math.abs(Math.hypot(...next) - 1) < 1e-9);
      maxStep = Math.max(maxStep, angleBetween(previous, next));
      previous = next;
    }
    assert.ok(maxStep < 0.5, `largest step ${maxStep}`);
    const nearLimb = Math.abs(sunAngle(orbit, 0.39) - sunAngle(orbit, 0.38));
    const nearNoon = Math.abs(sunAngle(orbit, 0.01) - sunAngle(orbit, 0));
    assert.ok(nearLimb < nearNoon / 2);
  }
});

test('the light warms as the Sun grazes the limb and fades out behind Earth', () => {
  const orbit = LAYOUTS.wide;
  const day = sampleSun(orbit, 0.2);
  const dusk = sampleSun(orbit, 0.395);
  const night = sampleSun(orbit, 0.45);
  assert.ok(day.warmth < dusk.warmth);
  assert.ok(dusk.daylight > 0.5 && dusk.warmth > 0.5);
  assert.equal(night.daylight, 0);
});

test('room light keeps the Sun azimuth but never shines from below the floor', () => {
  const below = roomLightDirection([-0.69, -0.31, -0.65]);
  assert.ok(Math.abs(Math.hypot(...below) - 1) < 1e-9);
  assert.ok(Math.abs(below[1] - ROOM_LIGHT_MIN_ELEVATION) < 1e-9);
  assert.ok(Math.abs(Math.atan2(below[2], below[0]) - Math.atan2(-0.65, -0.69)) < 1e-9);
  const above = roomLightDirection(BASE_SUN_DIRECTION);
  assert.ok(angleBetween(above, BASE_SUN_DIRECTION) < 0.05);
  assert.deepEqual([...roomLightDirection([0, -1, 0])], [0, 1, 0]);
});

test('debug query parameters pin the phase or change the speed', () => {
  assert.deepEqual({ ...readSunOverrides('') }, { phase: null, speed: 1 });
  assert.deepEqual({ ...readSunOverrides('?sun=0.4') }, { phase: 0.4, speed: 1 });
  assert.deepEqual({ ...readSunOverrides('?sun=1.25&sunSpeed=30') }, { phase: 0.25, speed: 30 });
  assert.deepEqual({ ...readSunOverrides('?sun=abc&sunSpeed=-3') }, { phase: null, speed: 0 });
  assert.equal(readSunOverrides('?sunSpeed=9999').speed, 240);
});

test('cosmos shaders include multi-layer Milky Way rifts, starburst Sun, procedural Moon craters, parallax cloud shadows, aurora, and particle Mie scattering', () => {
  const cosmosShaderModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL('./shaders/cosmos.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { module: cosmosShaderModule, exports: cosmosShaderModule.exports },
  );
  const shaders = cosmosShaderModule.exports;
  assert.ok(shaders.skyFragment.includes('ridgedFbm') && shaders.skyFragment.includes('uWarmth'));
  assert.ok(shaders.skyFragment.includes('starburstBlade') && shaders.skyFragment.includes('uOrbit'));
  assert.ok(shaders.starFragment.includes('vProminence') && shaders.starFragment.includes('secondarySpikes'));
  assert.ok(shaders.particleVertex.includes('forwardScatter') && shaders.particleFragment.includes('crystalMote'));
  assert.ok(shaders.planetVertex.includes('vObjectSun') && shaders.planetVertex.includes('uLitSun'));
  assert.ok(shaders.earthFragment.includes('shadowSamplePos') && shaders.earthFragment.includes('auroralOval'));
  assert.ok(shaders.cloudFragment.includes('selfShadow') && shaders.cloudFragment.includes('ridgeHighlight'));
  assert.ok(shaders.atmosphereFragment.includes('nightSide') && shaders.atmosphereFragment.includes('duskBand'));
  assert.ok(shaders.moonFragment.includes('craterLayer') && shaders.moonFragment.includes('lunarElevation'));
});

test('orbital Sun trajectory shares the 20% eclipse window, stays C1-continuous, and starts in sunlit upper-left sky', () => {
  const orbitEarth = [88, -648, -386];
  const orbitRadius = 468;
  const upHint = [0.08, 0.94, -0.33];
  const sunTarget = [-0.04, -0.18, -0.98];
  const p0 = startPhase(LAYOUTS.wide);
  const rig = createOrbitSunRig(orbitEarth, orbitRadius, upHint, sunTarget, p0);

  const startSample = sampleOrbitSun(rig, p0);
  assert.equal(startSample.daylight, 1);
  assert.ok(startSample.warmth < 0.05, `expected clear daytime warmth near 0, got ${startSample.warmth}`);
  assert.ok(startSample.separation > 10, `expected generous limb clearance at visit start, got ${startSample.separation}`);

  // Exact eclipse midpoint behind Earth at phase 0.5 and limb transitions at 0.4 / 0.6
  assert.equal(sampleOrbitSun(rig, 0.5).daylight, 0);
  assert.ok(Math.abs(sampleOrbitSun(rig, 0.4).separation) < 0.05);
  assert.ok(Math.abs(sampleOrbitSun(rig, 0.6).separation) < 0.05);

  const steps = 10000;
  let dark = 0;
  let prev = sampleOrbitSun(rig, 0).direction;
  let maxStep = 0;
  for (let i = 1; i <= steps; i++) {
    const sample = sampleOrbitSun(rig, i / steps);
    if (sample.daylight < 0.5) dark++;
    maxStep = Math.max(maxStep, angleBetween(prev, sample.direction));
    prev = sample.direction;
  }
  assert.ok(Math.abs(dark / steps - ECLIPSE_FRACTION) < 0.02, `orbit eclipse share ${dark / steps}`);
  assert.ok(maxStep < 0.35, `orbit Sun step jump ${maxStep}`);
});
