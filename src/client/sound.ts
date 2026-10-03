// Sound for LAST LIGHT, synthesized live with the Web Audio API: no audio files.
// Effects get random pitch variation so repeats never sound identical, and the
// music is generative: a chord progression that drifts between moods, with an
// arpeggio while exploring, a heartbeat and bass in fights, and a low, uneasy
// theme for the Devourer.

export type Sfx =
  | 'click' | 'vote' | 'strike' | 'fury' | 'hex' | 'bolt' | 'ward' | 'mend' | 'speak'
  | 'foeHit' | 'blocked' | 'charge' | 'wail' | 'stun' | 'slay' | 'bossSlay'
  | 'relic' | 'shrine' | 'enter' | 'intro' | 'win' | 'lose' | 'chat' | 'wyrm';

export type Mood = 'off' | 'lobby' | 'route' | 'combat' | 'boss';

const STORAGE_KEY = 'lastlight.sound';
const note = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12);
/** ±4% pitch drift so the same effect never plays twice exactly alike. */
const jit = (f: number, amount = 0.04) => f * (1 + (Math.random() * 2 - 1) * amount);

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  vol?: number;
  delay?: number;
  attack?: number;
  dest?: AudioNode;
}

interface NoiseOpts {
  dur: number;
  vol?: number;
  delay?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
}

// A minor progressions, as semitone offsets from A3 for each chord's root, third and fifth.
const PROGRESSIONS: Record<Exclude<Mood, 'off'>, number[][]> = {
  lobby: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
  route: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -2, 2]],
  combat: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]],
  boss: [[0, 3, 6], [1, 4, 7], [0, 3, 6], [-1, 3, 6]],
};
const TEMPO: Record<Exclude<Mood, 'off'>, number> = { lobby: 66, route: 78, combat: 116, boss: 92 };

export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private musicBus?: GainNode;
  private echo?: DelayNode;
  private noiseBuf?: AudioBuffer;
  private mood: Mood = 'off';
  private scheduler?: number;
  private nextBeat = 0;
  private beat = 0;
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
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.55 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);
      // a soft echo for the music's arpeggio
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = 0.32;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const damp = ctx.createBiquadFilter();
      damp.frequency.value = 1800;
      this.echo.connect(damp).connect(fb).connect(this.echo);
      this.echo.connect(this.musicBus);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.nextBeat = ctx.currentTime + 0.1;
      this.scheduler = window.setInterval(() => this.schedule(), 60);
      this.setMood(this.mood);
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
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    if (on) this.unlock();
  }

  setMood(mood: Mood) {
    this.mood = mood;
    if (!this.ctx || !this.musicBus) return;
    const level = mood === 'off' ? 0 : mood === 'combat' || mood === 'boss' ? 0.5 : 0.38;
    this.musicBus.gain.setTargetAtTime(level, this.ctx.currentTime, 0.8);
  }

  // ---------------------------------------------------------------- primitives

  private get ready() {
    return !!(this.ctx && this.master && this.enabled && this.ctx.state === 'running');
  }

  private tone({ type = 'square', freq, to, dur, vol = 0.16, delay = 0, attack = 0.008, dest }: ToneOpts) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest ?? this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise({ dur, vol = 0.2, delay = 0, filter = 'lowpass', freq = 2000, to, q = 1 }: NoiseOpts) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private arp(semis: number[], step: number, opts: Partial<ToneOpts> = {}) {
    const start = opts.delay ?? 0;
    const shift = Math.random() < 0.5 ? 0 : [-2, 2, 3][Math.floor(Math.random() * 3)]!;
    semis.forEach((s, i) => this.tone({ vol: 0.13, ...opts, freq: jit(note(s + shift), 0.01), dur: step * 1.7, delay: start + i * step }));
  }

  // ---------------------------------------------------------------- effects

  play(name: Sfx) {
    if (!this.ready) return;
    const coin = Math.random() < 0.5;
    switch (name) {
      case 'click':
        this.tone({ freq: jit(1700, 0.1), dur: 0.03, vol: 0.05 });
        break;
      case 'vote':
        this.tone({ type: 'triangle', freq: jit(660), to: jit(990), dur: 0.12, vol: 0.1 });
        break;
      case 'strike':
        this.noise({ dur: 0.12, vol: 0.28, filter: 'bandpass', freq: jit(3500, 0.2), to: 900, q: 2 });
        this.tone({ type: coin ? 'square' : 'sawtooth', freq: jit(700, 0.1), to: 140, dur: 0.12, vol: 0.12 });
        break;
      case 'fury':
        this.noise({ dur: 0.3, vol: 0.35, filter: 'bandpass', freq: 2500, to: 300, q: 1.5 });
        this.tone({ type: 'sawtooth', freq: jit(220), to: 55, dur: 0.35, vol: 0.2 });
        this.tone({ type: 'square', freq: jit(880), to: 110, dur: 0.18, vol: 0.1 });
        break;
      case 'hex':
        this.tone({ type: 'sine', freq: jit(330), to: jit(1320), dur: 0.35, vol: 0.14, attack: 0.05 });
        this.tone({ type: 'triangle', freq: jit(495), to: jit(1980), dur: 0.35, vol: 0.08, attack: 0.05, delay: 0.03 });
        break;
      case 'bolt':
        this.tone({ type: 'sawtooth', freq: jit(1800, 0.1), to: 200, dur: 0.22, vol: 0.12 });
        this.noise({ dur: 0.15, vol: 0.15, filter: 'highpass', freq: 3000 });
        break;
      case 'ward':
        this.tone({ type: 'triangle', freq: jit(392), dur: 0.5, vol: 0.12, attack: 0.03 });
        this.tone({ type: 'triangle', freq: jit(587), dur: 0.5, vol: 0.09, attack: 0.03, delay: 0.05 });
        this.tone({ type: 'sine', freq: jit(784), dur: 0.6, vol: 0.06, attack: 0.05, delay: 0.1 });
        break;
      case 'mend':
        this.arp([12, 16, 19, 24], 0.06, { type: 'triangle', vol: 0.1 });
        break;
      case 'speak':
        this.tone({ type: 'sine', freq: jit(523), to: jit(698), dur: 0.25, vol: 0.08, attack: 0.04 });
        break;
      case 'foeHit':
        this.noise({ dur: 0.3, vol: 0.32, freq: jit(1400, 0.2), to: 100 });
        this.tone({ type: 'sawtooth', freq: jit(130), to: 40, dur: 0.3, vol: 0.2 });
        break;
      case 'blocked':
        this.tone({ type: 'square', freq: jit(1046), dur: 0.08, vol: 0.12 });
        this.tone({ type: 'triangle', freq: jit(1568), dur: 0.25, vol: 0.1, delay: 0.04 });
        this.noise({ dur: 0.1, vol: 0.12, filter: 'highpass', freq: 5000 });
        break;
      case 'charge':
        this.tone({ type: 'sawtooth', freq: 60, to: 240, dur: 0.9, vol: 0.12, attack: 0.3 });
        this.noise({ dur: 0.9, vol: 0.12, filter: 'bandpass', freq: 300, to: 2400, q: 3 });
        break;
      case 'wail':
        for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: jit(700 + i * 37, 0.06), to: jit(420, 0.06), dur: 0.7, vol: 0.06, attack: 0.15, delay: i * 0.05 });
        this.noise({ dur: 0.7, vol: 0.1, filter: 'bandpass', freq: 1200, q: 6 });
        break;
      case 'stun':
        this.arp([24, 19, 24, 19], 0.05, { type: 'square', vol: 0.08 });
        break;
      case 'slay':
        this.noise({ dur: 0.7, vol: 0.35, freq: 3000, to: 60 });
        this.tone({ type: 'sawtooth', freq: 300, to: 30, dur: 0.6, vol: 0.16 });
        this.arp([0, 3, 7, 12], 0.07, { delay: 0.45 });
        break;
      case 'bossSlay':
        this.noise({ dur: 1.8, vol: 0.4, freq: 4000, to: 40 });
        this.tone({ type: 'sawtooth', freq: 110, to: 20, dur: 1.8, vol: 0.2 });
        break;
      case 'relic':
        this.tone({ freq: jit(note(15), 0.01), dur: 0.08, vol: 0.12 });
        this.tone({ freq: jit(note(22), 0.01), dur: 0.3, vol: 0.12, delay: 0.08 });
        this.tone({ type: 'triangle', freq: jit(note(27), 0.01), dur: 0.4, vol: 0.06, delay: 0.16 });
        break;
      case 'shrine':
        this.arp([0, 7, 12, 16, 19, 24], 0.12, { type: 'sine', vol: 0.08, attack: 0.04 });
        break;
      case 'enter':
        this.noise({ dur: 0.5, vol: 0.12, filter: 'lowpass', freq: 200, to: 2000 });
        this.tone({ type: 'sine', freq: 110, to: 55, dur: 0.5, vol: 0.12 });
        break;
      case 'chat': {
        const now = performance.now();
        if (now - this.lastChat < 250) return;
        this.lastChat = now;
        this.tone({ type: 'triangle', freq: jit(1320, 0.08), dur: 0.05, vol: 0.05 });
        break;
      }
      case 'wyrm':
        this.tone({ type: 'sawtooth', freq: jit(65), to: 48, dur: 0.8, vol: 0.2 });
        this.tone({ type: 'square', freq: jit(98), to: 73, dur: 0.6, vol: 0.06, delay: 0.05 });
        this.noise({ dur: 0.8, vol: 0.14, freq: 500, to: 120 });
        break;
      case 'intro':
        this.tone({ type: 'sawtooth', freq: note(-33), dur: 3.5, vol: 0.1, attack: 0.6 });
        this.tone({ type: 'sawtooth', freq: note(-27), dur: 3.5, vol: 0.07, attack: 0.8, delay: 0.4 });
        this.noise({ dur: 2.5, vol: 0.1, filter: 'bandpass', freq: 200, to: 1800, q: 4, delay: 1.2 });
        break;
      case 'win':
        this.arp([0, 4, 7, 12, 7, 12, 16, 19, 24], 0.1, { vol: 0.12 });
        this.tone({ type: 'triangle', freq: note(-12), dur: 1.6, vol: 0.12, attack: 0.1, delay: 0.5 });
        break;
      case 'lose':
        this.arp([7, 6, 5, 4], 0.25, { type: 'sawtooth', vol: 0.1 });
        this.noise({ dur: 1.5, vol: 0.2, freq: 2000, to: 60, delay: 0.9 });
        break;
    }
  }

  // ---------------------------------------------------------------- music

  /** Lookahead scheduler: lays down the next ~0.25s of music every tick. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    if (this.mood === 'off' || !this.enabled || ctx.state !== 'running') {
      this.nextBeat = ctx.currentTime + 0.1;
      return;
    }
    const mood = this.mood;
    const spb = 60 / TEMPO[mood] / 2; // eighth notes
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.musicStep(mood, this.beat, this.nextBeat - ctx.currentTime, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private musicStep(mood: Exclude<Mood, 'off'>, beat: number, delay: number, spb: number) {
    const prog = PROGRESSIONS[mood];
    const chord = prog[Math.floor(beat / 16) % prog.length]!; // a chord every two bars
    const bus = this.musicBus!;
    const base = -12; // A3

    // pad: a soft chord at each change
    if (beat % 16 === 0) {
      for (const s of chord) {
        this.tone({ type: 'triangle', freq: note(base + s), dur: spb * 16, vol: mood === 'boss' ? 0.05 : 0.035, attack: 1.2, delay, dest: bus });
      }
      if (mood === 'boss') this.tone({ type: 'sawtooth', freq: note(base - 24 + chord[0]!), dur: spb * 16, vol: 0.04, attack: 2, delay, dest: bus });
    }

    if (mood === 'lobby' || mood === 'route') {
      // a wandering arpeggio through the echo
      if (Math.random() < (mood === 'lobby' ? 0.35 : 0.5)) {
        const s = chord[Math.floor(Math.random() * chord.length)]! + (Math.random() < 0.4 ? 12 : 0);
        this.tone({ type: 'triangle', freq: note(base + 12 + s), dur: spb * 3, vol: 0.035, delay, dest: this.echo! });
      }
      if (mood === 'route' && beat % 4 === 0) this.tone({ type: 'sine', freq: note(base - 12 + chord[0]!), dur: spb * 3, vol: 0.05, delay, dest: bus });
      return;
    }

    // fights: a heartbeat on the bar and a driving bass line
    if (beat % 8 === 0 || beat % 8 === 1) {
      this.tone({ type: 'sine', freq: beat % 8 === 0 ? 60 : 52, to: 35, dur: 0.18, vol: mood === 'boss' ? 0.22 : 0.16, delay, dest: bus });
    }
    const bassPattern = mood === 'combat' ? [0, 0, 12, 0, 7, 0, 12, 10] : [0, -1, 0, 6, 0, -1, 0, 1];
    if (mood === 'combat' || beat % 2 === 0) {
      const s = bassPattern[beat % 8]!;
      this.tone({ type: 'square', freq: note(base - 12 + chord[0]! + s), dur: spb * 0.8, vol: 0.035, delay, dest: bus });
    }
    if (mood === 'boss' && beat % 32 === 28) {
      // an uneasy dissonant stab now and then
      this.tone({ type: 'sawtooth', freq: note(base + 6), dur: 0.6, vol: 0.04, attack: 0.02, delay, dest: bus });
      this.tone({ type: 'sawtooth', freq: note(base + 7), dur: 0.6, vol: 0.04, attack: 0.02, delay, dest: bus });
    }
  }
}
