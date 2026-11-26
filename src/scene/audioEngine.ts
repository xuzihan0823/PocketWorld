import { MusicDisc } from '../types/interactable';
import swedenUrl from '../../assets/audio/records/sweden.mp3';
import ariaMathUrl from '../../assets/audio/records/aria-math.mp3';
import subwooferLullabyUrl from '../../assets/audio/records/subwoofer-lullaby.mp3';

export const PRESET_MUSIC_DISCS: MusicDisc[] = [
  {
    id: 'disc-sweden',
    title: 'Sweden',
    artist: 'C418',
    audioUrl: swedenUrl,
    discThemeColor: ['#f59e0b', '#fb7185'],
    duration: 215.5,
  },
  {
    id: 'disc-aria-math',
    title: 'Aria Math',
    artist: 'C418',
    audioUrl: ariaMathUrl,
    discThemeColor: ['#38bdf8', '#818cf8'],
    duration: 310,
  },
  {
    id: 'disc-subwoofer-lullaby',
    title: 'Subwoofer Lullaby',
    artist: 'C418',
    audioUrl: subwooferLullabyUrl,
    discThemeColor: ['#34d399', '#059669'],
    duration: 208.56,
  },
  {
    id: 'disc-starlight-dream',
    title: '微缩梦境 (Diorama Reverie)',
    artist: 'Pocket Studio · Chillhop',
    audioUrl: 'synth:starlight-dream',
    discThemeColor: ['#c084fc', '#f472b6'],
    synthPreset: 'starlight-dream',
    duration: 180,
  },
];

/**
 * 根据本地音频文件名生成专属双色光盘渐变主题
 */
export function generateDiscColorsFromName(fileName: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < fileName.length; i++) {
    hash = (hash * 31 + fileName.charCodeAt(i)) >>> 0;
  }
  const palettes: [string, string][] = [
    ['#f97316', '#ec4899'],
    ['#06b6d4', '#3b82f6'],
    ['#10b981', '#14b8a6'],
    ['#eab308', '#f97316'],
    ['#8b5cf6', '#ec4899'],
    ['#38bdf8', '#34d399'],
  ];
  return palettes[hash % palettes.length];
}

export interface RoomAudioSnapshot {
  disc: MusicDisc;
  isPlaying: boolean;
  isMuted: boolean;
  status: 'idle' | 'starting' | 'playing' | 'paused' | 'error';
  error: string | null;
}

export interface FootstepAudioOptions {
  foot?: 0 | 1;
  surface?: 'wood' | 'rug';
  variant?: 'walk' | 'push';
  intensity?: number;
}

export type RoomSfxType =
  | 'switch'
  | 'paper'
  | 'soft'
  | 'disc'
  | 'footstep'
  | 'lamp-on'
  | 'lamp-off'
  | 'book-open'
  | 'book-close'
  | 'book-extract'
  | 'book-insert'
  | 'book-shelf-add'
  | 'paper-tear'
  | 'paper-crumple'
  | 'paper-land'
  | 'paper-pickup'
  | 'paper-check';

class RoomAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private isPlaying = false;
  private currentDisc: MusicDisc = PRESET_MUSIC_DISCS[0];
  private synthTimer: number | null = null;
  private stepIndex = 0;
  private footstepCount = 0;
  private lastFootstepTime = { walk: -Infinity, push: -Infinity };
  private lastSfxTime = new Map<RoomSfxType, number>();
  private noiseBuffer: AudioBuffer | null = null;
  private noiseBufferCtx: AudioContext | null = null;
  private crispNoiseBuffer: AudioBuffer | null = null;
  private crispNoiseBufferCtx: AudioContext | null = null;
  private htmlAudio: HTMLAudioElement | null = null;
  private catAudio: HTMLAudioElement | null = null;
  private preparedMusic: { disc: MusicDisc; audio: HTMLAudioElement } | null = null;
  private requestId = 0;
  private musicGain: GainNode | null = null;
  private playbackGain: GainNode | null = null;
  private musicLevel = 1;
  private voices = new Set<OscillatorNode>();
  private thruster: { osc: OscillatorNode; sub: OscillatorNode; noise: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private listeners = new Set<() => void>();
  private snapshot: RoomAudioSnapshot = { disc: this.currentDisc, isPlaying: false, isMuted: false, status: 'idle', error: null };

  public getSnapshot = (): RoomAudioSnapshot => this.snapshot;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(status: RoomAudioSnapshot['status'], error: string | null = null) {
    this.snapshot = { disc: this.currentDisc, isPlaying: this.isPlaying, isMuted: this.isMuted, status, error };
    this.listeners.forEach(listener => listener());
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        if (typeof window.AudioContext !== 'function') return null;
        this.ctx = new window.AudioContext();
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.isMuted ? 0 : 1;
        this.musicGain.connect(this.ctx.destination);
        this.playbackGain = this.ctx.createGain();
        this.playbackGain.gain.value = this.musicLevel;
        this.playbackGain.connect(this.musicGain);
      }
      return this.ctx;
    } catch { return null; }
  }

  /** Call synchronously from a physical object's user gesture before its insertion animation. */
  public unlock(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return Promise.resolve(false);
    return (ctx.state === 'running' ? Promise.resolve() : ctx.resume())
      .then(() => ctx.state === 'running', () => false);
  }

  /** Prime the same media element during touch/click; audible playback waits for insertion. */
  public prepareMusic(disc: MusicDisc): void {
    void this.unlock();
    if (disc.audioUrl.startsWith('synth:') || (this.htmlAudio && this.currentDisc.id === disc.id && this.currentDisc.audioUrl === disc.audioUrl)) return;
    this.cancelPreparedMusic();
    try {
      const audio = new Audio(disc.audioUrl);
      audio.muted = true;
      audio.volume = 0;
      this.preparedMusic = { disc, audio };
      void audio.play().then(() => {
        if (this.preparedMusic?.audio !== audio) return;
        audio.pause();
        audio.currentTime = 0;
      }).catch(() => { /* startMusic reports a recoverable playback error after insertion. */ });
    } catch { /* A browser without HTML audio is reported by startMusic. */ }
  }

  public cancelPreparedMusic(): void {
    const prepared = this.preparedMusic;
    this.preparedMusic = null;
    if (!prepared) return;
    prepared.audio.pause();
    prepared.audio.removeAttribute('src');
    prepared.audio.load();
  }

  /** Transport envelope; independent of mute and room/interaction sound effects. */
  public setMusicLevel(level: number): void {
    if (!Number.isFinite(level)) return;
    const next = Math.max(0, Math.min(1, level));
    if (next === this.musicLevel) return;
    this.musicLevel = next;
    if (this.playbackGain && this.ctx) this.playbackGain.gain.setTargetAtTime(next, this.ctx.currentTime, .015);
    if (this.htmlAudio) this.htmlAudio.volume = .65 * next;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) this.stopCatMeow();
    if (this.htmlAudio) {
      this.htmlAudio.muted = muted;
    }
    if (this.musicGain) this.musicGain.gain.value = muted ? 0 : 1;
    this.publish(this.snapshot.status, this.snapshot.error);
  }

  public stopCatMeow() {
    if (!this.catAudio) return;
    this.catAudio.pause();
    this.catAudio.currentTime = 0;
  }

  public playCatMeow(url: string) {
    if (this.isMuted) return;
    try {
      const audio = this.catAudio ??= new Audio(url);
      if (!audio.paused) return;
      audio.volume = .42;
      audio.currentTime = 0;
      void audio.play().catch(() => {
        if (this.catAudio === audio && audio.paused) this.catAudio = null;
      });
    } catch { /* An unavailable effect does not interrupt cat interaction. */ }
  }

  public playSfx(type: RoomSfxType) {
    if (type === 'footstep') {
      this.playFootstep();
      return;
    }
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const minGap = type === 'paper-check' ? 0.035 : 0.055;
    const prevTime = this.lastSfxTime.get(type) ?? -Infinity;
    if (now - prevTime < minGap) return;
    this.lastSfxTime.set(type, now);

    const out = this.musicGain ?? ctx.destination;
    if (type !== 'switch' && type !== 'soft' && type !== 'disc') {
      this.playPhysicalSfx(ctx, out, type, now);
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(out);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };

    if (type === 'switch') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.045);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'disc') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(310, now);
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.16);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.07);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.09);
    }
  }

  private ensureCrispNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.crispNoiseBuffer && this.crispNoiseBufferCtx === ctx) return this.crispNoiseBuffer;
    if (typeof ctx.createBuffer !== 'function') return null;
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.crispNoiseBuffer = buffer;
      this.crispNoiseBufferCtx = ctx;
      return buffer;
    } catch {
      return null;
    }
  }

  private scheduleTone(
    ctx: AudioContext,
    out: AudioNode,
    spec: {
      start: number;
      duration: number;
      type: OscillatorType;
      freqStart: number;
      freqEnd: number;
      peak: number;
      attack?: number;
    }
  ) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const attack = Math.min(spec.attack ?? 0.004, spec.duration * 0.45);
    osc.type = spec.type;
    osc.frequency.setValueAtTime(Math.max(20, spec.freqStart), spec.start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), spec.start + spec.duration);
    gain.gain.setValueAtTime(0.0001, spec.start);
    gain.gain.linearRampToValueAtTime(spec.peak, spec.start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0006, spec.start + spec.duration);
    osc.connect(gain);
    gain.connect(out);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(spec.start);
    osc.stop(spec.start + spec.duration + 0.006);
  }

  private scheduleNoiseBurst(
    ctx: AudioContext,
    out: AudioNode,
    buffer: AudioBuffer | null,
    spec: {
      start: number;
      duration: number;
      filterType: BiquadFilterType;
      freqStart: number;
      freqEnd?: number;
      q?: number;
      peak: number;
      attack?: number;
      playbackRate?: number;
    }
  ): boolean {
    if (!buffer || typeof ctx.createBufferSource !== 'function' || typeof ctx.createBiquadFilter !== 'function') {
      return false;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const attack = Math.min(spec.attack ?? 0.006, spec.duration * 0.45);
    source.buffer = buffer;
    if (spec.playbackRate) source.playbackRate.setValueAtTime(spec.playbackRate, spec.start);
    filter.type = spec.filterType;
    filter.frequency.setValueAtTime(Math.max(40, spec.freqStart), spec.start);
    if (spec.freqEnd && spec.freqEnd !== spec.freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, spec.freqEnd), spec.start + spec.duration);
    }
    if (spec.q !== undefined) filter.Q.setValueAtTime(spec.q, spec.start);
    gain.gain.setValueAtTime(0.0001, spec.start);
    gain.gain.linearRampToValueAtTime(spec.peak, spec.start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0005, spec.start + spec.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    const maxOffset = Math.max(0, buffer.duration - spec.duration - 0.01);
    const offset = Math.random() * maxOffset;
    source.start(spec.start, offset, spec.duration + 0.01);
    return true;
  }

  private playPhysicalSfx(
    ctx: AudioContext,
    out: AudioNode,
    type: Exclude<RoomSfxType, 'switch' | 'soft' | 'disc' | 'footstep'>,
    now: number
  ) {
    const jitter = 0.96 + Math.random() * 0.08;
    const crisp = this.ensureCrispNoiseBuffer(ctx);

    if (type === 'lamp-on' || type === 'lamp-off') {
      const turningOn = type === 'lamp-on';
      // 1. Brass bead pull-chain click
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.015,
        filterType: 'highpass',
        freqStart: (turningOn ? 2750 : 2350) * jitter,
        q: 1.1,
        peak: 0.036,
        attack: 0.002,
      });
      this.scheduleTone(ctx, out, {
        start: now,
        duration: 0.017,
        type: 'triangle',
        freqStart: (turningOn ? 1920 : 1540) * jitter,
        freqEnd: (turningOn ? 1160 : 840) * jitter,
        peak: 0.034,
        attack: 0.002,
      });
      // 2. Internal spring toggle detent snap
      const snap = now + 0.022;
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: snap,
        duration: 0.02,
        filterType: 'bandpass',
        freqStart: (turningOn ? 2100 : 1620) * jitter,
        freqEnd: (turningOn ? 1450 : 980) * jitter,
        q: 1.6,
        peak: turningOn ? 0.05 : 0.042,
        attack: 0.002,
      });
      this.scheduleTone(ctx, out, {
        start: snap,
        duration: 0.034,
        type: 'triangle',
        freqStart: (turningOn ? 740 : 620) * jitter,
        freqEnd: (turningOn ? 1120 : 390) * jitter,
        peak: turningOn ? 0.068 : 0.056,
        attack: 0.002,
      });
      return;
    }

    if (type === 'paper') {
      const hasNoise = this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.042,
        filterType: 'bandpass',
        freqStart: 2300 * jitter,
        freqEnd: 1850 * jitter,
        q: 1.8,
        peak: 0.028,
        attack: 0.005,
      });
      if (!hasNoise) {
        this.scheduleTone(ctx, out, {
          start: now,
          duration: 0.1,
          type: 'triangle',
          freqStart: 240 * jitter,
          freqEnd: 120 * jitter,
          peak: 0.065,
          attack: 0.008,
        });
        return;
      }
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.016,
        duration: 0.175,
        filterType: 'bandpass',
        freqStart: 1120 * jitter,
        freqEnd: 2380 * jitter,
        q: 1.15,
        peak: 0.058,
        attack: 0.046,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.135,
        duration: 0.055,
        filterType: 'lowpass',
        freqStart: 640 * jitter,
        freqEnd: 380 * jitter,
        q: 0.9,
        peak: 0.032,
        attack: 0.006,
      });
      return;
    }

    if (type === 'book-open') {
      this.scheduleTone(ctx, out, {
        start: now,
        duration: 0.072,
        type: 'sine',
        freqStart: 152 * jitter,
        freqEnd: 84 * jitter,
        peak: 0.056,
        attack: 0.008,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.018,
        duration: 0.195,
        filterType: 'bandpass',
        freqStart: 1080 * jitter,
        freqEnd: 1860 * jitter,
        q: 1.2,
        peak: 0.048,
        attack: 0.048,
      });
      return;
    }

    if (type === 'book-close') {
      this.scheduleTone(ctx, out, {
        start: now,
        duration: 0.095,
        type: 'sine',
        freqStart: 176 * jitter,
        freqEnd: 58 * jitter,
        peak: 0.084,
        attack: 0.004,
      });
      this.scheduleTone(ctx, out, {
        start: now,
        duration: 0.054,
        type: 'triangle',
        freqStart: 255 * jitter,
        freqEnd: 104 * jitter,
        peak: 0.032,
        attack: 0.003,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.004,
        duration: 0.076,
        filterType: 'bandpass',
        freqStart: 780 * jitter,
        freqEnd: 390 * jitter,
        q: 1.1,
        peak: 0.044,
        attack: 0.005,
      });
      return;
    }

    if (type === 'paper-tear') {
      const steps = [0, 0.028, 0.056, 0.088, 0.122, 0.156];
      let hasNoise = false;
      steps.forEach((offset, idx) => {
        const rise = 1 + idx * 0.12;
        const ok = this.scheduleNoiseBurst(ctx, out, crisp, {
          start: now + offset,
          duration: 0.044,
          filterType: 'bandpass',
          freqStart: 2250 * rise * jitter,
          freqEnd: 3500 * rise * jitter,
          q: 2.0,
          peak: 0.052 + (idx % 2) * 0.02,
          attack: 0.003,
        });
        hasNoise = hasNoise || ok;
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.01,
        duration: 0.15,
        filterType: 'bandpass',
        freqStart: 980 * jitter,
        freqEnd: 1620 * jitter,
        q: 1.3,
        peak: 0.034,
        attack: 0.012,
      });
      if (!hasNoise) {
        this.scheduleTone(ctx, out, {
          start: now,
          duration: 0.14,
          type: 'sawtooth',
          freqStart: 620 * jitter,
          freqEnd: 1480 * jitter,
          peak: 0.04,
          attack: 0.006,
        });
      }
      return;
    }

    if (type === 'paper-crumple') {
      const bursts = [
        { offset: 0, dur: 0.052, freq: 1850, peak: 0.054 },
        { offset: 0.048, dur: 0.048, freq: 2750, peak: 0.068 },
        { offset: 0.102, dur: 0.058, freq: 2150, peak: 0.062 },
        { offset: 0.168, dur: 0.046, freq: 3200, peak: 0.058 },
        { offset: 0.224, dur: 0.054, freq: 2400, peak: 0.046 },
      ];
      let hasNoise = false;
      for (const b of bursts) {
        const ok = this.scheduleNoiseBurst(ctx, out, crisp, {
          start: now + b.offset,
          duration: b.dur,
          filterType: 'bandpass',
          freqStart: b.freq * jitter,
          freqEnd: b.freq * 0.72 * jitter,
          q: 2.2,
          peak: b.peak,
          attack: 0.003,
        });
        hasNoise = hasNoise || ok;
      }
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.02,
        duration: 0.14,
        filterType: 'bandpass',
        freqStart: 540 * jitter,
        freqEnd: 340 * jitter,
        q: 1.4,
        peak: 0.028,
        attack: 0.01,
      });
      if (!hasNoise) {
        this.scheduleTone(ctx, out, {
          start: now,
          duration: 0.16,
          type: 'triangle',
          freqStart: 320 * jitter,
          freqEnd: 180 * jitter,
          peak: 0.045,
          attack: 0.005,
        });
      }
      return;
    }

    if (type === 'paper-land') {
      this.scheduleTone(ctx, out, {
        start: now,
        duration: 0.036,
        type: 'sine',
        freqStart: 255 * jitter,
        freqEnd: 122 * jitter,
        peak: 0.036,
        attack: 0.003,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.03,
        filterType: 'bandpass',
        freqStart: 1780 * jitter,
        freqEnd: 1180 * jitter,
        q: 1.7,
        peak: 0.04,
        attack: 0.002,
      });
      const bounce = now + 0.115;
      this.scheduleTone(ctx, out, {
        start: bounce,
        duration: 0.024,
        type: 'sine',
        freqStart: 290 * jitter,
        freqEnd: 156 * jitter,
        peak: 0.018,
        attack: 0.002,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: bounce,
        duration: 0.022,
        filterType: 'bandpass',
        freqStart: 1940 * jitter,
        freqEnd: 1380 * jitter,
        q: 1.8,
        peak: 0.022,
        attack: 0.002,
      });
      return;
    }

    if (type === 'paper-pickup') {
      const ok = this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.044,
        filterType: 'bandpass',
        freqStart: 2150 * jitter,
        freqEnd: 2900 * jitter,
        q: 2.0,
        peak: 0.042,
        attack: 0.004,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now + 0.044,
        duration: 0.056,
        filterType: 'bandpass',
        freqStart: 2650 * jitter,
        freqEnd: 1950 * jitter,
        q: 1.8,
        peak: 0.036,
        attack: 0.005,
      });
      if (!ok) {
        this.scheduleTone(ctx, out, {
          start: now,
          duration: 0.06,
          type: 'sine',
          freqStart: 380 * jitter,
          freqEnd: 520 * jitter,
          peak: 0.035,
          attack: 0.004,
        });
      }
      return;
    }

    if (type === 'paper-check') {
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.036,
        filterType: 'bandpass',
        freqStart: 2350 * jitter,
        freqEnd: 3150 * jitter,
        q: 2.1,
        peak: 0.03,
        attack: 0.004,
      });
      this.scheduleTone(ctx, out, {
        start: now + 0.006,
        duration: 0.032,
        type: 'sine',
        freqStart: 480 * jitter,
        freqEnd: 650 * jitter,
        peak: 0.036,
        attack: 0.003,
      });
      return;
    }

    if (type === 'book-extract') {
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.24,
        filterType: 'bandpass',
        freqStart: 460 * jitter,
        freqEnd: 740 * jitter,
        q: 1.5,
        peak: 0.052,
        attack: 0.042,
      });
      this.scheduleTone(ctx, out, {
        start: now + 0.015,
        duration: 0.145,
        type: 'triangle',
        freqStart: 168 * jitter,
        freqEnd: 224 * jitter,
        peak: 0.026,
        attack: 0.028,
      });
      return;
    }

    if (type === 'book-insert' || type === 'book-shelf-add') {
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: now,
        duration: 0.145,
        filterType: 'bandpass',
        freqStart: 680 * jitter,
        freqEnd: 410 * jitter,
        q: 1.5,
        peak: 0.044,
        attack: 0.018,
      });
      const tock = now + 0.132;
      this.scheduleTone(ctx, out, {
        start: tock,
        duration: 0.068,
        type: 'sine',
        freqStart: 205 * jitter,
        freqEnd: 88 * jitter,
        peak: 0.072,
        attack: 0.003,
      });
      this.scheduleTone(ctx, out, {
        start: tock,
        duration: 0.028,
        type: 'triangle',
        freqStart: 420 * jitter,
        freqEnd: 210 * jitter,
        peak: 0.028,
        attack: 0.002,
      });
      this.scheduleNoiseBurst(ctx, out, crisp, {
        start: tock,
        duration: 0.024,
        filterType: 'bandpass',
        freqStart: 920 * jitter,
        freqEnd: 580 * jitter,
        q: 1.4,
        peak: 0.028,
        attack: 0.002,
      });
      if (type === 'book-shelf-add') {
        this.scheduleTone(ctx, out, {
          start: now + 0.175,
          duration: 0.15,
          type: 'sine',
          freqStart: 523.25,
          freqEnd: 523.25,
          peak: 0.032,
          attack: 0.008,
        });
        this.scheduleTone(ctx, out, {
          start: now + 0.265,
          duration: 0.22,
          type: 'sine',
          freqStart: 659.25,
          freqEnd: 659.25,
          peak: 0.038,
          attack: 0.008,
        });
      }
    }
  }

  /**
   * 合成光脚踩在木地板（或地毯）上的自然脚步音效：
   * 1. 脚跟肉垫触地引发的温润木板低频短促共鸣（“噗/咚”）；
   * 2. 约 20ms 后前脚掌皮肤贴合木面的轻柔拍击与摩擦瞬态（“啪嗒”）；
   * 3. 左右脚自然微差与细微随机扰动，避免机械重复感。
   */
  public playFootstep(options: FootstepAudioOptions = {}) {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const variant = options.variant ?? 'walk';
    const lastTime = variant === 'walk'
      ? Math.max(this.lastFootstepTime.walk, this.lastFootstepTime.push)
      : this.lastFootstepTime[variant];
    if (now - lastTime < 0.085) return;
    this.lastFootstepTime[variant] = now;

    const surface = options.surface ?? 'wood';
    const baseIntensity = Math.min(Math.max(options.intensity ?? 1, 0.3), 1.6);

    const foot = options.foot ?? ((this.footstepCount++ & 1) as 0 | 1);
    this.triggerBarefootStep(ctx, now, foot, surface, variant, baseIntensity);
  }

  private ensureNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer && this.noiseBufferCtx === ctx) return this.noiseBuffer;
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * 0.18));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        prev = prev * 0.62 + white * 0.38;
        data[i] = prev;
      }
      this.noiseBuffer = buffer;
      this.noiseBufferCtx = ctx;
      return buffer;
    } catch {
      return null;
    }
  }

  private triggerBarefootStep(
    ctx: AudioContext,
    startTime: number,
    foot: 0 | 1,
    surface: 'wood' | 'rug',
    variant: 'walk' | 'push',
    intensity: number
  ) {
    const out = this.musicGain ?? ctx.destination;
    const isRug = surface === 'rug';
    const isPush = variant === 'push';
    const footBias = foot === 0 ? 0.97 : 1.03;
    const jitter = 0.97 + Math.random() * 0.06;
    const pitch = footBias * jitter;
    const rollDelay = isPush ? 0.012 : 0.019 + Math.random() * 0.006;
    const patTime = startTime + rollDelay;

    // 1. 脚跟/足底肉垫落地的木地板温润低频共鸣 (Heel pad & oak board resonance)
    const thudOsc = ctx.createOscillator();
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const thudGain = ctx.createGain();

    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime((isRug ? 108 : 142) * pitch, startTime);
    thudOsc.frequency.exponentialRampToValueAtTime((isRug ? 48 : 58) * pitch, startTime + 0.055);
    thudOsc.frequency.exponentialRampToValueAtTime((isRug ? 42 : 46) * pitch, startTime + 0.086);

    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime((isRug ? 165 : 225) * pitch, startTime);
    bodyOsc.frequency.exponentialRampToValueAtTime((isRug ? 78 : 96) * pitch, startTime + 0.044);
    bodyGain.gain.setValueAtTime(isRug ? 0.16 : 0.26, startTime);

    const thudPeak = (isRug ? 0.085 : 0.115) * intensity;
    thudGain.gain.setValueAtTime(0.0001, startTime);
    thudGain.gain.linearRampToValueAtTime(thudPeak, startTime + 0.005);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, startTime + 0.088);

    thudOsc.connect(thudGain);
    bodyOsc.connect(bodyGain);
    bodyGain.connect(thudGain);
    thudGain.connect(out);

    bodyOsc.onended = () => {
      bodyOsc.disconnect();
      bodyGain.disconnect();
    };
    thudOsc.onended = () => {
      thudOsc.disconnect();
      thudGain.disconnect();
    };

    thudOsc.start(startTime);
    thudOsc.stop(startTime + 0.092);
    bodyOsc.start(startTime);
    bodyOsc.stop(startTime + 0.048);

    // 2. 前脚掌裸肤轻拍木地板表面的肉感瞬态音 (Forefoot skin-on-wood pat tone)
    const patOsc = ctx.createOscillator();
    const patGain = ctx.createGain();
    patOsc.type = 'sine';
    patOsc.frequency.setValueAtTime((isRug ? 210 : 292) * pitch, patTime);
    patOsc.frequency.exponentialRampToValueAtTime((isRug ? 112 : 146) * pitch, patTime + 0.025);

    const patTonePeak = (isRug ? 0.012 : 0.028) * intensity;
    patGain.gain.setValueAtTime(0.0001, patTime);
    patGain.gain.linearRampToValueAtTime(patTonePeak, patTime + 0.003);
    patGain.gain.exponentialRampToValueAtTime(0.0005, patTime + 0.028);

    patOsc.connect(patGain);
    patGain.connect(out);
    patOsc.onended = () => {
      patOsc.disconnect();
      patGain.disconnect();
    };
    patOsc.start(patTime);
    patOsc.stop(patTime + 0.031);

    // 3. 脚掌皮肤贴合与微弱摩擦噪声层 (Filtered barefoot skin contact noise)
    const noiseBuffer = this.ensureNoiseBuffer(ctx);
    if (!noiseBuffer) return;

    const noise = ctx.createBufferSource();
    const bandpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();

    noise.buffer = noiseBuffer;
    noise.playbackRate.setValueAtTime((0.92 + Math.random() * 0.18) * footBias, startTime);

    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime((isRug ? 520 : 960) * pitch, startTime);
    bandpass.Q.setValueAtTime(isRug ? 1.4 : 1.85, startTime);

    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime((isRug ? 900 : 1680) * pitch, startTime);

    const heelNoisePeak = (isRug ? 0.016 : 0.024) * intensity;
    const patNoisePeak = (isRug ? 0.026 : 0.056) * intensity;
    const tailDuration = isPush ? 0.052 : 0.034;

    noiseGain.gain.setValueAtTime(0.0001, startTime);
    noiseGain.gain.linearRampToValueAtTime(heelNoisePeak, startTime + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.001, heelNoisePeak * 0.25), patTime);
    noiseGain.gain.linearRampToValueAtTime(patNoisePeak, patTime + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0006, patTime + tailDuration);

    noise.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(noiseGain);
    noiseGain.connect(out);

    noise.onended = () => {
      noise.disconnect();
      bandpass.disconnect();
      lowpass.disconnect();
      noiseGain.disconnect();
    };

    const maxOffset = Math.max(0, noiseBuffer.duration - 0.1);
    const offset = Math.random() * maxOffset;
    noise.start(startTime, offset, 0.095);
  }

  /** Resolves only when playback really starts; stale and rejected requests resolve false. */
  public async startMusic(disc: MusicDisc): Promise<boolean> {
    const sameDisc = this.currentDisc.id === disc.id && this.currentDisc.audioUrl === disc.audioUrl;
    if (sameDisc && this.isPlaying) return true;
    const prepared = this.preparedMusic?.disc.id === disc.id && this.preparedMusic.disc.audioUrl === disc.audioUrl ? this.preparedMusic.audio : null;
    if (prepared) this.preparedMusic = null;
    if (!sameDisc) this.stopMusic();
    this.currentDisc = disc;
    const request = ++this.requestId;
    this.publish('starting');
    try {
      if (!disc.audioUrl.startsWith('synth:')) {
        if (!this.htmlAudio) {
          const audio = prepared ?? new Audio(disc.audioUrl);
          audio.loop = true;
          audio.volume = 0.65 * this.musicLevel;
          audio.muted = this.isMuted;
          audio.onerror = () => {
            if (this.htmlAudio !== audio) return;
            this.pauseMusic();
            this.publish('error', '这张唱片暂时无法播放，请重新选择音乐。');
          };
          audio.onpause = () => {
            if (this.htmlAudio === audio && audio.paused && this.isPlaying) this.pauseMusic();
          };
          this.htmlAudio = audio;
        }
        const audio = this.htmlAudio;
        await audio.play();
        if (request !== this.requestId) {
          if (audio !== this.htmlAudio || (!this.isPlaying && this.snapshot.status !== 'starting')) audio.pause();
          return false;
        }
      } else {
        const ctx = this.ensureContext();
        if (!ctx) throw new Error('Audio unavailable');
        if (ctx.state !== 'running') await ctx.resume();
        if (ctx.state !== 'running') throw new Error('Audio suspended');
      }
      if (request !== this.requestId) return false;
      this.isPlaying = true;
      if (disc.audioUrl.startsWith('synth:')) this.startSynth();
      this.publish('playing');
      return true;
    } catch {
      if (request !== this.requestId) return false;
      this.pauseMusic();
      this.publish('error', '音乐未能开始播放，请再次触碰唱机。');
      return false;
    }
  }

  private startSynth() {
    if (this.synthTimer !== null) window.clearInterval(this.synthTimer);
    const scales: Record<string, number[]> = {
      'lofi-sunset': [261.63, 329.63, 392, 493.88, 523.25, 392, 329.63, 293.66],
      'midnight-rain': [220, 261.63, 329.63, 392, 440, 329.63, 293.66, 246.94],
      'warm-vinyl': [293.66, 369.99, 440, 554.37, 587.33, 440, 369.99, 329.63],
      'starlight-dream': [349.23, 440, 523.25, 659.25, 587.33, 523.25, 440, 392],
    };
    const notes = scales[this.currentDisc.synthPreset ?? 'lofi-sunset'] ?? scales['lofi-sunset'];
    const playStep = () => {
      const ctx = this.ctx;
      if (!this.isPlaying || !ctx || ctx.state !== 'running' || !this.musicGain) return;
      const frequency = notes[this.stepIndex++ % notes.length];
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.62);
      gain.connect(this.playbackGain ?? this.musicGain);
      let remaining = 2;
      for (const [type, multiplier] of [['sine', 1], ['triangle', 0.5]] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency * multiplier, now);
        osc.connect(gain);
        this.voices.add(osc);
        osc.onended = () => {
          this.voices.delete(osc);
          osc.disconnect();
          if (--remaining === 0) gain.disconnect();
        };
        osc.start(now);
        osc.stop(now + 0.65);
      }
    };
    playStep();
    this.synthTimer = window.setInterval(playStep, 520);
  }

  /** Keeps the selected disc and playback position for resumeMusic/startMusic(sameDisc). */
  public pauseMusic() {
    ++this.requestId;
    this.isPlaying = false;
    if (this.synthTimer !== null) window.clearInterval(this.synthTimer);
    this.synthTimer = null;
    this.htmlAudio?.pause();
    this.voices.forEach(voice => { try { voice.stop(); } catch { /* Already ended. */ } });
    this.voices.clear();
    this.publish('paused');
  }

  public resumeMusic(): Promise<boolean> { return this.startMusic(this.currentDisc); }

  /** Soft warm synthesized orbital thruster hum during spacecraft boost; obeys global mute. */
  public setThrusterBoost(level: number): void {
    const clamped = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    const ctx = this.ctx;
    if (clamped < 0.015 || !ctx || ctx.state !== 'running' || !this.musicGain) {
      if (this.thruster && ctx) {
        this.thruster.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      }
      return;
    }
    if (!this.thruster) {
      try {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        filter.Q.value = 1.2;
        filter.connect(gain);
        gain.connect(this.musicGain);

        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 64;
        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.28;
        osc.connect(oscGain);
        oscGain.connect(filter);

        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = 96;
        const subGain = ctx.createGain();
        subGain.gain.value = 0.16;
        sub.connect(subGain);
        subGain.connect(filter);

        const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 1.5));
        const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        let prev = 0;
        for (let i = 0; i < noiseLen; i++) {
          prev = prev * 0.86 + (Math.random() * 2 - 1) * 0.14;
          data[i] = prev * 2.4;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuf;
        noise.loop = true;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0.55;
        noise.connect(noiseGain);
        noiseGain.connect(filter);

        osc.start();
        sub.start();
        noise.start();
        this.thruster = { osc, sub, noise, filter, gain };
      } catch {
        return;
      }
    }
    const now = ctx.currentTime;
    this.thruster.osc.frequency.setTargetAtTime(58 + clamped * 44, now, 0.08);
    this.thruster.sub.frequency.setTargetAtTime(88 + clamped * 68, now, 0.08);
    this.thruster.filter.frequency.setTargetAtTime(140 + clamped * 340, now, 0.08);
    this.thruster.gain.gain.setTargetAtTime(0.055 * clamped, now, 0.06);
  }

  private stopThruster() {
    if (!this.thruster) return;
    const nodes = this.thruster;
    this.thruster = null;
    for (const src of [nodes.osc, nodes.sub, nodes.noise]) {
      try { src.stop(); src.disconnect(); } catch { /* Already stopped. */ }
    }
    try { nodes.filter.disconnect(); nodes.gain.disconnect(); } catch { /* Already disconnected. */ }
  }

  /** Legacy stop API releases playback resources; object URL ownership stays with the caller. */
  public stopMusic() {
    this.stopThruster();
    this.pauseMusic();
    this.cancelPreparedMusic();
    if (this.htmlAudio) {
      this.htmlAudio.onerror = null;
      this.htmlAudio.onpause = null;
      this.htmlAudio.removeAttribute('src');
      this.htmlAudio.load();
      this.htmlAudio = null;
    }
    this.stepIndex = 0;
    this.publish('idle');
  }
}

export const roomAudio = new RoomAudioEngine();
