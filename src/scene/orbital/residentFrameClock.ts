/** A discontinuity is a pause, not animation time to replay on the next visible frame. */
const MAX_CONTINUOUS_FRAME = .5;

export function createResidentFrameClock() {
  let resuming = false;
  return {
    // Visibility can change without a single frame running while hidden.
    reset() { resuming = true; },
    step(delta: number, hidden: boolean) {
      if (hidden) { resuming = true; return 0; }
      if (resuming) { resuming = false; return 0; }
      if (!Number.isFinite(delta) || delta <= 0 || delta > MAX_CONTINUOUS_FRAME) return 0;
      // Keep the full visible frame interval, including 15/20 FPS. Movement and
      // collision must still impose their own small step independently.
      return delta;
    },
  };
}
