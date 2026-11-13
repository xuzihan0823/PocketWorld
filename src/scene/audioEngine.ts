import { MusicDisc } from '../types/interactable';

export const PRESET_MUSIC_DISCS: MusicDisc[] = [
  {
    id: 'disc-lofi-sunset',
    title: '午后暖阳 (Sunset Window)',
    artist: 'Pocket Studio · Lo-Fi Vinyl',
    audioUrl: 'synth:lofi-sunset',
    discThemeColor: ['#f59e0b', '#fb7185'],
    synthPreset: 'lofi-sunset',
    duration: 168,
  },
  {
    id: 'disc-midnight-rain',
    title: '静谧星夜 (Midnight Study)',
    artist: 'Pocket Studio · Ambient',
    audioUrl: 'synth:midnight-rain',
    discThemeColor: ['#38bdf8', '#818cf8'],
    synthPreset: 'midnight-rain',
    duration: 194,
  },
  {
    id: 'disc-warm-vinyl',
    title: '木质留声 (Warm Oak & Coffee)',
    artist: 'Pocket Studio · Acoustic',
    audioUrl: 'synth:warm-vinyl',
    discThemeColor: ['#34d399', '#059669'],
    synthPreset: 'warm-vinyl',
    duration: 152,
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
  variant?: 'walk' | 'land' | 'push';
  intensity?: number;
}

class RoomAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private isPlaying = false;
  private currentDisc: MusicDisc = PRESET_MUSIC_DISCS[0];
  private synthTimer: number | null = null;
  private stepIndex = 0;
  private footstepCount = 0;
  private lastFootstepTime = { walk: -Infinity, land: -Infinity, push: -Infinity };
  private noiseBuffer: AudioBuffer | null = null;
  private noiseBufferCtx: AudioContext | null = null;
  private htmlAudio: HTMLAudioElement | null = null;
  private preparedMusic: { disc: MusicDisc; audio: HTMLAudioElement } | null = null;
  private requestId = 0;
  private musicGain: GainNode | null = null;
  private playbackGain: GainNode | null = null;
  private musicLevel = 1;
  private voices = new Set<OscillatorNode>();
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
    if (this.htmlAudio) {
      this.htmlAudio.muted = muted;
    }
    if (this.musicGain) this.musicGain.gain.value = muted ? 0 : 1;
    this.publish(this.snapshot.status, this.snapshot.error);
  }

  public playSfx(
    type: 'switch' | 'cat' | 'water' | 'paper' | 'soft' | 'disc' | 'footstep'
  ) {
    if (type === 'footstep') {
      this.playFootstep();
      return;
    }
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(this.musicGain ?? ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };

    if (type === 'switch') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.045);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'cat') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(460, now + 0.28);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.32);
    } else if (type === 'water') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'paper') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.09);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.11);
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
    const minGap = variant === 'land' ? 0.04 : 0.085;
    const lastTime = variant === 'walk'
      ? Math.max(this.lastFootstepTime.walk, this.lastFootstepTime.land, this.lastFootstepTime.push)
      : this.lastFootstepTime[variant];
    if (now - lastTime < minGap) return;
    this.lastFootstepTime[variant] = now;

    const surface = options.surface ?? 'wood';
    const baseIntensity = Math.min(Math.max(options.intensity ?? 1, 0.3), 1.6);

    if (variant === 'land') {
      this.triggerBarefootStep(ctx, now, 0, surface, 'land', baseIntensity * 1.12);
      this.triggerBarefootStep(ctx, now + 0.024, 1, surface, 'land', baseIntensity * 0.94);
      return;
    }

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
    variant: 'walk' | 'land' | 'push',
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

  /** Legacy stop API releases playback resources; object URL ownership stays with the caller. */
  public stopMusic() {
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
