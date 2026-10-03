// Chiptune sound effects and ambience, synthesized live with the Web Audio API.
// No audio files: every sound is a few oscillators and a burst of noise.

export type Sfx =
  | 'click' | 'move' | 'unlock' | 'alarm' | 'hurt' | 'heal' | 'strike' | 'slay' | 'loot'
  | 'chat' | 'wyrm' | 'encounter' | 'intro' | 'win' | 'lose';

export type Ambience = 'off' | 'lobby' | 'explore' | 'combat' | 'parley' | 'vault';

const STORAGE_KEY = 'icebreaker.sound';

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  vol?: number;
  delay?: number;
}

interface NoiseOpts {
  dur: number;
  vol?: number;
  delay?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
}

const note = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12);

export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuf?: AudioBuffer;
  private amb?: { gain: GainNode; drone: OscillatorNode[]; filter: BiquadFilterNode; rain: GainNode };
  private mode: Ambience = 'off';
  private lastChat = 0;
  enabled: boolean;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage blocked: default to on */
    }
    this.enabled = saved !== 'off';
  }

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startAmbience();
      this.setAmbience(this.mode);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    if (on) this.unlock();
  }

  // ---------------------------------------------------------------- primitives

  private get ready() {
    return !!(this.ctx && this.master && this.enabled && this.ctx.state === 'running');
  }

  private tone({ type = 'square', freq, to, dur, vol = 0.18, delay = 0 }: ToneOpts) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise({ dur, vol = 0.2, delay = 0, filter = 'lowpass', freq = 2000, to }: NoiseOpts) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private arp(semis: number[], step: number, opts: Partial<ToneOpts> = {}) {
    const start = opts.delay ?? 0;
    semis.forEach((s, i) => this.tone({ vol: 0.14, ...opts, freq: note(s), dur: step * 1.6, delay: start + i * step }));
  }

  // ---------------------------------------------------------------- effects

  play(name: Sfx) {
    if (!this.ready) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 1800, dur: 0.03, vol: 0.06 });
        break;
      case 'move':
        this.tone({ freq: 330, to: 660, dur: 0.09, vol: 0.1 });
        this.noise({ dur: 0.12, vol: 0.05, filter: 'bandpass', freq: 3000, to: 800 });
        break;
      case 'unlock':
        this.arp([3, 7, 10, 15], 0.06);
        this.noise({ dur: 0.08, vol: 0.08, filter: 'highpass', freq: 4000, delay: 0.24 });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone({ type: 'sawtooth', freq: 880, to: 440, dur: 0.22, vol: 0.12, delay: i * 0.24 });
        }
        break;
      case 'hurt':
        this.noise({ dur: 0.25, vol: 0.3, freq: 1200, to: 120 });
        this.tone({ type: 'sawtooth', freq: 160, to: 50, dur: 0.25, vol: 0.18 });
        break;
      case 'heal':
        this.arp([12, 16, 19, 24, 28], 0.05, { type: 'triangle', vol: 0.12 });
        break;
      case 'strike':
        this.noise({ dur: 0.1, vol: 0.25, filter: 'highpass', freq: 1500 });
        this.tone({ freq: 900, to: 200, dur: 0.12, vol: 0.12 });
        break;
      case 'slay':
        this.noise({ dur: 0.7, vol: 0.35, freq: 3000, to: 60 });
        this.tone({ type: 'sawtooth', freq: 300, to: 30, dur: 0.6, vol: 0.18 });
        this.arp([0, 3, 7, 12], 0.07, { delay: 0.45 });
        break;
      case 'loot':
        this.tone({ freq: note(15), dur: 0.08, vol: 0.12 });
        this.tone({ freq: note(22), dur: 0.25, vol: 0.12, delay: 0.08 });
        break;
      case 'chat': {
        const now = performance.now();
        if (now - this.lastChat < 250) return;
        this.lastChat = now;
        this.tone({ type: 'triangle', freq: 1320, dur: 0.05, vol: 0.05 });
        break;
      }
      case 'wyrm':
        this.tone({ type: 'sawtooth', freq: 70, to: 55, dur: 0.6, vol: 0.2 });
        this.tone({ type: 'square', freq: 104, to: 82, dur: 0.5, vol: 0.06, delay: 0.05 });
        this.noise({ dur: 0.6, vol: 0.12, freq: 400, to: 150 });
        break;
      case 'encounter':
        this.tone({ type: 'sawtooth', freq: note(-21), dur: 0.5, vol: 0.18 });
        this.tone({ type: 'sawtooth', freq: note(-20), dur: 0.5, vol: 0.14 });
        this.arp([-9, -12, -15], 0.12, { type: 'square', vol: 0.1, delay: 0.1 });
        break;
      case 'intro':
        this.tone({ type: 'sawtooth', freq: note(-33), dur: 3.5, vol: 0.12 });
        this.tone({ type: 'sawtooth', freq: note(-26), dur: 3.5, vol: 0.08, delay: 0.4 });
        this.arp([0, 3, 7, 10, 12], 0.18, { type: 'triangle', vol: 0.08, delay: 1.2 });
        break;
      case 'win':
        this.arp([0, 4, 7, 12, 7, 12, 16, 19, 24], 0.09, { vol: 0.13 });
        break;
      case 'lose':
        this.arp([7, 6, 5, 4], 0.22, { type: 'sawtooth', vol: 0.12 });
        this.noise({ dur: 1.2, vol: 0.2, freq: 2000, to: 80, delay: 0.8 });
        break;
    }
  }

  /** Ticks while the die tumbles (matching the 0.85s spin), then a landing sting. */
  dice(outcome?: string) {
    if (!this.ready) return;
    let t = 0;
    let gap = 0.035;
    while (t < 0.82) {
      this.tone({ freq: 1400 + Math.random() * 900, dur: 0.02, vol: 0.05, delay: t });
      t += gap;
      gap *= 1.17;
    }
    const at = 0.86;
    if (outcome === 'crit') this.arp([12, 16, 19, 24, 28, 31], 0.05, { delay: at, vol: 0.15 });
    else if (outcome === 'fumble') this.tone({ type: 'sawtooth', freq: 220, to: 70, dur: 0.6, vol: 0.16, delay: at });
    else if (outcome === 'success') this.arp([7, 12], 0.07, { delay: at, vol: 0.12 });
    else if (outcome === 'fail') this.arp([3, -2], 0.09, { delay: at, vol: 0.12 });
    else this.tone({ freq: 880, dur: 0.08, vol: 0.1, delay: at });
  }

  // ---------------------------------------------------------------- ambience

  private startAmbience() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 4;
    const drone = [55, 55.4, 82.4].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    // a slow wobble on the filter
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(gain);

    // rain: looping band-passed noise
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuf!;
    rainSrc.loop = true;
    const rainF = ctx.createBiquadFilter();
    rainF.type = 'bandpass';
    rainF.frequency.value = 2500;
    rainF.Q.value = 0.6;
    const rain = ctx.createGain();
    rain.gain.value = 0;
    rainSrc.connect(rainF).connect(rain).connect(this.master!);
    rainSrc.start();

    gain.connect(this.master!);
    this.amb = { gain, drone, filter, rain };
  }

  setAmbience(mode: Ambience) {
    this.mode = mode;
    if (!this.ctx || !this.amb) return;
    const t = this.ctx.currentTime;
    const levels: Record<Ambience, { drone: number; rain: number; cutoff: number; pitch: number }> = {
      off: { drone: 0, rain: 0, cutoff: 200, pitch: 1 },
      lobby: { drone: 0.035, rain: 0.05, cutoff: 260, pitch: 1 },
      explore: { drone: 0.035, rain: 0.02, cutoff: 380, pitch: 1 },
      combat: { drone: 0.045, rain: 0.0, cutoff: 900, pitch: 1.5 },
      parley: { drone: 0.045, rain: 0.0, cutoff: 220, pitch: 0.75 },
      vault: { drone: 0.04, rain: 0.0, cutoff: 1400, pitch: 2 },
    };
    const l = levels[mode];
    this.amb.gain.gain.setTargetAtTime(l.drone, t, 0.6);
    this.amb.rain.gain.setTargetAtTime(l.rain, t, 0.6);
    this.amb.filter.frequency.setTargetAtTime(l.cutoff, t, 0.6);
    [55, 55.4, 82.4].forEach((f, i) => this.amb!.drone[i]!.frequency.setTargetAtTime(f * l.pitch, t, 0.8));
  }
}
