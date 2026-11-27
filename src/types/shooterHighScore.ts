import { withStorageWriteLock } from './storageWrite.ts';

const SHOOTER_HIGH_SCORE = 'pocketworld:shooter:highscore';

export function shooterHighScore(candidate = 0, getStorage = () => localStorage): number {
  let best = candidate;
  try {
    const stored = Number(getStorage().getItem(SHOOTER_HIGH_SCORE));
    if (Number.isFinite(stored)) best = Math.max(candidate, stored);
  } catch { /* Keep the in-memory score. */ }
  return best;
}

export function recordShooterHighScore(score: number, getStorage = () => localStorage): number {
  const current = shooterHighScore(0, getStorage);
  if (current >= score) return current;
  withStorageWriteLock(SHOOTER_HIGH_SCORE, () => {
    try {
      const stored = Number(getStorage().getItem(SHOOTER_HIGH_SCORE));
      if (!Number.isFinite(stored) || score > stored) getStorage().setItem(SHOOTER_HIGH_SCORE, String(score));
    } catch { /* Keep the in-memory score. */ }
  });
  return score;
}
