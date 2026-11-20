export const CHAIR_FPS = 30;
export const CHAIR_SIT_FRAMES = 98; // Frames in the Blender contact cache.
export const CHAIR_CLIP_ORIGIN = .54;
// The cropped 120 Hz AMC runs from frame 161 to 705, with a stable seat at 497.
export const CHAIR_HOLD_SECONDS = (497 - 161) / 120;
export const CHAIR_END_SECONDS = (705 - 161) / 120;

interface ChairMotion {
  align: number;
  time: number;
  phase: 'align' | 'sit' | 'seated' | 'stand' | 'cancel' | 'leave';
}

export const createChairMotion = (): ChairMotion => ({ align: 0, time: 0, phase: 'align' });

export function stepChairMotion(motion: ChairMotion, delta: number, exiting: boolean, reduced: boolean) {
  const dt = Math.max(0, Math.min(delta, .04));
  const alignSeconds = reduced ? .12 : .55;
  const step = dt * (reduced ? CHAIR_HOLD_SECONDS / .4 : 1);
  if (!exiting && motion.align < 1) {
    motion.phase = 'align';
    motion.align = Math.min(1, motion.align + dt / alignSeconds);
  } else if (!exiting) {
    motion.time = Math.min(CHAIR_HOLD_SECONDS, motion.time + step);
    motion.phase = motion.time === CHAIR_HOLD_SECONDS ? 'seated' : 'sit';
  } else if ((motion.phase === 'seated' || motion.phase === 'stand') && motion.time < CHAIR_END_SECONDS) {
    motion.phase = 'stand';
    motion.time = Math.min(CHAIR_END_SECONDS, motion.time + step);
  } else if (motion.time > 0 && motion.time < CHAIR_HOLD_SECONDS) {
    motion.phase = 'cancel';
    motion.time = Math.max(0, motion.time - step);
  } else {
    motion.phase = 'leave';
    motion.align = Math.max(0, motion.align - dt / alignSeconds);
  }
  return {
    done: exiting && motion.align === 0,
    weight: motion.align * motion.align * (3 - 2 * motion.align),
    offset: CHAIR_CLIP_ORIGIN,
  };
}
