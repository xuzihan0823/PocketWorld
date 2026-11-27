import specialRingtoneUrl from '../../../../assets/audio/alarm-special-intro.mp3?url';
import type { ClockRingtoneId } from './clockState';

export class ClockAudioPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private synthTimer: ReturnType<typeof setInterval> | null = null;
  private pendingClassicBurst = false;
  private activeOscillators = new Set<OscillatorNode>();
  private htmlAudio: HTMLAudioElement | null = null;
  private muted = false;
  private playingTone: ClockRingtoneId | null = null;
  private disposed = false;

  constructor(private readonly specialUrl: string = specialRingtoneUrl) {}

  private ensureContext(): AudioContext | null {
    if (this.disposed || typeof window === 'undefined') return null;
    try {
      const Ctor = window.AudioContext ?? (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!this.ctx || this.ctx.state === 'closed') {
        if (typeof Ctor !== 'function') return null;
        this.ctx = new Ctor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : 0.85;
        this.masterGain.connect(this.ctx.destination);
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public unlock(): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const resumePlayback = () => {
      if (this.ctx === ctx && ctx.state === 'running' && this.pendingClassicBurst) this.triggerClassicBurst();
    };
    if (ctx.state === 'running') resumePlayback();
    else void ctx.resume().then(resumePlayback).catch(() => {});
  }

  public isPlaying(): boolean {
    return this.playingTone !== null;
  }

  public getActiveRingtone(): ClockRingtoneId | null {
    return this.playingTone;
  }

  public start(ringtone: ClockRingtoneId): void {
    if (this.disposed) return;
    this.stop();
    this.playingTone = ringtone;
    if (ringtone === 'special') {
      this.startSpecial();
    } else {
      this.startClassic();
    }
  }

  private startSpecial(): void {
    try {
      const AudioCtor = (typeof window !== 'undefined' && window.Audio)
        ? window.Audio
        : (globalThis as unknown as { Audio?: typeof Audio }).Audio;
      if (typeof AudioCtor !== 'function') {
        this.startClassic();
        return;
      }
      const audio = new AudioCtor(this.specialUrl);
      audio.loop = true;
      audio.volume = 0.82;
      audio.muted = this.muted;
      audio.currentTime = 0;
      this.htmlAudio = audio;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (this.htmlAudio === audio && this.playingTone === 'special') {
            this.stopHtmlAudio();
            this.startClassic();
          }
        });
      }
    } catch {
      this.startClassic();
    }
  }

  private startClassic(): void {
    if (!this.ensureContext()) return;
    const setIntervalFn = typeof window !== 'undefined' && typeof window.setInterval === 'function'
      ? window.setInterval.bind(window)
      : setInterval;
    this.synthTimer = setIntervalFn(() => this.triggerClassicBurst(), 820);
    this.triggerClassicBurst();
    this.unlock();
  }

  private triggerClassicBurst(): void {
    if (this.disposed || this.synthTimer === null || !this.playingTone || this.muted) return;
    const context = this.ensureContext();
    if (!context || !this.masterGain) return;
    if (context.state !== 'running') {
      this.pendingClassicBurst = true;
      return;
    }
    this.pendingClassicBurst = false;
    const now = context.currentTime;
    const pulseOffsets = [0, 0.11, 0.22, 0.33];
    for (const offset of pulseOffsets) this.scheduleClassicPulse(context, now + offset);
  }

  private scheduleClassicPulse(ctx: AudioContext, startTime: number): void {
    if (!this.masterGain) return;
    const duration = 0.072;
    const mainOsc = ctx.createOscillator();
    const bellOsc = ctx.createOscillator();
    const pulseGain = ctx.createGain();

    mainOsc.type = 'square';
    mainOsc.frequency.setValueAtTime(1046.5, startTime); // C6 classic alarm pitch

    bellOsc.type = 'triangle';
    bellOsc.frequency.setValueAtTime(2093, startTime); // C7 metallic bell harmonic

    pulseGain.gain.setValueAtTime(0.0001, startTime);
    pulseGain.gain.linearRampToValueAtTime(0.14, startTime + 0.006);
    pulseGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    mainOsc.connect(pulseGain);
    bellOsc.connect(pulseGain);
    pulseGain.connect(this.masterGain);

    this.activeOscillators.add(mainOsc);
    this.activeOscillators.add(bellOsc);

    let remaining = 2;
    const cleanup = (osc: OscillatorNode) => {
      this.activeOscillators.delete(osc);
      try { osc.disconnect(); } catch { /* ignore */ }
      if (--remaining === 0) {
        try { pulseGain.disconnect(); } catch { /* ignore */ }
      }
    };
    mainOsc.onended = () => cleanup(mainOsc);
    bellOsc.onended = () => cleanup(bellOsc);

    mainOsc.start(startTime);
    mainOsc.stop(startTime + duration + 0.004);
    bellOsc.start(startTime);
    bellOsc.stop(startTime + duration + 0.004);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 0.85;
    }
    if (this.htmlAudio) {
      this.htmlAudio.muted = muted;
    }
    if (muted) {
      this.stopActiveOscillators();
    }
  }

  private stopActiveOscillators(): void {
    for (const osc of this.activeOscillators) {
      try { osc.stop(); } catch { /* already ended */ }
      try { osc.disconnect(); } catch { /* ignore */ }
    }
    this.activeOscillators.clear();
  }

  private stopHtmlAudio(): void {
    if (!this.htmlAudio) return;
    const audio = this.htmlAudio;
    this.htmlAudio = null;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute?.('src');
      audio.load?.();
    } catch {
      /* ignore */
    }
  }

  public stop(): void {
    this.playingTone = null;
    this.pendingClassicBurst = false;
    if (this.synthTimer !== null) {
      const clearIntervalFn = typeof window !== 'undefined' && typeof window.clearInterval === 'function'
        ? window.clearInterval.bind(window)
        : clearInterval;
      clearIntervalFn(this.synthTimer);
      this.synthTimer = null;
    }
    this.stopActiveOscillators();
    this.stopHtmlAudio();
  }

  public dispose(): void {
    this.disposed = true;
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.masterGain = null;
  }
}
