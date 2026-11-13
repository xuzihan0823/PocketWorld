import type { MusicDisc } from '../../../types/interactable';

export type Point = [number, number, number];
// All coordinates are in the containing cabin's local space, never world space.
export const PLAYER: Point = [-.35, 1.2, -2.25];
export const PLATTER: Point = [-.48, 1.295, -2.25];
export const RECORD_CENTER: Point = [PLATTER[0], PLATTER[1] + .0125 + .007, PLATTER[2]];
export const DISC_RADIUS = .17;
export const DISC_LEAN = -.12;
export const ARM_REST = .1, ARM_PLAY = -1.03;
// Separate the entire label/hub thickness, not only the black vinyl faces.
export const discPosition = (slot: number): Point => [-.58 + (slot % 6) * .155, 1.36, -2.88 + (slot % 6) * .035];
export const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp = (a: Point, b: Point, t: number): Point => a.map((v, i) => mix(v, b[i], t)) as Point;
const bezier = (a: Point, b: Point, c: Point, d: Point, t: number): Point => a.map((v, i) => (1-t)**3*v + 3*(1-t)**2*t*b[i] + 3*(1-t)*t*t*c[i] + t**3*d[i]) as Point;

/** Reversible, collision-cleared path. Tilt is interpolated by quaternion in the view. */
export function recordPath(slot: number, progress: number): { position: Point; tilt: number } {
  const t = Math.max(0, Math.min(1, progress));
  const home = discPosition(slot);
  const pop: Point = [home[0], home[1] + .004, home[2] + .002];
  // First slide within the rack plane; only rotate after clearing neighbours and the lamp.
  const clear: Point = [Math.max(home[0], -.1), 1.78, pop[2] - (1.78 - pop[1]) * Math.tan(-DISC_LEAN)];
  const above: Point = [RECORD_CENTER[0], 1.53, RECORD_CENTER[2]];
  if (t < .1) return { position: lerp(home, pop, smooth(t / .1)), tilt: 0 };
  if (t < .4) return { position: lerp(pop, clear, smooth((t - .1) / .3)), tilt: 0 };
  if (t < .58) return { position: clear, tilt: smooth((t - .4) / .18) };
  if (t < .85) return { position: bezier(clear, [clear[0], 1.84, -2.32], [above[0], 1.68, above[2]], above, smooth((t - .58) / .27)), tilt: 1 };
  return { position: lerp(above, RECORD_CENTER, smooth((t - .85) / .15)), tilt: 1 };
}

export type RecordPhase = 'paused' | 'playing' | 'raise' | 'brake' | 'return' | 'extract' | 'settle' | 'spinup' | 'swing' | 'lower' | 'starting' | 'fadein' | 'park';
const durations: Partial<Record<RecordPhase, number>> = { raise: .35, brake: .5, return: 2.7, extract: 3.2, settle: .24, spinup: .55, swing: .65, lower: .6, fadein: .7, park: .25 };
export interface RecordPose { position: Point; tilt: number; seated: boolean; speed: number; yaw: number; lift: number; volume: number }
export type RecordEvent = { type: 'pause' | 'contact' } | { type: 'play'; disc: MusicDisc };

/** One owner for the transport, record and arm. Busy clicks never replace a running operation. */
export class RecordTransport {
  phase: RecordPhase;
  disc: MusicDisc;
  slot: number;
  target: { disc: MusicDisc; slot: number } | null = null;
  elapsed = 0;
  private wasPlaying = false;
  constructor(disc: MusicDisc, slot: number, playing = false) { this.disc = disc; this.slot = slot; this.phase = playing ? 'playing' : 'paused'; }
  get busy() { return this.phase !== 'paused' && this.phase !== 'playing'; }
  private enter(phase: RecordPhase) { this.phase = phase; this.elapsed = 0; }
  select(disc: MusicDisc, slot: number) {
    if (this.busy) return false;
    if (disc.id === this.disc.id) return this.phase === 'paused' ? this.resume() : false;
    this.target = { disc, slot }; this.wasPlaying = this.phase === 'playing'; this.enter('raise'); return true;
  }
  toggle() {
    if (this.busy) return false;
    if (this.phase === 'paused') return this.resume();
    this.wasPlaying = true; this.enter('raise'); return true;
  }
  private resume() { this.wasPlaying = false; this.enter('spinup'); return true; }
  playbackResult(playing: boolean) { if (this.phase === 'starting') { this.wasPlaying = true; this.enter(playing ? 'fadein' : 'raise'); } }
  tick(delta: number, reduced = false): RecordEvent[] {
    if (!this.busy || this.phase === 'starting') return [];
    this.elapsed += Math.max(0, Math.min(delta, .05));
    const duration = reduced ? .025 : durations[this.phase]!;
    if (this.elapsed < duration) return [];
    const events: RecordEvent[] = [];
    switch (this.phase) {
      case 'raise': this.enter('brake'); events.push({ type: 'pause' }); break;
      case 'brake': this.enter(this.target ? 'return' : 'park'); break;
      case 'return':
        this.disc = this.target!.disc; this.slot = this.target!.slot; this.target = null; this.enter('extract'); break;
      case 'extract': this.enter('settle'); events.push({ type: 'contact' }); break;
      case 'settle': this.enter('spinup'); break;
      case 'spinup': this.enter('swing'); break;
      case 'swing': this.enter('lower'); break;
      case 'lower': this.enter('starting'); events.push({ type: 'play', disc: this.disc }); break;
      case 'fadein': this.enter('playing'); break;
      case 'park': this.enter('paused'); break;
    }
    return events;
  }
  pose(reduced = false): RecordPose {
    const phase = this.phase;
    const t = smooth(this.elapsed / (reduced ? .025 : durations[phase] ?? 1));
    let position: Point = [...RECORD_CENTER], tilt = 1, seated = true, speed = 0, yaw = ARM_REST, lift = 1, volume = 0;
    if (phase === 'return' || phase === 'extract') {
      const path = recordPath(this.slot, phase === 'return' ? 1 - this.elapsed / (reduced ? .025 : durations.return!) : this.elapsed / (reduced ? .025 : durations.extract!));
      position = path.position; tilt = path.tilt; seated = false;
    }
    if (phase === 'settle' && !reduced) position[1] += Math.sin(Math.PI * t) ** 2 * .003;
    if (phase === 'playing' || phase === 'fadein' || phase === 'starting') { speed = 1; yaw = ARM_PLAY; lift = 0; volume = phase === 'playing' ? 1 : phase === 'fadein' ? t : 0; }
    if (phase === 'raise') { speed = this.wasPlaying ? 1 : 0; yaw = this.wasPlaying ? ARM_PLAY : ARM_REST; lift = this.wasPlaying ? t : 1; volume = this.wasPlaying ? 1-t : 0; }
    if (phase === 'brake') { speed = this.wasPlaying ? 1-t : 0; yaw = mix(this.wasPlaying ? ARM_PLAY : ARM_REST, ARM_REST, t); }
    if (phase === 'spinup') speed = t;
    if (phase === 'swing') { speed = 1; yaw = mix(ARM_REST, ARM_PLAY, t); }
    if (phase === 'lower') { speed = 1; yaw = ARM_PLAY; lift = 1-t; }
    return { position, tilt, seated, speed, yaw, lift, volume };
  }
}
