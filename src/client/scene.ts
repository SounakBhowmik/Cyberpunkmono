import type { Backdrop, ChoiceOption, Foe, Fx, Glyph, OptionIcon, SceneState, WyrmColor } from '../shared/protocol';
import { AV_H, AV_W, avatarSeed, buildAvatar, drawAvatar } from './avatar';
import { drawMonster } from './monsters';
import { drawPortrait } from './portraits';

// The scene window, drawn procedurally on one canvas: backdrops for every
// place in the story, the crew, the choice cards, glyph locks, characters,
// fights with the neon ICE, the wyrm, and the effects that sell every hit.

const C = {
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  yellow: '#ffe600',
  green: '#39ff88',
  red: '#ff3860',
  gold: '#ffb800',
  violet: '#b48cff',
  dim: '#3a3f5c',
  text: '#d7e3ff',
  muted: '#7a7f9a',
};
const WYRM_COLORS: Record<WyrmColor, string> = { red: '#ff5a3c', blue: '#4da3ff', green: '#3dff8f', black: '#9d8cff', white: '#dff4ff' };
const MOVE_COLOR: Record<string, string> = { strike: C.red, fury: C.gold, hex: C.violet, bolt: C.cyan, ward: C.yellow, mend: C.green, speak: C.magenta };
const GLYPH_CHAR: Record<Glyph, string> = { moon: '☾', eye: '◉', serpent: '∿', crown: '♛', key: '⚷' };
const ICON_COLOR: Record<OptionIcon, string> = { fight: C.red, sneak: C.violet, talk: C.cyan, help: C.green, rest: C.green, loot: C.gold, risk: C.magenta, path: C.yellow };
const FONT = '"JetBrains Mono", Menlo, Consolas, monospace';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; gravity: number; streak?: boolean }
interface Floater { text: string; x: number; y: number; t0: number; color: string; big?: boolean; small?: boolean }
interface Ring { x: number; y: number; t0: number; color: string; max: number; width: number }
interface Building { x: number; w: number; h: number; windows: number[]; sign?: string }
interface HeroAnim { move: string; t0: number }

export interface Lobby {
  title: string;
  subtitle: string;
  crew?: { handle: string; avatar: number; host?: boolean; you?: boolean }[];
}

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : 1 - (1 - x) * (1 - x));
const pulse = (x: number) => (x < 0 || x > 1 ? 0 : Math.sin(x * Math.PI));

export class SceneView {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private now = 0;
  private scene?: SceneState;
  private lobby: Lobby = { title: 'LAST LIGHT', subtitle: 'a city of millions. one waking wyrm. a few small spirits.' };
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private rings: Ring[] = [];
  private shakeUntil = 0;
  private shakeMag = 8;
  private punch = 0;
  private hitStopUntil = 0;
  private foeClock = 0;
  private flash = { color: C.red, until: 0, dur: 1 };
  private heroAnims = new Map<string, HeroAnim>();
  private foeAnim?: { move: string; t0: number; blocked: boolean };
  private foeHitAt = -10;
  private stunAt = -10;
  private wardAt = -10;
  private blockAt = -10;
  private mendAt = -10;
  private deathAt?: number;
  private glyphAt = -10;
  private glyphOk = true;
  private linger?: { scene: SceneState; until: number };
  private title?: { text: string; sub: string; t0: number };
  private timerEnd = 0;
  private timerTotal = 0;
  private cards: { index: number; x: number; y: number; w: number; h: number }[] = [];
  private hoverCard = -1;
  private city: Building[] = [];
  private motes: { x: number; y: number; s: number; r: number }[] = [];
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onOptionClick: (index: number) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('mousemove', (e) => this.hover(e));
    requestAnimationFrame(this.frame);
  }

  private get narrow() {
    return this.w < 560;
  }

  // ---------------------------------------------------------------- public api

  setScene(scene: SceneState) {
    const prev = this.scene;
    if (prev?.foe && !scene.foe && this.deathAt !== undefined) this.linger = { scene: prev, until: this.now + 1.3 };
    if (scene.foe && (!prev?.foe || prev.foe.name !== scene.foe.name)) {
      this.deathAt = undefined;
      this.foeAnim = undefined;
    }
    // keep the countdown in local time; the server sends how much is left
    if (scene.timer) {
      this.timerEnd = this.now + scene.timer.leftMs / 1000;
      this.timerTotal = scene.timer.totalMs / 1000;
    } else this.timerTotal = 0;
    this.scene = scene;
  }

  /** Seconds until the monster moves (or the vote closes), or undefined when nothing is ticking. */
  get secondsLeft(): number | undefined {
    return this.timerTotal ? Math.max(0, this.timerEnd - this.now) : undefined;
  }

  setLobby(lobby: Lobby) {
    this.lobby = lobby;
    this.scene = undefined;
  }

  playFx(fx: Fx) {
    // the monster sits top-centre and the crew along the bottom
    const fxX = this.w * 0.5;
    const fxY = this.h * 0.33;
    const crewY = this.h * 0.8;
    switch (fx.kind) {
      case 'title':
        this.title = { text: fx.title, sub: fx.subtitle, t0: this.now };
        break;
      case 'act': {
        this.heroAnims.set(fx.by, { move: fx.move, t0: this.now });
        if (fx.move === 'ward') this.wardAt = this.now;
        if (fx.move === 'mend') {
          this.mendAt = this.now;
          if (fx.amount) this.float(`+${fx.amount}`, this.w * 0.5, crewY - 60, C.green, true);
        }
        if (fx.amount && ['strike', 'fury', 'hex', 'bolt', 'speak'].includes(fx.move)) {
          const delay = fx.move === 'strike' || fx.move === 'fury' ? 200 : 170;
          setTimeout(() => this.impact(fxX, fxY, fx.move, fx.amount!), delay);
        }
        break;
      }
      case 'foe':
        this.foeAnim = { move: fx.move, t0: this.now, blocked: fx.blocked };
        if (fx.move === 'attack' || fx.move === 'heavy') {
          setTimeout(() => {
            if (fx.blocked) {
              this.blockAt = this.now;
              this.rings.push({ x: this.w * 0.5, y: crewY - 40, t0: this.now, color: C.yellow, max: this.w * 0.4, width: 4 });
              this.float('BLOCKED', this.w * 0.5, crewY - 70, C.yellow, true);
              this.sparks(this.w * 0.5, crewY - 40, C.yellow, 24);
            } else {
              this.shake(fx.move === 'heavy' ? 0.5 : 0.28, fx.move === 'heavy' ? 14 : 8);
              this.punch = fx.move === 'heavy' ? 0.06 : 0.03;
              this.flashScreen(C.red, fx.move === 'heavy' ? 0.5 : 0.3);
              this.float(`-${fx.amount}`, this.w * 0.5, crewY - 50, C.red, true);
            }
          }, 260);
        } else if (fx.move === 'wail') {
          this.flashScreen('#6b2bd6', 0.5);
          this.rings.push({ x: fxX, y: fxY, t0: this.now, color: C.magenta, max: this.w * 0.6, width: 2 });
          this.float(`-${fx.amount}`, this.w * 0.5, crewY - 50, C.magenta, true);
        } else if (fx.move === 'charge') {
          this.float('CHARGING', fxX, fxY + this.h * 0.2, C.gold, true);
        }
        break;
      case 'stun':
        this.stunAt = this.now;
        this.rings.push({ x: fxX, y: fxY, t0: this.now, color: C.violet, max: this.h * 0.5, width: 3 });
        this.float('INTERRUPTED', fxX, fxY + this.h * 0.2, C.violet, true);
        break;
      case 'heal':
        this.flashScreen(C.green, 0.3);
        this.risingRings(this.w / 2, this.h * 0.6, C.green);
        break;
      case 'hurt':
        this.shake(0.25, 6);
        this.flashScreen(C.red, 0.25);
        this.float(`-${fx.amount}`, this.w * 0.5, crewY - 50, C.red, true);
        break;
      case 'score': {
        const at = this.heroSpot(fx.by);
        const good = fx.points > 0;
        this.floaters.push({ text: `${good ? '+' : ''}${fx.points} ${fx.reason.toUpperCase()}`, x: at.x, y: at.y - 10, t0: this.now + 0.35, color: good ? C.gold : C.red, small: true });
        break;
      }
      case 'slay':
        this.deathAt = this.now;
        this.hitStopUntil = this.now + 0.12;
        this.rings.push({ x: fxX, y: fxY, t0: this.now, color: C.red, max: this.w * 0.5, width: 5 });
        this.sparks(fxX, fxY, C.red, fx.boss ? 140 : 70);
        this.sparks(fxX, fxY, C.gold, fx.boss ? 80 : 30);
        this.shake(fx.boss ? 1 : 0.35, fx.boss ? 16 : 8);
        break;
      case 'glyph':
        this.glyphAt = this.now;
        this.glyphOk = fx.ok;
        if (!fx.ok) {
          this.shake(0.3, 8);
          this.flashScreen(C.red, 0.3);
        }
        break;
      case 'boon':
        this.float(`✦ ${fx.name}`, this.w / 2, this.h * 0.3, C.gold, true);
        this.sparks(this.w / 2, this.h * 0.4, C.gold, 30);
        break;
      case 'vote':
      case 'end':
        break;
    }
  }

  // ---------------------------------------------------------------- effects

  /** An impact on the foe: hit-stop, a white flash, a shockwave ring, spark streaks. */
  private impact(x: number, y: number, move: string, amount: number) {
    const color = MOVE_COLOR[move] ?? C.yellow;
    const big = move === 'fury' || amount >= 14;
    this.foeHitAt = this.now;
    this.hitStopUntil = this.now + (big ? 0.11 : 0.06);
    this.rings.push({ x, y, t0: this.now, color, max: big ? this.h * 0.55 : this.h * 0.35, width: big ? 5 : 3 });
    this.sparks(x, y, color, big ? 36 : 18);
    if (big) {
      this.shake(0.22, 9);
      this.punch = 0.04;
    }
    this.float(`${amount}`, x + (Math.random() - 0.5) * 60, y - this.h * 0.12, big ? C.gold : '#ffffff', true);
  }

  private shake(seconds: number, mag = 8) {
    if (this.reduced) return;
    this.shakeUntil = Math.max(this.shakeUntil, this.now + seconds);
    this.shakeMag = mag;
  }

  private flashScreen(color: string, dur: number) {
    this.flash = { color, until: this.now + dur, dur };
  }

  private float(text: string, x: number, y: number, color: string, big = false) {
    this.floaters.push({ text, x, y, t0: this.now, color, big });
  }

  private sparks(x: number, y: number, color: string, n: number) {
    if (this.reduced) n = Math.min(n, 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 380;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.25 + Math.random() * 0.45, color, size: 1.5 + Math.random() * 1.5, gravity: 300, streak: true });
    }
  }

  private risingRings(x: number, y: number, color: string) {
    for (let i = 0; i < 3; i++) setTimeout(() => this.rings.push({ x, y: y - i * 20, t0: this.now, color, max: this.w * 0.25, width: 2 }), i * 120);
    for (let i = 0; i < 14; i++) this.particles.push({ x: x + (Math.random() - 0.5) * this.w * 0.3, y: y + Math.random() * 20, vx: 0, vy: -50 - Math.random() * 60, life: 0, max: 1.2, color, size: 3, gravity: 0 });
  }

  // ---------------------------------------------------------------- input & sizing

  private resize() {
    const parent = this.canvas.parentElement!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = parent.clientWidth;
    this.h = parent.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.buildCity();
  }

  private cardAt(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return this.cards.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  }

  private click(e: MouseEvent) {
    if (!this.scene?.choice) return;
    const card = this.cardAt(e);
    if (card) this.onOptionClick(card.index);
  }

  private hover(e: MouseEvent) {
    const card = this.scene?.choice ? this.cardAt(e) : undefined;
    this.hoverCard = card?.index ?? -1;
    this.canvas.style.cursor = card ? 'pointer' : 'default';
  }

  // ---------------------------------------------------------------- loop

  private frame = (ms: number) => {
    const t = ms / 1000;
    const dt = Math.min(0.05, t - (this.now || t));
    this.now = t;
    if (this.now >= this.hitStopUntil) this.foeClock += dt;
    const ctx = this.ctx;
    ctx.save();
    if (this.punch > 0.001) {
      const z = 1 + this.punch;
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(z, z);
      ctx.translate(-this.w / 2, -this.h / 2);
      this.punch *= 0.85;
    }
    if (this.now < this.shakeUntil) {
      const k = Math.min(1, (this.shakeUntil - this.now) * 3);
      ctx.translate((Math.random() - 0.5) * this.shakeMag * k, (Math.random() - 0.5) * this.shakeMag * 0.8 * k);
    }
    const s = this.scene;
    if (!s) this.drawLobby();
    else if (this.linger && this.now < this.linger.until) this.drawFight(this.linger.scene);
    else {
      this.linger = undefined;
      switch (s.view) {
        case 'story': this.drawStory(s); break;
        case 'puzzle': this.drawPuzzle(s); break;
        case 'parley': this.drawParley(s); break;
        case 'end': this.drawEnd(s); break;
        default: this.drawFight(s);
      }
    }
    this.drawRings();
    this.drawParticles(dt);
    this.drawFloaters();
    if (this.title) this.drawTitle();
    ctx.restore();
    if (this.now < this.flash.until) {
      ctx.globalAlpha = ((this.flash.until - this.now) / this.flash.dur) * 0.28;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    this.drawScanlines();
    requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------------- drawing helpers

  private glow(color: string, blur: number) {
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = blur;
  }

  private noGlow() {
    this.ctx.shadowBlur = 0;
  }

  private text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 400, outline = false) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineWidth = Math.max(3, size / 5);
      ctx.strokeStyle = 'rgba(5, 4, 10, 0.9)';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  private wrap(str: string, maxWidth: number, size: number, weight = 400): string[] {
    this.ctx.font = `${weight} ${size}px ${FONT}`;
    const lines: string[] = [];
    let line = '';
    for (const word of str.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (this.ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawScanlines() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    for (let y = 0; y < this.h; y += 3) ctx.fillRect(0, y, this.w, 1);
  }

  // ---------------------------------------------------------------- backdrops

  private buildCity() {
    const out: Building[] = [];
    let x = -10;
    while (x < this.w + 20) {
      const w = 24 + Math.random() * 60;
      out.push({ x, w, h: this.h * (0.18 + Math.random() * 0.42), windows: Array.from({ length: 40 }, () => Math.random()), ...(Math.random() < 0.18 ? { sign: Math.random() < 0.5 ? C.magenta : C.cyan } : {}) });
      x += w + 2 + Math.random() * 6;
    }
    this.city = out;
    this.motes = Array.from({ length: 40 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, s: 8 + Math.random() * 20, r: 0.6 + Math.random() * 1.6 }));
  }

  private sky(top = '#0b0717', bottom = '#05040a') {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(-30, -30, this.w + 60, this.h + 60);
  }

  private drawCity(alpha = 1, lit = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    for (const b of this.city) {
      ctx.fillStyle = '#0d0a1c';
      ctx.fillRect(b.x, this.h - b.h, b.w, b.h);
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.15)';
      ctx.strokeRect(b.x + 0.5, this.h - b.h + 0.5, b.w - 1, b.h - 1);
      const cols = Math.max(1, Math.floor(b.w / 9));
      const rows = Math.floor(b.h / 12);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const seed = b.windows[(r * cols + col) % b.windows.length]!;
          if (seed < 0.62 || seed > 0.62 + 0.38 * lit || Math.sin(this.now * 0.5 + seed * 40) < -0.85) continue;
          ctx.fillStyle = seed > 0.9 ? 'rgba(255, 230, 0, 0.55)' : 'rgba(0, 240, 255, 0.35)';
          ctx.fillRect(b.x + 3 + col * 9, this.h - b.h + 5 + r * 12, 4, 5);
        }
      }
      if (b.sign && lit > 0.5 && Math.sin(this.now * 3 + b.x) > -0.6) {
        this.glow(b.sign, 12);
        ctx.fillStyle = b.sign;
        ctx.fillRect(b.x + b.w * 0.2, this.h - b.h + 14, b.w * 0.6, 4);
        this.noGlow();
      }
    }
    for (const m of this.motes) {
      m.y -= m.s * 0.016;
      if (m.y < -5) {
        m.y = this.h + 5;
        m.x = Math.random() * this.w;
      }
      ctx.fillStyle = 'rgba(255, 220, 150, 0.25)';
      ctx.beginPath();
      ctx.arc(m.x + Math.sin(this.now + m.s) * 6, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private backdrop(b: Backdrop, dim = 1) {
    const ctx = this.ctx;
    const t = this.now;
    switch (b) {
      case 'city':
        this.sky();
        this.drawCity(0.9 * dim);
        break;
      case 'street': {
        this.sky('#0a0716', '#040308');
        // an alley: two walls in perspective, signs, a puddle catching the neon
        ctx.globalAlpha = dim;
        ctx.fillStyle = '#0e0b1c';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(this.w * 0.32, this.h * 0.25);
        ctx.lineTo(this.w * 0.32, this.h * 0.8);
        ctx.lineTo(0, this.h);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(this.w, 0);
        ctx.lineTo(this.w * 0.68, this.h * 0.25);
        ctx.lineTo(this.w * 0.68, this.h * 0.8);
        ctx.lineTo(this.w, this.h);
        ctx.fill();
        for (const [x, y, w, col] of [[0.08, 0.3, 0.12, C.magenta], [0.74, 0.36, 0.1, C.cyan], [0.2, 0.55, 0.07, C.gold]] as const) {
          if (Math.sin(t * 2.3 + x * 20) < -0.8) continue;
          this.glow(col, 16);
          ctx.fillStyle = col;
          ctx.fillRect(this.w * x, this.h * y, this.w * w, 4);
          this.noGlow();
          ctx.globalAlpha = 0.18 * dim;
          ctx.fillRect(this.w * x, this.h * (1.6 - y) * 0.62 + this.h * 0.4, this.w * w, 2);
          ctx.globalAlpha = dim;
        }
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.ellipse(this.w / 2, this.h * 0.88, this.w * (0.08 + i * 0.05) + Math.sin(t + i) * 4, 6 + i * 3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'market': {
        this.sky('#07101a', '#030608');
        ctx.globalAlpha = dim;
        // awnings and lanterns over black water
        for (let i = 0; i < 6; i++) {
          const x = (i + 0.5) * (this.w / 6);
          ctx.fillStyle = '#0d1520';
          ctx.fillRect(x - 30, this.h * 0.35, 60, this.h * 0.3);
          ctx.fillStyle = i % 2 ? '#3a1a2a' : '#1a2a3a';
          ctx.beginPath();
          ctx.moveTo(x - 38, this.h * 0.36);
          ctx.lineTo(x, this.h * 0.28);
          ctx.lineTo(x + 38, this.h * 0.36);
          ctx.fill();
          const sway = Math.sin(t * 1.3 + i) * 3;
          this.glow(C.gold, 14);
          ctx.fillStyle = 'rgba(255, 184, 0, 0.8)';
          ctx.beginPath();
          ctx.arc(x + sway, this.h * 0.42, 4, 0, Math.PI * 2);
          ctx.fill();
          this.noGlow();
        }
        const water = this.h * 0.66;
        const g = ctx.createLinearGradient(0, water, 0, this.h);
        g.addColorStop(0, '#071420');
        g.addColorStop(1, '#020508');
        ctx.fillStyle = g;
        ctx.fillRect(0, water, this.w, this.h - water);
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.15)';
        for (let i = 0; i < 14; i++) {
          const y = water + 6 + i * 9;
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x <= this.w; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.03 + t * 1.5 + i) * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'bridge': {
        this.sky('#060812', '#000002');
        ctx.globalAlpha = dim;
        // streams of data falling into a void
        ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
        for (let i = 0; i < 30; i++) {
          const x = (i * 97) % this.w;
          const y = ((t * (40 + (i % 5) * 20) + i * 53) % (this.h + 60)) - 30;
          ctx.fillRect(x, y, 2, 14);
        }
        const by = this.h * 0.72;
        this.glow(C.cyan, 12);
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, by);
        ctx.quadraticCurveTo(this.w / 2, by + 26, this.w + 10, by);
        ctx.stroke();
        ctx.lineWidth = 1;
        for (let i = 0; i <= 12; i++) {
          const x = (i / 12) * this.w;
          const sag = Math.sin((i / 12) * Math.PI) * 26 * 0.5;
          ctx.beginPath();
          ctx.moveTo(x, by + sag);
          ctx.lineTo(x, by - 50 + sag + Math.sin(t * 3 + i) * 2);
          ctx.stroke();
        }
        this.noGlow();
        ctx.globalAlpha = 1;
        break;
      }
      case 'shrine': {
        this.sky('#0d0716', '#05030a');
        ctx.globalAlpha = dim;
        const cx = this.w * 0.5;
        const top = this.h * 0.2;
        ctx.strokeStyle = 'rgba(255, 56, 96, 0.8)';
        this.glow(C.red, 14);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx - this.w * 0.22, top);
        ctx.quadraticCurveTo(cx, top - 14, cx + this.w * 0.22, top);
        ctx.moveTo(cx - this.w * 0.17, top + 22);
        ctx.lineTo(cx + this.w * 0.17, top + 22);
        ctx.moveTo(cx - this.w * 0.14, top - 4);
        ctx.lineTo(cx - this.w * 0.14, this.h * 0.85);
        ctx.moveTo(cx + this.w * 0.14, top - 4);
        ctx.lineTo(cx + this.w * 0.14, this.h * 0.85);
        ctx.stroke();
        this.noGlow();
        ctx.lineWidth = 1;
        for (const lx of [0.15, 0.85]) {
          this.glow(C.gold, 18);
          ctx.fillStyle = `rgba(255, 184, 0, ${0.6 + 0.2 * Math.sin(t * 2 + lx * 9)})`;
          ctx.fillRect(this.w * lx - 6, this.h * 0.6, 12, 18);
          this.noGlow();
        }
        for (const m of this.motes) {
          m.y += m.s * 0.01;
          m.x += Math.sin(t + m.s) * 0.3;
          if (m.y > this.h) m.y = -5;
          ctx.fillStyle = 'rgba(255, 150, 190, 0.35)';
          ctx.beginPath();
          ctx.ellipse(m.x, m.y, m.r * 1.6, m.r, t + m.s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'tower': {
        this.sky('#05070f', '#02030a');
        ctx.globalAlpha = dim;
        // a corporate lobby: light columns and a turning hologram logo
        for (let i = 0; i < 9; i++) {
          const x = (i / 8) * this.w;
          const g = ctx.createLinearGradient(x, 0, x, this.h);
          g.addColorStop(0, 'rgba(0, 240, 255, 0)');
          g.addColorStop(0.5, 'rgba(0, 240, 255, 0.12)');
          g.addColorStop(1, 'rgba(0, 240, 255, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 2, 0, 4, this.h);
        }
        const k = Math.cos(t * 0.8);
        this.glow(C.cyan, 16);
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.35})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(this.w / 2, this.h * 0.24, 40 * Math.abs(k) + 4, 40, 0, 0, Math.PI * 2);
        ctx.moveTo(this.w / 2 - 24 * k, this.h * 0.24);
        ctx.lineTo(this.w / 2 + 24 * k, this.h * 0.24);
        ctx.stroke();
        this.noGlow();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        for (let i = 0; i < 8; i++) {
          const y = this.h * 0.65 + i * i * 4;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(this.w, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'vault': {
        this.sky('#08060e', '#030206');
        ctx.globalAlpha = dim;
        // a hex-plated wall around a great round door
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.08)';
        const r = 22;
        for (let row = 0; row < this.h / (r * 1.5) + 1; row++) {
          for (let col = 0; col < this.w / (r * 1.73) + 1; col++) {
            const x = col * r * 1.73 + (row % 2 ? r * 0.86 : 0);
            const y = row * r * 1.5;
            ctx.beginPath();
            for (let i = 0; i <= 6; i++) {
              const a = Math.PI / 6 + (i * Math.PI) / 3;
              if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
              else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            }
            ctx.stroke();
          }
        }
        this.glow(C.gold, 18);
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.w / 2, this.h * 0.45, Math.min(this.w, this.h) * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        this.noGlow();
        ctx.globalAlpha = 1;
        break;
      }
      case 'castle': {
        this.sky('#090512', '#010104');
        ctx.globalAlpha = dim;
        // Ashenwake hangs upside down: needle towers descend from a broken moon.
        ctx.fillStyle = 'rgba(210, 220, 255, 0.12)';
        ctx.beginPath();
        ctx.arc(this.w * 0.74, this.h * 0.18, Math.min(this.w, this.h) * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#080711';
        for (let i = 0; i < 7; i++) {
          const x = this.w * (0.08 + i * 0.14);
          const wide = 34 + (i % 3) * 14;
          const bottom = this.h * (0.5 + (i % 2) * 0.08);
          ctx.fillRect(x - wide / 2, 0, wide, bottom);
          ctx.beginPath();
          ctx.moveTo(x - wide / 2 - 8, bottom);
          ctx.lineTo(x, bottom + 70 + (i % 3) * 18);
          ctx.lineTo(x + wide / 2 + 8, bottom);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 184, 0, 0.35)';
          ctx.fillRect(x - 3, bottom * 0.48, 6, 15);
          ctx.fillStyle = '#080711';
        }
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.16)';
        for (let i = 0; i < 4; i++) {
          const y = this.h * (0.68 + i * 0.06) + Math.sin(t + i) * 3;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(this.w * 0.3, y - 18, this.w * 0.7, y + 18, this.w, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'cathedral': {
        this.sky('#07040e', '#010104');
        ctx.globalAlpha = dim;
        const cx = this.w / 2;
        // A huge animated rose window makes the location unmistakable.
        this.glow(C.red, 16);
        ctx.strokeStyle = 'rgba(255, 56, 96, 0.45)';
        ctx.lineWidth = 2;
        for (let ring = 1; ring <= 4; ring++) {
          ctx.beginPath(); ctx.arc(cx, this.h * 0.32, ring * 28, 0, Math.PI * 2); ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6 + t * 0.035;
          ctx.beginPath(); ctx.moveTo(cx, this.h * 0.32); ctx.lineTo(cx + Math.cos(a) * 112, this.h * 0.32 + Math.sin(a) * 112); ctx.stroke();
        }
        this.noGlow();
        ctx.fillStyle = '#080711';
        for (const x of [0.08, 0.23, 0.77, 0.92]) {
          ctx.fillRect(this.w * x - 22, this.h * 0.2, 44, this.h * 0.7);
          ctx.beginPath(); ctx.moveTo(this.w * x - 30, this.h * 0.2); ctx.lineTo(this.w * x, this.h * 0.08); ctx.lineTo(this.w * x + 30, this.h * 0.2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'abyss': {
        this.sky('#02020a', '#000000');
        ctx.globalAlpha = dim;
        // Floating dungeon fragments drift around a black sun.
        const pulse = 42 + Math.sin(t * 0.5) * 5;
        this.glow('#8a62ff', 24);
        ctx.fillStyle = 'rgba(80, 45, 145, 0.45)';
        ctx.beginPath(); ctx.arc(this.w / 2, this.h * 0.25, pulse, 0, Math.PI * 2); ctx.fill();
        this.noGlow();
        ctx.fillStyle = '#05040c';
        for (let i = 0; i < 8; i++) {
          const x = (i + 0.5) * this.w / 8;
          const y = this.h * (0.5 + (i % 3) * 0.12) + Math.sin(t * 0.4 + i) * 8;
          ctx.beginPath(); ctx.moveTo(x - 52, y); ctx.lineTo(x + 45, y - 8); ctx.lineTo(x + 20, y + 18); ctx.lineTo(x - 18, y + 55); ctx.fill();
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)'; ctx.beginPath(); ctx.moveTo(x - 42, y); ctx.lineTo(x + 34, y - 6); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'lair': {
        this.sky('#08030a', '#000000');
        ctx.globalAlpha = dim;
        // red mist and eyes in the dark
        for (let i = 0; i < 5; i++) {
          const y = this.h * (0.55 + i * 0.1);
          ctx.fillStyle = `rgba(120, 10, 40, ${0.06 + 0.02 * Math.sin(t + i)})`;
          ctx.beginPath();
          ctx.ellipse(this.w / 2 + Math.sin(t * 0.3 + i) * 60, y, this.w * 0.7, 30, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 6; i++) {
          const open = Math.max(0, Math.sin(t * 0.4 + i * 1.7));
          if (open < 0.2) continue;
          const x = ((i * 0.17 + 0.08) % 1) * this.w;
          const y = this.h * (0.15 + (i % 3) * 0.12);
          ctx.fillStyle = `rgba(255, 56, 96, ${open * 0.5})`;
          for (const dx of [-6, 6]) {
            ctx.beginPath();
            ctx.ellipse(x + dx, y, 3, 1.5 * open, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'camp': {
        this.sky('#090614', '#040206');
        ctx.globalAlpha = dim;
        // a barricaded room: a window onto the night city, and a fire
        const wx = this.w * 0.6;
        const wy = this.h * 0.12;
        const ww = this.w * 0.3;
        const wh = this.h * 0.35;
        ctx.save();
        ctx.beginPath();
        ctx.rect(wx, wy, ww, wh);
        ctx.clip();
        ctx.translate(wx, wy);
        ctx.scale(ww / this.w, wh / this.h);
        this.drawCity(0.8, 0.35);
        ctx.restore();
        ctx.strokeStyle = '#3a2a1a';
        ctx.lineWidth = 6;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(wx - 10, wy + wh * 0.3);
        ctx.lineTo(wx + ww + 10, wy + wh * 0.5);
        ctx.moveTo(wx - 10, wy + wh * 0.8);
        ctx.lineTo(wx + ww + 10, wy + wh * 0.6);
        ctx.stroke();
        ctx.lineWidth = 1;
        const fx = this.w * 0.3;
        const fy = this.h * 0.86;
        const g = ctx.createRadialGradient(fx, fy, 4, fx, fy, this.h * 0.5);
        g.addColorStop(0, `rgba(255, 140, 40, ${0.28 + 0.06 * Math.sin(t * 9)})`);
        g.addColorStop(1, 'rgba(255, 140, 40, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.w, this.h);
        if (Math.random() < 0.4) this.particles.push({ x: fx + (Math.random() - 0.5) * 20, y: fy, vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 40, life: 0, max: 1, color: '#ff9a3a', size: 2, gravity: 0 });
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- lobby

  private drawLobby() {
    this.sky('#080511', '#020104');
    this.drawCity(0.72);
    const ctx = this.ctx;
    // A half-seen eye hangs behind the title; fog repeatedly hides it.
    const ex = this.w * 0.5 + Math.sin(this.now * 0.18) * this.w * 0.025;
    const ey = this.h * 0.19;
    const ew = Math.min(this.w * 0.36, 300);
    const eh = ew * 0.22;
    const aura = ctx.createRadialGradient(ex, ey, 2, ex, ey, ew * 0.75);
    aura.addColorStop(0, 'rgba(255,184,0,.2)');
    aura.addColorStop(.4, 'rgba(255,43,214,.07)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(ex - ew, ey - ew, ew * 2, ew * 2);
    ctx.save();
    ctx.globalAlpha = .58 + Math.sin(this.now * .7) * .08;
    this.glow('#ff4b68', 20);
    ctx.strokeStyle = '#8f294d';
    ctx.fillStyle = 'rgba(50,5,24,.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex - ew / 2, ey);
    ctx.quadraticCurveTo(ex, ey - eh, ex + ew / 2, ey);
    ctx.quadraticCurveTo(ex, ey + eh, ex - ew / 2, ey);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb800';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 7 + Math.sin(this.now) * 2, eh * .75, 0, 0, Math.PI * 2);
    ctx.fill();
    this.noGlow();
    ctx.restore();
    for (let i = 0; i < 4; i++) {
      const y = this.h * (.34 + i * .12) + Math.sin(this.now * (.12 + i * .03) + i) * 12;
      const fog = ctx.createLinearGradient(0, y, this.w, y);
      fog.addColorStop(0, 'rgba(100,70,130,0)');
      fog.addColorStop(.35, `rgba(105,80,135,${.025 + i * .008})`);
      fog.addColorStop(.7, 'rgba(70,50,100,.02)');
      fog.addColorStop(1, 'rgba(70,50,100,0)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, y, this.w, 28 + i * 9);
    }
    const size = Math.min(54, this.w / 9);
    const crew = this.lobby.crew ?? [];
    const titleY = crew.length ? this.h * 0.2 : this.h * 0.38;
    this.glow(C.gold, 22);
    this.text(this.lobby.title, this.w / 2, titleY, size, '#ffe9a8', 'center', 700);
    this.noGlow();
    const sub = Math.max(12, size * 0.26);
    this.wrap(this.lobby.subtitle, this.w - 40, sub).forEach((l, i) => this.text(l, this.w / 2, titleY + size * 0.85 + i * (sub + 6), sub, C.text));
    if (!crew.length) return;
    const slot = Math.min(150, (this.w - 40) / Math.max(crew.length, 2));
    const px = Math.max(3, Math.min(this.narrow ? 5 : 7, slot / (AV_W * 1.6), (this.h * 0.3) / AV_H));
    const cy = this.h * 0.58;
    crew.forEach((m, i) => {
      const x = this.w / 2 + (i - (crew.length - 1) / 2) * slot;
      const bob = Math.sin(this.now * 2.5 + i * 1.3) * px * 0.6;
      this.ctx.fillStyle = 'rgba(0, 240, 255, 0.1)';
      this.ctx.beginPath();
      this.ctx.ellipse(x, cy + (AV_H * px) / 2 + px * 1.5, AV_W * px * 0.5, px * 1.2, 0, 0, Math.PI * 2);
      this.ctx.fill();
      drawAvatar(this.ctx, buildAvatar(avatarSeed(m.handle, m.avatar)), x, cy + bob, px, { t: this.now, glow: true });
      this.text(`${m.host ? '★ ' : ''}${m.handle}`, x, cy + (AV_H * px) / 2 + px * 4 + 6, 12, m.you ? C.cyan : C.text, 'center', m.you ? 700 : 400);
    });
  }

  // ---------------------------------------------------------------- story & choices

  /** The crew stands together at the bottom left of every story scene. */
  private drawCrew(s: SceneState, baseY: number) {
    const px = this.narrow ? 2.4 : 3.2;
    s.party.forEach((m, i) => {
      const x = 24 + AV_W * px * 0.5 + i * (AV_W * px + 10);
      const bob = Math.sin(this.now * 2 + i) * 2;
      drawAvatar(this.ctx, buildAvatar(avatarSeed(m.handle, m.avatar), m.classes), x, baseY - AV_H * px * 0.5 + bob, px, { t: this.now, glow: true });
    });
  }

  private drawStory(s: SceneState) {
    this.backdrop(s.backdrop);
    const choice = s.choice;
    this.cards = [];
    if (!choice) {
      this.drawCrew(s, this.h - 16);
      return;
    }
    this.ctx.fillStyle = 'rgba(5, 4, 10, 0.5)';
    this.ctx.fillRect(0, 0, this.w, this.h);
    const titleSize = this.narrow ? 13 : 16;
    const prompt = this.wrap(choice.prompt, this.w - 40, titleSize, 700);
    prompt.forEach((l, i) => this.text(l, this.w / 2, 24 + i * (titleSize + 6), titleSize, '#ffe9a8', 'center', 700, true));
    const left = this.secondsLeft;
    if (left !== undefined) this.text(`⏱ ${Math.ceil(left)}s to vote`, this.w - 16, 22, 11, left <= 10 ? C.red : C.muted, 'right', 700, true);
    const top = 24 + prompt.length * (titleSize + 6) + 8;
    const opts = choice.options;
    const stacked = this.narrow || opts.length > 3;
    const gap = 12;
    const bottomPad = this.narrow ? 12 : 60;
    const cw = stacked ? this.w - 32 : Math.min(260, (this.w - 32 - gap * (opts.length - 1)) / opts.length);
    const ch = stacked ? Math.min(90, (this.h - top - bottomPad - gap * (opts.length - 1)) / opts.length) : Math.min(this.h - top - bottomPad, 150);
    const totalW = stacked ? cw : cw * opts.length + gap * (opts.length - 1);
    opts.forEach((o, i) => {
      const x = stacked ? 16 : (this.w - totalW) / 2 + i * (cw + gap);
      const y = stacked ? top + i * (ch + gap) : top + 4;
      this.cards.push({ index: i, x, y, w: cw, h: ch });
      this.drawCard(o, i, x, y, cw, ch, stacked, s);
    });
    if (!this.narrow) this.drawCrew(s, this.h - 10);
  }

  private drawCard(o: ChoiceOption, i: number, x: number, y: number, w: number, h: number, stacked: boolean, s: SceneState) {
    const ctx = this.ctx;
    const hot = this.hoverCard === i;
    const color = ICON_COLOR[o.icon];
    const lift = hot ? -3 : Math.sin(this.now * 1.5 + i) * 1.5;
    ctx.fillStyle = 'rgba(12, 10, 26, 0.94)';
    this.roundRect(x, y + lift, w, h, 10);
    ctx.fill();
    this.glow(color, hot ? 20 : 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = hot ? 2.5 : 1.5;
    ctx.stroke();
    this.noGlow();
    const icon = Math.min(stacked ? h * 0.6 : w * 0.3, 60);
    const ix = stacked ? x + 14 + icon / 2 : x + w / 2;
    const iy = stacked ? y + lift + h / 2 : y + lift + 16 + icon / 2;
    this.drawOptionIcon(o.icon, ix, iy, icon, color);
    const tx = stacked ? x + icon + 26 : x + w / 2;
    const align: CanvasTextAlign = stacked ? 'left' : 'center';
    const labelSize = this.narrow ? 12 : 14;
    const lines = this.wrap(o.label, stacked ? w - icon - 40 : w - 20, labelSize, 700).slice(0, 2);
    let ty = stacked ? y + lift + h * 0.3 : y + lift + icon + 34;
    for (const l of lines) {
      this.text(l, tx, ty, labelSize, C.text, align, 700);
      ty += labelSize + 4;
    }
    this.wrap(o.detail, stacked ? w - icon - 40 : w - 20, 11).slice(0, 2).forEach((l, k) => this.text(l, tx, ty + 2 + k * 14, 11, C.muted, align));
    o.votes.forEach((handle, k) => {
      const m = s.party.find((p) => p.handle === handle);
      if (!m) return;
      const vx = stacked ? x + w - 18 - k * 26 : x + w / 2 + (k - (o.votes.length - 1) / 2) * 26;
      const vy = stacked ? y + lift + h / 2 : y + lift + h - 20;
      drawAvatar(ctx, buildAvatar(avatarSeed(m.handle, m.avatar), m.classes), vx, vy, 2, { t: this.now, glow: true });
    });
  }

  private drawOptionIcon(icon: OptionIcon, x: number, y: number, size: number, color: string) {
    const ctx = this.ctx;
    const s = size / 2;
    this.glow(color, 12);
    ctx.strokeStyle = color;
    ctx.fillStyle = '#0c0a18';
    ctx.lineWidth = 2;
    ctx.beginPath();
    switch (icon) {
      case 'fight':
        ctx.moveTo(x - s * 0.7, y + s * 0.7);
        ctx.lineTo(x + s * 0.7, y - s * 0.7);
        ctx.moveTo(x + s * 0.7, y + s * 0.7);
        ctx.lineTo(x - s * 0.7, y - s * 0.7);
        ctx.moveTo(x - s * 0.4, y + s * 0.2);
        ctx.lineTo(x - s * 0.15, y + s * 0.45);
        ctx.moveTo(x + s * 0.4, y + s * 0.2);
        ctx.lineTo(x + s * 0.15, y + s * 0.45);
        break;
      case 'sneak':
        ctx.ellipse(x, y, s * 0.8, s * 0.4, 0, 0, Math.PI * 2);
        ctx.moveTo(x - s * 0.8, y - s * 0.55);
        ctx.lineTo(x + s * 0.8, y + s * 0.55);
        break;
      case 'talk':
        this.roundRect(x - s * 0.8, y - s * 0.6, s * 1.6, s * 1, 6);
        ctx.moveTo(x - s * 0.3, y + s * 0.4);
        ctx.lineTo(x - s * 0.5, y + s * 0.8);
        ctx.lineTo(x, y + s * 0.4);
        break;
      case 'help':
        ctx.moveTo(x, y + s * 0.7);
        ctx.bezierCurveTo(x - s * 1.1, y - s * 0.1, x - s * 0.4, y - s * 0.9, x, y - s * 0.3);
        ctx.bezierCurveTo(x + s * 0.4, y - s * 0.9, x + s * 1.1, y - s * 0.1, x, y + s * 0.7);
        break;
      case 'rest':
        ctx.moveTo(x, y - s * 0.8);
        ctx.quadraticCurveTo(x + s * 0.5, y, x, y + s * 0.5);
        ctx.quadraticCurveTo(x - s * 0.5, y, x, y - s * 0.8);
        ctx.moveTo(x - s * 0.5, y + s * 0.75);
        ctx.lineTo(x + s * 0.5, y + s * 0.75);
        break;
      case 'loot':
        ctx.moveTo(x, y - s * 0.8);
        ctx.lineTo(x + s * 0.6, y - s * 0.1);
        ctx.lineTo(x, y + s * 0.8);
        ctx.lineTo(x - s * 0.6, y - s * 0.1);
        ctx.closePath();
        ctx.moveTo(x - s * 0.6, y - s * 0.1);
        ctx.lineTo(x + s * 0.6, y - s * 0.1);
        break;
      case 'risk':
        ctx.moveTo(x, y - s * 0.8);
        ctx.lineTo(x + s * 0.8, y + s * 0.65);
        ctx.lineTo(x - s * 0.8, y + s * 0.65);
        ctx.closePath();
        ctx.moveTo(x, y - s * 0.25);
        ctx.lineTo(x, y + s * 0.2);
        ctx.moveTo(x, y + s * 0.38);
        ctx.lineTo(x, y + s * 0.45);
        break;
      case 'path':
        ctx.arc(x, y, s * 0.75, 0, Math.PI * 2);
        ctx.moveTo(x, y - s * 0.55);
        ctx.lineTo(x + s * 0.2, y);
        ctx.lineTo(x, y + s * 0.55);
        ctx.lineTo(x - s * 0.2, y);
        ctx.closePath();
        break;
    }
    ctx.fill();
    ctx.stroke();
    this.noGlow();
  }

  // ---------------------------------------------------------------- glyph lock

  private drawPuzzle(s: SceneState) {
    const ctx = this.ctx;
    const pz = s.puzzle!;
    this.backdrop(s.backdrop, 0.7);
    const cx = this.w / 2;
    const cy = this.h * 0.48;
    const r = Math.min(this.w, this.h) * 0.28;
    const age = this.now - this.glyphAt;
    const bad = !this.glyphOk && age < 0.5;
    const jx = bad ? (Math.random() - 0.5) * 12 : 0;
    // the lock: a ring that turns a notch with every right glyph
    this.glow(bad ? C.red : C.gold, 22);
    ctx.strokeStyle = bad ? C.red : C.gold;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx + jx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    const turn = (pz.progress / pz.length) * Math.PI * 2 + Math.sin(this.now * 0.6) * 0.03;
    for (let i = 0; i < 24; i++) {
      const a = turn + (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + jx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86);
      ctx.lineTo(cx + jx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
      ctx.stroke();
    }
    this.noGlow();
    // slots
    const slot = Math.min(56, (r * 1.6) / pz.length);
    for (let i = 0; i < pz.length; i++) {
      const x = cx + jx + (i - (pz.length - 1) / 2) * (slot + 8);
      const lit = i < pz.progress;
      const fresh = lit && i === pz.progress - 1 && this.glyphOk && age < 0.6;
      ctx.fillStyle = lit ? 'rgba(255, 184, 0, 0.18)' : 'rgba(12, 10, 26, 0.9)';
      this.roundRect(x - slot / 2, cy - slot / 2, slot, slot, 8);
      ctx.fill();
      this.glow(lit ? C.gold : C.dim, lit ? 16 + (fresh ? 20 : 0) : 0);
      ctx.strokeStyle = lit ? C.gold : C.dim;
      ctx.stroke();
      this.noGlow();
      const g = lit && pz.sequence ? pz.sequence[i] : undefined;
      if (lit) this.text(g ? GLYPH_CHAR[g] : '✓', x, cy + 2, slot * 0.5, C.gold, 'center', 700);
    }
    // tries left
    for (let i = 0; i < pz.maxMisses; i++) {
      ctx.fillStyle = i < pz.maxMisses - pz.misses ? C.green : C.red;
      ctx.beginPath();
      ctx.arc(cx + (i - (pz.maxMisses - 1) / 2) * 16, cy + r + 22, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // the Mage alone sees the order
    if (pz.sequence) {
      const label = 'only you can see this';
      const y = cy - r - 34;
      this.text(label, cx, y - 20, 11, C.violet, 'center', 400, true);
      pz.sequence.forEach((g, i) => {
        const x = cx + (i - (pz.sequence!.length - 1) / 2) * 44;
        const done = i < pz.progress;
        this.glow(C.violet, done ? 0 : 14);
        this.text(GLYPH_CHAR[g], x, y + 4, 28, done ? C.dim : C.violet, 'center', 700, true);
        this.noGlow();
      });
    } else {
      if (pz.shown) {
        this.glow(C.cyan, 18);
        this.text(`MAGE SIGNAL  ${GLYPH_CHAR[pz.shown]}`, cx, cy - r - 24, 18, C.cyan, 'center', 700, true);
        this.noGlow();
      } else this.text('the Mage can read the glyphs · the Rogue presses them', cx, cy - r - 24, 12, C.muted, 'center', 400, true);
    }
    this.drawCrew(s, this.h - 12);
  }

  // ---------------------------------------------------------------- conversations

  private drawParley(s: SceneState) {
    const p = s.parley!;
    this.backdrop(s.backdrop, 0.8);
    const color = WYRM_COLORS[s.wyrm.color];
    const size = Math.min(this.w * 0.5, this.h * 0.7);
    const x = this.w * (this.narrow ? 0.5 : 0.62);
    const y = this.h * 0.44 + Math.sin(this.now * 1.2) * 4;
    drawPortrait(this.ctx, p.npc, x, y, size, this.now, color);
    // how won-over they are
    const bw = Math.min(260, this.w * 0.6);
    const bx = this.w / 2 - bw / 2;
    const by = 16;
    const k = Math.max(0, Math.min(1, p.progress / p.goal));
    this.text(`${p.name.toUpperCase()} · won over`, this.w / 2, by, 12, '#ffe9a8', 'center', 700, true);
    this.ctx.fillStyle = 'rgba(255,255,255,0.1)';
    this.ctx.fillRect(bx, by + 12, bw, 7);
    this.glow(C.gold, 10);
    this.ctx.fillStyle = C.gold;
    this.ctx.fillRect(bx, by + 12, bw * k, 7);
    this.noGlow();
    this.text(`${p.linesLeft} line${p.linesLeft === 1 ? '' : 's'} left`, this.w / 2, by + 32, 11, C.muted, 'center', 400, true);
    this.drawCrew(s, this.h - 12);
  }

  // ---------------------------------------------------------------- fights

  /** Fights are seen from behind the crew: the monster looms at the top, the crew stands along the bottom. */
  private fightLayout(s: SceneState) {
    const boss = s.view === 'boss';
    const n = Math.max(1, s.party.length);
    const px = Math.max(2.5, Math.min(this.narrow ? 4.5 : 6.5, this.h / 72));
    const heroH = AV_H * px;
    const heroY = this.h - 26 - heroH / 2;
    const spacing = Math.min(this.w * 0.2, 150, (this.w - 80) / n);
    const heroes = s.party.map((m, i) => ({ m, x: this.w / 2 + (i - (n - 1) / 2) * spacing, y: heroY, px }));
    const size = Math.min(this.w * 0.3, this.h * (boss ? 0.24 : 0.2));
    return { heroes, heroY, heroTop: heroY - heroH / 2, fx: this.w / 2, fy: this.h * (boss ? 0.3 : 0.33), size, boss };
  }

  /** Where a crew member is standing right now, for floating scores. */
  heroSpot(handle: string): { x: number; y: number } {
    const s = this.scene;
    if (!s) return { x: this.w / 2, y: this.h / 2 };
    const i = Math.max(0, s.party.findIndex((m) => m.handle === handle));
    if (s.view === 'combat' || s.view === 'boss') {
      const h = this.fightLayout(s).heroes[i];
      if (h) return { x: h.x, y: h.y - AV_H * h.px * 0.7 };
    }
    const px = this.narrow ? 2.4 : 3.2;
    return { x: 24 + AV_W * px * 0.5 + i * (AV_W * px + 10), y: this.h - 30 - AV_H * px };
  }

  private drawFight(s: SceneState) {
    const ctx = this.ctx;
    const foe = s.foe;
    const L = this.fightLayout(s);
    const { boss, fx, fy, size, heroes } = L;
    this.backdrop(s.backdrop, 0.45);
    if (s.loadout) {
      const chosen = s.loadout.selected.length
        ? s.loadout.selected.map((item) => `${item.icon} ${item.name.toUpperCase()} · ${item.power}`).join('   ')
        : 'BASIC GEAR · CHOOSE RELICS BELOW';
      this.text('PREPARE THE CREW', this.w / 2, 20, this.narrow ? 12 : 15, C.gold, 'center', 700, true);
      this.text(chosen, this.w / 2, 42, this.narrow ? 8 : 10, C.text, 'center', 400, true);
      this.text(`${s.loadout.ready}/${s.loadout.total} JOES READY`, this.w / 2, 59, 9, C.muted, 'center', 700, true);
    }
    // a floor that runs away from the crew toward the monster
    const horizon = this.h * 0.42;
    ctx.strokeStyle = boss ? 'rgba(255, 56, 96, 0.2)' : 'rgba(255, 43, 214, 0.16)';
    ctx.lineWidth = 1;
    for (let i = -12; i <= 12; i++) {
      ctx.beginPath();
      ctx.moveTo(this.w / 2 + i * 18, horizon);
      ctx.lineTo(this.w / 2 + i * 120, this.h);
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const k = (i + ((this.now * 0.5) % 1)) / 7;
      const y = horizon + (this.h - horizon) * k * k;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }

    if (foe) {
      if (boss) this.drawWyrm(s, foe, fx, fy, size, L.heroY);
      else this.drawFoe(foe, fx, fy, size, L.heroY);
    }

    // the Ward: a shimmering wall of hexes between the crew and the monster
    const wardAge = this.now - this.wardAt;
    const blockAge = this.now - this.blockAt;
    if (wardAge < 1.4) {
      const a = Math.min(1, (1.4 - wardAge) * 2) * (blockAge < 0.3 ? 1 : 0.7);
      const y0 = L.heroTop - 34;
      this.glow(C.yellow, blockAge < 0.3 ? 30 : 14);
      ctx.strokeStyle = `rgba(255, 230, 0, ${a})`;
      ctx.lineWidth = blockAge < 0.3 ? 3 : 1.5;
      const hr = 16;
      for (let row = 0; row < 2; row++) {
        for (let x = this.w * 0.12 + (row % 2) * hr * 0.43; x < this.w * 0.88; x += hr * 0.86) {
          const y = y0 + row * hr * 0.75;
          ctx.beginPath();
          for (let i = 0; i <= 6; i++) {
            const ang = Math.PI / 6 + (i * Math.PI) / 3;
            const xx = x + Math.cos(ang) * hr * 0.5;
            const yy = y + Math.sin(ang) * hr * 0.5;
            if (i) ctx.lineTo(xx, yy);
            else ctx.moveTo(xx, yy);
          }
          ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(this.now * 6 + x * 0.05));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      this.noGlow();
    }
    // mend: soft rings rising through the crew
    if (this.now - this.mendAt < 0.05) for (const h of heroes) this.risingRings(h.x, h.y, C.green);

    const lunge = this.foeAnim && (this.foeAnim.move === 'attack' || this.foeAnim.move === 'heavy') && !this.foeAnim.blocked;
    const struck = lunge && this.now - this.foeAnim!.t0 > 0.26 && this.now - this.foeAnim!.t0 < 0.4;
    const target = fy + size * 0.6;
    for (const { m, x, y, px } of heroes) {
      const anim = this.heroAnims.get(m.handle);
      const age = anim ? this.now - anim.t0 : 99;
      let dx = Math.sin(this.now * 2 + x) * 2;
      let dy = Math.sin(this.now * 3 + x) * 3;
      const av = buildAvatar(avatarSeed(m.handle, m.avatar), m.classes);
      if (struck) {
        dx += (x < fx ? -1 : 1) * 12;
        dy += 10;
      }
      // a soft shadow grounds each hero on the floor
      ctx.fillStyle = 'rgba(0, 240, 255, 0.1)';
      ctx.beginPath();
      ctx.ellipse(x, y + AV_H * px * 0.5 + 2, AV_W * px * 0.5, px * 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
      if (anim && (anim.move === 'strike' || anim.move === 'fury') && age < 0.55) {
        const reach = target - y;
        const k = age < 0.2 ? ease(age / 0.2) : 1 - ease((age - 0.2) / 0.35);
        dy += reach * k * 0.85;
        dx += (fx - x) * k * 0.6;
        for (let t = 1; t <= 4; t++) {
          ctx.globalAlpha = 0.12 * (5 - t);
          drawAvatar(ctx, av, x + dx, y + dy + t * 14, px * (1 - k * 0.3), {});
        }
        ctx.globalAlpha = 1;
        if (age > 0.14 && age < 0.38) this.drawSlash(fx, fy, size, (age - 0.14) / 0.24, anim.move === 'fury' ? C.gold : C.red, anim.move === 'fury');
        drawAvatar(ctx, av, x + dx, y + dy, px * (1 - k * 0.3), { t: this.now, glow: true });
      } else {
        if (anim && ['hex', 'bolt', 'speak'].includes(anim.move) && age < 0.5) {
          const cast = pulse(age / 0.5);
          dx += (x < fx ? -1 : 1) * cast * 20;
          dy -= cast * 9;
          this.drawProjectile(anim.move, x, y - AV_H * px * 0.5, fx, fy, age);
        }
        if (anim && anim.move === 'mend' && age < 0.6) {
          const aid = pulse(age / 0.6);
          dx += (fx - x) * aid * .16;
          dy -= aid * 15;
        }
        if (anim && anim.move === 'ward' && age < 0.55) {
          const brace = pulse(age / 0.55);
          dx += (fx - x) * brace * .22;
          dy -= brace * 25;
        }
        drawAvatar(ctx, av, x + dx, y + dy, px, { t: this.now, glow: true, flash: !!struck });
      }
      const label = this.narrow || s.party.length > 2 ? m.handle.slice(0, 10) : `${m.handle} · ${m.classes.join('+')}`;
      this.text(label, x, y + AV_H * px * 0.5 + 12, 11, m.you ? C.cyan : C.muted, 'center', m.you ? 700 : 400, true);
      if (m.ready) this.text('✓', x + AV_W * px * 0.5 + 10, y - AV_H * px * 0.4, 15, C.green, 'center', 700, true);
    }

    if (!foe) return;
    this.drawIntent(foe, fx, fy + size * (boss ? 1.25 : 0.95), L.heroTop - 40);
    const bw = Math.min(280, this.w * 0.36);
    const by = 14;
    this.text(foe.name.toUpperCase(), fx, by, this.narrow ? 12 : 14, boss ? WYRM_COLORS[s.wyrm.color] : C.red, 'center', 700, true);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(fx - bw / 2, by + 11, bw, 7);
    this.glow(C.red, 8);
    ctx.fillStyle = C.red;
    ctx.fillRect(fx - bw / 2, by + 11, bw * (foe.hp / foe.maxHp), 7);
    this.noGlow();
    this.text(`${foe.hp}/${foe.maxHp}${foe.exposed ? ' · EXPOSED' : ''}`, fx, by + 28, 10, foe.exposed ? C.violet : C.muted, 'center', 400, true);
    this.drawTimer(fx, by + 40, bw);
    // round and wards sit in the bottom corner, out of the crew's way
    const cx = Math.max(40, (this.w - heroes.length * Math.min(this.w * 0.2, 150)) / 4);
    this.text(`ROUND ${s.round ?? 1}`, cx, this.h - 40, 11, C.muted, 'center', 700, true);
    const wards = s.wards ?? 0;
    for (let i = 0; i < Math.max(wards, 1); i++) {
      ctx.globalAlpha = wards ? 1 : 0.3;
      this.text('⬡', cx - ((Math.max(wards, 1) - 1) * 16) / 2 + i * 16, this.h - 22, 14, C.yellow, 'center', 700, true);
    }
    ctx.globalAlpha = 1;
  }

  /** The countdown to the monster's move: a draining bar that turns red and throbs at the end. */
  private drawTimer(x: number, y: number, w: number) {
    if (!this.timerEnd || !this.timerTotal) return;
    const left = Math.max(0, this.timerEnd - this.now);
    const k = Math.min(1, left / this.timerTotal);
    const urgent = left <= 5;
    const ctx = this.ctx;
    const color = urgent ? C.red : k < 0.5 ? C.gold : C.cyan;
    const throb = urgent ? 0.5 + 0.5 * Math.sin(this.now * 10) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x - w / 2, y, w, 5);
    this.glow(color, 6 + throb * 14);
    ctx.fillStyle = color;
    ctx.fillRect(x - (w * k) / 2, y, w * k, 5);
    this.noGlow();
    this.text(`⏱ ${Math.ceil(left)}s`, x, y + 16, urgent ? 13 + throb * 3 : 11, color, 'center', 700, true);
  }

  private drawSlash(x: number, y: number, size: number, k: number, color: string, big: boolean) {
    const ctx = this.ctx;
    const start = -Math.PI * 0.8;
    const sweep = Math.PI * 1.2 * ease(k);
    // a wide soft trail, then a thin hot core
    for (const [width, alpha, blur] of [[big ? 18 : 12, 0.25, 0], [big ? 6 : 4, 0.9, 24], [1.5, 1, 0]] as const) {
      ctx.globalAlpha = alpha * (1 - k * 0.6);
      if (blur) this.glow(color, blur);
      ctx.strokeStyle = width < 2 ? '#ffffff' : color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x - size * 0.1, y, size * 0.8, start + sweep * 0.25, start + sweep);
      ctx.stroke();
      this.noGlow();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  private drawProjectile(move: string, x0: number, y0: number, x1: number, y1: number, age: number) {
    const ctx = this.ctx;
    const k = Math.min(1, age / 0.18);
    const color = MOVE_COLOR[move] ?? C.cyan;
    this.glow(color, 18);
    ctx.strokeStyle = color;
    if (move === 'bolt') {
      // branching lightning with a bright core
      const zig = (ax: number, ay: number, bx: number, by: number, segs: number, spread: number, width: number) => {
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        for (let i = 1; i <= segs; i++) {
          const t = i / segs;
          ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t + (i < segs ? (Math.random() - 0.5) * spread : 0));
        }
        ctx.stroke();
      };
      const ex = x0 + (x1 - x0) * k;
      const ey = y0 + (y1 - y0) * k;
      zig(x0, y0, ex, ey, 9, 36, 3);
      ctx.strokeStyle = '#ffffff';
      zig(x0, y0, ex, ey, 9, 18, 1.2);
      ctx.strokeStyle = color;
      if (k > 0.5) zig(x0 + (ex - x0) * 0.5, y0 + (ey - y0) * 0.5, ex - 30, ey + 40, 4, 20, 1.5);
    } else if (move === 'speak') {
      const px = x0 + (x1 - x0) * ease(k);
      const py = y0 + (y1 - y0) * ease(k);
      ctx.lineWidth = 2;
      for (let r = 0; r < 3; r++) {
        ctx.globalAlpha = 1 - r * 0.3;
        ctx.beginPath();
        ctx.arc(px, py, 6 + r * 7 + ((age * 40) % 7), -0.8, 0.8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      // hex: a rune circle that flies and spins open around the target
      const px = x0 + (x1 - x0) * ease(k);
      const py = y0 + (y1 - y0) * ease(k) - Math.sin(k * Math.PI) * 40;
      const r = 8 + k * 26;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = age * 8 + (i / 6) * Math.PI * 2;
        this.text('ᚱ', px + Math.cos(a) * r, py + Math.sin(a) * r, 10, color);
      }
    }
    this.noGlow();
  }

  private drawIntent(foe: Foe, x: number, top: number, maxBottom: number) {
    const ctx = this.ctx;
    let label: string;
    let hint: string;
    let color: string;
    if (foe.intent) {
      const k = foe.intent.kind;
      color = k === 'charge' ? C.gold : k === 'shell' ? C.cyan : k === 'wail' ? C.magenta : C.red;
      label = `${{ attack: '⚔', heavy: '☠', charge: '⚡', shell: '⛨', wail: '≋' }[k]} ${foe.intent.label}`;
      hint = 'only you can see this · call it out';
    } else if (foe.called) {
      color = C.violet;
      label = `📣 ${foe.called.label.split(':')[0]}`;
      hint = `${foe.called.by} says: ${foe.called.label.split(':')[1]?.trim() ?? ''}`;
    } else {
      color = C.muted;
      label = '? ? ?';
      hint = 'only the Mage can see its next move';
    }
    const size = this.narrow ? 12 : 14;
    ctx.font = `700 ${size}px ${FONT}`;
    const lw = ctx.measureText(label).width;
    ctx.font = `400 11px ${FONT}`;
    const bw = Math.min(Math.max(lw, ctx.measureText(hint).width) + 24, this.narrow ? this.w * 0.62 : this.w * 0.5);
    const hintLines = this.wrap(hint, bw - 14, 11).slice(0, 2);
    const bh = 30 + hintLines.length * 13;
    const bx = Math.min(this.w - bw - 6, Math.max(6, x - bw / 2));
    const by = Math.max(54, Math.min(top, maxBottom - bh));
    const throb = foe.intent && (foe.intent.kind === 'charge' || foe.intent.kind === 'heavy') ? 0.5 + 0.5 * Math.sin(this.now * 8) : 0;
    ctx.fillStyle = 'rgba(10, 6, 14, 0.9)';
    this.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    this.glow(color, 8 + throb * 16);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 + throb;
    ctx.stroke();
    this.noGlow();
    this.text(label, bx + bw / 2, by + 14, size, color, 'center', 700);
    hintLines.forEach((l, i) => this.text(l, bx + bw / 2, by + 31 + i * 13, 11, C.text));
  }

  private drawFoe(foe: Foe, x: number, y: number, size: number, heroY: number) {
    const ctx = this.ctx;
    const t = this.foeClock;
    const dying = this.deathAt !== undefined ? this.now - this.deathAt : -1;
    if (dying > 0.5) return;
    const anim = this.foeAnim;
    const age = anim ? this.now - anim.t0 : 99;
    let ox = 0;
    let oy = 0;
    let scale = foe.elite ? 1.15 : 1;
    const lunging = anim && (anim.move === 'attack' || anim.move === 'heavy') && age < 0.7;
    if (lunging) {
      // it comes straight at the crew (and the camera)
      const k = pulse(age / 0.7);
      oy = k * (heroY - y) * 0.55;
      scale *= 1 + k * (anim!.move === 'heavy' ? 0.7 : 0.4);
    }
    if (anim && anim.move === 'charge' && age < 1.2) ox = (Math.random() - 0.5) * 6;
    const hitAge = this.now - this.foeHitAt;
    if (hitAge < 0.15) ox += (Math.random() - 0.5) * 12;
    const white = hitAge < 0.09;
    const color = white ? '#ffffff' : foe.elite ? '#ff1a3c' : C.red;
    const glow = (cl: string, b: number) => this.glow(cl, b);
    const noGlow = () => this.noGlow();
    // motion trail behind a lunge
    if (lunging) {
      for (let k = 1; k <= 3; k++) {
        ctx.save();
        ctx.globalAlpha = 0.12 * (4 - k);
        ctx.translate(x + ox, y + oy - k * 22);
        ctx.scale(scale, scale);
        drawMonster(ctx, foe.id, size, t, color, glow, noGlow);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(x + ox, y + oy);
    ctx.scale(scale, scale);
    if (dying >= 0) {
      ctx.globalAlpha = Math.max(0, 1 - dying / 0.5);
      ctx.scale(1 + dying * 0.6, 1 - dying);
    }
    drawMonster(ctx, foe.id, size, t, color, glow, noGlow);
    ctx.restore();
    // a hex leaves a rune circle turning around the foe
    if (foe.exposed) {
      this.glow(C.violet, 14);
      ctx.strokeStyle = 'rgba(180, 140, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x + ox, y + size * 0.6, size * 1.1, size * 0.25, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = this.now * 1.5 + (i / 8) * Math.PI * 2;
        this.text('ᚱ', x + ox + Math.cos(a) * size * 1.1, y + size * 0.6 + Math.sin(a) * size * 0.25, 11, C.violet);
      }
      this.noGlow();
    }
    if (foe.intent?.kind === 'shell') {
      this.glow(C.cyan, 16);
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.45 + 0.2 * Math.sin(this.now * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.now * 0.4;
        const px = x + ox + Math.cos(a) * size * 1.05;
        const py = y + Math.sin(a) * size * 1.05;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
      this.noGlow();
    }
    if (this.now - this.stunAt < 1.2) for (let i = 0; i < 3; i++) this.text('✦', x + ox + Math.cos(this.now * 5 + i * 2.1) * size * 0.4, y - size * 0.8 + Math.sin(this.now * 5 + i * 2.1) * 8, 14, C.violet);
  }

  private drawWyrm(s: SceneState, foe: Foe, hx0: number, hy0: number, size: number, heroY: number) {
    const ctx = this.ctx;
    const color = WYRM_COLORS[s.wyrm.color];
    const t = this.foeClock;
    const dying = this.deathAt !== undefined ? this.now - this.deathAt : -1;
    if (dying > 1.4) return;
    const anim = this.foeAnim;
    const age = anim ? this.now - anim.t0 : 99;
    const lunge = anim && (anim.move === 'attack' || anim.move === 'heavy') && age < 0.8 ? pulse(age / 0.8) : 0;
    const hitAge = this.now - this.foeHitAt;
    const hx = hx0 + Math.sin(t * 0.7) * this.w * 0.03 + (hitAge < 0.15 ? (Math.random() - 0.5) * 12 : 0);
    const hy = hy0 + Math.sin(t * 1.4) * 5 + lunge * (heroY - hy0) * 0.4;
    const r0 = size * 0.32;
    const charging = foe.intent?.kind === 'charge';
    if (dying >= 0) ctx.globalAlpha = Math.max(0, 1 - dying / 1.4);
    // the body coils up and away, out of the top of the screen
    for (let i = 24; i >= 1; i--) {
      const k = i / 24;
      const x = hx + Math.sin(k * Math.PI * 2.4 + t * 1.1) * this.w * 0.16 * Math.min(1, k * 2);
      const y = hy - r0 * 0.8 - k * (hy + r0 * 3);
      const r = r0 * (k < 0.15 ? 0.6 + k * 2.4 : 0.96 - (k - 0.15) * 0.5);
      ctx.fillStyle = '#0c0812';
      this.glow(color, 8);
      ctx.strokeStyle = hitAge < 0.09 ? '#ffffff' : color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r, y - r * 0.3);
      ctx.lineTo(x - r * 1.6, y);
      ctx.lineTo(x - r, y + r * 0.3);
      ctx.moveTo(x + r, y - r * 0.3);
      ctx.lineTo(x + r * 1.6, y);
      ctx.lineTo(x + r, y + r * 0.3);
      ctx.stroke();
    }
    // the head, jaws toward the crew
    const hs = r0 * 1.9 * (1 + lunge * 0.4);
    const jaw = 0.1 + 0.06 * Math.sin(t * 1.5) + lunge * 0.4;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#0c0812';
    this.glow(color, 18);
    ctx.strokeStyle = hitAge < 0.09 ? '#ffffff' : color;
    ctx.lineWidth = 2.5;
    for (const side of [1, -1]) {
      // upper skull and lower jaw, mirrored so the face is symmetric from the front
      ctx.save();
      ctx.scale(1, side);
      ctx.beginPath();
      ctx.moveTo(hs * 0.6, -hs * 0.45);
      ctx.quadraticCurveTo(-hs * 0.4, -hs * 0.6, -hs * 1.4, -hs * (0.08 + jaw * 0.5));
      ctx.lineTo(-hs * 1.3, 0);
      ctx.lineTo(hs * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const tx = -hs * 1.15 + i * hs * 0.2;
        ctx.moveTo(tx, -hs * jaw * 0.5);
        ctx.lineTo(tx + hs * 0.05, hs * (0.1 - jaw * 0.5));
        ctx.lineTo(tx + hs * 0.1, -hs * jaw * 0.5);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hs * 0.3, -hs * 0.48);
      ctx.quadraticCurveTo(hs * 0.8, -hs * 1.1, hs * 1.25, -hs * 1.15);
      ctx.stroke();
      const eye = charging || lunge > 0 ? C.red : color;
      this.glow(eye, 24);
      ctx.fillStyle = eye;
      ctx.beginPath();
      ctx.ellipse(-hs * 0.2, -hs * 0.3, hs * 0.16, hs * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#05040a';
      ctx.beginPath();
      ctx.ellipse(-hs * 0.2, -hs * 0.3, hs * 0.07, hs * 0.025, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0c0812';
      this.glow(color, 18);
      ctx.restore();
    }
    ctx.restore();
    this.noGlow();
    ctx.globalAlpha = 1;
    // breath curls out of the jaws, down toward the crew
    if (Math.random() < 0.6) this.particles.push({ x: hx + (Math.random() - 0.5) * hs * 0.3, y: hy + hs * 1.3, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 60, life: 0, max: 1.2, color: charging ? C.red : color, size: 2.2, gravity: -10 });
    if (foe.exposed) this.text('ᚱ ᚱ ᚱ', hx, hy - hs * 0.8, 14, C.violet, 'center', 700, true);
    if (foe.intent?.kind === 'shell') {
      this.glow(C.cyan, 16);
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.45 + 0.2 * Math.sin(this.now * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(hx, hy + hs * 0.2, hs * 1.1, hs * 1.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      this.noGlow();
    }
    if (this.now - this.stunAt < 1.2) for (let i = 0; i < 3; i++) this.text('✦', hx + Math.cos(this.now * 5 + i * 2.1) * hs * 0.5, hy - hs * 0.9, 16, C.violet);
  }

  // ---------------------------------------------------------------- endings & overlays

  private drawEnd(s: SceneState) {
    const e = s.ending;
    if (!e) return this.backdrop('city');
    const ctx = this.ctx;
    this.sky();
    if (e.win) {
      const g = ctx.createLinearGradient(0, this.h, 0, this.h * 0.2);
      g.addColorStop(0, 'rgba(255, 170, 60, 0.45)');
      g.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawCity(1, 1);
      if (Math.random() < 0.25) this.sparks(Math.random() * this.w, this.h * 0.3, Math.random() < 0.5 ? C.gold : C.cyan, 6);
    } else this.drawCity(1, 0.05);
    const color = e.win ? '#ffe9a8' : C.red;
    const size = Math.min(48, this.w / 10);
    this.glow(e.win ? C.gold : C.red, 24);
    this.text(e.title.toUpperCase(), this.w / 2, this.h * 0.24, size, color, 'center', 700, true);
    this.noGlow();
    this.drawCrew(s, this.h - 12);
  }

  private drawTitle() {
    const tc = this.title!;
    const age = this.now - tc.t0;
    if (age > 3.4) {
      this.title = undefined;
      return;
    }
    const a = age < 0.5 ? age / 0.5 : age > 2.6 ? Math.max(0, 1 - (age - 2.6) / 0.8) : 1;
    const ctx = this.ctx;
    ctx.globalAlpha = a * 0.75;
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, this.h * 0.32, this.w, this.h * 0.3);
    ctx.globalAlpha = a;
    // monospace glyphs are ~0.6em wide: shrink long titles to fit a phone
    const size = Math.min(34, this.w / 14, (this.w - 24) / (tc.text.length * 0.62));
    const shown = tc.text.slice(0, Math.floor(age * 30));
    this.glow(C.gold, 20);
    this.text(shown, this.w / 2, this.h * 0.44, size, '#ffe9a8', 'center', 700);
    this.noGlow();
    this.text(tc.sub, this.w / 2, this.h * 0.44 + size, 12, C.muted);
    ctx.strokeStyle = `rgba(255, 184, 0, ${a * 0.6})`;
    const lw = Math.min(this.w * 0.5, 320) * ease(age * 1.5);
    ctx.beginPath();
    ctx.moveTo(this.w / 2 - lw, this.h * 0.44 + size * 0.6);
    ctx.lineTo(this.w / 2 + lw, this.h * 0.44 + size * 0.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawRings() {
    const ctx = this.ctx;
    for (const r of this.rings) {
      const age = this.now - r.t0;
      const k = age / 0.5;
      if (k > 1) continue;
      ctx.globalAlpha = 1 - k;
      this.glow(r.color, 14);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.max * ease(k), 0, Math.PI * 2);
      ctx.stroke();
      this.noGlow();
    }
    ctx.globalAlpha = 1;
    this.rings = this.rings.filter((r) => this.now - r.t0 < 0.5);
  }

  private drawParticles(dt: number) {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.97;
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      if (p.streak) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  }

  private drawFloaters() {
    for (const f of this.floaters) {
      const age = this.now - f.t0;
      if (age < 0) continue;
      const life = f.small ? 1.6 : 1.2;
      const pop = 1 + Math.max(0, 0.45 - age * 2.5);
      this.ctx.globalAlpha = Math.max(0, 1 - age / life);
      this.glow(f.color, f.small ? 6 : 10);
      this.text(f.text, f.x, f.y - age * (f.small ? 22 : 36), (f.big ? 22 : f.small ? 11 : 15) * pop, f.color, 'center', 700, true);
      this.noGlow();
    }
    this.ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => this.now - f.t0 < (f.small ? 1.6 : 1.2));
  }
}
