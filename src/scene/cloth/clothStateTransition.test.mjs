import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';
import { load } from '../orbital/load-for-validation.mjs';
import { createSleeveDrive } from './clothStateTransition.ts';

const mixed = { selected: '起身', weights: [0, 0, 0, 0, 0, .5, .5] };
const idle = { selected: '待机', weights: [1, 0, 0, 0, 0, 0, 0] };

// The same linear trajectory with one or two samples must end with the same
// position and tangent, including the response to a reversal at the midpoint.
test('moving targets retain their tangent on retarget and integrate each band independently', () => {
  function run(splits) {
    const input = new Float32Array(180);
    const drive = createSleeveDrive({}, input, true);
    const dt = 1 / 120 / splits;
    for (let i = 1; i <= splits; i++) {
      input.fill(i / splits);
      drive.update(dt, mixed);
    }
    const support = 3 * 41, cuff = 3 * 53;
    assert.ok(drive.targets[support] > 0 && drive.targets[support] < drive.targets[cuff]);
    assert.ok(drive.targets[cuff] < drive.targets[3 * 5] && drive.targets[3 * 5] < 1);
    assert.ok(drive.gains[1] < drive.gains[2] && drive.gains[2] < drive.gains[0]);
    const turnVelocity = drive.velocities[cuff];
    assert.ok(turnVelocity > 0);
    for (let i = 1; i <= splits; i++) {
      input.fill(1 - 2 * i / splits);
      drive.update(dt, idle);
    }
    return { turnVelocity, positions: drive.targets.slice(), velocities: drive.velocities.slice(), gains: [...drive.gains] };
  }
  const a = run(1), b = run(2);
  assert.ok(Math.abs(a.turnVelocity - b.turnVelocity) < 2e-5);
  for (const field of ['positions', 'velocities', 'gains']) {
    assert.ok(a[field].every((v, k) => Math.abs(v - b[field][k]) < 2e-5), field);
  }
  // Sample on either side of the exact switch time. A new desired motion never
  // clears the incoming derivative, even when the new input starts reversing.
  const input = new Float32Array(180), drive = createSleeveDrive({}, input, true);
  input.fill(1);
  drive.update(1 / 120, mixed);
  const v0 = drive.velocities[159];
  input.fill(1 - 120 * 1e-7);
  drive.update(1e-7, idle);
  assert.ok(Math.abs(drive.velocities[159] - v0) < .01);
});

test('control diagnostics preserve raw targets and read each original stiffness sampler exactly once per solve', () => {
  let reads = 0;
  const elasticAnchor = { particle: 53, createStiffnessSampler: () => () => ++reads * 100 };
  const input = new Float32Array(180), drive = createSleeveDrive({ elasticAnchor }, input, false);
  const sample = elasticAnchor.createStiffnessSampler();
  input[159] = .125;
  drive.update(1 / 120, mixed);
  assert.equal(drive.targets, input);
  assert.equal(drive.velocities[159], 15);
  assert.equal(reads, 0);
  assert.equal(sample(1 / 120), 100);
  assert.equal(drive.anchors[0].stiffness, 100);
  assert.deepEqual(drive.gains, [1, 1, 1]);
  assert.equal(reads, 1);
});

test('both backends consume identical continuous action weights, targets and springs across all 4230 ribbon substeps', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => (await load('assets/public/' + url)).gltf);
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
  t.after(() => server.close());
  const { replaySleeve } = await server.ssrLoadModule('/src/scene/cloth/sleeveReplay.ts');
  const inputs = [];
  for (const engine of ['xpbd', 'rapier']) {
    const hash = createHash('sha256');
    let positions, previousWeights, count = 0;
    let previousPositions;
    const switches = [];
    const result = await replaySleeve(engine, false, undefined, [], { pipeline: 'contact', cuff: 'zoned',
      animationBlend: 'continuous', stateTransition: true, rapidSwitch: true,
      onStep(frame) {
        const { step, animation, pose, region, targets, velocities, gains, anchors } = frame;
        assert.equal(step, ++count);
        positions ??= frame.positions;
        assert.equal(frame.positions, positions, 'same solver storage across ordinary action changes');
        assert.ok(frame.positions.every(Number.isFinite));
        assert.notEqual(targets, region.targets);
        assert.equal(animation.selected, pose);
        assert.ok(Math.abs(animation.weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-12);
        for (const anchor of anchors) {
          const band = anchor.particle >= 48 ? 2 : 1;
          assert.equal(anchor.stiffness, anchor.baseStiffness * gains[band]);
        }
        assert.equal(anchors.reduce((sum, a) => sum + a.baseStiffness, 0), 12000);
        for (const values of [region.targets, targets, velocities, Float64Array.from(animation.weights), Float64Array.from(anchors, a => a.stiffness)]) {
          hash.update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
        }
        if (step === 3480 || step === 4194) previousPositions = frame.positions.slice();
        if (step === 3481 || step === 4195) {
          switches.push(pose);
          assert.ok(previousWeights.every((w, i) => Math.abs(animation.weights[i] - w) < .065));
          assert.ok(animation.weights[step === 3481 ? 5 : 6] > .4);
          const actualVelocity = frame.readParticleVelocities();
          assert.equal(actualVelocity.length, targets.length);
          assert.ok(actualVelocity.every(Number.isFinite));
          assert.ok(actualVelocity.some((v, k) => Math.abs(v) > .001 && !region.profile.pins.includes(Math.floor(k / 3))));
          if (engine === 'xpbd') assert.deepEqual(actualVelocity,
            frame.positions.map((p, k) => (p - previousPositions[k]) / frame.dt), 'Verlet retains the prior solved pose');
          const surface = frame.bindSurface();
          assert.equal(surface.final, surface.mesh.geometry.attributes.pwCloth.array);
          const b = surface.bindings.at(-1);
          assert.equal(b.nodes.length, 4);
          assert.ok(Math.abs(b.weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-10);
          assert.ok(Number.isFinite(surface.mappingErrorAt(b.id)));
        }
        previousWeights = animation.weights;
      },
    });
    assert.equal(result.steps, 4230);
    assert.deepEqual(switches, ['起身', '待机']);
    inputs.push(hash.digest('hex'));
  }
  assert.equal(inputs[0], inputs[1]);
});
