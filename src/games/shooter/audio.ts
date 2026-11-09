type SoundEvent = 'launch' | 'hit' | 'destroy' | 'wave';

/** No assets, timers or global listeners. Nodes are bounded and explicitly disconnected. */
export class PinballAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices = new Set<OscillatorNode>();
  private enabled = false;
  private muted = false;

  configure(enabled: boolean, muted: boolean): void {
    this.enabled = enabled;
    this.muted = muted;
    if (this.output && this.context) this.output.gain.setValueAtTime(enabled && !muted ? 0.32 : 0, this.context.currentTime);
    if (!enabled || muted) {
      this.clearVoices();
      if (this.context && this.context.state !== 'closed') void this.context.suspend().catch(() => undefined);
    } else if (this.context && this.context.state !== 'closed') void this.context.resume().catch(() => undefined);
  }

  // Call only in response to a user gesture; autoplay policies are not bypassed.
  unlock(): void {
    if (!this.enabled || this.muted || typeof window === 'undefined') return;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new window.AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = 0.32;
        this.output.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    } catch { /* Browsers without Web Audio remain fully playable. */ }
  }

  play(event: SoundEvent | 'impact' | 'critical' | 'switch' | 'pickup' | 'dash', flavor: 'classic' | 'pistol' | 'machine' | 'rocket' | 'wand' | 'broom' = 'classic'): void {
    const context = this.context; const output = this.output;
    if (!context || !output || !this.enabled || this.muted || context.state !== 'running' || this.voices.size >= 10) return;
    const launchPitch = { classic: 330, pistol: 500, machine: 220, rocket: 100, wand: 760, broom: 160 }[flavor];
    const frequency = event === 'launch' ? launchPitch : event === 'impact' ? 140 : event === 'critical' ? 1200 : event === 'switch' ? 360 : event === 'pickup' ? 990 : event === 'dash' ? 440 : event === 'hit' ? 180 : event === 'destroy' ? 650 : 1046;
    const duration = event === 'wave' ? 0.25 : event === 'launch' ? flavor === 'machine' ? .055 : flavor === 'rocket' ? .24 : .13 : .075;
    try {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = event === 'impact' || event === 'critical' ? 'square' : event === 'launch' && (flavor === 'machine' || flavor === 'broom') ? 'triangle' : event === 'destroy' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (event === 'launch' ? 1.8 : 0.7), context.currentTime + duration);
      gain.gain.setValueAtTime(event === 'impact' ? .035 : event === 'pickup' ? .028 : flavor === 'machine' ? .055 : .11, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain); gain.connect(output); this.voices.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(oscillator); };
      oscillator.start(); oscillator.stop(context.currentTime + duration);
    } catch { /* Sound failure must not interrupt the game. */ }
  }

  private clearVoices(): void {
    for (const oscillator of this.voices) { try { oscillator.stop(); } catch { /* Already stopped. */ } }
    this.voices.clear();
  }

  dispose(): void {
    this.clearVoices();
    const context = this.context;
    this.output?.disconnect(); this.context = null; this.output = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
