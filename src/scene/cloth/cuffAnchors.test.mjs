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

test('hard, released and single soft cuff retain their guide selection and bind lengths', () => {
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

test('zoned anchors span three sectors on two rings and are removed when changing strategies', () => {
  const p = sleeve();
  for (const guide of [41, 53]) {
    configureSleeveCuff(p, 'zoned', null, guide);
    assert.deepEqual(p.elasticAnchors.map(a => a.particle), [guide, guide + 4, guide - 4, guide - 12, guide - 8, guide - 16]);
    assert.deepEqual(p.pins, [5, 6, 7]);
    assert.equal(p.elasticAnchor, undefined);
    const ks = p.elasticAnchors.map(a => a.createStiffnessSampler()(1 / 120));
    assert.ok(Math.abs(ks.reduce((sum, k) => sum + k, 0) - 12000) < 1e-9);
    assert.ok(ks[0] > ks[1] && ks[1] === ks[2] && ks[0] > ks[3] && ks[3] > ks[4]);
  }
  for (const strategy of ['hard', 'released', 'soft']) {
    configureSleeveCuff(p, 'zoned', null);
    configureSleeveCuff(p, strategy, null);
    assert.equal(p.elasticAnchors, undefined);
  }
});

test('feathering preserves each sector load and uses existing neighbors on the same ring', () => {
  for (const guide of [41, 53]) {
    const profile = sleeve();
    configureSleeveCuff(profile, 'zoned', null, guide);
    const baseline = profile.elasticAnchors;
    configureSleeveCuff(profile, 'feathered', null, guide);
    const anchors = profile.elasticAnchors;
    assert.equal(new Set(anchors.map(a => a.particle)).size, 18);
    baseline.forEach((original, sector) => {
      const stiffness = original.createStiffnessSampler()(1 / 120);
      anchors.slice(3 * sector, 3 * sector + 3).forEach((anchor, i) => {
        assert.equal(anchor.particle, original.particle + i - 1);
        assert.equal(Math.floor(anchor.particle / 12), Math.floor(original.particle / 12));
        assert.ok(Math.abs(anchor.createStiffnessSampler()(1 / 120) - stiffness * [0.125, 0.75, 0.125][i]) < 1e-9);
      });
    });
  }
});

test('dynamic zones release to a finite floor and respond to wrist speed independently of timestep', () => {
  const bones = ['Arm', 'ForeArm', 'Hand'].map(name => Object.assign(new Bone(), { name: 'mixamorigLeft' + name }));
  const [shoulder, elbow, wrist] = bones;
  shoulder.add(elbow); elbow.add(wrist);
  elbow.position.x = wrist.position.x = 0.1;
  shoulder.updateMatrixWorld(true);
  const p = sleeve();
  configureSleeveCuff(p, 'dynamic', { skeleton: new Skeleton(bones) });
  const makeSampler = () => {
    const samples = p.elasticAnchors.map(a => a.createStiffnessSampler());
    return dt => samples.reduce((sum, sample) => sum + sample(dt), 0);
  };
  const sample60 = makeSampler(), sample120 = makeSampler();
  const straight = sample60(1 / 60);
  assert.ok(Math.abs(straight - 12000) < 1e-8);
  // Bend without moving the wrist in world space, isolating the flexion envelope.
  elbow.rotation.z = 2.1;
  shoulder.position.set(.1 * (1 - Math.cos(2.1)), -.1 * Math.sin(2.1), 0);
  shoulder.updateMatrixWorld(true);
  const first = sample120(1 / 120);
  assert.ok(first < straight && first > 0.85 * straight);
  assert.ok(Math.abs(sample60(1 / 60) - sample120(1 / 120)) < 1e-8);
  let bent = first;
  for (let i = 0; i < 180; i++) bent = sample120(1 / 120);
  assert.ok(Math.abs(bent - 5000) < 0.001);
  const fast60 = makeSampler(), fast120 = makeSampler();
  shoulder.position.x += .05;
  shoulder.updateMatrixWorld(true);
  const fast = fast120(1 / 120);
  assert.ok(fast > 12000 && fast < 45000);
  assert.equal(fast120(0), fast);
  shoulder.position.x += .05;
  shoulder.updateMatrixWorld(true);
  assert.ok(Math.abs(fast60(1 / 60) - fast120(1 / 120)) < 1e-8);
  for (let i = 0; i < 240; i++) bent = fast120(1 / 120);
  assert.ok(Math.abs(bent - 5000) < .001);
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

test('both backends apply each zoned spring to its own particle', async () => {
  for (const engine of ['xpbd', 'rapier']) {
    const p = sleeve();
    p.structural = []; p.shear = []; p.bend = [];
    configureSleeveCuff(p, 'zoned', null);
    const dt = 1 / 120, targets = p.rest.slice();
    const solver = engine === 'xpbd' ? new Xpbd(p, false) : await makeRapier(p, [], false, 0);
    if (engine === 'xpbd') solver.gravity = 0;
    try {
      p.elasticAnchors.forEach(({ particle }, i) => { targets[particle * 3 + i % 3] += .025; });
      solver.step(dt, targets, []);
      p.elasticAnchors.forEach(({ particle, createStiffnessSampler }, i) => {
        const j = particle * 3 + i % 3, k = createStiffnessSampler()(dt);
        const expected = .025 * k * dt * dt / (1 + k * dt * dt);
        const actual = solver.positions[j] - p.rest[j];
        assert.ok(Math.abs(actual - expected) < .0001, `${engine} particle ${particle}: ${actual}, expected ${expected}`);
      });
    } finally { solver.dispose(); }
  }
});
