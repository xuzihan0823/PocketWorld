import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

const module = { exports: {}, require: () => THREE };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('./chairMotion.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, module);
const { createChairMotion, advanceChairMotion, CHAIR_STAND_OFFSET } = module.exports;
for (const fps of [30, 60, 144]) test(`chair entry, idle and recovery keep travel separate from descent at ${fps} FPS`, () => {
  const m = createChairMotion(.83), phases = new Set();
  for (let frame = 0; frame < fps * 15; frame++) {
    const exit = frame > fps * 8;
    const step = advanceChairMotion(m, 1 / fps, exit, false, .53); phases.add(m.phase);
    if (m.time > 0) assert.equal(m.offset, CHAIR_STAND_OFFSET);
    assert(Math.abs(step.travel) <= .53 / fps + 1e-8);
    assert(m.time >= 0 && m.time <= 6 && m.weight >= 0 && m.weight <= 1);
  }
  assert.equal(m.phase, 'done'); assert.equal(m.offset, .83); assert.equal(m.weight, 0);
  for (const phase of ['backing', 'blend-in', 'sit-down', 'seated', 'stand-up', 'blend-out', 'leaving']) assert(phases.has(phase), phase);
});
for (const phase of ['backing', 'blend-in', 'sit-down', 'seated']) test(`cancel from ${phase} preserves pose and exits without teleporting`, () => {
  const m = createChairMotion(.82);
  for (let i = 0; i < 900 && m.phase !== phase; i++) advanceChairMotion(m, 1 / 60, false, false, .53);
  const before = { ...m };
  advanceChairMotion(m, 1 / 60, true, false, .53);
  assert(Math.abs(m.offset - before.offset) < .01);
  assert(Math.abs(m.time - before.time) < .09);
  for (let i = 0; i < 900 && m.phase !== 'done'; i++) advanceChairMotion(m, 1 / 60, true, false, .53);
  assert.equal(m.phase, 'done'); assert.equal(m.time, 0); assert.equal(m.weight, 0);
});
test('reduced motion settles once and does not play idle breathing', () => {
  const m = createChairMotion(.82);
  for (let i = 0; i < 360; i++) advanceChairMotion(m, 1 / 60, false, true, .53);
  assert.equal(m.phase, 'seated'); assert.equal(m.time, 3);
});
