import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { Bone, Skeleton } from 'three';
import { configureSleeveCuff } from './cuffAnchors.ts';
import { makeRapier } from './rapier.ts';

const source = await fs.readFile(new URL('./physics.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { Xpbd, lattice } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

function sleeve() {
  const profile = lattice(12, 5, true, 0.0025, (c, r) => {
    const angle = 2 * Math.PI * c / 12;
    return [Math.cos(angle) * 0.04, r * 0.06, Math.sin(angle) * 0.04];
  });
  profile.pins = [5, 6, 7, 41];
  return profile;
}

test('single-sleeve strategies change only the one distal guide and preserve bind lengths', () => {
  const p = sleeve(), rest = p.rest.slice();
  configureSleeveCuff(p, 'hard', null, 41);
  assert.deepEqual(p.pins, [5, 6, 7, 41]);
  configureSleeveCuff(p, 'hard', null);
  assert.deepEqual(p.pins, [5, 6, 7, 53]);
  configureSleeveCuff(p, 'soft', null);
  assert.deepEqual(p.pins, [5, 6, 7]);
  assert.equal(p.elasticAnchor.particle, 53);
  configureSleeveCuff(p, 'released', null);
  assert.equal(p.elasticAnchor, undefined);
  assert.deepEqual(p.pins, [5, 6, 7]);
  assert.deepEqual(p.rest, rest);
});

test('posture-dependent stiffness releases and recovers continuously at the same elapsed time', () => {
  const bones = ['Arm', 'ForeArm', 'Hand'].map(name => Object.assign(new Bone(), { name: 'mixamorigLeft' + name }));
  const [shoulder, elbow, wrist] = bones;
  shoulder.add(elbow); elbow.add(wrist);
  elbow.position.x = wrist.position.x = 0.1;
  shoulder.updateMatrixWorld(true);
  const p = sleeve();
  configureSleeveCuff(p, 'dynamic', { skeleton: new Skeleton(bones) });
  const sample60 = p.elasticAnchor.createStiffnessSampler(), sample120 = p.elasticAnchor.createStiffnessSampler();
  const straight = sample60(1 / 60);
  elbow.rotation.z = 2.1;
  shoulder.updateMatrixWorld(true);
  const first = sample120(1 / 120);
  assert.ok(first < straight && first > 0.85 * straight);
  assert.ok(Math.abs(sample60(1 / 60) - sample120(1 / 120)) < 1e-9);
  let bent = first;
  for (let i = 0; i < 120; i++) bent = sample120(1 / 120);
  assert.ok(bent > 0 && bent < straight / 20);
  elbow.rotation.z = 0;
  shoulder.updateMatrixWorld(true);
  const recovering = sample120(1 / 120);
  assert.ok(recovering > bent && recovering < straight / 5);
  for (let i = 0; i < 120; i++) bent = sample120(1 / 120);
  assert.ok(bent > straight * 0.999 && bent <= straight);
});

test('XPBD finite-stiffness attachment obeys the implicit one-particle solution at both substeps', () => {
  for (const dt of [1 / 60, 1 / 120]) for (const iterations of [1, 5]) {
    const p = sleeve();
    p.structural = []; p.shear = []; p.bend = [];
    p.material.iterations = iterations;
    configureSleeveCuff(p, 'soft', null);
    const k = p.elasticAnchor.createStiffnessSampler()(dt);
    const solver = new Xpbd(p, false), targets = p.rest.slice();
    solver.gravity = 0;
    for (let axis = 0; axis < 3; axis++) targets[3 * 53 + axis] += 0.03 * (axis - 1);
    solver.step(dt, targets, []);
    for (let axis = 0; axis < 3; axis++) {
      const j = 3 * 53 + axis;
      const expected = p.rest[j] + (targets[j] - p.rest[j]) * k * dt * dt / (1 + k * dt * dt);
      assert.ok(Math.abs(solver.positions[j] - expected) < 1e-7);
    }
    solver.dispose();
  }
});

test('Rapier hard, elastic and released guides have distinct responses to the same target step', async () => {
  const travel = {};
  for (const strategy of ['hard', 'soft', 'released']) {
    const p = sleeve();
    configureSleeveCuff(p, strategy, null);
    const solver = await makeRapier(p, [], false, 0), targets = p.rest.slice();
    const j = 3 * 53;
    targets[j] += 0.03;
    try {
      solver.step(1 / 120, targets, []);
      travel[strategy] = solver.positions[j] - p.rest[j];
    } finally { solver.dispose(); }
  }
  assert.ok(Math.abs(travel.hard - 0.03) < 1e-5);
  assert.ok(Math.abs(travel.released) < 1e-5);
  assert.ok(travel.soft > travel.released + 1e-5 && travel.soft < travel.hard);
});
