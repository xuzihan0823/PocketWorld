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
const maskUrl = await moduleUrl('./sleeveMask.ts');
const contactImports = { three: import.meta.resolve('three'), './sleeveMask': maskUrl, 'three-mesh-bvh': import.meta.resolve('three-mesh-bvh') };
const { patchRegion, garmentRegion } = await import(
  await moduleUrl('./binding.ts', { ...contactImports, './physics': physics })
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

test('single sleeve keeps bind lengths across creation poses and caps only the displayed offsets', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-ribbon.glb', import.meta.url));
  let mesh;
  gltf.scene.traverse(o => {
    if (o.isSkinnedMesh && (!mesh || mesh.geometry.attributes.position.count < o.geometry.attributes.position.count)) mesh = o;
  });
  gltf.scene.scale.setScalar(1.43);
  gltf.scene.updateMatrixWorld(true);
  const first = garmentRegion(mesh, 'Left', false, true);
  mesh.skeleton.getBoneByName('mixamorigLeftForeArm').rotateX(0.8);
  gltf.scene.updateMatrixWorld(true);
  const region = garmentRegion(mesh, 'Left', false, true);
  assert.deepEqual(first.profile.rest, region.profile.rest);
  assert.notDeepEqual(first.profile.initial, region.profile.initial);
  const solver = new Xpbd(region.profile);
  assert.deepEqual(solver.positions, region.targets);
  const originalRest = region.profile.rest.slice();
  const expectedEdges = new Set();
  for (let i = 0; i < 60; i++) {
    expectedEdges.add(`${i},${i % 12 === 11 ? i - 11 : i + 1}`);
    if (i < 48) expectedEdges.add(`${i},${i + 12}`);
  }
  for (let j = 0; j < region.profile.structural.length; j += 2) {
    const [a, b] = region.profile.structural.slice(j, j + 2);
    assert.ok(expectedEdges.delete(`${a},${b}`));
    assert.ok(distance(originalRest, a, b) > 0.001);
  }
  assert.equal(expectedEdges.size, 0);
  const displaced = region.targets.slice();
  for (let i = 0; i < displaced.length; i += 3) displaced[i] += 0.09;
  region.sample(1);
  region.bind(displaced);
  const { raw, final } = region.sleeveLayers;
  const linear = new T.Matrix3().setFromMatrix4(mesh.matrixWorld), v = new T.Vector3();
  let largestRaw = 0, largestFinal = 0;
  for (let k = 0; k < raw.length; k += 3) {
    largestRaw = Math.max(largestRaw, v.fromArray(raw, k).applyMatrix3(linear).length());
    largestFinal = Math.max(largestFinal, v.fromArray(final, k).applyMatrix3(linear).length());
  }
  assert.ok(largestRaw > 0.08 && largestFinal > 0.01 && largestFinal <= 0.018001);
  assert.deepEqual(region.profile.rest, originalRest);
  solver.dispose();
});

test('sleeve audit detects a crossing on the real jacket and identifies pairs removed after mapping', async () => {
  const maskUrl = await moduleUrl('./sleeveMask.ts');
  const { sleeveSurfaceMask } = await import(maskUrl);
  const { createSleeveAudit } = await import(await moduleUrl('./sleeveSurface.ts', {
    three: import.meta.resolve('three'), './sleeveMask': maskUrl, 'three-mesh-bvh': import.meta.resolve('three-mesh-bvh'),
  }));
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-ribbon.glb', import.meta.url));
  let mesh;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh && o.geometry.attributes.position.count === 38114) mesh = o; });
  gltf.scene.updateMatrixWorld(true);
  const mask = sleeveSurfaceMask(mesh), audit = createSleeveAudit(mesh);
  const face = members => {
    const ids = mesh.geometry.index.array;
    for (let i = 0; i < ids.length; i += 3) {
      const tri = [ids[i], ids[i+1], ids[i+2]];
      if (tri.every(id => members.has(id))) return tri;
    }
    assert.fail('missing labeled face');
  };
  const points = face(mask.torso).map(id => mesh.getVertexPosition(id, new T.Vector3()));
  const target = new T.Triangle(...points), mid = target.getMidpoint(new T.Vector3());
  const normal = target.getNormal(new T.Vector3()).multiplyScalar(0.002);
  const raw = new Float32Array(3 * mesh.geometry.attributes.position.count), final = raw.slice();
  for (const id of mask.sleeve) final[3*id] = 2;
  raw.set(final);
  const crossing = [mid.clone().add(normal), mid.clone().sub(normal), mid.clone().lerp(points[0], 0.3)];
  face(mask.sleeve).forEach((id,k) => crossing[k].sub(mesh.getVertexPosition(id,new T.Vector3())).toArray(raw,3*id));
  const hit = audit.measure(raw,final);
  assert.ok(hit.raw > 0);
  assert.equal(hit.final, 0);
  assert.equal(hit.added, 0);
  assert.equal(hit.removed, hit.raw);
  assert.ok(Object.values(hit.counts).every(n => n > 0));
  assert.ok(mask.skin.has(2607) && !mask.sleeve.has(2607));
});
