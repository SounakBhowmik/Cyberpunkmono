// Procedural pixel-art avatars: small mythical creatures (kitsune, griffin,
// naga, oni, phoenix, wisp, tengu) grown from a seed: the player's handle plus
// how many times they've rerolled. The species, palette and markings come from
// the seed; class gear (blade, rune orb, shield) is drawn over the top, so a
// player keeps the same creature whatever class they're dealt.

export const AV_W = 11;
export const AV_H = 12;

/** b body, s shade, e eye, a accent (tails, wings, flame), w bone (beak, horns, fangs), g gear, t glowing gear. */
type Cell = 'b' | 's' | 'e' | 'a' | 'w' | 'g' | 't' | null;

interface Species {
  name: string;
  rows: string[];
  /** Accent hue range: fire creatures burn warm, the rest contrast with their body. */
  accent: 'fire' | 'contrast';
}

const SPECIES: Species[] = [
  {
    name: 'kitsune',
    accent: 'contrast',
    rows: [
      '.b.......b.',
      '.bb.....bb.',
      '.bab...bab.',
      '.bbbbbbbbb.',
      'bbebbbbbebb',
      'bbbbbbbbbbb',
      '.bbbwwwbbb.',
      '..bbbsbbb..',
      'a..bbbbb..a',
      'aa.bbbbb.aa',
      '.aabbbbbaa.',
      '..bb...bb..',
    ],
  },
  {
    name: 'griffin',
    accent: 'contrast',
    rows: [
      '....bbb....',
      '...bbbbb...',
      '...bebbb...',
      '..bbbbwww..',
      'a..bbbbww.a',
      'aa.bbbbb.aa',
      'aaabbbbbaaa',
      '.aabbbbbaa.',
      '...bbbbb...',
      '...bs.sb...',
      '..ww...ww..',
      '...........',
    ],
  },
  {
    name: 'naga',
    accent: 'contrast',
    rows: [
      '...bbbbb...',
      '..bbbbbbb..',
      '.bbaebeabb.',
      '.bbbbbbbbb.',
      '.bbbbwbbbb.',
      '..bbbbbbb..',
      '...abbba...',
      '....bbb....',
      '...bbb.....',
      '..bbb......',
      '..bbbbbb...',
      '...sssss...',
    ],
  },
  {
    name: 'oni',
    accent: 'contrast',
    rows: [
      'w.........w',
      'ww.......ww',
      '.wbbbbbbbw.',
      '.bbbbbbbbb.',
      '.beebbbeeb.',
      '.bbbbbbbbb.',
      '.bwbbbbbwb.',
      '.bbaaaaabb.',
      '..bbbbbbb..',
      '.bbbbbbbbb.',
      'bb.bbbbb.bb',
      '...bb.bb...',
    ],
  },
  {
    name: 'phoenix',
    accent: 'fire',
    rows: [
      '.....a.....',
      '....aaa....',
      '....bbb....',
      '...bebbw...',
      'a..bbbbww.a',
      'aa.bbbbb.aa',
      'aaaabbbaaaa',
      '.aaabbbaaa.',
      '..aabbbaa..',
      '....bab....',
      '...aa.aa...',
      '..a.....a..',
    ],
  },
  {
    name: 'wisp',
    accent: 'fire',
    rows: [
      '.....a.....',
      '....aa.....',
      '...aaaa.a..',
      '..aabbaaa..',
      '.aabbbbba..',
      '.abebbbeba.',
      '.abbbbbbba.',
      '.abbbwbbba.',
      '..abbbbba..',
      '...abbba...',
      '....aba....',
      '.....a.....',
    ],
  },
  {
    name: 'tengu',
    accent: 'contrast',
    rows: [
      '...bbbbb...',
      '..bbbbbbb..',
      '..beebbeb..',
      '..bbbbbbb..',
      '..bbbbwwwww',
      'a..bbbbb..a',
      'aa.bbbbb.aa',
      'aaabbbbbaaa',
      '..abbbbba..',
      '...bbbbb...',
      '...b...b...',
      '..bb...bb..',
    ],
  },
];

export interface Avatar {
  species: string;
  grid: Cell[][];
  body: string;
  shade: string;
  eye: string;
  accent: string;
  bone: string;
  gear: string;
  /** Blink phase offset so a crew doesn't blink in unison. */
  phase: number;
}

const CLASS_GEAR: Record<string, string> = { striker: '#ff3860', mystic: '#00f0ff', guardian: '#ffe600' };

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

  // every random draw happens regardless of class, so gear never changes the creature
  const r = rng(seed);
  const species = SPECIES[Math.floor(r() * SPECIES.length)]!;
  const hue = Math.floor(r() * 360);
  const fireHue = 10 + Math.floor(r() * 40);
  const phase = r() * 4;
  const marking = Math.floor(r() * 3);
  const flip = r() < 0.5;

  const grid: Cell[][] = species.rows.map((row) => [...(flip ? [...row].reverse().join('') : row)].map((ch) => (ch === '.' ? null : (ch as Cell))));
  // markings: a little per-creature pattern so two kitsune never match
  const markRows = marking === 0 ? [5, 6] : marking === 1 ? [3, 8] : [7];
  for (const row of markRows) {
    for (let col = 0; col < AV_W; col++) {
      if (grid[row]?.[col] === 'b' && (col + row) % 3 === 0) grid[row]![col] = 's';
    }
  }

  const put = (row: number, col: number, v: Cell) => {
    if (row >= 0 && row < AV_H && col >= 0 && col < AV_W) grid[row]![col] = v;
  };
  const has = (c: string) => classes.includes(c);
  if (has('striker')) {
    // a blade over the shoulder
    for (let row = 1; row <= 7; row++) put(row, 10, 'g');
    put(0, 10, 't');
    put(7, 9, 'g');
  }
  if (has('mystic')) {
    // a floating rune orb
    put(0, 1, 't');
    put(1, 0, 't');
    put(1, 2, 't');
    put(1, 1, 'g');
  }
  if (has('guardian')) {
    // a little shield in front
    for (const [row, col] of [[8, 0], [8, 1], [8, 2], [9, 0], [9, 1], [9, 2], [10, 1]] as const) put(row, col, 'g');
    put(9, 1, 't');
  }

  const accentHue = species.accent === 'fire' ? fireHue : (hue + 150 + Math.floor(r() * 60)) % 360;
  const avatar: Avatar = {
    species: species.name,
    grid,
    body: `hsl(${hue} 65% 56%)`,
    shade: `hsl(${hue} 60% 32%)`,
    eye: `hsl(${(hue + 180) % 360} 100% 85%)`,
    accent: species.accent === 'fire' ? `hsl(${accentHue} 100% 60%)` : `hsl(${accentHue} 85% 62%)`,
    bone: '#f2ead8',
    gear: CLASS_GEAR[classes[0] ?? ''] ?? '#d7e3ff',
    phase,
  };
  cache.set(key, avatar);
  return avatar;
}

export interface DrawOpts {
  /** Seconds, for blinking, flickering flame and glowing gear. Omit for a still frame. */
  t?: number;
  /** Draw it all white (a hit flash). */
  flash?: boolean;
  glow?: boolean;
}

/** Draw centred on (cx, cy) with each pixel `px` screen pixels wide. */
export function drawAvatar(ctx: CanvasRenderingContext2D, av: Avatar, cx: number, cy: number, px: number, opts: DrawOpts = {}) {
  const t = opts.t ?? 0;
  const live = opts.t !== undefined;
  const blink = live && (t + av.phase) % 4 < 0.12;
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
        case 'a': color = av.accent; break;
        case 'w': color = av.bone; break;
        case 'g': color = av.gear; break;
        case 't': color = av.gear; break;
      }
      if (opts.flash) color = '#ffffff';
      // accent pixels shimmer (flame, tails, wings)
      const shimmer = live && cell === 'a' ? Math.sin(t * 6 + row * 0.9 + col * 0.4) * 0.5 + 0.5 : 1;
      const glowing = opts.glow && (cell === 'e' || cell === 't' || (cell === 'a' && shimmer > 0.7));
      if (glowing) {
        ctx.shadowColor = color;
        ctx.shadowBlur = px * 2.5 * (cell === 't' ? 0.6 + 0.4 * Math.sin(t * 5) : 1);
      }
      if (shimmer < 1) ctx.globalAlpha = 0.7 + shimmer * 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(x0 + col * px, y0 + row * px, p, p);
      if (shimmer < 1) ctx.globalAlpha = 1;
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
