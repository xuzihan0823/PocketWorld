import { MathUtils } from 'three';

/** The supplied caster chair is fitted once; no gas-lift or animated seat height. */
export const ROLLING_CHAIR_SIZE: [number, number, number] = [.85, .79, .75];
export const CHAIR_STAND_OFFSET = .40;
export type ChairPhase = 'backing' | 'blend-in' | 'sit-down' | 'seated' | 'stand-up' | 'blend-out' | 'leaving' | 'done';
export function createChairMotion(offset: number) {
  return { phase: 'backing' as ChairPhase, offset, exitOffset: offset, time: 0, weight: 0, idle: 0, returning: false };
}
export type ChairMotion = ReturnType<typeof createChairMotion>;
export function advanceChairMotion(m: ChairMotion, delta: number, exit: boolean, reduced: boolean, speed: number) {
  const dt = Math.min(Math.max(delta, 0), .05), before = m.offset;
  if (exit && !m.returning) {
    m.returning = true;
    m.phase = m.phase === 'backing' ? 'leaving' : 'stand-up';
  }
  if (m.phase === 'backing') {
    m.offset = Math.max(CHAIR_STAND_OFFSET, m.offset - speed * dt);
    if (m.offset === CHAIR_STAND_OFFSET) m.phase = 'blend-in';
  } else if (m.phase === 'blend-in') {
    m.weight = Math.min(1, m.weight + dt / .24);
    if (m.weight === 1) m.phase = 'sit-down';
  } else if (m.phase === 'sit-down') {
    m.time = Math.min(3, m.time + dt * (reduced ? 3 : 1));
    if (m.time === 3) { m.phase = 'seated'; m.idle = 0; }
  } else if (m.phase === 'seated') {
    if (!reduced) m.idle += dt;
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
