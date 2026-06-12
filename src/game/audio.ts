/**
 * audio.ts — M4 audio (SPEC §10): minimal synthesized Web Audio SFX (no
 * asset files) plus the one sanctioned asset, the sourced menu-music track
 * at public/audio/menu.ogg (loops gaplessly with the plain loop flag).
 *
 * Browser autoplay policy: an AudioContext starts suspended until a user
 * gesture, so nothing here makes sound before unlock() is called from a
 * gesture handler (main.ts hooks the first keydown/pointerdown). Every
 * public method no-ops safely before unlock or when WebAudio is missing
 * (vitest/SSR), so callers never guard.
 */

const MUTE_KEY = 'sas:muted';
const MUSIC_SRC = 'audio/menu.ogg';
const MUSIC_VOLUME = 0.45;
const MASTER_GAIN = 0.5;
const THRUST_GAIN = 0.14;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private thrustGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: HTMLAudioElement | null = null;
  private musicWanted = false;
  /** The track is delivered separately; a 404 just means silence. */
  private musicFailed = false;
  muted: boolean;

  constructor() {
    this.muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  }

  /** Idempotent; must be called from a user-gesture handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    if (typeof AudioContext === 'undefined') return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    this.master.connect(this.ctx.destination);

    // Thrust bed: an always-running filtered-noise loop whose gain is the
    // throttle (setThrust). Starting it once avoids per-frame node churn.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    this.thrustGain = this.ctx.createGain();
    this.thrustGain.gain.value = 0;
    src.connect(filter).connect(this.thrustGain).connect(this.master);
    src.start();

    if (this.musicWanted) this.startMusic();
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* private-mode storage failures are not worth surfacing */
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    if (this.music) this.music.muted = this.muted;
    return this.muted;
  }

  // --- menu music -----------------------------------------------------------

  playMenuMusic(): void {
    this.musicWanted = true;
    if (this.ctx) this.startMusic();
  }

  stopMenuMusic(): void {
    this.musicWanted = false;
    if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
    }
  }

  private startMusic(): void {
    if (this.musicFailed || typeof Audio === 'undefined') return;
    if (!this.music) {
      this.music = new Audio(MUSIC_SRC);
      this.music.loop = true;
      this.music.volume = MUSIC_VOLUME;
      this.music.addEventListener('error', () => {
        this.musicFailed = true;
        this.music = null;
      });
    }
    this.music.muted = this.muted;
    void this.music.play().catch(() => {
      /* autoplay rejection — the next unlock retries */
    });
  }

  // --- synthesized SFX --------------------------------------------------------

  uiMove(): void {
    this.tone('square', 660, 660, 0.04, 0.1);
  }

  uiSelect(): void {
    this.tone('square', 520, 880, 0.09, 0.16);
  }

  jump(): void {
    this.tone('sawtooth', 880, 110, 0.6, 0.22);
    this.burst(0.5, 0.12, 700);
  }

  dock(): void {
    this.tone('sine', 440, 440, 0.12, 0.18);
    this.tone('sine', 660, 660, 0.16, 0.18, 0.11);
  }

  undock(): void {
    this.tone('sine', 660, 660, 0.12, 0.18);
    this.tone('sine', 440, 440, 0.16, 0.18, 0.11);
  }

  /** Salvage / mining / deposit success. */
  pickup(): void {
    this.tone('triangle', 520, 1040, 0.14, 0.18);
  }

  damage(): void {
    this.burst(0.2, 0.3, 180, 0.8);
  }

  death(): void {
    this.tone('sawtooth', 220, 36, 1.3, 0.26);
    this.burst(0.8, 0.2, 120, 0.6);
  }

  victory(): void {
    this.tone('triangle', 440, 440, 0.18, 0.2);
    this.tone('triangle', 554, 554, 0.18, 0.2, 0.14);
    this.tone('triangle', 659, 659, 0.34, 0.22, 0.28);
  }

  /** Decrypt Flight Log static — a short churn of high blips. */
  decrypt(): void {
    for (let i = 0; i < 6; i++) {
      this.tone('square', 1400 - i * 120, 900, 0.05, 0.08, i * 0.07);
    }
  }

  /** Throttle for the looped thrust bed; call every frame from main.ts. */
  setThrust(on: boolean): void {
    if (!this.ctx || !this.thrustGain) return;
    const target = on ? THRUST_GAIN : 0;
    this.thrustGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
  }

  // --- synth plumbing -----------------------------------------------------------

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    peak: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, from), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** One-shot band-passed noise hit (impacts, jump rumble). */
  private burst(dur: number, peak: number, freq: number, q = 1): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }
}
