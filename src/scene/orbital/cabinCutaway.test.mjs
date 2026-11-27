import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import * as cutaway from './cabinCutaway.ts';
const { cabinDeckOpacity, collectZoomFades, quickCabinFrame } = cutaway;

test('single-floor framing hides the other room while overview shows both', () => {
  assert.deepEqual(cabinDeckOpacity('overview', 0), { lower: 1, upper: 1 });
  assert.deepEqual(cabinDeckOpacity('lower', 1), { lower: 1, upper: 0 });
  assert.deepEqual(cabinDeckOpacity('upper', 1), { lower: 0, upper: 1 });
});

test('closing in fades only the other deck and pulling back restores both', () => {
  const far = cutaway.cabinZoomIsolation(1);
  const middle = cutaway.cabinZoomIsolation(.80);
  const near = cutaway.cabinZoomIsolation(.65);
  assert.equal(far, 0);
  assert.ok(middle > 0 && middle < 1);
  assert.equal(near, 1);
  assert.equal(cutaway.cabinZoomIsolation(.74), 1);
  assert.ok(cutaway.cabinZoomIsolation(.915) > 0);
  for (const [focus, other] of [['lower', 'upper'], ['upper', 'lower']]) {
    assert.deepEqual(cabinDeckOpacity(focus, far), { lower: 1, upper: 1 });
    assert.equal(cabinDeckOpacity(focus, middle)[focus], 1);
    assert.equal(cabinDeckOpacity(focus, middle)[other], 1 - middle);
    assert.equal(cabinDeckOpacity(focus, near)[other], 0);
  }
});

test('wide floor changes keep both rooms visible while close floor changes finish the fade', () => {
  const both = { lower: 1, upper: 1 };
  assert.deepEqual(cabinDeckOpacity('lower', 0, .95, 'lower'), both);
  for (const target of ['lower', 'upper']) {
    const wide = quickCabinFrame(.75, both, target, 0);
    assert.equal(wide.lower, 1);
    assert.equal(wide.upper, 1);
    assert.deepEqual(quickCabinFrame(1, both, target, 1), {
      ...cabinDeckOpacity(target, 1), resident: 1, relocate: true,
    });
  }
});

test('a fading room preserves shared materials and restores the original mesh and shadows', () => {
  const room = new Group();
  const shared = new MeshStandardMaterial({ opacity: .8, transparent: true });
  const inner = new Mesh(undefined, shared);
  const outer = new Mesh(undefined, shared);
  inner.castShadow = true;
  room.add(inner);
  const fade = cutaway.createCabinGroupFade();
  fade.set(room, .25);
  assert.ok(room.visible);
  assert.equal(inner.material.opacity, .2);
  assert.equal(outer.material.opacity, .8);
  assert.equal(inner.castShadow, false);
  fade.set(room, 0);
  assert.equal(room.visible, false);
  assert.equal(inner.material, shared);
  fade.set(room, 1);
  assert.ok(room.visible);
  assert.equal(inner.material, shared);
  assert.equal(inner.castShadow, true);
});

test('opaque geometry fades through continuous transparency', () => {
  const room = new Group();
  const original = new MeshStandardMaterial();
  const mesh = new Mesh(undefined, original);
  room.add(mesh);
  const fade = cutaway.createCabinGroupFade();
  fade.set(room, .5);
  assert.equal(mesh.material.opacity, .5);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.alphaHash, false);
  assert.equal(mesh.material.depthWrite, false);
  fade.set(room, 1);
  assert.equal(mesh.material, original);
  assert.equal(mesh.material.transparent, false);
});

test('walking opens the next room early and fades the old room toward the landing', () => {
  for (const [from, to] of [['lower', 'upper'], ['upper', 'lower']]) {
    const sample = progress => cabinDeckOpacity(from, 1, from === 'lower' ? progress : 1 - progress, from);
    assert.deepEqual(sample(0), cabinDeckOpacity(from, 1));
    assert.ok(sample(.12)[to] > 0 && sample(.12)[to] < 1);
    assert.deepEqual(sample(.5), { lower: 1, upper: 1 });
    assert.ok(sample(.89)[from] > 0 && sample(.89)[from] < 1);
    assert.deepEqual(sample(1), cabinDeckOpacity(to, 1));
  }
});

test('quick travel conceals Luna and the old room at relocation on either deck', () => {
  for (const [from, to] of [['lower', 'upper'], ['upper', 'lower']]) {
    const initial = cabinDeckOpacity(from, 1);
    const start = quickCabinFrame(0, initial, to, 1);
    const moving = quickCabinFrame(.30, initial, to, 1);
    const relocation = quickCabinFrame(.50, initial, to, 1);
    const end = quickCabinFrame(1, initial, to, 1);
    assert.deepEqual(start, { ...initial, resident: 1, relocate: false });
    assert.ok(moving[from] > 0 && moving[from] < 1);
    assert.ok(moving[to] > 0 && moving[to] < 1);
    assert.equal(relocation.relocate, true);
    assert.equal(relocation.resident, 0);
    assert.equal(relocation[from], 0);
    assert.deepEqual(end, { ...cabinDeckOpacity(to, 1), resident: 1, relocate: true });
  }
});

test('faded materials stay cached across fade cycles, sync dynamic maps, and dispose cleanly on teardown', () => {
  const room = new Group();
  const original = new MeshStandardMaterial({ color: '#f5f0e1' });
  const customHook = () => {};
  const customKey = () => 'custom-fade-key';
  original.onBeforeCompile = customHook;
  original.customProgramCacheKey = customKey;
  const mesh = new Mesh(undefined, original);
  room.add(mesh);

  const fade = cutaway.createCabinGroupFade();
  fade.set(room, .4);
  const firstFaded = mesh.material;
  let disposed = 0;
  firstFaded.addEventListener('dispose', () => { disposed += 1; });
  assert.equal(firstFaded.onBeforeCompile, customHook);
  assert.equal(firstFaded.customProgramCacheKey, customKey);

  // Returning to 0 or 1 restores the original without evicting the compiled faded material.
  fade.set(room, 0);
  assert.equal(mesh.material, original);
  assert.equal(disposed, 0);

  // Dynamic map/color updates made while opaque are synchronized on the next fade.
  const tex = new Texture();
  original.map = tex;
  original.color.set('#ffffff');
  fade.set(room, .6);
  assert.equal(mesh.material, firstFaded);
  assert.equal(firstFaded.map, tex);
  assert.equal(firstFaded.color.getHexString(), 'ffffff');
  assert.equal(firstFaded.opacity, .6);

  fade.set(room, 1);
  assert.equal(mesh.material, original);
  assert.equal(disposed, 0);

  // Disposing the original material also frees its cached faded clone.
  original.dispose();
  assert.equal(disposed, 1);

  // Disposing the fade controller cleans up remaining cached clones.
  const other = new MeshStandardMaterial();
  const otherMesh = new Mesh(undefined, other);
  room.add(otherMesh);
  fade.set(room, .5);
  const otherFaded = otherMesh.material;
  let otherDisposed = 0;
  otherFaded.addEventListener('dispose', () => { otherDisposed += 1; });
  fade.dispose();
  assert.equal(otherMesh.material, other);
  assert.equal(otherDisposed, 1);
  tex.dispose();
  other.dispose();
});

test('collectZoomFades selects ordered framebuffer fade layers without cloning materials', () => {
  assert.deepEqual(collectZoomFades({ lower: 1, upper: 1, resident: .5, interior: 1 }), ['resident']);
  assert.deepEqual(collectZoomFades({ lower: 1, upper: .4, resident: 1, interior: 1 }), ['upper']);
  assert.deepEqual(collectZoomFades({ lower: .4, upper: 1, resident: 1, interior: 1 }), ['lower']);
  assert.deepEqual(collectZoomFades({ lower: 1, upper: 1, resident: 0, interior: 1 }), []);
  assert.deepEqual(collectZoomFades({ lower: 1, upper: 1, resident: 1, interior: 1 }), []);
  assert.deepEqual(
    collectZoomFades({ lower: .3, upper: .6, resident: .5, interior: 1 }, ['lower', 'upper', 'resident']),
    ['lower', 'upper', 'resident'],
  );
  assert.deepEqual(
    collectZoomFades({ lower: .6, upper: .3, resident: .5, interior: 1 }, ['upper', 'lower', 'resident']),
    ['upper', 'lower', 'resident'],
  );
  assert.deepEqual(collectZoomFades({ lower: 1, upper: .5, resident: 1, interior: .8 }), []);
});
