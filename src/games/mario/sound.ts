import laughUrl from '../../../assets/games/ski/audio/原版笑声.wav?url';
import mountUrl from '../../../assets/games/ski/audio/niulai.wav?url';
import type { SkiEvent } from './model';

export type SoundName = 'laugh' | 'mount';
const urls: Record<SoundName, string> = { laugh: laughUrl, mount: mountUrl };
const bytes = new Map<SoundName, Promise<ArrayBuffer>>();

export class SkiSound {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private sources = new Map<SoundName, AudioBufferSourceNode>();
  private tones = new Set<{ oscillator: OscillatorNode; volume: GainNode }>();
  private muted = false;
  private paused = false;
  private disposed = false;

  unlock() {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.muted ? 0 : 0.8;
        this.gain.connect(this.context.destination);
        for (const name of ['laugh', 'mount'] as const) {
          if (!bytes.has(name)) bytes.set(name, fetch(urls[name]).then(response => {
            if (!response.ok) throw new Error('音效加载失败');
            return response.arrayBuffer();
          }).catch(error => { bytes.delete(name); throw error; }));
          void bytes.get(name)!.then(data => this.context?.decodeAudioData(data.slice(0))).then(buffer => {
            if (buffer && !this.disposed) this.buffers.set(name, buffer);
          }).catch(() => {});
        }
      }
      if (!this.paused) void this.context.resume().catch(() => {});
    } catch { /* Browsers without Web Audio can still play the game. */ }
  }

  playEvent(event: SkiEvent) {
    if (event === 'crash' || event === 'caught') this.play('laugh');
    if (event === 'mount') this.play('mount');
    if (event === 'boost' || event === 'coin') this.playTone(event);
  }

  private playTone(kind: 'boost' | 'coin') {
    if (!this.context || !this.gain || this.paused || this.disposed || this.muted || this.tones.size >= 4) return;
    const now = this.context.currentTime;
    const duration = kind === 'boost' ? 0.16 : 0.08;
    const oscillator = this.context.createOscillator();
    const volume = this.context.createGain();
    const voice = { oscillator, volume };
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(kind === 'boost' ? 520 : 1150, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'boost' ? 1040 : 1530, now + duration);
    volume.gain.setValueAtTime(0, now);
    volume.gain.linearRampToValueAtTime(kind === 'boost' ? 0.11 : 0.07, now + 0.012);
    volume.gain.linearRampToValueAtTime(0, now + duration);
    oscillator.connect(volume); volume.connect(this.gain);
    oscillator.onended = () => {
      oscillator.disconnect(); volume.disconnect(); this.tones.delete(voice);
    };
    this.tones.add(voice);
    oscillator.start(now); oscillator.stop(now + duration);
  }

  play(name: SoundName) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.context || !this.gain || this.paused || this.disposed || this.muted) return;
    const previous = this.sources.get(name);
    if (previous) { previous.stop(); previous.disconnect(); }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (this.sources.get(name) === source) this.sources.delete(name);
      source.disconnect();
    };
    this.sources.set(name, source);
    source.start(0, 0, name === 'laugh' ? Math.min(3, buffer.duration) : buffer.duration);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 0.8;
    if (muted) this.stop();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!this.context || this.context.state === 'closed') return;
    void (paused ? this.context.suspend() : this.context.resume()).catch(() => {});
  }

  stop() {
    for (const source of this.sources.values()) { source.stop(); source.disconnect(); }
    this.sources.clear();
    for (const { oscillator, volume } of this.tones) { oscillator.stop(); oscillator.disconnect(); volume.disconnect(); }
    this.tones.clear();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.buffers.clear();
  }
}
