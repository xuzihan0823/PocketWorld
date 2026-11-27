import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFishingGame } from './engine.ts';
import { FISH_CATALOG, LEGACY_FISH_COUNT } from './catalog.ts';
import { HIGHSCORE_KEY, LEGACY_SAVE_KEY, openFishingStorage, SAVE_KEY } from './storage.ts';

const empty = () => createFishingGame({ random: () => 0 }).getProgress();
function storage(progress, score = '11', raw = JSON.stringify(progress)) {
  const map = new Map([[SAVE_KEY, raw], [HIGHSCORE_KEY, score]]);
  const writes = [];
  return {
    map, writes,
    open: () => openFishingStorage(() => ({ getItem: key => map.get(key), setItem(key, text) { map.set(key, text); writes.push(key); } })),
  };
}

test('strictly validates schema, ids, limits and exact recipe time without trusting custom prices', () => {
  const pending = { fishId: 'snapper', recipeId: 'special', remainingMs: 6000 };
  const valid = { ...empty(), discoveredFishIds: ['snapper'], orders: [pending] };
  const invalid = [
    { ...valid, coins: -1 }, { ...valid, coins: Number.MAX_SAFE_INTEGER },
    { ...valid, rodLevel: 4 }, { ...valid, discoveredFishIds: ['snapper', 'snapper'] },
    { ...valid, fishCounts: { ...valid.fishCounts, snapper: 33 } },
    { ...valid, fishCounts: { ...valid.fishCounts, sardine: 1 } },
    { ...valid, fishCounts: { ...valid.fishCounts, snapper: 0.5 } },
    { ...valid, orders: [pending, pending, pending, pending] },
    { ...valid, orders: [{ ...pending, fishId: 'missing' }] },
    { ...valid, orders: [{ ...pending, recipeId: 'constructor' }] },
    { ...valid, discoveredFishIds: ['sardine'], orders: [{ ...pending, fishId: 'sardine' }] },
    ...[0, 6001, -1, 4000.1].map(remainingMs => ({ ...valid, orders: [{ ...pending, remainingMs }] })),
    { ...valid, orders: [pending, { ...pending, remainingMs: 5999 }] },
    { ...valid, extra: '鱼'.repeat(1400) },
  ];
  for (const progress of invalid) assert.equal(storage(progress).open().progress, undefined, JSON.stringify(progress));
  const parsed = storage({ ...valid, orders: [{ ...pending, price: 200 }] }).open();
  assert.deepEqual(parsed.progress, valid);
  assert.equal(parsed.highScore, 11);
});

test('bad saves start clean; future versions and read-denied saves are not overwritten', () => {
  const corrupt = storage(null, '1e4', '{');
  const fresh = corrupt.open();
  assert.equal(fresh.progress, undefined);
  assert.equal(fresh.highScore, 0);
  fresh.flush(() => assert.fail('clean data'), 0);
  fresh.markDirty();
  fresh.flush(empty, 5);
  assert.deepEqual(corrupt.writes, [SAVE_KEY, HIGHSCORE_KEY]);
  assert(Buffer.byteLength(corrupt.map.get(SAVE_KEY) + corrupt.map.get(HIGHSCORE_KEY)) <= 4096);
  const future = storage({ version: 3, payload: '鱼'.repeat(2000) });
  const save = future.open();
  assert.equal(save.progress, undefined);
  save.markDirty();
  save.flush(empty, 12);
  assert.deepEqual(future.writes, [HIGHSCORE_KEY]);
  let disk = '';
  const denied = openFishingStorage(() => ({
    getItem: key => { if (key === SAVE_KEY) throw new Error('read denied'); return null; },
    setItem: (key, value) => { assert.equal(key, HIGHSCORE_KEY); disk = value; },
  }));
  denied.markDirty();
  denied.flush(empty, 5);
  assert.equal(disk, '5');
  assert.doesNotThrow(() => openFishingStorage(() => { throw new Error('storage blocked'); }).flush(empty, 20));
});

test('version one saves resume expanded recipes alongside existing sushi orders', () => {
  const orders = [
    { fishId: 'sardine', recipeId: 'grilled', remainingMs: 3_250 },
    { fishId: 'snapper', recipeId: 'steamedSnapper', remainingMs: 9_000 },
    { fishId: 'sardine', recipeId: 'basic', remainingMs: 4_000 },
  ];
  const saved = { ...empty(), discoveredFishIds: ['sardine', 'snapper'], orders };
  assert.deepEqual(storage(saved).open().progress, saved);
  const wrongFish = { ...saved, orders: [{ fishId: 'sardine', recipeId: 'steamedSnapper', remainingMs: 9_000 }] };
  assert.equal(storage(wrongFish).open().progress, undefined);
});

test('eight-fish saves retain the basket, equipment and queue after the catalog expands', () => {
  const legacyIds = FISH_CATALOG.slice(0, LEGACY_FISH_COUNT).map(fish => fish.id);
  const counts = Object.fromEntries(legacyIds.map(id => [id, id === 'snapper' ? 2 : 0]));
  const saved = {
    ...empty(), coins: 90, rodLevel: 3, equippedRodLevel: 2,
    fishCounts: counts, discoveredFishIds: ['snapper', 'sardine'],
    orders: [{ fishId: 'sardine', recipeId: 'grilled', remainingMs: 2_000 }],
  };
  const newCounts = { ...empty().fishCounts, ...counts };
  assert.deepEqual(storage(saved).open().progress, { ...saved, fishCounts: newCounts });
  const expanded = {
    ...saved, fishCounts: { ...newCounts, lanternfish: 1 }, discoveredFishIds: [...saved.discoveredFishIds, 'lanternfish'],
    orders: [...saved.orders, { fishId: 'lanternfish', recipeId: 'lanternSushi', remainingMs: 9_000 }],
  };
  assert.deepEqual(storage(expanded).open().progress, expanded);
  const { anchovy, ...missing } = counts;
  assert.equal(storage({ ...saved, fishCounts: { ...missing, unexpected: anchovy } }).open().progress, undefined);
});

test('legacy saves upgrade on the first write, and career and bait persist together', () => {
  const legacy = { ...empty(), version: 1, coins: 20 };
  const map = new Map([[LEGACY_SAVE_KEY, JSON.stringify(legacy)]]);
  const access = () => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
  const save = openFishingStorage(access);
  assert.equal(save.progress.version, 2);
  assert.equal(save.progress.angling, undefined);
  const game = createFishingGame({ random: () => 0, progress: save.progress });
  game.startTrip();
  game.selectBait('shrimp');
  game.advance(10_600);
  save.markDirty();
  save.flush(game.getProgress, 0);
  assert.deepEqual(openFishingStorage(access).progress.angling, {
    bait: 'shrimp', stock: { shrimp: 2, fish: 3 }, counts: { sardine: 1 }, best: { fishId: 'sardine', grams: 80 },
  });
  assert.deepEqual(JSON.parse(map.get(LEGACY_SAVE_KEY)), legacy);
});

test('write failure retains dirty state for retry and best never replaces a larger record', () => {
  const data = new Map([[HIGHSCORE_KEY, '3']]);
  let deny = true;
  const log = [];
  const open = openFishingStorage(() => ({
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { if (deny) throw new Error('quota'); log.push(key); data.set(key, value); },
  }));
  open.markDirty();
  open.flush(empty, 5);
  assert.deepEqual(log, []);
  data.set(HIGHSCORE_KEY, '10');
  deny = false;
  open.flush(empty, 5);
  open.flush(() => assert.fail('clean after retry'), 5);
  assert.deepEqual(log, [SAVE_KEY]);
  assert.equal(data.get(HIGHSCORE_KEY), '10');
});

test('queued writers compare the live save inside the lock and can reopen the winning snapshot', () => {
  const queue = [];
  const store = new Map();
  const access = () => ({ getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) });
  const locks = { request(key, callback) {
    assert.equal(key, SAVE_KEY);
    queue.push(callback);
    return Promise.resolve();
  } };
  let conflicts = 0;
  globalThis.window = { navigator: { locks } };
  try {
    const a = openFishingStorage(access);
    const b = openFishingStorage(access, () => conflicts++);
    a.markDirty(); b.markDirty();
    a.flush(() => ({ ...empty(), coins: 20 }), 0);
    b.flush(() => ({ ...empty(), coins: 10 }), 0);
    queue.splice(0).forEach(write => write());
    assert.equal(conflicts, 1);
    assert.equal(openFishingStorage(access).progress.coins, 20);
    b.markDirty(); b.flush(empty, 0);
    assert.equal(queue.length, 0);
    const fresh = openFishingStorage(access);
    fresh.markDirty(); fresh.flush(() => ({ ...fresh.progress, coins: 21 }), 0);
    queue.shift()();
    assert.equal(openFishingStorage(access).progress.coins, 21);
  } finally { delete globalThis.window; }
});
