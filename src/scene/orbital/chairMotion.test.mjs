import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL('./chairMotion.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, module,
);
const { createChairMotion, stepChairMotion, CHAIR_HOLD_SECONDS } = module.exports;

function advance(motion, seconds, { exiting = false, reduced = false, fps = 60 } = {}) {
  let result;
  for (let i = 0; i < Math.ceil(seconds * fps); i++) result = stepChairMotion(motion, 1 / fps, exiting, reduced);
  return result;
}

test('the fixed chair aligns before sitting and holds the supported frame until release', () => {
  for (const fps of [30, 60, 120, 144]) {
    const motion = createChairMotion();
    advance(motion, .4, { fps });
    assert.equal(motion.phase, 'align');
    assert.equal(motion.time, 0);
    advance(motion, .6, { fps });
    assert.equal(motion.phase, 'sit');
    assert.equal(motion.align, 1);
    advance(motion, 6, { fps });
    assert.equal(motion.phase, 'seated');
    assert.equal(motion.time, CHAIR_HOLD_SECONDS);
  }
});

test('a seated exit releases directly along the contact path and restores the floor entry', () => {
  const motion = createChairMotion();
  advance(motion, 6);
  const result = stepChairMotion(motion, .02, true, false);
  assert.equal(result.done, false);
  assert.equal(motion.phase, 'stand');
  assert(motion.time < CHAIR_HOLD_SECONDS);
  assert.equal(motion.align, 1);
  assert(advance(motion, 1.8, { exiting: true }).done);
  assert.equal(motion.time, 0);
  assert.equal(motion.align, 0);
});

test('cancelling during alignment or sitting finishes at the floor entry', () => {
  for (const seconds of [.2, .9, 2, 3.2]) {
    const motion = createChairMotion();
    advance(motion, seconds);
    const previousTime = motion.time;
    stepChairMotion(motion, .001, true, false);
    assert(motion.time <= previousTime && previousTime - motion.time < .003);
    assert(advance(motion, 4, { exiting: true }).done);
  }
});

test('reduced motion shortens the clip and large resume deltas preserve the exit order', () => {
  const motion = createChairMotion();
  advance(motion, .65, { reduced: true });
  assert.equal(motion.phase, 'seated');
  stepChairMotion(motion, 60, true, false);
  assert.equal(motion.align, 1);
  assert(motion.time < CHAIR_HOLD_SECONDS && motion.time > CHAIR_HOLD_SECONDS - .1);
  assert(advance(motion, .65, { exiting: true, reduced: true }).done);
});
