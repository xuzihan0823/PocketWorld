import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('./wallVisibility.ts', import.meta.url), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { wallOccludes, stepFade, fadeOpacity, WALL_FADE } = context.exports;

// Same layout as HabitatShell: 8.4 × 6.8 floor, 3.5 m walls, 0.2 m thick (bevels ignored).
const walls = {
  front: { id: 'front', normal: [0, 0, 1], min: [-4.35, 0, 3.38], max: [4.35, 3.5, 3.58] },
  back: { id: 'back', normal: [0, 0, -1], min: [-4.35, 0, -3.58], max: [4.35, 3.5, -3.38] },
  left: { id: 'left', normal: [-1, 0, 0], min: [-4.38, 0, -3.39], max: [-4.18, 3.5, 3.39] },
  right: { id: 'right', normal: [1, 0, 0], min: [4.18, 0, -3.58], max: [4.38, 3.5, 3.39] },
};
const samples = [[0, 1.2, 0], ...[-3.5, 3.5].flatMap(x => [-2.7, 2.7].flatMap(z => [[x, 0.3, z], [x, 2.2, z]]))];
const orbit = (azimuth, polar, distance = 20) => [
  distance * Math.sin(polar) * Math.sin(azimuth), 1.05 + distance * Math.cos(polar), distance * Math.sin(polar) * Math.cos(azimuth)];
const hidden = (camera, state = {}) => Object.keys(walls).filter(id => wallOccludes(walls[id], camera, samples, !!state[id])).sort();

test('front view hides only the front wall', () => assert.deepEqual(hidden(orbit(0, 1.1)), ['front']));
test('front-left and front-right corners hide both adjacent walls', () => {
  assert.deepEqual(hidden(orbit(-Math.PI / 4, 1.1)), ['front', 'left']);
  assert.deepEqual(hidden(orbit(Math.PI / 4, 1.1)), ['front', 'right']);
});
test('side and back views keep the far walls', () => {
  assert.deepEqual(hidden(orbit(Math.PI / 2, 1.1)), ['right']);
  assert.deepEqual(hidden(orbit(Math.PI, 1.1)), ['back']);
});
test('distance does not change the decision', () => {
  for (const distance of [8, 12, 30]) assert.deepEqual(hidden(orbit(Math.PI / 4, 1.1, distance)), ['front', 'right']);
});
test('looking straight down clears every wall', () => assert.deepEqual(hidden(orbit(0.6, 0.05)), []));
test('camera inside the room never hides a wall', () => assert.deepEqual(hidden([1.45, 1.88, 1.2]), []));
test('hysteresis holds the state near the wall plane', () => {
  const near = [4.42, 3, 1]; // 4 cm outside the right wall's outer face, inside the band
  assert.equal(wallOccludes(walls.right, near, samples, true), true);
  assert.equal(wallOccludes(walls.right, near, samples, false), false);
});
test('fade continues from the current progress and eases', () => {
  let progress = 1;
  progress = stepFade(progress, true, WALL_FADE.fadeOut / 2);
  assert.ok(Math.abs(progress - 0.5) < 1e-9);
  progress = stepFade(progress, false, WALL_FADE.fadeIn / 4);
  assert.ok(Math.abs(progress - 0.75) < 1e-9);
  assert.equal(stepFade(0.1, true, 1), 0);
  assert.equal(stepFade(0.9, false, 1), 1);
  assert.equal(fadeOpacity(0), 0);
  assert.equal(fadeOpacity(1), 1);
  assert.equal(fadeOpacity(0.5), 0.5);
  assert.ok(fadeOpacity(0.1) < 0.1 && fadeOpacity(0.9) > 0.9);
});
