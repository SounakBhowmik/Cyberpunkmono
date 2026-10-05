import type { Checkpoint, ClassId, ModeId, RunResult } from '../shared/protocol';
import { ITEMS, type Item } from '../shared/items';

// Everything a player keeps between sessions: their callsign, the last
// checkpoint, past adventures and achievements. It lives in this browser for
// now; accounts and a global ranking are a future feature.

const KEY = {
  name: 'lastlight.name',
  checkpoint: 'lastlight.checkpoint',
  runs: 'lastlight.runs',
  achievements: 'lastlight.achievements',
  tutorial: 'lastlight.tutorial',
  rerolled: 'lastlight.rerolled',
  playSeconds: 'lastlight.playSeconds',
  inventory: 'lastlight.inventory',
  mastery: 'lastlight.mastery',
  daily: 'lastlight.daily',
};

export const PLAYER_NAMES = [
  'softmug', 'fuzzysock', 'fluffypillow', 'softspoon', 'fuzzyhat', 'fluffymat', 'softcup', 'fuzzybrush', 'fluffyrug', 'softbowl',
  'wetsock', 'stickyjar', 'dampmop', 'soggybox', 'wetpen', 'stickyfork', 'dampcap', 'soggybag', 'wetlamp', 'stickydoor',
  'hardpan', 'roughcup', 'bumpyball', 'hardshoe', 'roughmat', 'lumpybed', 'hardbell', 'crustyplate', 'bumpybox', 'lumpychair',
  'shinyfork', 'smoothcan', 'slickspoon', 'glossykey', 'shinybowl', 'smoothrock', 'slickpan', 'shinycup', 'smoothbelt', 'glossyjar',
  'dustyhat', 'drybrush', 'crumbycup', 'dustybook', 'drymug', 'flakybox', 'dustylamp', 'crispybag', 'drysock', 'flakypan',
] as const;

function generatedName() {
  return PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)]!;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked (private window): progress just isn't kept */
  }
}

export interface PastRun {
  at: number;
  story: ModeId;
  title: string;
  win: boolean;
  stars: number;
  team: number;
  points: number;
  mvp?: string;
  crew: string[];
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export interface Artifact {
  story: ModeId;
  name: string;
  desc: string;
  icon: string;
}

export const ARTIFACTS: Artifact[] = [
  { story: 'tutorial', name: 'ECHO’s Crew Pin', desc: 'A small violet flame answers when danger is near.', icon: '🕯' },
  { story: 'adventure', name: 'Shard of the Last Seal', desc: 'Warm with five names the wyrm could not erase.', icon: '◈' },
  { story: 'heist', name: 'Heart-Chain Link', desc: 'A broken link from the prison beneath the tower.', icon: '⛓' },
  { story: 'survival', name: 'Ember of Fourth Dawn', desc: 'It glows brightest when another Joe stands nearby.', icon: '✺' },
];

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'student', name: 'Student', desc: 'Finish the training.', icon: '🎓' },
  { id: 'first', name: 'First Light', desc: 'Finish any story.', icon: '🕯' },
  { id: 'pilgrim', name: 'Pilgrim', desc: 'Win The Pilgrimage.', icon: '⛩' },
  { id: 'thief', name: 'Master Thief', desc: 'Win The Heart of the Wyrm.', icon: '🗝' },
  { id: 'survivor', name: 'Survivor', desc: 'Win Four Nights.', icon: '🌅' },
  { id: 'flawless', name: 'Three Stars', desc: 'Win a story with three stars.', icon: '★' },
  { id: 'shield', name: 'Shieldbearer', desc: 'Land 3 clean Wards in one story.', icon: '⬡' },
  { id: 'breaker', name: 'Chargebreaker', desc: 'Break 3 charges with a Hex in one story.', icon: '⚡' },
  { id: 'seer', name: 'Seer', desc: 'Call the monster’s move right 5 times in one story.', icon: '👁' },
  { id: 'ready', name: 'Never Flat-Footed', desc: 'Win a story without once being caught undecided.', icon: '⏱' },
  { id: 'lockpick', name: 'Lockpick', desc: 'Win a story without a single wrong glyph.', icon: '☾' },
  { id: 'tongue', name: 'Silver Tongue', desc: 'Earn 15 persuasion in one story.', icon: '💬' },
  { id: 'mvp', name: 'Warden’s Pick', desc: 'Be the MVP of a crew.', icon: '🏅' },
  { id: 'friend', name: 'Wyrm Friend', desc: 'Set the wyrm free.', icon: '🐉' },
  { id: 'legend', name: 'Legend', desc: 'Score 400 points yourself in one story.', icon: '👑' },
  { id: 'veteran', name: 'Veteran', desc: 'Finish 10 stories.', icon: '🎖' },
  { id: 'omen', name: 'Omen Seeker', desc: 'Answer a daily omen.', icon: '☾' },
  { id: 'streak3', name: 'Three Dawns', desc: 'Complete daily quests on three consecutive days.', icon: '🔥' },
];

const dayKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

export const Progress = {
  get name(): string {
    const saved = read<string>(KEY.name, '');
    if (saved && (PLAYER_NAMES as readonly string[]).includes(saved)) return saved;
    const name = generatedName();
    write(KEY.name, name);
    return name;
  },
  set name(v: string) {
    write(KEY.name, v);
  },

  get canReroll(): boolean {
    return !read<boolean>(KEY.rerolled, false);
  },

  rerollIdentity(): string {
    if (!this.canReroll) return this.name;
    const name = generatedName();
    write(KEY.name, name);
    write(KEY.rerolled, true);
    return name;
  },

  get checkpoint(): Checkpoint | null {
    return read<Checkpoint | null>(KEY.checkpoint, null);
  },
  set checkpoint(cp: Checkpoint | null) {
    write(KEY.checkpoint, cp);
  },

  get runs(): PastRun[] {
    return read<PastRun[]>(KEY.runs, []);
  },

  get unlocked(): Record<string, number> {
    return read<Record<string, number>>(KEY.achievements, {});
  },

  get trained(): boolean {
    return read<boolean>(KEY.tutorial, false);
  },

  get playSeconds(): number {
    return read<number>(KEY.playSeconds, 0);
  },

  get inventory(): string[] {
    return read<string[]>(KEY.inventory, []);
  },

  get artifacts(): Artifact[] {
    const finished = new Set<ModeId>(this.runs.filter((run) => run.win).map((run) => run.story));
    if (this.trained) finished.add('tutorial');
    return ARTIFACTS.filter((artifact) => finished.has(artifact.story));
  },

  get mastery(): Record<ClassId, number> {
    return read<Record<ClassId, number>>(KEY.mastery, { rogue: 0, mage: 0, cleric: 0 });
  },

  get daily(): { date: string; streak: number; done: boolean } {
    const saved = read<{ date: string; streak: number }>(KEY.daily, { date: '', streak: 0 });
    return { ...saved, done: saved.date === dayKey() };
  },

  roleLevel(role: ClassId): number {
    return 1 + Math.floor((this.mastery[role] ?? 0) / 200);
  },

  /** Record a finished story and return any achievements it unlocked. */
  record(r: RunResult): { achievements: Achievement[]; items: Item[]; xp: Partial<Record<ClassId, number>>; artifact?: Artifact; newArtifact?: boolean } {
    const me = r.players.find((p) => p.you);
    const artifact = r.win ? ARTIFACTS.find((item) => item.story === r.story) : undefined;
    const newArtifact = !!artifact && !this.artifacts.some((item) => item.story === artifact.story);
    if (r.story === 'tutorial') {
      write(KEY.tutorial, true);
    } else {
      const runs = [{ at: Date.now(), story: r.story, title: r.title, win: r.win, stars: r.stars, team: r.team, points: me?.points ?? 0, ...(r.mvp ? { mvp: r.mvp } : {}), crew: r.players.map((p) => p.handle) }, ...this.runs].slice(0, 40);
      write(KEY.runs, runs);
    }
    const total = this.runs.length;
    const earned: string[] = [];
    const won = r.win && r.story !== 'tutorial';
    if (r.story === 'tutorial' && r.win) earned.push('student');
    if (r.story !== 'tutorial') earned.push('first');
    if (won && r.story === 'adventure') earned.push('pilgrim');
    if (won && r.story === 'heist') earned.push('thief');
    if (won && r.story === 'survival') earned.push('survivor');
    if (won && r.story === 'daily') {
      earned.push('omen');
      const previous = this.daily;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const streak = previous.date === dayKey(yesterday) ? previous.streak + 1 : previous.date === dayKey() ? previous.streak : 1;
      write(KEY.daily, { date: dayKey(), streak });
      if (streak >= 3) earned.push('streak3');
    }
    if (won && r.stars === 3) earned.push('flawless');
    if (me && me.cleanWards >= 3) earned.push('shield');
    if (me && me.brokenCharges >= 3) earned.push('breaker');
    if (me && me.goodCalls >= 5) earned.push('seer');
    if (won && me && me.idle === 0) earned.push('ready');
    if (won && r.glyphMisses === 0) earned.push('lockpick');
    if (me && me.persuasion >= 15) earned.push('tongue');
    if (me && r.mvp === me.handle) earned.push('mvp');
    if (won && r.flags.includes('freed')) earned.push('friend');
    if (me && me.points >= 400) earned.push('legend');
    if (total >= 10) earned.push('veteran');

    const have = this.unlocked;
    const fresh = earned.filter((id) => !have[id]);
    for (const id of fresh) have[id] = Date.now();
    write(KEY.achievements, have);

    const beforeItems = new Set(this.inventory);
    const playSeconds = this.playSeconds + (r.story === 'tutorial' ? 0 : r.seconds);
    write(KEY.playSeconds, playSeconds);
    const finishedQuests = this.runs.filter((run) => run.win).length;
    const harvested = new Set(r.foundItems ?? []);
    const inventory = ITEMS.filter((item) => harvested.has(item.id) || beforeItems.has(item.id) || (item.seconds <= playSeconds && item.quests <= finishedQuests)).map((item) => item.id);
    write(KEY.inventory, inventory);
    const found = ITEMS.filter((item) => inventory.includes(item.id) && !beforeItems.has(item.id));

    const xp: Partial<Record<ClassId, number>> = {};
    if (me && r.story !== 'tutorial') {
      const gain = Math.max(20, me.points) + r.stars * 25;
      const mastery = { ...this.mastery };
      for (const role of me.classes) {
        mastery[role] = (mastery[role] ?? 0) + gain;
        xp[role] = gain;
      }
      write(KEY.mastery, mastery);
    }
    return { achievements: ACHIEVEMENTS.filter((a) => fresh.includes(a.id)), items: found, xp, ...(artifact ? { artifact, newArtifact } : {}) };
  },
};
