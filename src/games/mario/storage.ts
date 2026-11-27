import { withStorageWriteLock } from '../../types/storageWrite.ts';
import { BAIT_LIMIT, CAREER_LIMIT, FISH_CAPACITY, FISH_CATALOG, FISH_MASS, LEGACY_FISH_COUNT, ORDER_CAPACITY, RECIPE_CATALOG, isBaitId, isRecipeId, type FishId } from './catalog.ts';
import type { AnglingProgress, CatchWeight, FishingOrder, FishingProgress } from './model.ts';

export const SAVE_KEY = 'pocketworld:mario:save:v2';
export const LEGACY_SAVE_KEY = 'pocketworld:mario:save:v1';
export const HIGHSCORE_KEY = 'pocketworld:mario:highscore:v2';
// Leave room for a safe-integer score (at most 16 ASCII bytes).
const SAVE_BYTE_LIMIT = 4096 - 16;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
type Save = { progress?: FishingProgress; preserve?: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function decodeAngling(value: unknown, discovered: Set<FishId>): AnglingProgress | undefined {
  if (!record(value) || !isBaitId(value.bait) || !record(value.stock) || !record(value.counts)) return;
  const { shrimp, fish } = value.stock;
  if (!integer(shrimp, 0, BAIT_LIMIT) || !integer(fish, 0, BAIT_LIMIT)) return;
  const stock = { shrimp, fish };
  if (value.bait !== 'none' && stock[value.bait] === 0) return;
  const counts: Partial<Record<FishId, number>> = {};
  for (const [id, count] of Object.entries(value.counts)) {
    const species = FISH_CATALOG.find(entry => entry.id === id);
    if (!species || !discovered.has(species.id) || !integer(count, 1, CAREER_LIMIT)) return;
    counts[species.id] = count;
  }
  let best: CatchWeight | undefined;
  if (record(value.best)) {
    const { fishId, grams } = value.best;
    const species = FISH_CATALOG.find(entry => entry.id === fishId);
    if (!species || !counts[species.id]) return;
    const [minimum, maximum] = FISH_MASS[species.id];
    if (!integer(grams, minimum, maximum)) return;
    best = { fishId: species.id, grams };
  } else if (value.best !== undefined || Object.keys(counts).length) return;
  return { stock, bait: value.bait, counts, ...(best && { best }) };
}

function decodeSave(raw: string | null): Save {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    // A newer format must survive even if it is over this version's budget.
    if (!record(value)) return {};
    if (Object.prototype.hasOwnProperty.call(value, 'version')) {
      if (value.version !== 1 && value.version !== 2) return { preserve: true };
    }
    const { version, coins, rodLevel, equippedRodLevel, fishCounts, discoveredFishIds, orders } = value;
    if ((version !== 1 && version !== 2) || new TextEncoder().encode(raw).length > SAVE_BYTE_LIMIT ||
        !integer(coins, 0, Number.MAX_SAFE_INTEGER) || (rodLevel !== 1 && rodLevel !== 2 && rodLevel !== 3) ||
        !record(fishCounts) ||
        !Array.isArray(discoveredFishIds) || discoveredFishIds.length > FISH_CATALOG.length ||
        !Array.isArray(orders) || orders.length > ORDER_CAPACITY) return {};

    const countKeys = Object.keys(fishCounts).length;
    const legacy = countKeys === LEGACY_FISH_COUNT;
    if (!legacy && countKeys !== FISH_CATALOG.length) return {};
    const discovered = new Set<FishId>();
    for (const id of discoveredFishIds) {
      const fish = FISH_CATALOG.find(fish => fish.id === id);
      if (!fish || !Object.prototype.hasOwnProperty.call(fishCounts, fish.id) || discovered.has(fish.id)) return {};
      discovered.add(fish.id);
    }
    const counts = {} as Record<FishId, number>;
    let total = 0;
    for (const [index, { id }] of FISH_CATALOG.entries()) {
      const count = legacy && index >= LEGACY_FISH_COUNT ? 0 : fishCounts[id];
      if (!integer(count, 0, FISH_CAPACITY) || (count > 0 && !discovered.has(id))) return {};
      counts[id] = count;
      total += count;
    }
    if (total > FISH_CAPACITY) return {};

    const pending: FishingOrder[] = [];
    let pendingRevenue = 0;
    for (const order of orders) {
      if (!record(order)) return {};
      const { fishId, recipeId, remainingMs } = order;
      const fish = FISH_CATALOG.find(fish => fish.id === fishId);
      if (!fish || !discovered.has(fish.id) || !isRecipeId(recipeId)) return {};
      const recipe = RECIPE_CATALOG[recipeId];
      if ((recipe.fishIds && !recipe.fishIds.includes(fish.id)) ||
          !integer(remainingMs, pending.length ? recipe.durationMs : 1, recipe.durationMs)) return {};
      pendingRevenue += recipe.price;
      pending.push({ fishId: fish.id, recipeId, remainingMs });
    }
    if (coins > Number.MAX_SAFE_INTEGER - pendingRevenue) return {};
    const equipped = equippedRodLevel === 1 || equippedRodLevel === 2 || equippedRodLevel === 3
      ? Math.min(equippedRodLevel, rodLevel) as typeof rodLevel : rodLevel;
    const angling = version === 2 && value.angling !== undefined ? decodeAngling(value.angling, discovered) : undefined;
    if (version === 2 && value.angling !== undefined && !angling) return {};
    return { progress: {
      version: 2, coins, rodLevel, ...(equipped !== rodLevel && { equippedRodLevel: equipped }),
      fishCounts: counts, discoveredFishIds: [...discovered], orders: pending, ...(angling && { angling }),
    } };
  } catch { return {}; }
}

function readScore(raw: string | null) {
  if (raw === null || !/^\d{1,16}$/.test(raw)) return 0;
  const value = Number(raw);
  return integer(value, 0, Number.MAX_SAFE_INTEGER) ? value : 0;
}

export function openFishingStorage(getStorage: () => StorageAccess, onConflict?: () => void) {
  let baseline: string | null = null;
  let save: Save = {};
  let lastScore = 0;
  try {
    const storage = getStorage();
    baseline = storage.getItem(SAVE_KEY) ?? null;
    save = decodeSave(baseline ?? storage.getItem(LEGACY_SAVE_KEY));
  }
  catch { save = { preserve: true }; } // Don't overwrite a record we could not read.
  try { lastScore = readScore(getStorage().getItem(HIGHSCORE_KEY)); }
  catch { /* In-memory best still works. */ }
  let dirty = false;
  let pending = false;
  function changedElsewhere(storage: StorageAccess) {
    if (save.preserve || (storage.getItem(SAVE_KEY) ?? null) === baseline) return false;
    save.preserve = true;
    onConflict?.();
    return true;
  }

  return {
    progress: save.progress,
    highScore: lastScore,
    markDirty() { dirty = true; },
    checkForChanges() {
      try { changedElsewhere(getStorage()); } catch { /* Retry at the next checkpoint. */ }
    },
    flush(progress: () => FishingProgress, highScore: number) {
      if (dirty && !save.preserve && !pending) {
        pending = true;
        withStorageWriteLock(SAVE_KEY, () => {
          try {
            const storage = getStorage();
            if (save.preserve || changedElsewhere(storage)) return;
            const encoded = JSON.stringify(progress());
            if (new TextEncoder().encode(encoded).length <= SAVE_BYTE_LIMIT) {
              storage.setItem(SAVE_KEY, encoded);
              baseline = encoded;
              dirty = false;
            }
          } catch { /* Keep dirty so a later checkpoint can retry. */ }
          finally { pending = false; }
        }, () => { pending = false; });
      }
      if (highScore > lastScore) {
        try {
          const storage = getStorage();
          // Don't clobber a newer record from another tab or a transient read failure.
          const current = readScore(storage.getItem(HIGHSCORE_KEY));
          if (highScore > current) storage.setItem(HIGHSCORE_KEY, String(highScore));
          lastScore = Math.max(highScore, current);
        } catch { /* In-memory best still works. */ }
      }
    },
  };
}
