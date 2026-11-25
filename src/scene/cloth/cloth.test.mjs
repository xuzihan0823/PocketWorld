import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as T from 'three';
import { load } from '../orbital/load-for-validation.mjs';

// Run exactly the browser modules with the repository compiler and installed WASM.
async function moduleUrl(file, imports = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [name, url] of Object.entries(imports))
    outputText = outputText.replaceAll(`'${name}'`, JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
}
const physics = await moduleUrl('./physics.ts'),
  { FixedClock, Xpbd, distance } = await import(physics);
const { patchRegion, garmentRegion } = await import(
  await moduleUrl('./binding.ts', { './physics': physics, three: import.meta.resolve('three') })
);
const { makeRapier } = await import(
  await moduleUrl('./rapier.ts', {
    '@dimforge/rapier3d-compat': import.meta.resolve('@dimforge/rapier3d-compat'),
  })
);

test('fixed clock caps backlog and advances identical time at 30/60/120 render FPS', () => {
  for (const fps of [30, 60, 120]) {
    const clock = new FixedClock();
    let steps = 0;
    for (let i = 0; i < fps; i++) clock.advance(1 / fps, 60, () => steps++);
    assert.equal(steps, 60);
    clock.advance(5, 60, () => steps++);
    assert.equal(steps, 64);
    assert.equal(clock.dropped, 296);
  }
});

test('XPBD separates coincident non-neighbors while respecting pins and self-contact toggle', () => {
  for (const self of [true, false]) {
    const profile = {
      ...patchRegion(new T.Scene()).profile,
      rest: new Float32Array(6),
      pins: [0],
      structural: [],
      shear: [],
      bend: [],
      triangles: [],
      thickness: 0.04,
    };
    const solver = new Xpbd(profile, self);
    solver.step(0.001, profile.rest, []);
    assert.equal(solver.positions[1], 0);
    assert.equal(distance(solver.positions, 0, 1) > 0.079, self);
    solver.dispose();
  }
});

// Measure both backends at exactly the same simulated instants, independent of browser refresh.
function foldAngle(profile, p) {
  const normals = new Map();
  let total = 0,
    pairs = 0;
  for (let n = 0; n < profile.triangles.length; n += 3) {
    const ids = profile.triangles.slice(n, n + 3);
    const [a, b, c] = ids.map((i) => new T.Vector3().fromArray(p, 3 * i));
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    for (let i = 0; i < 3; i++) {
      const x = ids[i],
        y = ids[(i + 1) % 3],
        key = Math.min(x, y) * p.length + Math.max(x, y);
      const previous = normals.get(key);
      if (previous) {
        total += previous.angleTo(normal);
        pairs++;
      } else normals.set(key, normal);
    }
  }
  return ((total / pairs) * 180) / Math.PI;
}

for (const engine of ['xpbd', 'rapier'])
  for (const self of [true, false])
    test(
      engine + ' suspended cloth follows moving pins through fold and reversal, self=' + self,
      async (t) => {
        const region = patchRegion(new T.Scene());
        const { profile, targets, balls } = region;
        const solver = engine === 'xpbd' ? new Xpbd(profile, self) : await makeRapier(profile, balls, self);
        let maxStretch = 0,
          maxFold = 0;
        try {
          for (let i = 1; i <= 240; i++) {
            region.sample(i / 120);
            solver.step(1 / 120, targets, balls);
            assert.ok(solver.positions.every(Number.isFinite));
            if (i % 6 === 0) {
              maxFold = Math.max(maxFold, foldAngle(profile, solver.positions));
              for (let k = 0; k < profile.structural.length; k += 2) {
                const a = profile.structural[k],
                  b = profile.structural[k + 1];
                if (profile.pins.includes(a) && profile.pins.includes(b)) continue;
                maxStretch = Math.max(
                  maxStretch,
                  distance(solver.positions, a, b) / distance(profile.rest, a, b) - 1,
                );
              }
            }
            for (const pin of profile.pins)
              assert.ok(
                Math.hypot(...[0, 1, 2].map((k) => solver.positions[3 * pin + k] - targets[3 * pin + k])) <
                  1e-4,
              );
          }
          t.diagnostic(
            'peak free-edge extension ' +
              (100 * maxStretch).toFixed(1) +
              '%, peak mean adjacent-face angle ' +
              maxFold.toFixed(1) +
              ' deg',
          );
          region.bind(solver.positions);
          assert.ok(distance(solver.positions, 0, 96) > 0.1);
        } finally {
          solver.dispose();
        }
      },
    );

test('ribbon sleeve maps only its own side after the final bone pose and leaves skin data intact', async () => {
  const { gltf } = await load(
    new URL('../../../assets/public/models/resident/luna-ribbon.glb', import.meta.url),
  );
  let surface;
  gltf.scene.traverse((o) => {
    if (
      o.isSkinnedMesh &&
      (!surface || o.geometry.attributes.position.count > surface.geometry.attributes.position.count)
    )
      surface = o;
  });
  gltf.scene.updateMatrixWorld(true);
  const region = garmentRegion(surface, 'Left'),
    pos = surface.geometry.attributes.position;
  const rest = pos.array.slice();
  surface.skeleton.getBoneByName('mixamorigLeftForeArm').rotateX(0.7);
  gltf.scene.updateMatrixWorld(true);
  const bones = surface.skeleton.bones.map((b) => b.matrixWorld.clone());
  region.sample(0);
  assert.ok(region.targets.some((v, i) => Math.abs(v - region.profile.rest[i]) > 0.005));
  const p = region.targets.slice();
  for (let i = 0; i < p.length; i += 3) p[i] += 0.01;
  region.bind(p);
  const offset = surface.geometry.attributes.pwCloth;
  let moved = 0;
  for (let i = 0; i < offset.count; i++)
    if (offset.getX(i) > 0.00001) {
      assert.ok(pos.getX(i) > 0);
      moved++;
    }
  assert.ok(moved > 1000 && moved <= region.mappedVertices);
  assert.deepEqual(pos.array, rest);
  assert.ok(bones.every((b, i) => b.equals(surface.skeleton.bones[i].matrixWorld)));
});
