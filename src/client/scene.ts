import type { Fx, HudMember, RollView, SceneRoom, SceneState, WyrmColor } from '../shared/protocol';
import { AV_H, AV_W, avatarSeed, buildAvatar, drawAvatar } from './avatar';

// The scene window: a neon-vector arcade view of the delve. Everything is
// drawn procedurally on one canvas, so there are no image assets to load.

const COLORS = {
  bg: '#07060d',
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  yellow: '#ffe600',
  green: '#39ff88',
  red: '#ff3860',
  gold: '#ffb800',
  dim: '#3a3f5c',
  text: '#d7e3ff',
  muted: '#7a7f9a',
};

const WYRM_COLORS: Record<WyrmColor, string> = {
  red: '#ff5a3c',
  blue: '#4da3ff',
  green: '#3dff8f',
  black: '#9d8cff',
  white: '#dff4ff',
};

const CLASS_COLOR: Record<string, string> = { rogue: COLORS.green, mage: COLORS.cyan, cleric: COLORS.yellow };
const FONT = '"JetBrains Mono", Menlo, Consolas, monospace';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Floater { text: string; x: number; y: number; t0: number; color: string; big?: boolean }
interface Building { x: number; w: number; h: number; windows: number[]; sign?: string }

type Overlay =
  | { kind: 'intro'; t0: number; corp: string; district: string; wyrm: string; title: string; color: string }
  | { kind: 'end'; t0: number; win: boolean };

export interface Lobby {
  title: string;
  subtitle: string;
  /** Avatars to line up under the title: the crew in a safehouse, or just you on the street. */
  crew?: { handle: string; avatar: number; host?: boolean; you?: boolean }[];
}

interface ChatPop { handle: string; avatar: number; classes: string[]; text: string; t0: number }

export class SceneView {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private now = 0;
  private scene?: SceneState;
  private lobby: Lobby = { title: 'ICEBREAKER', subtitle: 'jack in to begin' };
  private forceMap = false;
  private runnerPos?: { x: number; y: number };
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private chats: ChatPop[] = [];
  private partyHitAt = -10;
  private shakeUntil = 0;
  private flash = { color: COLORS.red, until: 0, dur: 1 };
  private monsterHitAt = -10;
  private monsterDeath?: number;
  /** Keeps the fight on screen briefly after a kill so the death animation plays. */
  private linger?: { scene: SceneState; until: number };
  private unlockAt = new Map<string, number>();
  private die?: { roll: RollView; t0: number; resolve: () => void };
  private overlay?: Overlay;
  private roomRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private hoverRoom?: string;
  private city: Building[] = [];
  private rain: { x: number; y: number; s: number }[] = [];
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Phone-width scenes stack things vertically. */
  private get narrow() {
    return this.w < 560;
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onRoomClick: (room: SceneRoom, scene: SceneState) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('mousemove', (e) => this.hover(e));
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- public api

  setScene(scene: SceneState) {
    const prev = this.scene;
    if (prev && prev.view !== scene.view && scene.view !== 'explore') this.forceMap = false;
    if (prev?.combat && !scene.combat && this.monsterDeath !== undefined) this.linger = { scene: prev, until: this.now + 1.4 };
    if (scene.combat && !prev?.combat) {
      this.monsterDeath = undefined;
      this.monsterHitAt = -10;
    }
    this.scene = scene;
  }

  setLobby(lobby: Lobby | null) {
    if (lobby) {
      this.lobby = lobby;
      this.scene = undefined;
      if (this.overlay?.kind === 'end' && this.now - this.overlay.t0 > 3) this.overlay = undefined;
    }
  }

  /** A crewmate's avatar pops up in the corner with what they said. */
  chat(member: Pick<HudMember, 'handle' | 'avatar' | 'classes'>, text: string) {
    this.chats.push({ handle: member.handle, avatar: member.avatar, classes: member.classes, text, t0: this.now });
    if (this.chats.length > 2) this.chats.shift();
  }

  toggleMap(): boolean {
    this.forceMap = !this.forceMap;
    return this.forceMap;
  }

  get mapForced() {
    return this.forceMap;
  }

  playFx(fx: Fx) {
    const cx = this.w / 2;
    const cy = this.h / 2;
    switch (fx.kind) {
      case 'intro':
        this.overlay = { kind: 'intro', t0: this.now, corp: fx.corp, district: fx.district, wyrm: fx.wyrm, title: fx.title, color: WYRM_COLORS[fx.color] };
        break;
      case 'move':
        break;
      case 'unlock':
        this.unlockAt.set(fx.node, this.now);
        this.float('UNLOCKED', cx, cy * 0.5, COLORS.green, true);
        break;
      case 'alarm':
        this.shake(0.5);
        this.flashScreen(COLORS.red, 0.6);
        this.float('ALARM', cx, cy * 0.45, COLORS.red, true);
        break;
      case 'hurt':
        this.partyHitAt = this.now;
        this.shake(0.35);
        this.flashScreen(COLORS.red, 0.35);
        this.float(`+${fx.amount}% trace`, this.w * 0.25, this.h * 0.4, COLORS.red);
        break;
      case 'heal':
        this.flashScreen(COLORS.green, 0.4);
        this.float(`-${fx.amount}% trace`, cx, cy * 0.6, COLORS.green, true);
        this.burst(cx, cy, COLORS.green, 30);
        break;
      case 'strike':
        this.monsterHitAt = this.now;
        this.float(`-${fx.amount}`, this.w * 0.74, this.h * 0.32, COLORS.yellow, true);
        this.burst(this.w * 0.74, this.h * 0.52, COLORS.yellow, 14);
        break;
      case 'slay':
        this.monsterDeath = this.now;
        this.burst(this.w * 0.74, this.h * 0.55, COLORS.red, 90);
        this.burst(this.w * 0.74, this.h * 0.55, COLORS.magenta, 50);
        this.float('DESTROYED', this.w * 0.74, this.h * 0.25, COLORS.green, true);
        break;
      case 'loot':
        this.float(`✦ ${fx.name}`, cx, cy * 0.75, COLORS.magenta, true);
        this.burst(cx, cy * 0.8, COLORS.magenta, 24);
        break;
      case 'end':
        this.overlay = { kind: 'end', t0: this.now, win: fx.win };
        if (fx.win) for (let i = 0; i < 4; i++) this.burst(this.w * (0.2 + i * 0.2), this.h * 0.4, i % 2 ? COLORS.gold : COLORS.cyan, 50);
        else this.shake(0.8);
        break;
    }
  }

  /** Big tumbling d20 in the middle of the scene; resolves when it has landed. */
  rollDie(roll: RollView): Promise<void> {
    if (this.reduced) return Promise.resolve();
    return new Promise((resolve) => {
      this.die?.resolve();
      this.die = { roll, t0: this.now, resolve };
    });
  }

  // ---------------------------------------------------------------- input

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

  private roomAt(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return this.roomRects.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
  }

  private click(e: MouseEvent) {
    const hit = this.roomAt(e);
    const room = hit && this.scene?.rooms.find((q) => q.id === hit.id);
    if (room && this.scene) this.onRoomClick(room, this.scene);
  }

  private hover(e: MouseEvent) {
    this.hoverRoom = this.roomAt(e)?.id;
    this.canvas.style.cursor = this.hoverRoom ? 'pointer' : 'default';
  }

  // ---------------------------------------------------------------- effects

  private shake(seconds: number) {
    if (!this.reduced) this.shakeUntil = Math.max(this.shakeUntil, this.now + seconds);
  }

  private flashScreen(color: string, dur: number) {
    this.flash = { color, until: this.now + dur, dur };
  }

  private float(text: string, x: number, y: number, color: string, big = false) {
    this.floaters.push({ text, x, y, t0: this.now, color, big });
  }

  private burst(x: number, y: number, color: string, n: number) {
    if (this.reduced) n = Math.min(n, 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 220;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.6 + Math.random() * 0.8, color, size: 1.5 + Math.random() * 2.5 });
    }
  }

  // ---------------------------------------------------------------- loop

  private frame = (ms: number) => {
    const t = ms / 1000;
    const dt = Math.min(0.05, t - (this.now || t));
    this.now = t;
    const ctx = this.ctx;
    ctx.save();
    if (this.now < this.shakeUntil) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8);

    this.drawBackdrop();
    const s = this.scene;
    if (!s) this.drawLobby();
    else if (this.linger && this.now < this.linger.until) this.drawCombat(this.linger.scene);
    else {
      this.linger = undefined;
      const view = this.forceMap ? 'explore' : s.view;
      if (view === 'explore') this.drawMap(s);
      else if (view === 'combat') this.drawCombat(s);
      else if (view === 'parley') this.drawParley(s);
      else this.drawVault(s);
    }
    this.drawParticles(dt);
    this.drawFloaters();
    this.drawChats();
    if (this.die) this.drawDie();
    if (this.overlay) this.drawOverlay();
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

  // ---------------------------------------------------------------- helpers

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

  private wrap(str: string, maxWidth: number, size: number): string[] {
    this.ctx.font = `400 ${size}px ${FONT}`;
    const words = str.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
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

  // ---------------------------------------------------------------- backdrop & lobby

  private buildCity() {
    const out: Building[] = [];
    let x = -10;
    while (x < this.w + 20) {
      const w = 24 + Math.random() * 60;
      const h = this.h * (0.18 + Math.random() * 0.42);
      const windows = Array.from({ length: 40 }, () => Math.random());
      out.push({ x, w, h, windows, ...(Math.random() < 0.18 ? { sign: Math.random() < 0.5 ? COLORS.magenta : COLORS.cyan } : {}) });
      x += w + 2 + Math.random() * 6;
    }
    this.city = out;
    this.rain = Array.from({ length: 90 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, s: 300 + Math.random() * 300 }));
  }

  private drawBackdrop() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0b0717');
    g.addColorStop(1, '#05040a');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.w + 40, this.h + 40);
    // faint grid
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < this.w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.h);
      ctx.stroke();
    }
    for (let y = 0; y < this.h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }
  }

  private drawCity(alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    const base = this.h;
    for (const b of this.city) {
      ctx.fillStyle = '#0d0a1c';
      ctx.fillRect(b.x, base - b.h, b.w, b.h);
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.18)';
      ctx.strokeRect(b.x + 0.5, base - b.h + 0.5, b.w - 1, b.h - 1);
      // windows
      const cols = Math.max(1, Math.floor(b.w / 9));
      const rows = Math.floor(b.h / 12);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const seed = b.windows[(r * cols + c) % b.windows.length]!;
          const lit = seed > 0.62 && Math.sin(this.now * 0.5 + seed * 40) > -0.85;
          if (!lit) continue;
          ctx.fillStyle = seed > 0.9 ? 'rgba(255, 230, 0, 0.55)' : 'rgba(0, 240, 255, 0.35)';
          ctx.fillRect(b.x + 3 + c * 9, base - b.h + 5 + r * 12, 4, 5);
        }
      }
      if (b.sign) {
        const on = Math.sin(this.now * 3 + b.x) > -0.6;
        if (on) {
          this.glow(b.sign, 12);
          ctx.fillStyle = b.sign;
          ctx.fillRect(b.x + b.w * 0.2, base - b.h + 14, b.w * 0.6, 4);
          this.noGlow();
        }
      }
    }
    // the corp tower
    const tw = Math.min(90, this.w * 0.09);
    const tx = this.w * 0.5 - tw / 2;
    const th = this.h * 0.85;
    ctx.fillStyle = '#100b22';
    ctx.beginPath();
    ctx.moveTo(tx, base);
    ctx.lineTo(tx + tw * 0.15, base - th);
    ctx.lineTo(tx + tw * 0.85, base - th);
    ctx.lineTo(tx + tw, base);
    ctx.fill();
    this.glow(COLORS.magenta, 10);
    ctx.strokeStyle = COLORS.magenta;
    ctx.stroke();
    this.noGlow();
    const blink = Math.sin(this.now * 4) > 0;
    if (blink) {
      this.glow(COLORS.red, 14);
      ctx.fillStyle = COLORS.red;
      ctx.beginPath();
      ctx.arc(tx + tw / 2, base - th - 8, 3, 0, Math.PI * 2);
      ctx.fill();
      this.noGlow();
    }
    ctx.globalAlpha = 1;
    this.drawRain(alpha);
  }

  private drawRain(alpha = 1) {
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(150, 190, 255, ${0.25 * alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.rain) {
      d.y += d.s * 0.016;
      d.x -= d.s * 0.003;
      if (d.y > this.h) {
        d.y = -10;
        d.x = Math.random() * (this.w + 40);
      }
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 2, d.y + 10);
    }
    ctx.stroke();
  }

  private drawLobby() {
    this.drawCity(0.9);
    const size = Math.min(54, this.w / 11);
    const crew = this.lobby.crew ?? [];
    const titleY = crew.length ? this.h * 0.18 : this.h * 0.3;
    this.glow(COLORS.cyan, 18);
    this.text(this.lobby.title, this.w / 2, titleY, size, COLORS.cyan, 'center', 700);
    this.noGlow();
    if (crew.length) {
      const slot = Math.min(150, (this.w - 40) / Math.max(crew.length, 2));
      const px = Math.max(3, Math.min(this.narrow ? 5 : 7, slot / (AV_W * 1.6), (this.h * 0.32) / AV_H));
      const cy = this.h * (this.narrow ? 0.52 : 0.58);
      crew.forEach((m, i) => {
        const x = this.w / 2 + (i - (crew.length - 1) / 2) * slot;
        const bob = Math.sin(this.now * 2.5 + i * 1.3) * px * 0.6;
        // a little plinth of light
        this.ctx.fillStyle = 'rgba(0, 240, 255, 0.10)';
        this.ctx.beginPath();
        this.ctx.ellipse(x, cy + (AV_H * px) / 2 + px * 1.5, AV_W * px * 0.5, px * 1.2, 0, 0, Math.PI * 2);
        this.ctx.fill();
        drawAvatar(this.ctx, buildAvatar(avatarSeed(m.handle, m.avatar)), x, cy + bob, px, { t: this.now, glow: true });
        const label = `${m.host ? '★ ' : ''}${m.handle}`;
        this.text(label, x, cy + (AV_H * px) / 2 + px * 4 + 6, 12, m.you ? COLORS.cyan : COLORS.text, 'center', m.you ? 700 : 400);
      });
    }
    const sub = Math.max(12, size * 0.28);
    this.wrap(this.lobby.subtitle, this.w - 40, sub).forEach((l, i) => this.text(l, this.w / 2, titleY + size * 0.9 + i * (sub + 6), sub, COLORS.text));
  }

  // ---------------------------------------------------------------- map

  private drawMap(s: SceneState) {
    const ctx = this.ctx;
    const shown = s.rooms.filter((r) => r.known !== 'hidden');
    const all = s.rooms;
    const maxX = Math.max(...all.map((r) => r.x), 1);
    const ys = all.map((r) => r.y);
    const minY = Math.min(...ys, -0.5);
    const maxY = Math.max(...ys, 0.5);
    const vertical = this.narrow;
    let bw: number;
    let bh: number;
    let pos: Map<string, { x: number; y: number }>;
    if (vertical) {
      // depth runs top to bottom, siblings spread across
      const lanes = maxY - minY + 1;
      const padX = 12;
      const padTop = 34;
      const padBottom = 34;
      bw = Math.min(124, (this.w - padX * 2) / lanes - 12);
      bh = Math.max(28, Math.min(46, (this.h - padTop - padBottom) / (maxX + 1) - 10));
      const px = (y: number) => padX + bw / 2 + ((y - minY) / (maxY - minY || 1)) * (this.w - padX * 2 - bw);
      const py = (x: number) => padTop + bh / 2 + (x / maxX) * (this.h - padTop - padBottom - bh);
      pos = new Map(all.map((r) => [r.id, { x: px(r.y), y: py(r.x) }]));
    } else {
      const padX = Math.min(90, this.w * 0.1);
      const padY = Math.min(70, this.h * 0.16);
      bw = Math.min(124, (this.w - padX * 2) / (maxX + 1) - 18);
      bh = Math.min(54, Math.max(38, this.h * 0.12));
      const px = (x: number) => padX + (x / maxX) * (this.w - padX * 2);
      const py = (y: number) => padY + ((y - minY) / (maxY - minY || 1)) * (this.h - padY * 2 - 10) + 10;
      pos = new Map(all.map((r) => [r.id, { x: px(r.x), y: py(r.y) }]));
    }

    // corridors with packets flowing
    ctx.lineWidth = 2;
    const drawn = new Set<string>();
    for (const r of shown) {
      for (const l of r.links) {
        const other = all.find((q) => q.id === l);
        if (!other || other.known === 'hidden') continue;
        const key = [r.id, l].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const a = pos.get(r.id)!;
        const b = pos.get(l)!;
        const lockedLink = r.locked || other.locked;
        ctx.strokeStyle = lockedLink ? 'rgba(255, 56, 96, 0.35)' : 'rgba(0, 240, 255, 0.35)';
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -this.now * 24;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // a packet
        const k = (this.now * 0.35 + (key.length % 7) / 7) % 1;
        ctx.fillStyle = lockedLink ? COLORS.red : COLORS.cyan;
        ctx.fillRect(a.x + (b.x - a.x) * k - 2, a.y + (b.y - a.y) * k - 2, 4, 4);
      }
    }

    // rooms
    this.roomRects = [];
    const runnerRoom = all.find((r) => r.id === s.runnerAt);
    const adjacent = new Set(runnerRoom?.links ?? []);
    for (const r of shown) {
      const p = pos.get(r.id)!;
      const x = p.x - bw / 2;
      const y = p.y - bh / 2;
      this.roomRects.push({ id: r.id, x, y, w: bw, h: bh });
      let color = r.known === 'seen' ? COLORS.dim : COLORS.cyan;
      if (r.kind === 'vault') color = COLORS.gold;
      else if (r.kind === 'gate') color = WYRM_COLORS[s.wyrm.color];
      else if (r.locked) color = COLORS.red;
      if (r.id === s.runnerAt) color = COLORS.green;
      const unlock = this.unlockAt.get(r.id);
      const pulse = unlock !== undefined && this.now - unlock < 1 ? 1 - (this.now - unlock) : 0;
      const hot = this.hoverRoom === r.id && adjacent.has(r.id);

      ctx.fillStyle = r.known === 'seen' ? 'rgba(20, 18, 36, 0.8)' : 'rgba(14, 12, 30, 0.92)';
      this.roundRect(x, y, bw, bh, 6);
      ctx.fill();
      this.glow(color, (r.known === 'seen' ? 0 : 10) + pulse * 30 + (hot ? 12 : 0));
      ctx.strokeStyle = color;
      ctx.lineWidth = r.id === s.runnerAt || hot ? 2.5 : 1.5;
      ctx.stroke();
      this.noGlow();

      const fs = Math.max(10, Math.min(13, bw / 9, bh / 3.2));
      this.text(r.kind === 'vault' ? 'VAULT' : r.id, p.x, y + bh * 0.32, fs, r.known === 'seen' ? COLORS.muted : COLORS.text, 'center', 700);
      // icons row
      const icons: [string, string][] = [];
      if (r.locked && r.kind !== 'vault') icons.push(['⚿', COLORS.red]);
      if (r.port) icons.push([`${r.port}`, COLORS.red]);
      if (r.intel) icons.push(['◆', COLORS.yellow]);
      if (r.program) icons.push(['✦', COLORS.magenta]);
      if (r.lair) icons.push(['☠', COLORS.red]);
      if (r.kind === 'gate') icons.push(['≈', WYRM_COLORS[s.wyrm.color]]);
      if (r.known === 'seen' && !icons.length) icons.push(['?', COLORS.muted]);
      const line = icons.map(([t]) => t).join(' ');
      ctx.font = `400 ${fs}px ${FONT}`;
      let ix = p.x - ctx.measureText(line).width / 2;
      for (const [t, col] of icons) {
        this.text(t, ix, y + bh * 0.7, fs, col, 'left');
        ix += ctx.measureText(`${t} `).width;
      }
    }

    // the hunting patrol (cleric only)
    if (s.patrolAt && pos.has(s.patrolAt)) {
      const p = pos.get(s.patrolAt)!;
      this.drawEye(p.x + bw / 2 - 6, p.y - bh / 2 - 4, 9, COLORS.red, 0.25 + 0.15 * Math.sin(this.now * 5));
    }

    // the runner token glides between rooms
    const target = pos.get(s.runnerAt);
    if (target) {
      if (!this.runnerPos) this.runnerPos = { ...target };
      this.runnerPos.x += (target.x - this.runnerPos.x) * 0.12;
      this.runnerPos.y += (target.y - this.runnerPos.y) * 0.12;
      const bob = Math.sin(this.now * 4) * 3;
      ctx.globalAlpha = s.ghosted ? 0.35 + 0.2 * Math.sin(this.now * 8) : 1;
      const rogue = s.party.find((m) => m.classes.includes('rogue'));
      const av = rogue ? buildAvatar(avatarSeed(rogue.handle, rogue.avatar), rogue.classes) : undefined;
      if (av) {
        const px = vertical ? 1.6 : 2.2;
        if (vertical) drawAvatar(ctx, av, this.runnerPos.x - bw / 2 - 2 + bob * 0.5, this.runnerPos.y - bh / 2, px, { t: this.now, glow: true });
        else drawAvatar(ctx, av, this.runnerPos.x, this.runnerPos.y - bh / 2 - AV_H * px * 0.5 - 2 + bob, px, { t: this.now, glow: true });
      } else if (vertical) this.drawHero('rogue', this.runnerPos.x - bw / 2 - 2 + bob * 0.5, this.runnerPos.y - bh / 2, 8);
      else this.drawHero('rogue', this.runnerPos.x, this.runnerPos.y - bh / 2 - 16 + bob, 11);
      ctx.globalAlpha = 1;
    }

    // legend
    const legend = this.narrow
      ? '⚿ lock  ◆ intel  ✦ prog  ☠ lair' + (s.patrolAt ? '  ◉ patrol' : '')
      : '⚿ locked  ◆ intel  ✦ program  ☠ ICE lair' + (s.patrolAt ? '  ◉ patrol' : '');
    this.text(legend, 12, this.h - 14, 11, COLORS.muted, 'left');
    if (this.forceMap && s.view !== 'explore') this.text('[map view · press map to return]', this.w - 12, this.h - 14, 11, COLORS.muted, 'right');
  }

  private drawEye(x: number, y: number, r: number, color: string, openness: number) {
    const ctx = this.ctx;
    this.glow(color, 12);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.6, r * Math.max(0.15, openness * 2), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + Math.sin(this.now * 1.7) * r * 0.6, y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    this.noGlow();
  }

  /** Class glyphs: rogue = diamond, mage = triangle, cleric = circle with halo. */
  private drawHero(cls: string, x: number, y: number, size: number, ready?: boolean) {
    const ctx = this.ctx;
    const color = CLASS_COLOR[cls] ?? COLORS.text;
    this.glow(color, 14);
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(7, 6, 13, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (cls === 'rogue') {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size * 0.8, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size * 0.8, y);
      ctx.closePath();
    } else if (cls === 'mage') {
      ctx.moveTo(x, y - size * 1.1);
      ctx.lineTo(x + size, y + size * 0.8);
      ctx.lineTo(x - size, y + size * 0.8);
      ctx.closePath();
    } else {
      ctx.arc(x, y, size * 0.85, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    if (cls === 'cleric') {
      ctx.beginPath();
      ctx.ellipse(x, y - size * 1.25, size * 0.7, size * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // visor / eye
    ctx.fillStyle = color;
    ctx.fillRect(x - size * 0.35, y - size * 0.1, size * 0.7, Math.max(2, size * 0.16));
    this.noGlow();
    if (ready) this.text('✓', x + size * 1.3, y - size, size, COLORS.green, 'center', 700);
  }

  // ---------------------------------------------------------------- combat

  private drawSynthFloor(color: string) {
    const ctx = this.ctx;
    const horizon = this.h * 0.62;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    for (let i = -12; i <= 12; i++) {
      ctx.beginPath();
      ctx.moveTo(this.w / 2 + i * 20, horizon);
      ctx.lineTo(this.w / 2 + i * 140, this.h);
      ctx.stroke();
    }
    const off = (this.now * 0.6) % 1;
    for (let i = 0; i < 9; i++) {
      const k = (i + off) / 9;
      const y = horizon + (this.h - horizon) * k * k;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Pixel size for the crew in a fight: big enough to read, small enough for four to fit. */
  private partyPx() {
    const n = Math.max(1, this.scene?.party.length ?? 1);
    const rows = Math.ceil(n / (n > 2 ? 2 : 1));
    return Math.max(2.5, Math.min(this.narrow ? 3.5 : 6.5, this.h / 70, (this.h * 0.62) / (rows * AV_H * 1.35)));
  }

  private drawCombat(s: SceneState) {
    const c = s.combat;
    this.drawSynthFloor(COLORS.magenta);
    // party on the left
    const n = s.party.length;
    s.party.forEach((m, i) => {
      // one column for small crews, a two-column formation for three or four
      const cols = n > 2 ? 2 : 1;
      const rows = Math.ceil(n / cols);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.w * (cols === 1 ? 0.14 : 0.1 + col * (this.narrow ? 0.17 : 0.12));
      const y = this.h * (rows === 1 ? 0.5 : 0.3 + (row / (rows - 1)) * 0.4) + (col ? this.h * 0.06 : 0);
      const bob = Math.sin(this.now * 3 + i) * 3;
      const px = this.partyPx();
      const flash = this.now - this.partyHitAt < 0.15;
      drawAvatar(this.ctx, buildAvatar(avatarSeed(m.handle, m.avatar), m.classes), x, y + bob, px, { t: this.now, glow: true, flash });
      if (m.ready) this.text('✓', x + AV_W * px * 0.5 + 10, y - AV_H * px * 0.4, 16, COLORS.green, 'center', 700);
      const label = this.narrow || n > 2 ? m.handle.slice(0, 10) : `${m.handle}${m.classes.length ? ` · ${m.classes.join('+')}` : ''}`;
      this.text(label, x, y + AV_H * px * 0.5 + 12, 11, m.you ? COLORS.cyan : COLORS.muted);
    });
    if (!c) return;
    // the monster
    const mx = this.w * 0.74;
    const my = this.h * 0.55;
    const size = Math.min(this.w, this.h) * 0.24;
    const hitAge = this.now - this.monsterHitAt;
    const dying = this.monsterDeath !== undefined ? this.now - this.monsterDeath : -1;
    if (dying < 0 || dying < 0.4) {
      const ctx = this.ctx;
      ctx.save();
      const jitter = hitAge < 0.25 ? (Math.random() - 0.5) * 14 : 0;
      ctx.translate(mx + jitter, my);
      if (dying >= 0) {
        ctx.globalAlpha = Math.max(0, 1 - dying / 0.4);
        ctx.scale(1 + dying, 1 - dying * 1.5);
      }
      const color = hitAge < 0.12 ? '#ffffff' : COLORS.red;
      drawMonster(ctx, c.monster, size, this.now, color, (cl, b) => this.glow(cl, b), () => this.noGlow());
      ctx.restore();
    }
    // name + HP bar
    const bw = Math.min(260, this.w * 0.3);
    const bx = mx - bw / 2;
    const by = this.h * 0.1;
    this.text(c.name.toUpperCase(), mx, by, 14, COLORS.red, 'center', 700);
    this.ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this.ctx.fillRect(bx, by + 14, bw, 8);
    this.glow(COLORS.red, 8);
    this.ctx.fillStyle = COLORS.red;
    this.ctx.fillRect(bx, by + 14, bw * (c.hp / c.maxHp), 8);
    this.noGlow();
    this.text(`${c.hp}/${c.maxHp} HP · round ${c.round}`, mx, by + 34, 11, COLORS.muted);
  }

  // ---------------------------------------------------------------- parley

  private drawParley(s: SceneState) {
    const ctx = this.ctx;
    const color = WYRM_COLORS[s.wyrm.color];
    const p = s.parley ?? { suspicion: 40, sealed: false };
    const t = this.now;
    // the coiled body, tail to head
    const hx = this.narrow ? this.w * 0.5 : this.w * 0.6;
    const hy = this.narrow ? this.h * 0.47 : this.h * 0.42;
    const seg = 26;
    const r0 = Math.min(this.w, this.h) * 0.075;
    for (let i = seg; i >= 1; i--) {
      const k = i / seg;
      const x = hx + r0 * 1.2 + k * this.w * 0.32 + Math.sin(k * 7 + t * 0.9) * this.w * 0.02;
      const y = hy + Math.sin(k * Math.PI * 2.2 + t * 1.1) * this.h * 0.12 * k * 1.6 + k * this.h * 0.34;
      const r = r0 * (k < 0.18 ? 0.55 + k * 2.4 : 0.98 - (k - 0.18) * 0.7);
      ctx.fillStyle = '#0c0a18';
      this.glow(color, 8);
      ctx.strokeStyle = color;
      ctx.globalAlpha = p.sealed ? 0.4 : 0.9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // a spine ridge
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r);
      ctx.lineTo(x, y - r * 1.5);
      ctx.lineTo(x + r * 0.3, y - r);
      ctx.stroke();
    }
    ctx.globalAlpha = p.sealed ? 0.5 : 1;
    // the head, facing left
    const breathe = Math.sin(t * 1.5) * 4;
    const hs = r0 * 1.9;
    ctx.save();
    ctx.translate(hx, hy + breathe);
    ctx.fillStyle = '#0c0a18';
    this.glow(color, 16);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hs * 0.6, -hs * 0.45);
    ctx.quadraticCurveTo(-hs * 0.4, -hs * 0.55, -hs * 1.35, -hs * 0.1);
    ctx.lineTo(-hs * 1.3, hs * 0.05);
    ctx.lineTo(-hs * 0.2, hs * 0.05);
    const jaw = 0.12 + 0.08 * Math.sin(t * 1.5);
    ctx.lineTo(-hs * 1.2, hs * (0.12 + jaw));
    ctx.quadraticCurveTo(-hs * 0.2, hs * 0.55, hs * 0.6, hs * 0.45);
    ctx.quadraticCurveTo(hs * 1.0, 0, hs * 0.6, -hs * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // horns
    ctx.beginPath();
    ctx.moveTo(hs * 0.3, -hs * 0.45);
    ctx.quadraticCurveTo(hs * 0.7, -hs * 1.1, hs * 1.1, -hs * 1.15);
    ctx.moveTo(hs * 0.05, -hs * 0.5);
    ctx.quadraticCurveTo(hs * 0.3, -hs * 1.0, hs * 0.65, -hs * 1.25);
    ctx.stroke();
    // teeth
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const tx = -hs * 1.15 + i * hs * 0.2;
      ctx.moveTo(tx, hs * 0.04);
      ctx.lineTo(tx + hs * 0.05, hs * 0.14);
      ctx.lineTo(tx + hs * 0.1, hs * 0.04);
    }
    ctx.stroke();
    // the eye: its slit narrows as suspicion rises
    const sus = Math.max(0, Math.min(100, p.suspicion)) / 100;
    const eyeColor = sus > 0.7 ? COLORS.red : sus > 0.45 ? COLORS.yellow : color;
    this.glow(eyeColor, 20);
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.ellipse(-hs * 0.35, -hs * 0.22, hs * 0.2, hs * 0.11, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05040a';
    ctx.beginPath();
    ctx.ellipse(-hs * 0.35, -hs * 0.22, hs * (0.07 - sus * 0.055), hs * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.noGlow();
    ctx.globalAlpha = 1;

    // breath
    if (!p.sealed && Math.random() < 0.5) {
      this.particles.push({ x: hx - hs * 1.3, y: hy + hs * 0.1 + breathe, vx: -30 - Math.random() * 40, vy: (Math.random() - 0.5) * 20, life: 0, max: 1.2, color, size: 2 });
    }

    // suspicion meter
    const mw = this.narrow ? this.w * 0.4 : Math.min(220, this.w * 0.28);
    const mx = this.w - mw - 16;
    const my = this.narrow ? this.h * 0.47 + Math.min(this.w, this.h) * 0.2 : 46;
    if (!this.narrow) this.text(`${s.wyrm.name} · ${s.wyrm.title}`, this.w - 16, 18, 12, color, 'right', 700);
    this.text('suspicion', mx, my - 8, 10, COLORS.muted, 'left');
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(mx, my, mw, 6);
    ctx.fillStyle = eyeColor;
    ctx.fillRect(mx, my, mw * sus, 6);

    // speech bubbles: beside the wyrm on wide screens, above and below it on phones
    const rogue = s.party.find((m) => m.classes.includes('rogue'));
    const speaker = rogue ? buildAvatar(avatarSeed(rogue.handle, rogue.avatar), rogue.classes) : undefined;
    const apx = this.narrow ? 2.4 : 3.2;
    const indent = speaker ? AV_W * apx + 10 : 0;
    if (this.narrow) {
      const bw = this.w - 24;
      if (p.reply) this.bubble(p.reply, 12, 10, bw, color, 'right', 3);
      if (p.said) {
        const box = this.bubble(p.said, 12 + indent, -10, bw - indent, COLORS.green, 'left', 2);
        if (speaker) drawAvatar(ctx, speaker, 12 + (AV_W * apx) / 2, box.y + box.h / 2, apx, { t: this.now, glow: true });
      }
    } else {
      const bubbleW = Math.min(360, this.w * 0.42);
      if (p.reply) this.bubble(p.reply, 16, 16, bubbleW, color, 'right');
      if (p.said) {
        const box = this.bubble(p.said, 16 + indent, this.h * 0.62, bubbleW, COLORS.green, 'left');
        if (speaker) drawAvatar(ctx, speaker, 16 + (AV_W * apx) / 2, box.y + box.h / 2, apx, { t: this.now, glow: true });
      }
    }
    if (!p.reply && !p.said) {
      const hint = this.wrap('the wyrm watches you. press "talk" and say something clever.', this.w * 0.8, 12);
      hint.forEach((l, i) => this.text(l, this.w / 2, this.h * 0.88 + i * 16, 12, COLORS.muted));
    }
    if (p.sealed) this.text(this.narrow ? 'SEALED · use the code' : 'SEALED · only the code opens the vault now', this.w / 2, this.h * 0.5, 14, COLORS.red, 'center', 700);
  }

  /** A speech bubble. A negative y anchors it that far from the bottom edge. */
  private bubble(str: string, x: number, y: number, maxW: number, color: string, tail: 'left' | 'right', maxLines = 6): { y: number; h: number } {
    const ctx = this.ctx;
    const size = this.narrow ? 11 : 12;
    let lines = this.wrap(str, maxW - 20, size);
    if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]!.slice(0, -1)}…`];
    const h = lines.length * (size + 5) + 16;
    if (y < 0) y = this.h + y - h - 12;
    ctx.fillStyle = 'rgba(7, 6, 13, 0.88)';
    this.roundRect(x, y, maxW, h, 8);
    ctx.fill();
    this.glow(color, 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    const tx = tail === 'right' ? x + maxW - 30 : x + 30;
    ctx.moveTo(tx, y + h);
    ctx.lineTo(tx + (tail === 'right' ? 18 : -6), y + h + 12);
    ctx.lineTo(tx + 10, y + h);
    ctx.stroke();
    this.noGlow();
    lines.forEach((l, i) => this.text(l, x + 10, y + 14 + i * (size + 5), size, COLORS.text, 'left'));
    return { y, h };
  }

  private drawChats() {
    const life = 4.5;
    this.chats = this.chats.filter((c) => this.now - c.t0 < life);
    const px = this.narrow ? 2.2 : 2.8;
    const aw = AV_W * px;
    const maxW = Math.min(320, this.w - aw - 40);
    // above the map legend in a delve; lower in the lobby, clear of the crew's names
    let bottom = this.scene ? this.h - 30 : this.h - 8;
    for (const c of [...this.chats].reverse()) {
      const age = this.now - c.t0;
      const alpha = Math.min(1, age * 5, (life - age) / 0.6);
      const slide = Math.max(0, 1 - age * 6) * -30;
      this.ctx.globalAlpha = Math.max(0, alpha);
      const size = 11;
      const lines = this.wrap(c.text, maxW - 20, size).slice(0, 2);
      const h = Math.max(AV_H * px, lines.length * (size + 5) + 22);
      const y = bottom - h;
      const x = 12 + slide;
      this.ctx.fillStyle = 'rgba(7, 6, 13, 0.9)';
      this.roundRect(x, y, aw + maxW + 16, h, 6);
      this.ctx.fill();
      this.ctx.strokeStyle = 'rgba(255, 43, 214, 0.6)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      drawAvatar(this.ctx, buildAvatar(avatarSeed(c.handle, c.avatar), c.classes), x + 6 + aw / 2, y + h / 2, px, { t: this.now, glow: true });
      this.text(c.handle, x + aw + 14, y + 10, 10, COLORS.magenta, 'left', 700);
      lines.forEach((l, i) => this.text(l, x + aw + 14, y + 24 + i * (size + 5), size, COLORS.text, 'left'));
      bottom = y - 6;
    }
    this.ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- vault

  private drawVault(_s: SceneState) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h * 0.5;
    const r = Math.min(this.w, this.h) * 0.2;
    const spin = this.now * 0.4;
    this.glow(COLORS.gold, 24);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 2.5;
    for (const k of [1, 0.7]) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = spin * (k === 1 ? 1 : -1.5) + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * r * k;
        const y = cy + Math.sin(a) * r * k;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    this.noGlow();
    this.text('payload.dat', cx, cy, Math.max(14, r * 0.22), COLORS.gold, 'center', 700);
    this.text('the hoard is open. DOWNLOAD it.', cx, cy + r + 30, 13, COLORS.text);
    if (Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: Math.cos(a) * 20, vy: -30 - Math.random() * 30, life: 0, max: 1.4, color: COLORS.gold, size: 2 });
    }
  }

  // ---------------------------------------------------------------- overlays

  private drawParticles(dt: number) {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private drawFloaters() {
    for (const f of this.floaters) {
      const age = this.now - f.t0;
      this.ctx.globalAlpha = Math.max(0, 1 - age / 1.4);
      this.glow(f.color, 10);
      this.text(f.text, f.x, f.y - age * 40, f.big ? 22 : 15, f.color, 'center', 700);
      this.noGlow();
    }
    this.ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => this.now - f.t0 < 1.4);
  }

  private drawDie() {
    const d = this.die!;
    const age = this.now - d.t0;
    const spinFor = 0.85;
    const holdUntil = 1.5;
    const fadeUntil = 1.85;
    if (age > holdUntil && d.resolve) {
      const r = d.resolve;
      d.resolve = () => {};
      r();
    }
    if (age > fadeUntil) {
      this.die = undefined;
      return;
    }
    const ctx = this.ctx;
    const landed = age >= spinFor;
    const o = d.roll.outcome;
    const color = !landed ? COLORS.yellow : o === 'crit' ? COLORS.gold : o === 'success' ? COLORS.green : o === 'fumble' || o === 'fail' ? COLORS.red : COLORS.yellow;
    const alpha = age > holdUntil ? 1 - (age - holdUntil) / (fadeUntil - holdUntil) : Math.min(1, age * 6);
    const r = Math.min(this.w, this.h) * 0.13;
    const cx = this.scene?.view === 'combat' && !this.forceMap ? this.w * 0.44 : this.w / 2;
    const cy = this.h * 0.45;
    const rot = landed ? 0 : (1 - age / spinFor) ** 2 * 14;
    const scale = landed ? 1 + Math.max(0, 0.25 - (age - spinFor)) : 0.8 + 0.2 * Math.sin(age * 30);

    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    this.glow(color, 26);
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(12, 10, 26, 0.95)';
    ctx.lineWidth = 3;
    // icosahedron silhouette: hexagon with an inner triangle
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const tri = [0, 2, 4].map((i) => -Math.PI / 2 + (i * Math.PI) / 3);
    tri.forEach((a, i) => {
      const x = Math.cos(a) * r * 0.62;
      const y = Math.sin(a) * r * 0.62;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const b = tri[Math.round(i / 2) % 3]!;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * r * 0.62, Math.sin(b) * r * 0.62);
      ctx.stroke();
    }
    ctx.restore();
    const face = landed ? d.roll.natural : 1 + Math.floor(Math.random() * d.roll.sides);
    this.text(String(face), cx, cy + 2, r * 0.55, color, 'center', 700);
    this.noGlow();
    if (landed) {
      const label = o === 'crit' ? 'CRITICAL!' : o === 'fumble' ? 'FUMBLE!' : o === 'success' ? 'SUCCESS' : o === 'fail' ? 'FAIL' : '';
      if (label) this.text(label, cx, cy + r + 26, 20, color, 'center', 700);
      if (o === 'crit' && age - spinFor < 0.05) this.burst(cx, cy, COLORS.gold, 60);
    }
    if (d.roll.caption) this.text(d.roll.caption, cx, cy - r - 22, 13, COLORS.text);
    ctx.globalAlpha = 1;
  }

  private drawOverlay() {
    const o = this.overlay!;
    const age = this.now - o.t0;
    const ctx = this.ctx;
    if (o.kind === 'intro') {
      const total = 5.2;
      if (age > total) {
        this.overlay = undefined;
        return;
      }
      const fade = age > total - 0.8 ? 1 - (age - (total - 0.8)) / 0.8 : 1;
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#05040a';
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawCity(fade);
      ctx.globalAlpha = fade;
      // the wyrm's eyes open beneath the tower
      if (age > 2.2) {
        const open = Math.min(1, (age - 2.2) / 0.6);
        this.drawEye(this.w * 0.44, this.h * 0.92, 10, o.color, open * 0.3);
        this.drawEye(this.w * 0.56, this.h * 0.92, 10, o.color, open * 0.3);
      }
      const title = 'THE DELVE';
      const shown = title.slice(0, Math.floor(age * 8));
      const size = Math.min(48, this.w / 10);
      this.glow(COLORS.cyan, 18);
      this.text(shown, this.w / 2, this.h * 0.22, size, COLORS.cyan, 'center', 700);
      this.noGlow();
      if (age > 1.2) this.text(`${o.corp} · ${o.district}`, this.w / 2, this.h * 0.22 + size, 14, COLORS.magenta);
      if (age > 2.6) {
        this.wrap(`beneath the tower sleeps ${o.wyrm}, a ${o.title}`, this.w - 40, 13).forEach((l, i) => this.text(l, this.w / 2, this.h * 0.22 + size + 26 + i * 18, 13, o.color));
      }
      ctx.globalAlpha = 1;
      return;
    }
    // end screen
    const a = Math.min(1, age * 2);
    ctx.globalAlpha = a * 0.92;
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = a;
    const color = o.win ? COLORS.gold : COLORS.red;
    const size = Math.min(52, this.w / 11);
    this.glow(color, 24);
    this.text(o.win ? 'DELVE COMPLETE' : 'FLATLINED', this.w / 2, this.h * 0.42, size, color, 'center', 700);
    this.noGlow();
    this.text(o.win ? 'the hoard is yours' : 'the tower burned your decks', this.w / 2, this.h * 0.42 + size, 14, COLORS.text);
    ctx.globalAlpha = 1;
    if (o.win && Math.random() < 0.3) this.burst(Math.random() * this.w, this.h * 0.3, Math.random() < 0.5 ? COLORS.gold : COLORS.cyan, 12);
  }

  private drawScanlines() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < this.h; y += 3) ctx.fillRect(0, y, this.w, 1);
  }
}

// ---------------------------------------------------------------- monsters

type GlowFn = (color: string, blur: number) => void;

/** Each ICE monster is a little animated vector creature centred on (0, 0). */
function drawMonster(ctx: CanvasRenderingContext2D, id: string, s: number, t: number, color: string, glow: GlowFn, noGlow: () => void) {
  glow(color, 18);
  ctx.strokeStyle = color;
  ctx.fillStyle = '#0c0a18';
  ctx.lineWidth = 2.5;
  const eyes = (pts: [number, number][], r: number) => {
    ctx.fillStyle = color;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0c0a18';
  };

  switch (id) {
    case 'hound': {
      const step = Math.sin(t * 8);
      ctx.beginPath();
      // spiky back
      ctx.moveTo(-s * 0.9, -s * 0.1);
      for (let i = 0; i <= 8; i++) {
        const x = -s * 0.7 + i * s * 0.18;
        ctx.lineTo(x, -s * (i % 2 ? 0.55 : 0.35) + Math.sin(t * 6 + i) * 3);
      }
      ctx.lineTo(s * 0.8, s * 0.05);
      ctx.lineTo(s * 0.7, s * 0.3);
      ctx.lineTo(-s * 0.6, s * 0.3);
      ctx.lineTo(-s * 1.0, s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // legs
      ctx.beginPath();
      for (const [x, ph] of [[-s * 0.45, 0], [-s * 0.15, 1], [s * 0.25, 0], [s * 0.55, 1]] as const) {
        const sw = (ph ? step : -step) * s * 0.1;
        ctx.moveTo(x, s * 0.3);
        ctx.lineTo(x + sw, s * 0.65);
      }
      ctx.stroke();
      // jaws
      const open = 0.1 + 0.08 * Math.abs(Math.sin(t * 5));
      ctx.beginPath();
      ctx.moveTo(-s * 1.0, s * 0.1);
      ctx.lineTo(-s * 1.35, s * (0.1 + open));
      ctx.lineTo(-s * 0.85, s * 0.22);
      ctx.stroke();
      eyes([[-s * 0.78, -s * 0.05], [-s * 0.62, -s * 0.07]], s * 0.05);
      break;
    }
    case 'ooze': {
      ctx.beginPath();
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI + (i / n) * Math.PI;
        const r = s * (0.8 + 0.08 * Math.sin(a * 5 + t * 3) + 0.05 * Math.sin(a * 9 - t * 4));
        const x = Math.cos(a) * r * 1.2;
        const y = Math.sin(a) * r * (0.9 + 0.05 * Math.sin(t * 2)) + s * 0.4;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      eyes([[-s * 0.3, -s * 0.1 + Math.sin(t * 2) * 4], [s * 0.15, -s * 0.18 + Math.cos(t * 2) * 4], [s * 0.45, 0]], s * 0.06);
      // drips
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.6 + i / 3) % 1;
        ctx.fillStyle = color;
        ctx.fillRect(-s * 0.6 + i * s * 0.6, s * 0.4 + k * s * 0.3, 3, 6);
      }
      break;
    }
    case 'sentinel': {
      const sway = Math.sin(t * 1.5) * 0.08;
      ctx.save();
      ctx.rotate(sway * 0.3);
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.9);
      ctx.lineTo(s * 0.3, -s * 0.9);
      ctx.lineTo(s * 0.4, s * 0.7);
      ctx.lineTo(-s * 0.4, s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // visor
      ctx.fillStyle = color;
      ctx.fillRect(-s * 0.2, -s * 0.7, s * 0.4, s * 0.06);
      // shield
      ctx.fillStyle = '#0c0a18';
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.3);
      ctx.lineTo(-s * 0.85, -s * 0.2);
      ctx.lineTo(-s * 0.8, s * 0.3);
      ctx.lineTo(-s * 0.5, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // blade
      ctx.save();
      ctx.translate(s * 0.45, -s * 0.1);
      ctx.rotate(0.45 + Math.sin(t * 2) * 0.25);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -s * 1.0);
      ctx.moveTo(-s * 0.12, -s * 0.08);
      ctx.lineTo(s * 0.12, -s * 0.08);
      ctx.stroke();
      ctx.restore();
      ctx.restore();
      break;
    }
    case 'kraken': {
      for (let i = 0; i < 7; i++) {
        const base = -Math.PI * 0.05 + (i / 6) * Math.PI * 1.1;
        ctx.beginPath();
        let x = Math.cos(base) * s * 0.4;
        let y = Math.sin(base) * s * 0.3;
        ctx.moveTo(x, y);
        for (let k = 1; k <= 10; k++) {
          const a = base + Math.sin(t * 2 + i + k * 0.5) * 0.35;
          x += Math.cos(a) * s * 0.09;
          y += Math.sin(a) * s * 0.09 + 1.5;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.15, s * 0.5, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      eyes([[-s * 0.18, -s * 0.15], [s * 0.18, -s * 0.15]], s * 0.08);
      // glitch blocks
      ctx.fillStyle = color;
      for (let i = 0; i < 4; i++) {
        if (Math.sin(t * 13 + i * 3) > 0.7) ctx.fillRect((Math.sin(i * 9.1) - 0.5) * s * 1.6, (Math.cos(i * 4.7) - 0.3) * s, 10, 4);
      }
      break;
    }
    default: {
      // mimic: a chest whose lid gapes open
      const open = 0.15 + 0.25 * Math.max(0, Math.sin(t * 2.2));
      ctx.beginPath();
      ctx.rect(-s * 0.7, -s * 0.1, s * 1.4, s * 0.7);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(-s * 0.7, -s * 0.1);
      ctx.rotate(-open);
      ctx.beginPath();
      ctx.rect(0, -s * 0.35, s * 1.4, s * 0.35);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        ctx.moveTo(s * 0.1 + i * s * 0.18, 0);
        ctx.lineTo(s * 0.18 + i * s * 0.18, s * 0.12);
        ctx.lineTo(s * 0.26 + i * s * 0.18, 0);
      }
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        ctx.moveTo(-s * 0.6 + i * s * 0.18, -s * 0.1);
        ctx.lineTo(-s * 0.52 + i * s * 0.18, -s * 0.22);
        ctx.lineTo(-s * 0.44 + i * s * 0.18, -s * 0.1);
      }
      ctx.stroke();
      eyes([[-s * 0.25, -s * 0.28 - open * s * 0.3], [s * 0.25, -s * 0.3 - open * s * 0.3]], s * 0.05);
      break;
    }
  }
  noGlow();
}
