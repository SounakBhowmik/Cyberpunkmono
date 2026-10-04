import type { Checkpoint, ModeId, RunResult } from '../shared/protocol';

// Everything a player keeps between sessions: their callsign, the last
// checkpoint, past adventures and achievements. It lives in this browser for
// now; accounts and a global ranking are a future feature.

const KEY = {
  name: 'lastlight.name',
  checkpoint: 'lastlight.checkpoint',
  runs: 'lastlight.runs',
  achievements: 'lastlight.achievements',
  tutorial: 'lastlight.tutorial',
};

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
];

export const Progress = {
  get name(): string {
    return read<string>(KEY.name, '');
  },
  set name(v: string) {
    write(KEY.name, v);
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

  /** Record a finished story and return any achievements it unlocked. */
  record(r: RunResult): Achievement[] {
    const me = r.players.find((p) => p.you);
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
    return ACHIEVEMENTS.filter((a) => fresh.includes(a.id));
  },
};
