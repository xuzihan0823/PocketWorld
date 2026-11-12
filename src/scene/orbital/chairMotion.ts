import { MathUtils } from 'three';

// Keep the hanging skirt in front of the full-size cushion before lifting.
export const CHAIR_STAND_OFFSET = .68;
/** Measured cushion fit: the lounge seat is lower and 6.5 cm deeper at its front. */
export function chairSeatFit(time: number, weight: number, lounge: boolean) {
  const transfer = weight * MathUtils.smoothstep(time, 1.4, 2.75);
  return { y: lounge ? -.037 * transfer : 0, z: 0 };
}
/** Move onto the front edge before reaching down; keep the pelvis supported. */
export function chairScootFit(perch: number) {
  return { y: -.01 * perch, z: .14 * MathUtils.smoothstep(perch, 0, .6) };
}
export type ChairPhase = 'backing' | 'blend-in' | 'sit-down' | 'seated' | 'stand-up' | 'blend-out' | 'leaving' | 'done';
/** The controller owns travel; the clip owns pelvis descent and limb motion. */
export function createChairMotion(offset: number, lounge = false) {
  return { phase: 'backing' as ChairPhase, offset, standOffset: CHAIR_STAND_OFFSET + (lounge ? .065 : 0), exitOffset: offset, time: 0, weight: 0, idle: 0, returning: false };
}
export type ChairMotion = ReturnType<typeof createChairMotion>;
export function advanceChairMotion(m: ChairMotion, dt: number, exit: boolean, reduced: boolean, speed: number) {
  const before = m.offset;
  if (exit && !m.returning) {
    m.returning = true;
    m.phase = m.phase === 'backing' ? 'leaving' : 'stand-up';
  }
  if (m.phase === 'backing') {
    m.offset = Math.max(m.standOffset, m.offset - speed * dt);
    if (m.offset === m.standOffset) m.phase = 'blend-in';
  } else if (m.phase === 'blend-in') {
    m.weight = Math.min(1, m.weight + dt / .24);
    if (m.weight === 1) m.phase = 'sit-down';
  } else if (m.phase === 'sit-down') {
    m.time = Math.min(3, m.time + dt * (reduced ? 3 : 1));
    if (m.time === 3) { m.phase = 'seated'; m.idle = 0; }
  } else if (m.phase === 'seated') {
    if (!reduced) m.idle += dt;
    // Ping-pong the quiet section; both turnarounds ease to zero speed.
    m.time = 3 + 1.5 * (1 - Math.cos(m.idle * Math.PI / 3));
  } else if (m.phase === 'stand-up') {
    m.time = Math.max(0, m.time - dt * (m.time > 3 ? 5 : reduced ? 3 : 1.35));
    if (m.time === 0) m.phase = 'blend-out';
  } else if (m.phase === 'blend-out') {
    m.weight = Math.max(0, m.weight - dt / .24);
    if (m.weight === 0) m.phase = 'leaving';
  } else if (m.phase === 'leaving') {
    m.offset = Math.min(m.exitOffset, m.offset + speed * dt);
    if (m.offset === m.exitOffset) m.phase = 'done';
  }
  return { travel: m.offset - before, crouch: m.weight * MathUtils.smoothstep(m.time, .25, 3) };
}
