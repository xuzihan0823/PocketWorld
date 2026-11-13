import type { StripPhase } from './schedule.ts';

export interface StripGesture { id: string; phase: StripPhase; progress: number; origin: 'attached' | 'pasted' }
export const TEAR_DISTANCE = 94;
export function startStripGesture(id: string, pasted = false): StripGesture {
  return { id, phase: pasted ? 'dragging' : 'peeling', progress: pasted ? 1 : 0, origin: pasted ? 'pasted' : 'attached' };
}
export function moveStripGesture(state: StripGesture, distance: number): StripGesture {
  if (state.phase === 'detached') return { ...state, phase: 'dragging' };
  if (state.phase !== 'peeling') return state;
  const progress = Math.min(1, Math.max(0, distance / TEAR_DISTANCE));
  return { ...state, progress, phase: progress === 1 ? 'detached' : 'peeling' };
}
export function finishStripGesture(state: StripGesture, target: 'book' | 'surface' | null, cancelled = false): StripPhase {
  if (cancelled || state.phase === 'peeling' || target === null) return state.origin;
  return target === 'book' ? 'attached' : 'pasted';
}
/** Deterministic paper fibres, shared by SVG outline and mesh silhouette. */
export function tornEdge(t: number, seed = 0) {
  return (Math.sin(t * 173 + seed * 3) * 0.5 + Math.sin(t * 397 + seed) * 0.3 + Math.sin(t * 71) * 0.2) * 0.004;
}
