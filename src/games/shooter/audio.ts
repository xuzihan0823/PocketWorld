import type { VariantId } from './survival/arsenal';

export type SoundEvent = 'launch' | 'hit' | 'destroy' | 'wave' | 'impact' | 'critical' | 'switch' | 'pickup' | 'dash' | 'blast';

type Tone = [wave: OscillatorType, startHz: number, endHz: number, length: number, gain: number, delay?: number];

const casts: Record<VariantId, readonly Tone[]> = {
  hex: [['triangle', 640, 240, .10, .16], ['sine', 1480, 940, .12, .065, .016]],
  scatter: [['sawtooth', 205, 63, .13, .105], ['triangle', 820, 220, .075, .075]],
  rail: [['triangle', 290, 1580, .12, .09], ['sine', 1740, 525, .18, .12, .043]],
  stream: [['square', 315, 197, .042, .064], ['sine', 790, 520, .035, .04]],
  burst: [
    ['triangle', 390, 237, .058, .12],
    ['triangle', 455, 272, .058, .10, .08],
    ['triangle', 510, 304, .068, .095, .16],
  ],
  prism: [['sawtooth', 255, 820, .115, .076], ['triangle', 1440, 402, .17, .10, .04]],
  launcher: [['sawtooth', 125, 57, .19, .10], ['sine', 285, 490, .26, .068]],
  mortar: [['sine', 150, 69, .21, .15], ['triangle', 340, 820, .35, .068, .048]],
  mine: [['triangle', 470, 305, .064, .12], ['sine', 880, 880, .11, .055, .08]],
  star: [['sine', 640, 920, .15, .13], ['triangle', 1250, 1560, .14, .055, .044]],
  frostfan: [['sine', 1540, 970, .13, .097], ['sine', 2210, 1840, .105, .055, .033]],
  moon: [['triangle', 493, 658, .20, .092], ['sine', 740, 554, .21, .081, .08]],
  sweep: [['triangle', 214, 63, .15, .13], ['sawtooth', 550, 160, .10, .045]],
  lance: [['triangle', 225, 580, .075, .13], ['sine', 820, 330, .13, .09, .031]],
  flying: [['triangle', 330, 495, .10, .10], ['sine', 660, 330, .20, .085, .075]],
};

const effects: Record<Exclude<SoundEvent, 'launch'>, readonly Tone[]> = {
  hit: [['triangle', 212, 66, .18, .16]],
  destroy: [['triangle', 430, 690, .10, .086]],
  wave: [['triangle', 525, 790, .18, .075], ['sine', 1047, 1175, .16, .06, .09]],
  impact: [['triangle', 185, 102, .061, .07]],
  critical: [['sine', 1090, 1360, .10, .11]],
  switch: [['triangle', 420, 610, .08, .086]],
  pickup: [['sine', 975, 1300, .08, .07]],
  dash: [['triangle', 360, 160, .19, .113]],
  blast: [['triangle', 118, 37, .27, .19], ['sawtooth', 207, 53, .155, .064]],
};

// 《月下嗒嗒舞》: an eight-bar C minor loop with a bouncing bell answer.
const melody = [
  [72, 0, 75, 79, 77, 0, 75, 72],
  [70, 0, 72, 75, 77, 75, 70, 0],
  [72, 0, 75, 79, 84, 79, 75, 0],
  [74, 0, 77, 74, 71, 0, 67, 0],
  [77, 0, 79, 80, 79, 0, 77, 72],
  [75, 0, 77, 75, 72, 0, 70, 0],
  [72, 75, 79, 0, 84, 79, 82, 79],
  [77, 74, 71, 0, 67, 0, 71, 0],
];
const bassRoots = [48, 46, 44, 43, 41, 44, 48, 43];
const eighth = 60 / 132 / 2;
const hz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export class ShooterAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices = new Map<OscillatorNode, GainNode>();
  private enabled = false;
  private muted = false;
  private beat = 0;
  private nextNote = 0;
  private lastBlast = -Infinity;

  configure(enabled: boolean, muted: boolean): void {
    const wasAudible = this.enabled && !this.muted;
    const audible = enabled && !muted;
    this.enabled = enabled;
    this.muted = muted;

    const context = this.context;
    if (!context || context.state === 'closed') return;
    this.output?.gain.setValueAtTime(audible ? .42 : 0, context.currentTime);
    if (audible === wasAudible) return;
    this.nextNote = 0;
    if (!audible) {
      this.clearVoices();
      void context.suspend().catch(() => undefined);
    } else {
      void context.resume().catch(() => undefined);
    }
  }

  unlock(): void {
    if (!this.enabled || this.muted || typeof window === 'undefined') return;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new window.AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = .42;
        this.output.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    } catch { /* The cartridge remains playable without Web Audio. */ }
  }

  startTrack(): void {
    this.beat = 0;
    this.nextNote = 0;
    this.lastBlast = -Infinity;
  }

  /** Driven by the active game frame. No timer survives pause, mute or eject. */
  tick(): void {
    const context = this.context;
    if (!context || !this.enabled || this.muted || context.state !== 'running') return;
    const now = context.currentTime;
    if (now < this.nextNote) return;
    const bar = Math.floor(this.beat / 8);
    const step = this.beat % 8;
    const note = melody[bar][step];
    const when = Math.max(now, this.nextNote) + .008;

    if (note) {
      const pitch = hz(note);
      this.tone(['triangle', pitch, pitch, .18, .081], when);
      if (step === 0 || step === 4) this.tone(['sine', pitch * 2, pitch * 2, .088, .033], when);
    }
    if (step % 2 === 0) {
      const bass = hz(bassRoots[bar] + (step % 4 === 2 ? 7 : 0));
      this.tone(['sine', bass, bass, .22, .093], when);
      if (step === 0 || step === 4) this.tone(['sine', 105, 44, .11, .068], when);
    } else if (step === 3 || step === 7) {
      this.tone(['triangle', 1190, 740, .034, .032], when);
    }
    this.beat = (this.beat + 1) % (melody.length * 8);
    this.nextNote = this.nextNote > now - eighth ? this.nextNote + eighth : now + eighth;
  }

  play(event: SoundEvent, variant: VariantId = 'hex'): void {
    const context = this.context;
    if (!context || !this.enabled || this.muted || context.state !== 'running') return;
    const now = context.currentTime;
    if (event === 'blast') {
      if (now - this.lastBlast < .13) return;
      this.lastBlast = now;
    }
    const notes = event === 'launch' ? casts[variant] : effects[event];
    for (const note of notes) this.tone(note, now);
  }

  private tone([wave, start, end, duration, volume, delay = 0]: Tone, when: number): void {
    const context = this.context;
    const output = this.output;
    if (!context || !output || this.voices.size >= 22) return;
    const oscillator = context.createOscillator();
    const voice = context.createGain();
    const time = when + delay;
    const endTime = time + duration;
    try {
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(start, time);
      oscillator.frequency.exponentialRampToValueAtTime(end, endTime);
      voice.gain.setValueAtTime(.001, time);
      voice.gain.exponentialRampToValueAtTime(volume, time + .008);
      voice.gain.exponentialRampToValueAtTime(.001, endTime);
      oscillator.connect(voice);
      voice.connect(output);
      this.voices.set(oscillator, voice);
      oscillator.onended = () => this.disconnect(oscillator, voice);
      oscillator.start(time);
      oscillator.stop(endTime);
    } catch {
      this.disconnect(oscillator, voice);
      try { oscillator.stop(); } catch { /* Creation failed before the oscillator started. */ }
    }
  }

  private disconnect(oscillator: OscillatorNode, voice: GainNode): void {
    oscillator.onended = null;
    oscillator.disconnect();
    voice.disconnect();
    this.voices.delete(oscillator);
  }

  private clearVoices(): void {
    this.voices.forEach((voice, oscillator) => {
      this.disconnect(oscillator, voice);
      try { oscillator.stop(); } catch { /* Already stopped. */ }
    });
  }

  dispose(): void {
    this.clearVoices();
    const context = this.context;
    this.output?.disconnect();
    this.context = null;
    this.output = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
