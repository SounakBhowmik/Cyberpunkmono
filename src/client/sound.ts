import type { Mood } from '../shared/protocol';

// Sound for LAST LIGHT, synthesized live with the Web Audio API: no audio files.
// Every scene has its own piece of music. When the scene changes, the old
// piece fades out and is disconnected, so none of its notes linger, and the
// new one starts from its first beat.

export type Sfx =
  | 'click' | 'vote' | 'strike' | 'fury' | 'hex' | 'bolt' | 'ward' | 'mend' | 'speak'
  | 'foeHit' | 'blocked' | 'charge' | 'wail' | 'stun' | 'slay' | 'bossSlay'
  | 'boon' | 'glyphOk' | 'glyphBad' | 'title' | 'win' | 'lose' | 'chat' | 'npc' | 'notice'
  | 'tick' | 'score' | 'achieve' | 'flat';

export type { Mood };

const STORAGE_KEY = 'lastlight.sound';
const note = (semis: number) => 440 * 2 ** (semis / 12);
const jit = (f: number, amount = 0.04) => f * (1 + (Math.random() * 2 - 1) * amount);

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  vol?: number;
  at?: number;
  attack?: number;
  dest?: AudioNode;
  detune?: number;
}

interface Track {
  mood: Mood;
  gain: GainNode;
  beat: number;
  next: number;
}

/** Each piece: tempo (eighth notes per minute / 2), level, and a step function. */
interface Piece {
  bpm: number;
  level: number;
  step: (s: Sound, t: Track, beat: number, at: number, eighth: number) => void;
}

export class Sound {
  ctx?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private musicBus?: GainNode;
  private echo?: DelayNode;
  private noiseBuf?: AudioBuffer;
  private track?: Track;
  private wanted: Mood = 'lobby';
  private scheduler?: number;
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
      comp.threshold.value = -16;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.9;
      this.musicBus.connect(this.master);
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = 0.3;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      const damp = ctx.createBiquadFilter();
      damp.frequency.value = 2000;
      this.echo.connect(damp).connect(fb).connect(this.echo);
      this.echo.connect(this.musicBus);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.scheduler = window.setInterval(() => this.schedule(), 50);
      this.startTrack(this.wanted);
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

  /** Switch the music to a scene's piece. The previous piece is cut, not layered. */
  setMood(mood: Mood) {
    if (mood === this.wanted && this.track?.mood === mood) return;
    this.wanted = mood;
    if (this.ctx) this.startTrack(mood);
  }

  private startTrack(mood: Mood) {
    const ctx = this.ctx!;
    const old = this.track;
    if (old) {
      // fade out and disconnect: every note scheduled into it goes silent
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
      setTimeout(() => old.gain.disconnect(), 500);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(PIECES[mood].level, ctx.currentTime + 0.8);
    gain.connect(this.musicBus!);
    this.track = { mood, gain, beat: 0, next: ctx.currentTime + 0.15 };
  }

  private schedule() {
    const ctx = this.ctx;
    const t = this.track;
    if (!ctx || !t || ctx.state !== 'running') return;
    const piece = PIECES[t.mood];
    const eighth = 60 / piece.bpm / 2;
    while (t.next < ctx.currentTime + 0.3) {
      if (this.enabled) piece.step(this, t, t.beat, t.next, eighth);
      t.next += eighth;
      t.beat++;
    }
  }

  // ---------------------------------------------------------------- primitives (used by the pieces too)

  get ready() {
    return !!(this.ctx && this.master && this.enabled && this.ctx.state === 'running');
  }

  tone({ type = 'square', freq, to, dur, vol = 0.15, at, attack = 0.008, dest, detune = 0 }: ToneOpts) {
    const ctx = this.ctx!;
    const t = at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest ?? this.sfxBus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(o: { dur: number; vol?: number; at?: number; filter?: BiquadFilterType; freq?: number; to?: number; q?: number; dest?: AudioNode }) {
    const ctx = this.ctx!;
    const t = o.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(o.dest ?? this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + o.dur + 0.05);
  }

  /** A soft pad chord into a music track. */
  pad(t: Track, semis: number[], at: number, dur: number, vol: number, type: OscillatorType = 'triangle') {
    for (const s of semis) {
      this.tone({ type, freq: note(s), dur, vol, at, attack: Math.min(1.2, dur / 3), dest: t.gain });
      this.tone({ type, freq: note(s), dur, vol: vol * 0.6, at, attack: Math.min(1.2, dur / 3), dest: t.gain, detune: 8 });
    }
  }

  kick(t: Track, at: number, vol = 0.35) {
    this.tone({ type: 'sine', freq: 140, to: 40, dur: 0.18, vol, at, dest: t.gain });
  }

  snare(t: Track, at: number, vol = 0.12) {
    this.noise({ dur: 0.14, vol, at, filter: 'highpass', freq: 1800, dest: t.gain });
  }

  hat(t: Track, at: number, vol = 0.04) {
    this.noise({ dur: 0.04, vol, at, filter: 'highpass', freq: 7000, dest: t.gain });
  }

  bell(t: Track, semis: number, at: number, vol = 0.05) {
    this.tone({ type: 'sine', freq: note(semis), dur: 1.4, vol, at, dest: this.echo! });
    this.tone({ type: 'sine', freq: note(semis + 12), dur: 0.6, vol: vol * 0.3, at, dest: t.gain });
  }

  // ---------------------------------------------------------------- effects

  play(name: Sfx) {
    if (!this.ready) return;
    const arp = (semis: number[], step: number, o: Partial<ToneOpts> = {}) => {
      const shift = [0, 0, -2, 3][Math.floor(Math.random() * 4)]!;
      semis.forEach((s, i) => this.tone({ vol: 0.12, ...o, freq: note(s + shift), dur: step * 1.8, at: this.ctx!.currentTime + (o.at ?? 0) + i * step }));
    };
    switch (name) {
      case 'click':
        this.tone({ type: 'triangle', freq: jit(420, 0.04), to: jit(560, 0.04), dur: 0.09, vol: 0.055, attack: 0.012 });
        this.tone({ type: 'sine', freq: jit(210, 0.03), dur: 0.11, vol: 0.025, attack: 0.008 });
        break;
      case 'vote':
        this.tone({ type: 'triangle', freq: jit(660), to: jit(990), dur: 0.12, vol: 0.1 });
        break;
      case 'notice':
        this.tone({ type: 'triangle', freq: jit(880, 0.05), dur: 0.08, vol: 0.05 });
        break;
      case 'chat': {
        const now = performance.now();
        if (now - this.lastChat < 250) return;
        this.lastChat = now;
        this.tone({ type: 'triangle', freq: jit(1320, 0.08), dur: 0.05, vol: 0.05 });
        this.tone({ type: 'triangle', freq: jit(1760, 0.08), dur: 0.05, vol: 0.04, at: this.ctx!.currentTime + 0.06 });
        break;
      }
      case 'npc':
        this.tone({ type: 'sine', freq: jit(330), to: jit(262), dur: 0.25, vol: 0.06, attack: 0.03 });
        break;
      case 'strike':
        this.noise({ dur: 0.12, vol: 0.28, filter: 'bandpass', freq: jit(3500, 0.2), to: 900, q: 2 });
        this.tone({ type: 'sawtooth', freq: jit(700, 0.1), to: 140, dur: 0.12, vol: 0.1 });
        break;
      case 'fury':
        this.noise({ dur: 0.3, vol: 0.35, filter: 'bandpass', freq: 2500, to: 300, q: 1.5 });
        this.tone({ type: 'sawtooth', freq: jit(220), to: 55, dur: 0.35, vol: 0.2 });
        break;
      case 'hex':
        this.tone({ type: 'sine', freq: jit(330), to: jit(1320), dur: 0.35, vol: 0.13, attack: 0.05 });
        this.tone({ type: 'triangle', freq: jit(495), to: jit(1980), dur: 0.35, vol: 0.07, attack: 0.05 });
        break;
      case 'bolt':
        this.tone({ type: 'sawtooth', freq: jit(1800, 0.1), to: 200, dur: 0.22, vol: 0.11 });
        this.noise({ dur: 0.15, vol: 0.15, filter: 'highpass', freq: 3000 });
        break;
      case 'ward':
        this.tone({ type: 'triangle', freq: jit(392), dur: 0.5, vol: 0.11, attack: 0.03 });
        this.tone({ type: 'triangle', freq: jit(587), dur: 0.5, vol: 0.08, attack: 0.03 });
        break;
      case 'mend':
        arp([12, 16, 19, 24], 0.06, { type: 'triangle', vol: 0.09 });
        break;
      case 'speak':
        this.tone({ type: 'sine', freq: jit(523), to: jit(698), dur: 0.25, vol: 0.07, attack: 0.04 });
        break;
      case 'foeHit':
        this.noise({ dur: 0.3, vol: 0.32, freq: jit(1400, 0.2), to: 100 });
        this.tone({ type: 'sawtooth', freq: jit(130), to: 40, dur: 0.3, vol: 0.18 });
        break;
      case 'blocked':
        this.tone({ type: 'square', freq: jit(1046), dur: 0.08, vol: 0.1 });
        this.tone({ type: 'triangle', freq: jit(1568), dur: 0.25, vol: 0.09, at: this.ctx!.currentTime + 0.04 });
        break;
      case 'charge':
        this.tone({ type: 'sawtooth', freq: 60, to: 240, dur: 0.9, vol: 0.11, attack: 0.3 });
        this.noise({ dur: 0.9, vol: 0.1, filter: 'bandpass', freq: 300, to: 2400, q: 3 });
        break;
      case 'wail':
        for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: jit(700 + i * 37, 0.06), to: jit(420, 0.06), dur: 0.7, vol: 0.05, attack: 0.15 });
        break;
      case 'stun':
        arp([24, 19, 24, 19], 0.05, { type: 'square', vol: 0.07 });
        break;
      case 'slay':
        this.noise({ dur: 0.7, vol: 0.32, freq: 3000, to: 60 });
        arp([0, 3, 7, 12], 0.07, { at: 0.4 });
        break;
      case 'bossSlay':
        this.noise({ dur: 1.8, vol: 0.38, freq: 4000, to: 40 });
        this.tone({ type: 'sawtooth', freq: 110, to: 20, dur: 1.8, vol: 0.18 });
        break;
      case 'boon':
        arp([15, 22, 27], 0.08, { vol: 0.1 });
        break;
      case 'glyphOk':
        this.tone({ type: 'sine', freq: jit(880, 0.02), dur: 0.3, vol: 0.1 });
        this.tone({ type: 'sine', freq: jit(1320, 0.02), dur: 0.4, vol: 0.06, at: this.ctx!.currentTime + 0.05 });
        break;
      case 'glyphBad':
        this.tone({ type: 'square', freq: 150, dur: 0.12, vol: 0.12 });
        this.tone({ type: 'square', freq: 110, dur: 0.18, vol: 0.12, at: this.ctx!.currentTime + 0.12 });
        break;
      case 'title':
        this.tone({ type: 'sawtooth', freq: note(-33), dur: 2.2, vol: 0.08, attack: 0.4 });
        this.noise({ dur: 1.6, vol: 0.08, filter: 'bandpass', freq: 200, to: 1600, q: 4 });
        break;
      case 'win':
        arp([0, 4, 7, 12, 16, 19, 24], 0.1, { vol: 0.11 });
        break;
      case 'lose':
        arp([7, 6, 5, 4], 0.25, { type: 'sawtooth', vol: 0.09 });
        break;
      case 'tick':
        // the last seconds before the monster moves
        this.tone({ type: 'square', freq: 1760, dur: 0.04, vol: 0.05 });
        break;
      case 'score':
        this.tone({ type: 'triangle', freq: jit(1320, 0.03), dur: 0.12, vol: 0.05 });
        break;
      case 'achieve':
        arp([12, 16, 19, 24, 28], 0.07, { type: 'triangle', vol: 0.1 });
        break;
      case 'flat':
        this.tone({ type: 'sawtooth', freq: 220, to: 90, dur: 0.4, vol: 0.12 });
        break;
    }
  }
}

// ---------------------------------------------------------------- the pieces

// Semitones from A4. Each piece is a two- or four-bar loop with its own feel.
const PIECES: Record<Mood, Piece> = {
  lobby: {
    bpm: 54, level: 0.48,
    step(s, t, b, at, e) {
      const roots = [-31, -30, -34, -31];
      const root = roots[Math.floor(b / 16) % roots.length]!;
      if (b % 16 === 0) {
        s.pad(t, [root + 12, root + 18, root + 19], at, e * 20, 0.018, 'sawtooth');
        s.tone({ type: 'sine', freq: note(root), dur: e * 24, vol: .045, at, attack: 2, dest: t.gain });
      }
      if (b % 8 === 5 && Math.random() < .55) s.bell(t, root + 30 + Math.floor(Math.random() * 3), at, .018);
      if (b % 16 === 12) s.noise({ dur: e * 6, vol: .018, at, filter: 'bandpass', freq: 420, to: 1100, q: 5, dest: t.gain });
    },
  },
  story: {
    bpm: 84, level: 0.5,
    step(s, t, b, at, e) {
      const chords = [[-12, -9, -5], [-16, -12, -9], [-19, -15, -12], [-14, -10, -7]];
      const ch = chords[Math.floor(b / 16) % 4]!;
      if (b % 16 === 0) s.pad(t, ch, at, e * 16, 0.022);
      // a music-box melody walking the chord
      const melody = [0, 2, 1, 2, 0, 1, 2, 1];
      if (b % 2 === 0) s.tone({ type: 'sine', freq: note(ch[melody[(b / 2) % 8]!]! + 24), dur: e * 3, vol: 0.03, at, dest: t.gain });
      if (b % 8 === 0) s.tone({ type: 'triangle', freq: note(ch[0]! - 12), dur: e * 7, vol: 0.04, at, dest: t.gain });
    },
  },
  tense: {
    bpm: 104, level: 0.55,
    step(s, t, b, at, e) {
      const roots = [-24, -24, -23, -22];
      const r = roots[Math.floor(b / 16) % 4]!;
      // a low pulsing ostinato and a clock
      s.tone({ type: 'square', freq: note(r + (b % 4 === 3 ? 7 : 0)), dur: e * 0.7, vol: 0.03, at, dest: t.gain });
      if (b % 2 === 1) s.hat(t, at, 0.025);
      if (b % 16 === 0) s.pad(t, [r + 12, r + 17, r + 22], at, e * 16, 0.016, 'sine');
      if (b % 32 === 24) s.tone({ type: 'sine', freq: note(r + 37), dur: 1.5, vol: 0.025, at, attack: 0.5, dest: t.gain });
    },
  },
  combat: {
    bpm: 136, level: 0.55,
    step(s, t, b, at, e) {
      const roots = [-24, -24, -28, -26];
      const r = roots[Math.floor(b / 16) % 4]!;
      if (b % 4 === 0) s.kick(t, at, 0.3);
      if (b % 8 === 4) s.snare(t, at, 0.12);
      s.hat(t, at, b % 2 ? 0.02 : 0.035);
      const bass = [0, 0, 12, 0, 7, 0, 10, 12];
      s.tone({ type: 'sawtooth', freq: note(r + bass[b % 8]!), dur: e * 0.8, vol: 0.03, at, dest: t.gain });
      if (b % 16 === 0) s.pad(t, [r + 24, r + 31], at, e * 8, 0.02, 'sawtooth');
    },
  },
  boss: {
    bpm: 90, level: 0.6,
    step(s, t, b, at, e) {
      const roots = [-27, -26, -27, -28];
      const r = roots[Math.floor(b / 16) % 4]!;
      if (b % 8 === 0 || b % 8 === 3) s.kick(t, at, 0.4);
      if (b % 8 === 4) s.noise({ dur: 0.4, vol: 0.12, at, filter: 'lowpass', freq: 900, dest: t.gain });
      if (b % 16 === 0) {
        // a dark choir: detuned saws a tritone apart
        s.pad(t, [r + 12, r + 15, r + 18], at, e * 16, 0.02, 'sawtooth');
        s.tone({ type: 'sawtooth', freq: note(r), dur: e * 16, vol: 0.04, at, attack: 1, dest: t.gain });
      }
      if (b % 2 === 0) s.tone({ type: 'square', freq: note(r + [0, 1, 0, 6][(b / 2) % 4]!), dur: e * 1.6, vol: 0.025, at, dest: t.gain });
    },
  },
  night: {
    bpm: 62, level: 0.55,
    step(s, t, b, at, e) {
      // a heartbeat, a low drone, and something glassy far away
      if (b % 8 === 0) s.kick(t, at, 0.22);
      if (b % 8 === 1) s.kick(t, at, 0.15);
      if (b % 32 === 0) s.tone({ type: 'sine', freq: note(-33), dur: e * 32, vol: 0.05, at, attack: 2, dest: t.gain });
      if (b % 16 === 10 && Math.random() < 0.7) s.tone({ type: 'sine', freq: note(26 + Math.floor(Math.random() * 3)), dur: 2.5, vol: 0.02, at, attack: 0.8, dest: t.gain });
    },
  },
  victory: {
    bpm: 112, level: 0.5,
    step(s, t, b, at, e) {
      const chords = [[-12, -8, -5], [-7, -3, 0], [-10, -5, -1], [-12, -8, -5]];
      const ch = chords[Math.floor(b / 8) % 4]!;
      if (b % 8 === 0) s.pad(t, ch, at, e * 8, 0.025);
      s.tone({ type: 'triangle', freq: note(ch[b % 3]! + 24), dur: e * 1.5, vol: 0.03, at, dest: t.gain });
      if (b % 4 === 0) s.kick(t, at, 0.15);
    },
  },
  defeat: {
    bpm: 56, level: 0.5,
    step(s, t, b, at, e) {
      const chords = [[-12, -9, -5], [-14, -10, -7], [-16, -12, -9], [-17, -13, -10]];
      if (b % 16 === 0) s.pad(t, chords[Math.floor(b / 16) % 4]!, at, e * 16, 0.025, 'sine');
      if (b % 8 === 4 && Math.random() < 0.5) s.bell(t, chords[Math.floor(b / 16) % 4]![0]! + 12, at, 0.02);
    },
  },
};
