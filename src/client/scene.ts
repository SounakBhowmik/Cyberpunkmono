import type { Foe, Fx, HudMember, Intent, RouteKind, SceneState, WyrmColor } from '../shared/protocol';
import { AV_H, AV_W, avatarSeed, buildAvatar, drawAvatar } from './avatar';

// The scene window: everything is drawn procedurally on one canvas, so there
// are no image assets. Views: the city (lobby), the descent (route choices),
// fights against horrors, and the Devourer itself.

const C = {
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  yellow: '#ffe600',
  green: '#39ff88',
  red: '#ff3860',
  blood: '#c4122f',
  bone: '#e8e2d0',
  gold: '#ffb800',
  dim: '#3a3f5c',
  text: '#d7e3ff',
  muted: '#7a7f9a',
};

const WYRM_COLORS: Record<WyrmColor, string> = { red: '#ff5a3c', blue: '#4da3ff', green: '#3dff8f', black: '#9d8cff', white: '#dff4ff' };
const MOVE_COLOR: Record<string, string> = { strike: C.red, fury: C.red, hex: C.cyan, bolt: C.cyan, ward: C.yellow, mend: C.green, speak: C.magenta };
const FONT = '"JetBrains Mono", Menlo, Consolas, monospace';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; gravity: number }
interface Floater { text: string; x: number; y: number; t0: number; color: string; big?: boolean }
interface Building { x: number; w: number; h: number; windows: number[]; sign?: string }
interface ChatPop { handle: string; avatar: number; classes: string[]; text: string; t0: number }
interface HeroAnim { move: string; t0: number; amount?: number }
type Overlay = { kind: 'intro'; t0: number; wyrm: string; title: string; color: string } | { kind: 'end'; t0: number; win: boolean };

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
  private chats: ChatPop[] = [];
  private shakeUntil = 0;
  private shakeMag = 8;
  private flash = { color: C.red, until: 0, dur: 1 };
  private heroAnims = new Map<string, HeroAnim>();
  private foeAnim?: { move: string; t0: number; blocked: boolean };
  private foeHitAt = -10;
  private stunAt = -10;
  private wardAt = -10;
  private mendAt = -10;
  private deathAt?: number;
  private linger?: { scene: SceneState; until: number };
  private overlay?: Overlay;
  private cards: { index: number; x: number; y: number; w: number; h: number }[] = [];
  private hoverCard = -1;
  private city: Building[] = [];
  private motes: { x: number; y: number; s: number; r: number }[] = [];
  private blinkOut = 0;
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
    if (prev?.foe && !scene.foe && this.deathAt !== undefined) this.linger = { scene: prev, until: this.now + 1.5 };
    if (scene.foe && (!prev?.foe || prev.foe.name !== scene.foe.name)) {
      this.deathAt = undefined;
      this.foeAnim = undefined;
    }
    this.scene = scene;
  }

  setLobby(lobby: Lobby) {
    this.lobby = lobby;
    this.scene = undefined;
    if (this.overlay?.kind === 'end' && this.now - this.overlay.t0 > 4) this.overlay = undefined;
  }

  chat(member: Pick<HudMember, 'handle' | 'avatar' | 'classes'>, text: string) {
    this.chats.push({ handle: member.handle, avatar: member.avatar, classes: member.classes, text, t0: this.now });
    if (this.chats.length > 2) this.chats.shift();
  }

  playFx(fx: Fx) {
    const foeX = this.w * 0.72;
    const foeY = this.h * 0.52;
    switch (fx.kind) {
      case 'intro':
        this.overlay = { kind: 'intro', t0: this.now, wyrm: fx.wyrm.name, title: fx.wyrm.title, color: WYRM_COLORS[fx.wyrm.color] };
        break;
      case 'enter':
        this.flashScreen('#000000', 0.5);
        break;
      case 'act':
        this.heroAnims.set(fx.by, { move: fx.move, t0: this.now, amount: fx.amount });
        if (fx.move === 'ward') this.wardAt = this.now;
        if (fx.move === 'mend') {
          this.mendAt = this.now;
          if (fx.amount) this.float(`-${fx.amount}%`, this.w * 0.2, this.h * 0.3, C.green, true);
        }
        if (fx.amount && ['strike', 'fury', 'hex', 'bolt', 'speak'].includes(fx.move)) {
          const delay = fx.move === 'strike' || fx.move === 'fury' ? 0.22 : 0.18;
          setTimeout(() => {
            this.foeHitAt = this.now;
            this.float(`-${fx.amount}`, foeX + (Math.random() - 0.5) * 40, this.h * 0.28, fx.move === 'fury' ? C.gold : MOVE_COLOR[fx.move] ?? C.yellow, true);
            this.burst(foeX, foeY, MOVE_COLOR[fx.move] ?? C.yellow, fx.move === 'fury' ? 40 : 18);
            if (fx.move === 'fury') this.shake(0.25, 10);
          }, delay * 1000);
        }
        break;
      case 'foe':
        this.foeAnim = { move: fx.move, t0: this.now, blocked: fx.blocked };
        if (fx.move === 'attack' || fx.move === 'heavy') {
          setTimeout(() => {
            if (fx.blocked) {
              this.wardAt = this.now;
              this.float('BLOCKED', this.w * 0.24, this.h * 0.25, C.yellow, true);
              this.burst(this.w * 0.3, this.h * 0.5, C.yellow, 30);
            } else {
              this.shake(fx.move === 'heavy' ? 0.6 : 0.35, fx.move === 'heavy' ? 16 : 9);
              this.flashScreen(C.blood, fx.move === 'heavy' ? 0.7 : 0.4);
              this.float(`+${fx.amount}% corruption`, this.w * 0.22, this.h * 0.32, C.red, true);
            }
          }, 260);
        } else if (fx.move === 'wail') {
          this.flashScreen('#6b2bd6', 0.6);
          this.float(`+${fx.amount}% corruption`, this.w * 0.22, this.h * 0.32, C.magenta, true);
        } else if (fx.move === 'charge') {
          this.float('CHARGING', foeX, this.h * 0.2, C.red, true);
        }
        break;
      case 'stun':
        this.stunAt = this.now;
        this.float('INTERRUPTED', foeX, this.h * 0.2, C.cyan, true);
        break;
      case 'heal':
        this.flashScreen(C.green, 0.4);
        this.float(`-${fx.amount}% corruption`, this.w / 2, this.h * 0.4, C.green, true);
        this.burst(this.w / 2, this.h * 0.5, C.green, 40);
        break;
      case 'slay':
        this.deathAt = this.now;
        this.burst(foeX, foeY, C.blood, fx.boss ? 200 : 90);
        this.burst(foeX, foeY, C.bone, fx.boss ? 120 : 40);
        this.shake(fx.boss ? 1.2 : 0.4, fx.boss ? 18 : 8);
        break;
      case 'relic':
        this.float(`✦ ${fx.name}`, this.w / 2, this.h * 0.35, C.magenta, true);
        this.burst(this.w / 2, this.h * 0.45, C.magenta, 40);
        break;
      case 'vote':
        break;
      case 'end':
        this.overlay = { kind: 'end', t0: this.now, win: fx.win };
        break;
    }
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
    if (this.scene?.view !== 'route') return;
    const card = this.cardAt(e);
    if (card) this.onOptionClick(card.index);
  }

  private hover(e: MouseEvent) {
    const card = this.scene?.view === 'route' ? this.cardAt(e) : undefined;
    this.hoverCard = card?.index ?? -1;
    this.canvas.style.cursor = card ? 'pointer' : 'default';
  }

  // ---------------------------------------------------------------- effects helpers

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

  private burst(x: number, y: number, color: string, n: number, gravity = 160) {
    if (this.reduced) n = Math.min(n, 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 260;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.5 + Math.random() * 0.9, color, size: 1.5 + Math.random() * 3, gravity });
    }
  }

  // ---------------------------------------------------------------- loop

  private frame = (ms: number) => {
    const t = ms / 1000;
    const dt = Math.min(0.05, t - (this.now || t));
    this.now = t;
    const ctx = this.ctx;
    ctx.save();
    if (this.now < this.shakeUntil) {
      const k = Math.min(1, (this.shakeUntil - this.now) * 3);
      ctx.translate((Math.random() - 0.5) * this.shakeMag * k, (Math.random() - 0.5) * this.shakeMag * 0.8 * k);
    }
    const s = this.scene;
    if (!s) this.drawLobby();
    else if (this.linger && this.now < this.linger.until) this.drawFight(this.linger.scene);
    else {
      this.linger = undefined;
      if (s.view === 'route') this.drawRoute(s);
      else this.drawFight(s);
    }
    if (s) this.drawCorruption(s.corruption);
    this.drawParticles(dt);
    this.drawFloaters();
    this.drawChats();
    if (this.overlay) this.drawOverlay();
    ctx.restore();
    if (this.now < this.flash.until) {
      ctx.globalAlpha = ((this.flash.until - this.now) / this.flash.dur) * 0.32;
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

  private text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 400) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < this.h; y += 3) ctx.fillRect(0, y, this.w, 1);
  }

  /** Dark veins creep in from the edges as corruption rises: the stakes, felt. */
  private drawCorruption(corruption: number) {
    if (corruption <= 0) return;
    const ctx = this.ctx;
    const k = Math.min(1, corruption / 100);
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * (0.75 - k * 0.4), this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, 'rgba(40, 0, 30, 0)');
    g.addColorStop(1, `rgba(60, 0, 40, ${0.25 + k * 0.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    // veins
    ctx.strokeStyle = `rgba(150, 20, 90, ${0.2 + k * 0.5})`;
    ctx.lineWidth = 1.5;
    const n = Math.floor(4 + k * 14);
    for (let i = 0; i < n; i++) {
      const side = i % 4;
      const along = ((i * 0.618) % 1) * (side % 2 ? this.h : this.w);
      let x = side === 0 ? along : side === 1 ? this.w : side === 2 ? along : 0;
      let y = side === 0 ? 0 : side === 1 ? along : side === 2 ? this.h : along;
      const inward = side === 0 ? [0, 1] : side === 1 ? [-1, 0] : side === 2 ? [0, -1] : [1, 0];
      ctx.beginPath();
      ctx.moveTo(x, y);
      const len = 30 + k * 120;
      for (let s = 0; s < 6; s++) {
        x += inward[0]! * (len / 6) + Math.sin(i * 7 + s * 2.1 + this.now * 0.6) * 9;
        y += inward[1]! * (len / 6) + Math.cos(i * 5 + s * 1.7 + this.now * 0.6) * 9;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- city & lobby

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

  private drawSky() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0b0717');
    g.addColorStop(1, '#05040a');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.w + 40, this.h + 40);
  }

  /** windowsLit: 1 = a living city, 0 = every light out. */
  private drawCity(alpha = 1, windowsLit = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    const base = this.h;
    for (const b of this.city) {
      ctx.fillStyle = '#0d0a1c';
      ctx.fillRect(b.x, base - b.h, b.w, b.h);
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.15)';
      ctx.strokeRect(b.x + 0.5, base - b.h + 0.5, b.w - 1, b.h - 1);
      const cols = Math.max(1, Math.floor(b.w / 9));
      const rows = Math.floor(b.h / 12);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const seed = b.windows[(r * cols + col) % b.windows.length]!;
          if (seed < 0.62 || seed > 0.62 + 0.38 * windowsLit) continue;
          if (Math.sin(this.now * 0.5 + seed * 40) < -0.85) continue;
          ctx.fillStyle = seed > 0.9 ? 'rgba(255, 230, 0, 0.55)' : 'rgba(0, 240, 255, 0.35)';
          ctx.fillRect(b.x + 3 + col * 9, base - b.h + 5 + r * 12, 4, 5);
        }
      }
      if (b.sign && windowsLit > 0.5 && Math.sin(this.now * 3 + b.x) > -0.6) {
        this.glow(b.sign, 12);
        ctx.fillStyle = b.sign;
        ctx.fillRect(b.x + b.w * 0.2, base - b.h + 14, b.w * 0.6, 4);
        this.noGlow();
      }
    }
    ctx.globalAlpha = alpha;
    // drifting motes of light instead of rain
    for (const m of this.motes) {
      m.y -= m.s * 0.016;
      if (m.y < -5) {
        m.y = this.h + 5;
        m.x = Math.random() * this.w;
      }
      ctx.fillStyle = `rgba(255, 220, 150, ${0.25 * alpha})`;
      ctx.beginPath();
      ctx.arc(m.x + Math.sin(this.now + m.s) * 6, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawLobby() {
    this.drawSky();
    this.drawCity(0.9);
    const size = Math.min(54, this.w / 9);
    const crew = this.lobby.crew ?? [];
    const titleY = crew.length ? this.h * 0.17 : this.h * 0.3;
    this.glow(C.gold, 22);
    this.text(this.lobby.title, this.w / 2, titleY, size, '#ffe9a8', 'center', 700);
    this.noGlow();
    const sub = Math.max(12, size * 0.26);
    this.wrap(this.lobby.subtitle, this.w - 40, sub).forEach((l, i) => this.text(l, this.w / 2, titleY + size * 0.85 + i * (sub + 6), sub, C.text));
    if (!crew.length) return;
    const slot = Math.min(150, (this.w - 40) / Math.max(crew.length, 2));
    const px = Math.max(3, Math.min(this.narrow ? 5 : 7, slot / (AV_W * 1.6), (this.h * 0.32) / AV_H));
    const cy = this.h * (this.narrow ? 0.54 : 0.6);
    crew.forEach((m, i) => {
      const x = this.w / 2 + (i - (crew.length - 1) / 2) * slot;
      const bob = Math.sin(this.now * 2.5 + i * 1.3) * px * 0.6;
      this.ctx.fillStyle = 'rgba(255, 200, 100, 0.12)';
      this.ctx.beginPath();
      this.ctx.ellipse(x, cy + (AV_H * px) / 2 + px * 1.5, AV_W * px * 0.5, px * 1.2, 0, 0, Math.PI * 2);
      this.ctx.fill();
      drawAvatar(this.ctx, buildAvatar(avatarSeed(m.handle, m.avatar)), x, cy + bob, px, { t: this.now, glow: true });
      this.text(`${m.host ? '★ ' : ''}${m.handle}`, x, cy + (AV_H * px) / 2 + px * 4 + 6, 12, m.you ? C.cyan : C.text, 'center', m.you ? 700 : 400);
    });
  }

  // ---------------------------------------------------------------- the descent

  private drawRoute(s: SceneState) {
    const ctx = this.ctx;
    this.drawSky();
    // a shaft falling away beneath you
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
    for (let i = 0; i < 14; i++) {
      const y = ((i / 14 + this.now * 0.05) % 1) * this.h;
      ctx.beginPath();
      ctx.moveTo(this.w * 0.5 - y * 0.6, y);
      ctx.lineTo(this.w * 0.5 + y * 0.6, y);
      ctx.stroke();
    }
    for (const m of this.motes) {
      m.y -= m.s * 0.03;
      if (m.y < -5) m.y = this.h + 5;
      ctx.fillStyle = 'rgba(255, 220, 150, 0.25)';
      ctx.fillRect(m.x, m.y, m.r * 1.4, m.r * 1.4);
    }

    // the depth gauge: floors passed, and the wyrm waiting at the bottom
    const gx = this.narrow ? 16 : 30;
    const top = 30;
    const bottom = this.h - 30;
    const step = (bottom - top) / (s.floors - 1);
    ctx.strokeStyle = 'rgba(215, 227, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, bottom);
    ctx.stroke();
    for (let f = 1; f <= s.floors; f++) {
      const y = top + (f - 1) * step;
      const done = f < s.floor;
      const here = f === s.floor;
      const kind = s.path[f - 1];
      const color = f === s.floors ? WYRM_COLORS[s.wyrm.color] : here ? C.gold : done ? C.cyan : C.dim;
      this.glow(color, here ? 14 : 0);
      ctx.fillStyle = here ? color : '#07060d';
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(gx, y, here ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.noGlow();
      if (done && kind && !this.narrow) this.text(ROUTE_GLYPH[kind], gx + 16, y, 11, C.muted, 'left');
    }
    if (!this.narrow) this.text('☠', gx + 16, bottom, 12, WYRM_COLORS[s.wyrm.color], 'left');

    // the choice cards
    const opts = s.options ?? [];
    const left = this.narrow ? 40 : 90;
    const avail = this.w - left - 20;
    const titleY = 26;
    this.text(s.floor === s.floors ? 'THE BOTTOM' : `FLOOR ${s.floor} · CHOOSE THE WAY DOWN`, left + avail / 2, titleY, this.narrow ? 13 : 15, C.gold, 'center', 700);
    this.cards = [];
    const stacked = this.narrow && opts.length > 1;
    const gap = 16;
    const cw = stacked ? avail : Math.min(300, (avail - gap * (opts.length - 1)) / Math.max(1, opts.length));
    const ch = stacked ? (this.h - 70 - gap) / 2 : Math.min(this.h - 80, 260);
    const totalW = stacked ? cw : cw * opts.length + gap * (opts.length - 1);
    opts.forEach((o, i) => {
      const x = stacked ? left : left + (avail - totalW) / 2 + i * (cw + gap);
      const y = stacked ? 48 + i * (ch + gap) : 50 + (this.h - 80 - ch) / 2;
      this.cards.push({ index: i, x, y, w: cw, h: ch });
      const hot = this.hoverCard === i;
      const color = ROUTE_COLOR[o.kind];
      const lift = hot ? -4 : Math.sin(this.now * 1.5 + i) * 2;
      ctx.fillStyle = 'rgba(12, 10, 26, 0.92)';
      this.roundRect(x, y + lift, cw, ch, 10);
      ctx.fill();
      this.glow(color, hot ? 22 : 10);
      ctx.strokeStyle = color;
      ctx.lineWidth = hot ? 2.5 : 1.5;
      ctx.stroke();
      this.noGlow();
      const icon = Math.min(cw, ch) * (stacked ? 0.38 : 0.32);
      const iconX = stacked ? x + icon * 0.8 : x + cw / 2;
      const iconY = stacked ? y + lift + ch / 2 : y + lift + ch * 0.32;
      if (o.foe) this.drawMiniHorror(o.foe, iconX, iconY + icon * 0.1, icon * 0.55, o.kind === 'elite');
      else this.drawRouteIcon(o.kind, iconX, iconY, icon, color);
      const tx = stacked ? x + icon * 1.7 : x + cw / 2;
      const align: CanvasTextAlign = stacked ? 'left' : 'center';
      const ty = stacked ? y + lift + ch * 0.32 : y + lift + ch * 0.64;
      this.text(`${i + 1}. ${o.label}`, tx, ty, this.narrow ? 13 : 15, C.text, align, 700);
      const detail = this.wrap(o.detail, (stacked ? cw - icon * 1.9 : cw - 24), 11);
      detail.slice(0, 2).forEach((l, k) => this.text(l, tx, ty + 20 + k * 15, 11, C.muted, align));
      // who voted for it
      const vy = stacked ? y + lift + ch - 22 : y + lift + ch - 24;
      o.votes.forEach((h, k) => {
        const member = s.party.find((m) => m.handle === h);
        if (member) drawAvatar(ctx, buildAvatar(avatarSeed(member.handle, member.avatar), member.classes), (stacked ? tx + 12 : x + cw / 2 - ((o.votes.length - 1) * 30) / 2) + k * 30, vy, 2.2, { t: this.now, glow: true });
      });
      if (!o.votes.length) this.text(this.narrow ? 'tap to vote' : 'click to vote', stacked ? tx : x + cw / 2, vy, 10, C.dim, align);
    });
  }

  private drawRouteIcon(kind: RouteKind, x: number, y: number, size: number, color: string) {
    const ctx = this.ctx;
    const s = size / 2;
    this.glow(color, 14);
    ctx.strokeStyle = color;
    ctx.fillStyle = '#0c0a18';
    ctx.lineWidth = 2;
    switch (kind) {
      case 'fight':
      case 'elite': {
        // a gaunt face with hollow eyes
        ctx.beginPath();
        ctx.ellipse(x, y, s * 0.6, s * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        for (const dx of [-0.25, 0.25]) {
          ctx.beginPath();
          ctx.ellipse(x + dx * s, y - s * 0.15, s * 0.14, s * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(x - s * 0.25, y + s * 0.4);
        ctx.quadraticCurveTo(x, y + s * (0.5 + 0.08 * Math.sin(this.now * 3)), x + s * 0.25, y + s * 0.4);
        ctx.stroke();
        if (kind === 'elite') {
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const px = x - s * 0.5 + i * s * 0.25;
            ctx.moveTo(px, y - s * 0.8);
            ctx.lineTo(px + s * 0.12, y - s * 1.2);
            ctx.lineTo(px + s * 0.25, y - s * 0.8);
          }
          ctx.stroke();
        }
        break;
      }
      case 'shrine': {
        // a torii gate with a soft light inside
        ctx.fillStyle = `rgba(57, 255, 136, ${0.12 + 0.08 * Math.sin(this.now * 2)})`;
        ctx.fillRect(x - s * 0.5, y - s * 0.4, s, s * 1.2);
        ctx.beginPath();
        ctx.moveTo(x - s * 0.9, y - s * 0.7);
        ctx.quadraticCurveTo(x, y - s * 0.85, x + s * 0.9, y - s * 0.7);
        ctx.moveTo(x - s * 0.7, y - s * 0.45);
        ctx.lineTo(x + s * 0.7, y - s * 0.45);
        ctx.moveTo(x - s * 0.55, y - s * 0.75);
        ctx.lineTo(x - s * 0.55, y + s * 0.85);
        ctx.moveTo(x + s * 0.55, y - s * 0.75);
        ctx.lineTo(x + s * 0.55, y + s * 0.85);
        ctx.stroke();
        break;
      }
      case 'cache': {
        // a spinning relic gem
        const spin = Math.sin(this.now * 2) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y - s * 0.8);
        ctx.lineTo(x + s * 0.6 * (0.4 + spin * 0.6), y - s * 0.1);
        ctx.lineTo(x, y + s * 0.8);
        ctx.lineTo(x - s * 0.6 * (0.4 + spin * 0.6), y - s * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - s * 0.6 * (0.4 + spin * 0.6), y - s * 0.1);
        ctx.lineTo(x + s * 0.6 * (0.4 + spin * 0.6), y - s * 0.1);
        ctx.stroke();
        break;
      }
      case 'boss': {
        // the wyrm's slit eye
        ctx.beginPath();
        ctx.ellipse(x, y, s * 0.9, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y, s * 0.08 + s * 0.04 * Math.sin(this.now * 2), s * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    this.noGlow();
  }

  /** A small, still-twitching portrait of the horror behind a door. */
  private drawMiniHorror(id: string, x: number, y: number, size: number, elite: boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    if (elite) this.glow(C.blood, 30);
    const body = '#0a0608';
    const accent = elite ? '#ff1a3c' : C.blood;
    switch (id) {
      case 'crimson': drawCrimson(ctx, size, this.now, body, accent, C.bone); break;
      case 'crawler': drawCrawler(ctx, size, this.now, body, accent, C.bone); break;
      case 'stalker': drawStalker(ctx, size, this.now, body, accent, C.bone, 0); break;
      default: drawWretch(ctx, size, this.now, body, accent, C.bone); break;
    }
    this.noGlow();
    ctx.restore();
  }

  // ---------------------------------------------------------------- fights

  private heroPositions(s: SceneState) {
    const n = s.party.length;
    const cols = n > 2 ? 2 : 1;
    const rows = Math.ceil(n / cols);
    const px = Math.max(2.5, Math.min(this.narrow ? 3.5 : 6, this.h / 75, (this.h * 0.6) / (rows * AV_H * 1.35)));
    return s.party.map((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.w * (cols === 1 ? 0.15 : 0.1 + col * (this.narrow ? 0.17 : 0.12));
      const y = this.h * (rows === 1 ? 0.55 : 0.36 + (row / (rows - 1)) * 0.36) + (col ? this.h * 0.06 : 0);
      return { m, x, y, px };
    });
  }

  private drawFight(s: SceneState) {
    const ctx = this.ctx;
    const boss = s.view === 'boss';
    const foe = s.foe;
    // a corridor lit by a dying fluorescent tube
    ctx.fillStyle = boss ? '#07030a' : '#08060c';
    ctx.fillRect(-20, -20, this.w + 40, this.h + 40);
    const tubeOn = boss || Math.sin(this.now * 23) > -0.92 && !(Math.sin(this.now * 1.3) > 0.97);
    if (tubeOn) {
      const lg = ctx.createRadialGradient(this.w * 0.55, 0, 10, this.w * 0.55, 0, this.h * 0.9);
      lg.addColorStop(0, boss ? 'rgba(120, 30, 60, 0.35)' : 'rgba(170, 200, 255, 0.16)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, this.w, this.h);
      if (!boss) {
        ctx.fillStyle = 'rgba(220, 235, 255, 0.7)';
        ctx.fillRect(this.w * 0.45, 6, this.w * 0.2, 3);
      }
    }
    // floor
    const horizon = this.h * 0.66;
    ctx.strokeStyle = boss ? 'rgba(196, 18, 47, 0.28)' : 'rgba(196, 18, 47, 0.18)';
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(this.w / 2 + i * 24, horizon);
      ctx.lineTo(this.w / 2 + i * 150, this.h);
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const k = (i + ((this.now * 0.3) % 1)) / 7;
      const y = horizon + (this.h - horizon) * k * k;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }

    const heroes = this.heroPositions(s);
    const fx = this.w * 0.72;
    const fy = this.h * (boss ? 0.48 : 0.52);
    const size = Math.min(this.w, this.h) * (boss ? 0.3 : 0.25);

    // the foe (behind the heroes' attack effects)
    if (foe) {
      if (boss) this.drawWyrm(s, foe, fx, fy, size);
      else this.drawHorror(foe, fx, fy, size);
    }

    // ward dome over the crew
    const wardAge = this.now - this.wardAt;
    if (wardAge < 0.9) {
      const a = 1 - wardAge / 0.9;
      const cx = this.w * (this.narrow ? 0.2 : 0.17);
      this.glow(C.yellow, 20);
      ctx.strokeStyle = `rgba(255, 230, 0, ${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, this.h * 0.56, this.w * 0.14 * (0.8 + ease(wardAge * 4) * 0.2), this.h * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 230, 0, ${a * 0.08})`;
      ctx.fill();
      this.noGlow();
    }
    // mend motes rising over the crew
    const mendAge = this.now - this.mendAt;
    if (mendAge < 0.2 && Math.random() < 0.9) {
      for (const hpos of heroes) this.particles.push({ x: hpos.x + (Math.random() - 0.5) * 30, y: hpos.y + 20, vx: 0, vy: -60 - Math.random() * 40, life: 0, max: 1, color: C.green, size: 2.5, gravity: 0 });
    }

    // heroes, with their action animations
    const hitFlash = this.foeAnim && (this.foeAnim.move === 'attack' || this.foeAnim.move === 'heavy' || this.foeAnim.move === 'wail') && !this.foeAnim.blocked && this.now - this.foeAnim.t0 > 0.26 && this.now - this.foeAnim.t0 < 0.42;
    for (const { m, x, y, px } of heroes) {
      const anim = this.heroAnims.get(m.handle);
      const age = anim ? this.now - anim.t0 : 99;
      let dx = 0;
      let dy = Math.sin(this.now * 3 + x) * 3;
      if (anim && (anim.move === 'strike' || anim.move === 'fury') && age < 0.55) {
        // dash in, slash, dash back
        const reach = fx - x - size * 0.6;
        dx = reach * (age < 0.22 ? ease(age / 0.22) : 1 - ease((age - 0.22) / 0.33));
        dy -= pulse(age / 0.55) * 20;
        // after-images
        for (let k = 1; k <= 3; k++) {
          ctx.globalAlpha = 0.15 * (4 - k);
          drawAvatar(ctx, buildAvatar(avatarSeed(m.handle, m.avatar), m.classes), x + dx - k * 14, y + dy, px, {});
        }
        ctx.globalAlpha = 1;
        if (age > 0.16 && age < 0.36) this.drawSlash(fx, fy, size, (age - 0.16) / 0.2, anim.move === 'fury' ? C.gold : C.red);
      }
      if (anim && (anim.move === 'hex' || anim.move === 'bolt' || anim.move === 'speak') && age < 0.5) {
        dx = -pulse(age / 0.3) * 8;
        this.drawProjectile(anim.move, x, y, fx, fy, age);
      }
      if (anim && anim.move === 'mend' && age < 0.6) dy -= pulse(age / 0.6) * 14;
      const glowRing = anim && age < 0.6 ? MOVE_COLOR[anim.move] : undefined;
      if (glowRing) {
        ctx.fillStyle = glowRing;
        ctx.globalAlpha = 0.18 * (1 - age / 0.6);
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, AV_W * px * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawAvatar(ctx, buildAvatar(avatarSeed(m.handle, m.avatar), m.classes), x + dx, y + dy, px, { t: this.now, glow: true, flash: !!hitFlash });
      const label = this.narrow || s.party.length > 2 ? m.handle.slice(0, 10) : `${m.handle} · ${m.classes.join('+')}`;
      this.text(label, x, y + AV_H * px * 0.5 + 12, 11, m.you ? C.cyan : C.muted);
      if (m.ready) this.text('✓', x + AV_W * px * 0.5 + 10, y - AV_H * px * 0.4, 15, C.green, 'center', 700);
    }

    if (!foe) return;
    // intent badge: what it will do next
    this.drawIntent(foe.intent, fx, fy - size * (boss ? 0.95 : 1.05), foe);
    // name, HP
    const bw = Math.min(260, this.w * 0.34);
    const by = 16;
    this.text(foe.name.toUpperCase(), fx, by, this.narrow ? 12 : 14, boss ? WYRM_COLORS[s.wyrm.color] : C.red, 'center', 700);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(fx - bw / 2, by + 12, bw, 7);
    this.glow(C.red, 8);
    ctx.fillStyle = C.red;
    ctx.fillRect(fx - bw / 2, by + 12, bw * (foe.hp / foe.maxHp), 7);
    this.noGlow();
    this.text(`${foe.hp}/${foe.maxHp}${foe.exposed ? ' · EXPOSED' : ''}`, fx, by + 30, 10, foe.exposed ? C.cyan : C.muted);
    if (s.round) this.text(`ROUND ${s.round}`, this.w * 0.15, 16, 11, C.muted, 'center', 700);

    if (boss) this.drawParley(s);
    else if (s.floor <= 2 && s.round !== undefined && s.round <= 3) {
      const tip = this.narrow ? 'read its next move · Ward blocks · Hex + Strike = ×2' : 'read its next move above its head · Ward blocks attacks · Hex interrupts charges and makes Strike hit ×2 · Bolt pierces shells';
      this.wrap(tip, this.w - 40, 11).forEach((l, i, arr) => this.text(l, this.w / 2, this.h - 12 - (arr.length - 1 - i) * 14, 11, 'rgba(255, 233, 168, 0.85)'));
    }
  }

  private drawSlash(x: number, y: number, size: number, k: number, color: string) {
    const ctx = this.ctx;
    this.glow(color, 20);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(x - size * 0.1, y, size * 0.7, -Math.PI * 0.75, -Math.PI * 0.75 + Math.PI * 1.1 * ease(k));
    ctx.stroke();
    this.noGlow();
  }

  private drawProjectile(move: string, x0: number, y0: number, x1: number, y1: number, age: number) {
    const ctx = this.ctx;
    const k = Math.min(1, age / 0.22);
    const color = MOVE_COLOR[move] ?? C.cyan;
    this.glow(color, 18);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (move === 'bolt') {
      // a jagged bolt of lightning
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 1; i <= 8; i++) {
        const t = (i / 8) * k;
        ctx.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + (i < 8 ? (Math.random() - 0.5) * 30 : 0));
      }
      ctx.stroke();
    } else {
      // a spiralling rune (hex) or rings of words (speak)
      const px = x0 + (x1 - x0) * ease(k);
      const py = y0 + (y1 - y0) * ease(k) - Math.sin(k * Math.PI) * 40;
      if (move === 'speak') {
        ctx.lineWidth = 2;
        for (let r = 0; r < 3; r++) {
          ctx.globalAlpha = 1 - r * 0.3;
          ctx.beginPath();
          ctx.arc(px, py, 6 + r * 7 + ((age * 40) % 7), -0.8, 0.8);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(age * 14);
        ctx.lineWidth = 2;
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.rotate(Math.PI / 4);
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.restore();
      }
    }
    this.noGlow();
  }

  private drawIntent(intent: Intent, x: number, y: number, foe: Foe) {
    const ctx = this.ctx;
    const color = intent.kind === 'heavy' ? C.red : intent.kind === 'charge' ? C.gold : intent.kind === 'shell' ? C.cyan : intent.kind === 'wail' ? C.magenta : C.red;
    const size = this.narrow ? 12 : 14;
    ctx.font = `700 ${size}px ${FONT}`;
    const label = `${INTENT_GLYPH[intent.kind]} ${intent.label}`;
    const hint = intent.hint;
    const w = Math.max(ctx.measureText(label).width, (ctx.font = `400 11px ${FONT}`, ctx.measureText(hint).width)) + 24;
    const bw = Math.min(w, this.narrow ? this.w * 0.62 : this.w * 0.5);
    const hintLines = this.wrap(hint, bw - 14, 11).slice(0, 2);
    const bh = 30 + hintLines.length * 13;
    const bx = Math.min(this.w - bw - 6, Math.max(6, x - bw / 2));
    const by = Math.max(54, y - bh);
    const throb = intent.kind === 'heavy' || intent.kind === 'charge' ? 0.5 + 0.5 * Math.sin(this.now * 8) : 0;
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
    void foe;
  }

  /** Four original horrors. Dark bodies, bone and blood accents, and they glitch. */
  private drawHorror(foe: Foe, x: number, y: number, size: number) {
    const ctx = this.ctx;
    const t = this.now;
    const dying = this.deathAt !== undefined ? t - this.deathAt : -1;
    if (dying > 0.6) return;
    // they flicker out of existence for a frame now and then
    if (this.blinkOut > 0) this.blinkOut--;
    else if (Math.random() < 0.008) this.blinkOut = 2;
    if (this.blinkOut > 0 && dying < 0) return;

    const anim = this.foeAnim;
    const age = anim ? t - anim.t0 : 99;
    let ox = 0;
    let scale = foe.elite ? 1.12 : 1;
    if (anim && (anim.move === 'attack' || anim.move === 'heavy') && age < 0.7) {
      // lunge at the crew, right at the camera
      const k = pulse(age / 0.7);
      ox = -k * this.w * 0.35;
      scale *= 1 + k * (anim.move === 'heavy' ? 0.6 : 0.35);
    }
    if (anim && anim.move === 'charge' && age < 1.2) ox = (Math.random() - 0.5) * 6;
    const hitAge = t - this.foeHitAt;
    if (hitAge < 0.2) ox += (Math.random() - 0.5) * 16;
    const stunned = t - this.stunAt < 1.2;

    ctx.save();
    ctx.translate(x + ox, y);
    ctx.scale(scale, scale);
    if (dying >= 0) {
      ctx.globalAlpha = Math.max(0, 1 - dying / 0.6);
      ctx.translate((Math.random() - 0.5) * 20 * dying, 0);
    }
    const draw = (body: string, accent: string, eye: string) => {
      switch (foe.id) {
        case 'crimson': drawCrimson(ctx, size, t, body, accent, eye); break;
        case 'crawler': drawCrawler(ctx, size, t, body, accent, eye); break;
        case 'stalker': drawStalker(ctx, size, t, body, accent, eye, anim && age < 0.7 ? pulse(age / 0.7) : 0); break;
        default: drawWretch(ctx, size, t, body, accent, eye); break;
      }
    };
    // chromatic split: a red and a cyan ghost behind the real thing
    if (!this.reduced && Math.random() < 0.25) {
      ctx.globalAlpha *= 0.35;
      ctx.save();
      ctx.translate(-4, 0);
      draw('rgba(255,0,60,0.6)', 'rgba(255,0,60,0.6)', 'rgba(255,0,60,0.6)');
      ctx.restore();
      ctx.save();
      ctx.translate(4, 0);
      draw('rgba(0,240,255,0.5)', 'rgba(0,240,255,0.5)', 'rgba(0,240,255,0.5)');
      ctx.restore();
      ctx.globalAlpha /= 0.35;
    }
    const white = hitAge < 0.1;
    if (foe.elite) {
      this.glow(C.blood, 40);
    }
    draw(white ? '#ffffff' : '#0a0608', white ? '#ffffff' : foe.elite ? '#ff1a3c' : C.blood, white ? '#ffffff' : C.bone);
    this.noGlow();
    ctx.restore();
    if (foe.intent.kind === 'shell') {
      this.glow(C.cyan, 16);
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.5 + 0.2 * Math.sin(t * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.4;
        const px = x + ox + Math.cos(a) * size * 0.95;
        const py = y + Math.sin(a) * size * 0.95;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
      this.noGlow();
    }
    if (foe.intent.kind === 'charge' && Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x: x + Math.cos(a) * size * 1.4, y: y + Math.sin(a) * size * 1.4, vx: -Math.cos(a) * size * 2, vy: -Math.sin(a) * size * 2, life: 0, max: 0.5, color: C.gold, size: 2, gravity: 0 });
    }
    if (stunned) for (let i = 0; i < 3; i++) this.text('✦', x + ox + Math.cos(t * 5 + i * 2.1) * size * 0.4, y - size * 0.9 + Math.sin(t * 5 + i * 2.1) * 8, 14, C.cyan);
  }

  // ---------------------------------------------------------------- the Devourer

  private drawWyrm(s: SceneState, foe: Foe, hx0: number, hy0: number, size: number) {
    const ctx = this.ctx;
    const color = WYRM_COLORS[s.wyrm.color];
    const t = this.now;
    const dying = this.deathAt !== undefined ? t - this.deathAt : -1;
    if (dying > 1.4) return;
    const anim = this.foeAnim;
    const age = anim ? t - anim.t0 : 99;
    const lunge = anim && (anim.move === 'attack' || anim.move === 'heavy') && age < 0.8 ? pulse(age / 0.8) : 0;
    const hitAge = t - this.foeHitAt;
    const hx = hx0 - lunge * this.w * 0.25 + (hitAge < 0.2 ? (Math.random() - 0.5) * 14 : 0);
    const hy = hy0 + Math.sin(t * 1.4) * 5;
    const r0 = size * 0.32;
    if (dying >= 0) ctx.globalAlpha = Math.max(0, 1 - dying / 1.4);
    // the coils, tail to head
    for (let i = 24; i >= 1; i--) {
      const k = i / 24;
      const x = hx + r0 * 1.2 + k * this.w * 0.3 + Math.sin(k * 7 + t * 0.9) * this.w * 0.02;
      const y = hy + Math.sin(k * Math.PI * 2.2 + t * 1.1) * this.h * 0.12 * k * 1.6 + k * this.h * 0.32;
      const r = r0 * (k < 0.18 ? 0.55 + k * 2.4 : 0.98 - (k - 0.18) * 0.7);
      ctx.fillStyle = '#0c0812';
      this.glow(color, 8);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r);
      ctx.lineTo(x, y - r * 1.6);
      ctx.lineTo(x + r * 0.3, y - r);
      ctx.stroke();
    }
    // the head, jaw snapping open on an attack
    const hs = r0 * 1.9 * (1 + lunge * 0.3);
    const jaw = 0.1 + 0.06 * Math.sin(t * 1.5) + lunge * 0.4 + (foe.intent.kind === 'charge' ? 0.15 : 0);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.fillStyle = '#0c0812';
    this.glow(color, 18);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    // upper jaw and skull
    ctx.beginPath();
    ctx.moveTo(hs * 0.6, -hs * 0.45);
    ctx.quadraticCurveTo(-hs * 0.4, -hs * 0.6, -hs * 1.4, -hs * 0.08);
    ctx.lineTo(-hs * 1.3, hs * 0.04);
    ctx.lineTo(hs * 0.2, hs * 0.04);
    ctx.quadraticCurveTo(hs * 1.0, 0, hs * 0.6, -hs * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // lower jaw
    ctx.beginPath();
    ctx.moveTo(hs * 0.2, hs * 0.1);
    ctx.lineTo(-hs * 1.2, hs * (0.1 + jaw));
    ctx.quadraticCurveTo(-hs * 0.3, hs * (0.5 + jaw * 0.6), hs * 0.6, hs * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // teeth, top and bottom
    ctx.strokeStyle = C.bone;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const tx = -hs * 1.2 + i * hs * 0.18;
      ctx.moveTo(tx, hs * 0.04);
      ctx.lineTo(tx + hs * 0.05, hs * 0.17);
      ctx.lineTo(tx + hs * 0.1, hs * 0.04);
      const by = hs * (0.1 + jaw * (1 - i / 7));
      ctx.moveTo(tx + hs * 0.02, by);
      ctx.lineTo(tx + hs * 0.07, by - hs * 0.12);
      ctx.lineTo(tx + hs * 0.12, by);
    }
    ctx.stroke();
    // horns
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hs * 0.3, -hs * 0.48);
    ctx.quadraticCurveTo(hs * 0.8, -hs * 1.2, hs * 1.25, -hs * 1.2);
    ctx.moveTo(hs * 0.05, -hs * 0.55);
    ctx.quadraticCurveTo(hs * 0.3, -hs * 1.1, hs * 0.7, -hs * 1.35);
    ctx.stroke();
    // the eye: a red slit that burns brighter as it charges
    const eye = foe.intent.kind === 'charge' || lunge > 0 ? C.red : color;
    this.glow(eye, 24);
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.ellipse(-hs * 0.4, -hs * 0.24, hs * 0.2, hs * 0.1, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05040a';
    ctx.beginPath();
    ctx.ellipse(-hs * 0.4, -hs * 0.24, hs * 0.025, hs * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.noGlow();
    ctx.globalAlpha = 1;
    // breath leaking from its jaws
    if (Math.random() < 0.6) {
      this.particles.push({ x: hx - hs * 1.3, y: hy + hs * 0.1, vx: -40 - Math.random() * 60, vy: (Math.random() - 0.5) * 30, life: 0, max: 1.2, color: foe.intent.kind === 'charge' ? C.red : color, size: 2.2, gravity: -10 });
    }
    if (t - this.stunAt < 1.2) for (let i = 0; i < 3; i++) this.text('✦', hx + Math.cos(t * 5 + i * 2.1) * hs * 0.5, hy - hs * 0.9, 16, C.cyan);
  }

  private drawParley(s: SceneState) {
    const p = s.parley ?? {};
    const color = WYRM_COLORS[s.wyrm.color];
    const bw = this.narrow ? this.w - 24 : Math.min(340, this.w * 0.4);
    const x = 12;
    // on phones the reply sits below the move badge instead of over it
    if (p.reply) this.bubble(p.reply, this.narrow ? x : this.w * 0.15 + 30, this.narrow ? this.h * 0.36 : 44, bw, color, this.narrow ? 2 : 3);
    if (p.said) {
      const member = s.party.find((m) => m.handle === p.saidBy);
      const box = this.bubble(p.said, x + 40, this.h - (this.narrow ? 70 : 80), bw - 40, C.green, 2);
      if (member) drawAvatar(this.ctx, buildAvatar(avatarSeed(member.handle, member.avatar), member.classes), x + 16, box.y + box.h / 2, 2.4, { t: this.now, glow: true });
    }
    if (!p.reply && !p.said) {
      const hint = `it ${s.wyrm.temperament}. anyone can speak instead of attacking.`;
      this.wrap(hint, this.w * 0.6, 11).forEach((l, i) => this.text(l, this.w / 2, this.h - 24 + i * 14, 11, 'rgba(255, 233, 168, 0.85)'));
    }
  }

  /** A speech bubble; returns where it landed. */
  private bubble(str: string, x: number, y: number, maxW: number, color: string, maxLines: number): { y: number; h: number } {
    const ctx = this.ctx;
    const size = this.narrow ? 11 : 12;
    let lines = this.wrap(str, maxW - 20, size);
    if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]!.slice(0, -1)}…`];
    const h = lines.length * (size + 5) + 14;
    ctx.fillStyle = 'rgba(7, 6, 13, 0.9)';
    this.roundRect(x, y, maxW, h, 8);
    ctx.fill();
    this.glow(color, 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this.noGlow();
    lines.forEach((l, i) => this.text(l, x + 10, y + 13 + i * (size + 5), size, C.text, 'left'));
    return { y, h };
  }

  // ---------------------------------------------------------------- overlays

  private drawParticles(dt: number) {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  }

  private drawFloaters() {
    for (const f of this.floaters) {
      const age = this.now - f.t0;
      const pop = 1 + Math.max(0, 0.4 - age * 2);
      this.ctx.globalAlpha = Math.max(0, 1 - age / 1.4);
      this.glow(f.color, 10);
      this.text(f.text, f.x, f.y - age * 40, (f.big ? 22 : 15) * pop, f.color, 'center', 700);
      this.noGlow();
    }
    this.ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => this.now - f.t0 < 1.4);
  }

  private drawChats() {
    const life = 4.5;
    this.chats = this.chats.filter((c) => this.now - c.t0 < life);
    const px = this.narrow ? 2.2 : 2.8;
    const aw = AV_W * px;
    const maxW = Math.min(320, this.w - aw - 40);
    let bottom = this.scene ? this.h - 34 : this.h - 8;
    for (const c of [...this.chats].reverse()) {
      const age = this.now - c.t0;
      this.ctx.globalAlpha = Math.max(0, Math.min(1, age * 5, (life - age) / 0.6));
      const slide = Math.max(0, 1 - age * 6) * -30;
      const lines = this.wrap(c.text, maxW - 20, 11).slice(0, 2);
      const h = Math.max(AV_H * px, lines.length * 16 + 22);
      const y = bottom - h;
      const x = 12 + slide;
      this.ctx.fillStyle = 'rgba(7, 6, 13, 0.9)';
      this.roundRect(x, y, aw + maxW + 16, h, 6);
      this.ctx.fill();
      this.ctx.strokeStyle = 'rgba(255, 43, 214, 0.6)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      drawAvatar(this.ctx, buildAvatar(avatarSeed(c.handle, c.avatar), c.classes), x + 6 + aw / 2, y + h / 2, px, { t: this.now, glow: true });
      this.text(c.handle, x + aw + 14, y + 10, 10, C.magenta, 'left', 700);
      lines.forEach((l, i) => this.text(l, x + aw + 14, y + 24 + i * 16, 11, C.text, 'left'));
      bottom = y - 6;
    }
    this.ctx.globalAlpha = 1;
  }

  private drawOverlay() {
    const o = this.overlay!;
    const age = this.now - o.t0;
    const ctx = this.ctx;
    if (o.kind === 'intro') {
      const total = 6;
      if (age > total) {
        this.overlay = undefined;
        return;
      }
      const fade = age > total - 0.8 ? 1 - (age - (total - 0.8)) / 0.8 : 1;
      ctx.globalAlpha = fade;
      this.drawSky();
      this.drawCity(fade, Math.max(0.15, 1 - Math.max(0, age - 3) * 0.4));
      ctx.globalAlpha = fade;
      if (age > 2.2) {
        const open = Math.min(1, (age - 2.2) / 0.7);
        for (const ex of [0.43, 0.57]) {
          this.glow(o.color, 24);
          ctx.fillStyle = o.color;
          ctx.beginPath();
          ctx.ellipse(this.w * ex, this.h * 0.9, 18, 9 * open, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#05040a';
          ctx.beginPath();
          ctx.ellipse(this.w * ex, this.h * 0.9, 2.5, 8 * open, 0, 0, Math.PI * 2);
          ctx.fill();
          this.noGlow();
        }
      }
      const size = Math.min(56, this.w / 8);
      const shown = 'LAST LIGHT'.slice(0, Math.floor(age * 7));
      this.glow(C.gold, 24);
      this.text(shown, this.w / 2, this.h * 0.2, size, '#ffe9a8', 'center', 700);
      this.noGlow();
      const lines = [
        [1.4, 'beneath Neo-Avalon, something is waking', C.text],
        [2.6, `${o.wyrm}, a ${o.title}`, o.color],
        [3.8, 'when it wakes, every mind in the city goes dark', C.text],
        [4.6, 'you are the last light', C.gold],
      ] as const;
      let y = this.h * 0.2 + size;
      for (const [at, str, color] of lines) {
        if (age < at) break;
        for (const l of this.wrap(str, this.w - 40, 13)) {
          this.text(l, this.w / 2, y, 13, color);
          y += 18;
        }
        y += 4;
      }
      ctx.globalAlpha = 1;
      return;
    }
    // the ending: dawn over a city that never knew, or every light going out
    const a = Math.min(1, age * 1.5);
    ctx.globalAlpha = a;
    this.drawSky();
    if (o.win) {
      const dawn = Math.min(1, age / 3);
      const g = ctx.createLinearGradient(0, this.h, 0, this.h * 0.2);
      g.addColorStop(0, `rgba(255, 170, 60, ${0.5 * dawn})`);
      g.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawCity(a, 1);
      if (Math.random() < 0.3) this.burst(Math.random() * this.w, this.h * 0.3, Math.random() < 0.5 ? C.gold : C.cyan, 10, 40);
    } else {
      this.drawCity(a, Math.max(0, 1 - age / 3));
    }
    ctx.globalAlpha = a;
    const color = o.win ? C.gold : C.red;
    const size = Math.min(52, this.w / 10);
    this.glow(color, 26);
    this.text(o.win ? 'THE LIGHT HOLDS' : 'THE CITY FALLS', this.w / 2, this.h * 0.32, size, color, 'center', 700);
    this.noGlow();
    this.text(o.win ? 'the Devourer sleeps. Neo-Avalon wakes, never knowing.' : 'one by one, the windows go dark.', this.w / 2, this.h * 0.32 + size, 13, C.text);
    ctx.globalAlpha = 1;
  }
}

const ROUTE_COLOR: Record<RouteKind, string> = { fight: C.red, elite: '#ff1a3c', shrine: C.green, cache: C.magenta, boss: C.gold };
const ROUTE_GLYPH: Record<RouteKind, string> = { fight: '⚔', elite: '☠', shrine: '✚', cache: '✦', boss: '☠' };
const INTENT_GLYPH: Record<string, string> = { attack: '⚔', heavy: '☠', charge: '⚡', shell: '⛨', wail: '≋' };

// ---------------------------------------------------------------- the horrors

/** A gaunt figure with a face painted red, black hollows for eyes, and long fingers. */
function drawCrimson(ctx: CanvasRenderingContext2D, s: number, t: number, body: string, blood: string, bone: string) {
  const tilt = Math.sin(t * 0.7) > 0.9 ? 0.25 : 0; // the head snaps sideways now and then
  ctx.fillStyle = body;
  ctx.strokeStyle = blood;
  ctx.lineWidth = 2;
  // ragged coat
  ctx.beginPath();
  ctx.moveTo(-s * 0.25, -s * 0.45);
  ctx.lineTo(s * 0.25, -s * 0.45);
  for (let i = 0; i <= 8; i++) ctx.lineTo(s * 0.45 - i * s * 0.1125, s * (0.9 + (i % 2 ? 0.08 : 0) + Math.sin(t * 2 + i) * 0.02));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // long fingers
  ctx.strokeStyle = bone;
  ctx.lineWidth = 1.5;
  for (const side of [-1, 1]) {
    const hx = side * s * 0.42;
    const hy = s * 0.35 + Math.sin(t * 1.5 + side) * 3;
    ctx.beginPath();
    for (let f = 0; f < 4; f++) {
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + side * s * 0.04 * f, hy + s * (0.28 + f * 0.02));
    }
    ctx.stroke();
  }
  // the head
  ctx.save();
  ctx.translate(0, -s * 0.62);
  ctx.rotate(tilt);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.05, s * 0.2, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // the red face
  ctx.fillStyle = blood;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.17, s * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  for (const dx of [-0.07, 0.07]) {
    ctx.beginPath();
    ctx.ellipse(dx * s, -s * 0.04, s * 0.05, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // black streaks and a too-wide mouth
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.14, -s * 0.16);
  ctx.lineTo(-s * 0.04, -s * 0.1);
  ctx.moveTo(s * 0.14, -s * 0.16);
  ctx.lineTo(s * 0.04, -s * 0.1);
  ctx.moveTo(-s * 0.1, s * 0.12);
  ctx.quadraticCurveTo(0, s * 0.17, s * 0.1, s * 0.12);
  ctx.stroke();
  // pinprick pupils
  ctx.fillStyle = bone;
  ctx.fillRect(-s * 0.075, -s * 0.05, 2, 2);
  ctx.fillRect(s * 0.065, -s * 0.05, 2, 2);
  ctx.restore();
}

/** Crawls out of a dead screen, hair first, moving in jerks like a video missing frames. */
function drawCrawler(ctx: CanvasRenderingContext2D, s: number, t: number, body: string, blood: string, bone: string) {
  const tq = Math.floor(t * 6) / 6; // stop-motion
  const creep = Math.sin(tq * 0.8) * s * 0.06;
  const solid = body === '#0a0608';
  ctx.save();
  ctx.translate(creep, s * 0.2);
  ctx.scale(1.45, 1.45);
  // pale reaching arms
  ctx.strokeStyle = bone;
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const reach = Math.sin(tq * 2 + side) * s * 0.08;
    ctx.beginPath();
    ctx.moveTo(side * s * 0.15, -s * 0.15);
    ctx.lineTo(side * s * 0.45 - s * 0.25 + reach, s * 0.05);
    ctx.lineTo(-s * 0.55 + side * s * 0.15 + reach, s * 0.22);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // hunched body under a curtain of hair
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(s * 0.1, -s * 0.15, s * 0.4, s * 0.28, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // a sliver of pale face behind the hair
  ctx.fillStyle = solid ? '#b9b2a2' : body;
  ctx.beginPath();
  ctx.ellipse(-s * 0.14, -s * 0.24, s * 0.1, s * 0.15, 0.1, 0, Math.PI * 2);
  ctx.fill();
  // hair, strand by strand, hanging to the floor
  const strand = (i: number) => {
    const hx = -s * 0.38 + i * s * 0.024;
    ctx.beginPath();
    ctx.moveTo(hx + s * 0.06, -s * 0.48);
    ctx.bezierCurveTo(hx - s * 0.05, -s * 0.2, hx + Math.sin(tq * 3 + i) * s * 0.03, s * 0.05, hx - s * 0.08, s * 0.3);
    ctx.stroke();
  };
  ctx.lineWidth = 3;
  ctx.strokeStyle = blood;
  for (let i = 0; i < 26; i += 5) strand(i); // a blood-red rim so it reads against the dark
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = solid ? '#2e232a' : body;
  for (let i = 0; i < 26; i++) if (i !== 9 && i !== 10) strand(i); // a gap where the eye shows
  // one eye, through the hair
  ctx.fillStyle = bone;
  ctx.beginPath();
  ctx.ellipse(-s * 0.15, -s * 0.24, s * 0.05, s * 0.032, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(-s * 0.15, -s * 0.24, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = blood;
  ctx.fillRect(-s * 0.16, -s * 0.25, 2, 2);
  ctx.restore();
}

/** Ribs like a cathedral, a bullet skull, and a second jaw that slides out to bite. */
function drawStalker(ctx: CanvasRenderingContext2D, s: number, t: number, body: string, blood: string, bone: string, strike: number) {
  ctx.fillStyle = body;
  ctx.strokeStyle = blood;
  ctx.lineWidth = 2;
  // tail
  ctx.beginPath();
  ctx.moveTo(s * 0.3, s * 0.3);
  ctx.bezierCurveTo(s * 0.9, s * 0.5, s * 1.0, -s * 0.2 + Math.sin(t * 1.5) * s * 0.1, s * 0.75, -s * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.75, -s * 0.5);
  ctx.lineTo(s * 0.68, -s * 0.62);
  ctx.lineTo(s * 0.85, -s * 0.58);
  ctx.closePath();
  ctx.fillStyle = blood;
  ctx.fill();
  ctx.fillStyle = body;
  // ribcage torso
  ctx.beginPath();
  ctx.ellipse(s * 0.05, s * 0.15, s * 0.32, s * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = bone;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const ry = -s * 0.1 + i * s * 0.08;
    ctx.beginPath();
    ctx.moveTo(s * 0.05, ry);
    ctx.quadraticCurveTo(-s * 0.2, ry + s * 0.04, -s * 0.22, ry + s * 0.1);
    ctx.moveTo(s * 0.05, ry);
    ctx.quadraticCurveTo(s * 0.3, ry + s * 0.04, s * 0.32, ry + s * 0.1);
    ctx.stroke();
  }
  // legs
  ctx.strokeStyle = blood;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (const lx of [-0.2, 0.25]) {
    ctx.moveTo(lx * s, s * 0.45);
    ctx.lineTo(lx * s - s * 0.1, s * 0.7);
    ctx.lineTo(lx * s + s * 0.02, s * 0.9);
  }
  ctx.stroke();
  // the long bullet skull, glossy
  ctx.save();
  ctx.translate(-s * 0.1, -s * 0.35);
  ctx.rotate(-0.35 + Math.sin(t * 0.8) * 0.05);
  ctx.fillStyle = body;
  ctx.strokeStyle = blood;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, s * 0.02);
  ctx.quadraticCurveTo(-s * 0.25, -s * 0.15, s * 0.55, -s * 0.12);
  ctx.quadraticCurveTo(s * 0.3, s * 0.08, -s * 0.1, s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232, 226, 208, 0.5)';
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, -s * 0.06);
  ctx.quadraticCurveTo(s * 0.1, -s * 0.12, s * 0.45, -s * 0.1);
  ctx.stroke();
  // jaws: the inner jaw slides out on a strike
  const inner = 0.06 + strike * 0.35 + Math.max(0, Math.sin(t * 0.9) - 0.9) * 2;
  ctx.strokeStyle = bone;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.32, s * 0.04);
  ctx.lineTo(-s * 0.32 - s * inner, s * 0.06);
  ctx.stroke();
  ctx.fillStyle = bone;
  ctx.fillRect(-s * 0.32 - s * inner - 4, s * 0.03, 5, 6);
  ctx.restore();
}

/** Pale, grinning, head at a wrong angle, and far too many elbows. */
function drawWretch(ctx: CanvasRenderingContext2D, s: number, t: number, body: string, blood: string, bone: string) {
  const pale = body === '#0a0608' ? '#cfc8b8' : body;
  // spindly arms with extra joints, moving like a spider's legs
  ctx.strokeStyle = pale;
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const k = i % 3;
    const base = { x: side * s * 0.1, y: -s * 0.15 + k * s * 0.15 };
    const phase = t * 2.4 + i * 1.3;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    let x = base.x;
    let y = base.y;
    for (let j = 0; j < 3; j++) {
      x += side * s * 0.22;
      y += (j % 2 ? 1 : -1) * s * 0.16 + Math.sin(phase + j) * s * 0.05;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x + side * s * 0.05, s * 0.85);
    ctx.stroke();
  }
  // thin torso
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(0, s * 0.05, s * 0.12, s * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  // the head, tilted too far, with a grin too wide
  ctx.save();
  ctx.translate(0, -s * 0.45);
  ctx.rotate(0.55 + Math.sin(t * 0.5) * 0.1);
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.17, s * 0.21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  for (const dx of [-0.07, 0.07]) {
    ctx.beginPath();
    ctx.ellipse(dx * s, -s * 0.05, s * 0.045, s * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-s * 0.13, s * 0.06);
  ctx.quadraticCurveTo(0, s * 0.2, s * 0.13, s * 0.06);
  ctx.quadraticCurveTo(0, s * 0.12, -s * 0.13, s * 0.06);
  ctx.fill();
  ctx.strokeStyle = bone === '#ffffff' ? bone : '#f5f0e0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const tx = -s * 0.1 + i * s * 0.033;
    ctx.moveTo(tx, s * 0.075);
    ctx.lineTo(tx, s * 0.105);
  }
  ctx.stroke();
  ctx.fillStyle = blood;
  ctx.fillRect(-s * 0.075, -s * 0.06, 2, 2);
  ctx.fillRect(s * 0.065, -s * 0.06, 2, 2);
  ctx.restore();
}
