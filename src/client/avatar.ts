// Procedural pixel-art avatars: small symmetric non-human creatures, grown
// from a seed (the player's handle plus how many times they've rerolled).
// Class gear (hood, antenna crown, halo) is drawn over the creature, so a
// player keeps the same body whatever role they're dealt.

export const AV_W = 11;
export const AV_H = 12;

/** Cell codes: b body, s shade, e eye, m mouth cut-out, g gear, t glowing gear tip, h halo. */
type Cell = 'b' | 's' | 'e' | 'm' | 'g' | 't' | 'h' | null;

export interface Avatar {
  grid: Cell[][];
  body: string;
  shade: string;
  eye: string;
  gear: string;
  /** Blink phase offset so a crew doesn't blink in unison. */
  phase: number;
}

const CLASS_GEAR: Record<string, string> = { rogue: '#39ff88', mage: '#00f0ff', cleric: '#ffe600' };

/** FNV-1a: a small stable string hash. */
export function avatarSeed(handle: string, reroll = 0): number {
  let h = 0x811c9dc5;
  for (const ch of `${handle.toLowerCase()}#${reroll}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Avatar>();

export function buildAvatar(seed: number, classes: string[] = []): Avatar {
  const key = `${seed}:${classes.join('+')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const r = rng(seed);
  // Colours first, and every random draw below happens whatever the class,
  // so the creature is identical with or without gear.
  const hue = Math.floor(r() * 360);
  const phase = r() * 4;
  const grid: Cell[][] = Array.from({ length: AV_H }, () => Array<Cell>(AV_W).fill(null));
  const set = (row: number, col: number, v: Cell) => {
    if (row < 0 || row >= AV_H || col < 0 || col >= AV_W) return;
    grid[row]![col] = v;
    grid[row]![AV_W - 1 - col] = v;
  };
  const get = (row: number, col: number) => grid[row]?.[col] ?? null;

  // The creature lives in rows 3-11; rows 0-2 are left for gear.
  const headRows = 3 + Math.floor(r() * 2); // 3-4 rows of head
  for (let row = 3; row < AV_H; row++) {
    const zone = row < 3 + headRows ? 'head' : row < 10 ? 'body' : 'legs';
    for (let col = 1; col <= 5; col++) {
      const centre = 1 - (5 - col) / 5; // 0.2 at the edge, 1 at the spine
      const density = zone === 'head' ? 0.35 + centre * 0.6 : zone === 'body' ? 0.2 + centre * 0.6 : 0.15 + (col % 2) * 0.35;
      if (r() < density) set(row, col, 'b');
    }
  }
  // a spine so it reads as one creature
  for (let row = 4; row <= 8; row++) set(row, 5, 'b');
  for (let row = 4; row <= 6; row++) set(row, 4, 'b');

  // eyes: never two, mostly
  const eyeRow = 5;
  const eyes = r();
  const eyeCols = eyes < 0.3 ? [5] : eyes < 0.55 ? [3, 5] : eyes < 0.8 ? [3] : [2, 4];
  for (const c of eyeCols) {
    set(eyeRow, c, 'e');
    if (!get(eyeRow - 1, c)) set(eyeRow - 1, c, 'b');
    if (!get(eyeRow + 1, c)) set(eyeRow + 1, c, 'b');
  }
  // a grille mouth
  if (r() < 0.55) {
    const mr = eyeRow + 2;
    set(mr, 4, 'm');
    set(mr, 5, 'm');
  }
  // feelers when there's no gear to make room for
  const feelers = r() < 0.5;
  if (!classes.length && feelers) {
    set(2, 3, 'b');
    set(1, 2, 'b');
  }
  // shade the undersides for a bit of depth
  for (let row = 0; row < AV_H; row++) {
    for (let col = 0; col < AV_W; col++) {
      if (get(row, col) === 'b' && !get(row + 1, col)) grid[row]![col] = 's';
    }
  }

  // class gear on top
  const has = (c: string) => classes.includes(c);
  if (has('rogue')) {
    for (let c = 2; c <= 5; c++) set(2, c, 'g');
    set(3, 1, 'g');
    set(4, 1, 'g');
    set(5, 0, 'g');
    set(3, 2, 'g');
  }
  if (has('mage')) {
    set(2, 3, 'g');
    set(2, 5, 'g');
    set(1, 5, 'g');
    set(0, 5, 't');
  }
  if (has('cleric')) {
    if (!has('mage')) {
      for (let c = 3; c <= 5; c++) set(0, c, 'h');
      set(1, 2, 'h');
    }
    set(8, 5, 'h');
    set(9, 4, 'h');
    set(9, 5, 'h');
    set(10, 5, 'h');
  }

  const gear = CLASS_GEAR[classes[0] ?? ''] ?? `hsl(${(hue + 160) % 360} 90% 65%)`;
  const avatar: Avatar = {
    grid,
    body: `hsl(${hue} 70% 58%)`,
    shade: `hsl(${hue} 65% 34%)`,
    eye: `hsl(${(hue + 180) % 360} 100% 82%)`,
    gear,
    phase,
  };
  cache.set(key, avatar);
  return avatar;
}

export interface DrawOpts {
  /** Seconds, for blinking and the glowing tip. Omit for a still frame. */
  t?: number;
  /** Draw it all white (a hit flash). */
  flash?: boolean;
  glow?: boolean;
}

/** Draw centred on (cx, cy) with each pixel `px` screen pixels wide. */
export function drawAvatar(ctx: CanvasRenderingContext2D, av: Avatar, cx: number, cy: number, px: number, opts: DrawOpts = {}) {
  const t = opts.t ?? 0;
  const blink = opts.t !== undefined && (t + av.phase) % 4 < 0.12;
  const x0 = Math.round(cx - (AV_W * px) / 2);
  const y0 = Math.round(cy - (AV_H * px) / 2);
  const p = Math.ceil(px);
  for (let row = 0; row < AV_H; row++) {
    for (let col = 0; col < AV_W; col++) {
      const cell = av.grid[row]![col];
      if (!cell) continue;
      let color: string;
      switch (cell) {
        case 'b': color = av.body; break;
        case 's': color = av.shade; break;
        case 'e': color = blink ? av.shade : av.eye; break;
        case 'm': color = '#05040a'; break;
        case 'g': color = av.gear; break;
        case 't': color = av.gear; break;
        case 'h': color = '#ffe600'; break;
      }
      if (opts.flash && cell !== 'm') color = '#ffffff';
      const glowing = opts.glow && (cell === 'e' || cell === 't' || cell === 'h');
      if (glowing) {
        ctx.shadowColor = color;
        ctx.shadowBlur = px * 2.5 * (cell === 't' ? 0.6 + 0.4 * Math.sin(t * 5) : 1);
      }
      ctx.fillStyle = color;
      ctx.fillRect(x0 + col * px, y0 + row * px, p, p);
      if (glowing) ctx.shadowBlur = 0;
    }
  }
}

const urlCache = new Map<string, string>();

/** A still PNG of the avatar for HTML (HUD chips), cached per seed and class. */
export function avatarDataUrl(seed: number, classes: string[] = [], px = 3): string {
  const key = `${seed}:${classes.join('+')}:${px}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = AV_W * px;
  canvas.height = AV_H * px;
  drawAvatar(canvas.getContext('2d')!, buildAvatar(seed, classes), canvas.width / 2, canvas.height / 2, px);
  const url = canvas.toDataURL();
  urlCache.set(key, url);
  return url;
}
