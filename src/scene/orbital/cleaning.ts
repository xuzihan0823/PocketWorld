export interface CleaningTiming {
  /** Fade to black before the clean-up is announced. */
  fadeIn: number;
  /** Time the floor is being swept while the screen stays black. */
  sweep: number;
  /** Fade back to the room after items have been reset. */
  fadeOut: number;
  /** Spacing between synthesized broom strokes. */
  sweepInterval: number;
}

/** Reduced motion keeps the same sequence readable, but only a blink long. */
export function cleaningTiming(reducedMotion: boolean): CleaningTiming {
  return reducedMotion
    ? { fadeIn: 120, sweep: 1400, fadeOut: 120, sweepInterval: 460 }
    : { fadeIn: 520, sweep: 3200, fadeOut: 700, sweepInterval: 620 };
}

export function cleaningSweepCount(timing: CleaningTiming): number {
  return Math.max(1, Math.floor(timing.sweep / timing.sweepInterval));
}

export function cleaningTotal(timing: CleaningTiming): number {
  return timing.fadeIn + timing.sweep + timing.fadeOut;
}
