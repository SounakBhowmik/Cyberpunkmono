import type {
  ActionButton, Checkpoint, ClassId, FeedItem, Foe, Fx, Glyph, HudMember, HudState, ModeId, Move, PlayerStats, Portrait, RunResult, SceneState, WyrmColor, WyrmInfo,
} from '../../shared/protocol.js';
import { ITEMS, itemById, type ItemKind } from '../../shared/items.js';
import { c } from '../ansi.js';
import { BREEDS, BREED_IDS, type Breed } from './breeds.js';
import {
  BOONS, CALLS, CLASS_MOVES, CLASS_NAME, DISTRICTS, FOES, GLYPHS, GLYPH_CHAR, MOVES, NUM, WARDEN, WYRM_FOE, intentOf,
  type FoeSpec, type IntentSpec,
} from './content.js';
import { SilentNarrator, type Narrator } from './narrator.js';
import { NPCS, type ParleyContext, type ParleyJudge, type ParleyTurn } from './parley.js';
import { Rng } from './rng.js';
import { STORIES, text, type Effects, type Option, type Story, type StoryCtx, type StoryNode } from './story.js';

export interface GamePlayer {
  readonly id: string;
  readonly handle: string;
  /** Avatar reroll count, chosen in the lobby. */
  readonly avatar?: number;
  send(text: string): void;
  setPrompt(text: string): void;
  setHud(hud: HudState): void;
  setScene(scene: SceneState, actions: ActionButton[]): void;
  feed(item: FeedItem): void;
  fx(fx: Fx): void;
  /** A chapter checkpoint to save (null clears it when the story ends). */
  checkpoint?(cp: Checkpoint | null): void;
}

export interface GameResult {
  win: boolean;
  title: string;
  meter: number;
  seconds: number;
  stars: number;
  team: number;
}

export interface GameOptions {
  judge: ParleyJudge;
  onEnd: (result: GameResult) => void;
  story?: ModeId;
  narrator?: Narrator;
  seed?: number;
  /** Room code, shown in the HUD. */
  code?: string;
  /** Combat round timer in ms. 0 disables it (tests). */
  roundMs?: number;
  /** Vote timer in ms. 0 disables it (tests). */
  voteMs?: number;
  /** Pick the story back up from a saved chapter. */
  checkpoint?: Checkpoint;
  /** Fixed roles for solo crews. */
  classes?: Record<string, ClassId[]>;
  /** Player-owned equipment IDs, offered before every automatic fight. */
  inventory?: Record<string, string[]>;
  /** Solo difficulty multiplier for foe health and damage. */
  difficulty?: number;
}

type Phase = 'story' | 'choice' | 'puzzle' | 'parley' | 'combat' | 'boss' | 'ended';

interface FoeState {
  spec: FoeSpec;
  name: string;
  hp: number;
  maxHp: number;
  intent: IntentSpec;
  pendingHeavy?: IntentSpec;
  exposed: boolean;
  enraged: number;
  elite: boolean;
  boss: boolean;
  dmgMult: number;
  next: string;
  win?: Effects;
}

interface Queued {
  player: string;
  cls: ClassId;
  move: Move;
  amount?: number;
  /** when it was chosen, for the Warden's quick-thinking bonus */
  at: number;
}

type Stats = Omit<PlayerStats, 'handle' | 'you' | 'classes'>;
const blankStats = (): Stats => ({ points: 0, cleanWards: 0, brokenCharges: 0, pierced: 0, doubles: 0, goodCalls: 0, idle: 0, glyphs: 0, persuasion: 0 });

interface ParleyState {
  npc: string;
  ctx: ParleyContext;
  goal: number;
  progress: number;
  linesLeft: number;
  history: ParleyTurn[];
  busy: boolean;
  said?: string;
  saidBy?: string;
  reply?: string;
  success: string;
  failure: string;
}

/** Shields and heals land first, then set-ups, then the big hits. */
const ORDER: Move[] = ['ward', 'mend', 'hex', 'bolt', 'speak', 'strike', 'fury'];
const CLASS_ITEM: Record<ClassId, ItemKind> = { rogue: 'attack', mage: 'magic', cleric: 'defense' };
const CORPS = ['Arasaka-Vey', 'Kiroshi Dynamics', 'Militech Halcyon', 'Zetatech Lumen', 'Biotechnica Rho'];
const NPC_NAME: Record<string, string> = { kitsune: 'The Kitsune', fixer: 'The Fixer', oracle: 'The Oracle', scavenger: 'Rook' };
const SITUATION: Record<string, string> = {
  oracle: 'Small spirits on the way to seal the Devourer ask you to reveal where it can be hurt. Only a true, selfless reason earns it.',
  scavenger: 'A crew holding the last lit safehouse wants your medkits and your help on the final night.',
  vault: 'Thieves have reached the vault where you are chained. Let them take your heart only if they convince you they will free you, not sell you.',
  boss: 'A crew of small spirits is fighting to seal you. Some of them speak instead of attacking.',
};

/** Chapter one starts at 1× pressure; the last chapter reaches exactly 5×. */
export function chapterDifficulty(chapter: number, chapters: number) {
  if (chapters <= 1) return 1;
  return 1 + 4 * Math.max(0, Math.min(1, (chapter - 1) / (chapters - 1)));
}

export class Game {
  readonly story: Story;
  readonly breed: Breed;
  readonly wyrmName: string;
  readonly district: string;
  readonly corp: string;
  readonly classes = new Map<string, ClassId[]>();
  readonly flags = new Set<string>();
  readonly boons = new Set<string>();
  meter = 0;
  wards = 0;
  phase: Phase = 'story';
  nodeId = '';
  chapter = 0;
  options: Option[] = [];
  puzzle?: { sequence: Glyph[]; progress: number; misses: number; success: string; failure: string };
  parley?: ParleyState;
  foe?: FoeState;
  round = 0;
  ending?: { title: string; text: string; win: boolean };
  /** Every story node the crew has passed through, in order. */
  readonly trail: string[] = [];

  private readonly players = new Map<string, GamePlayer>();
  private readonly rng: Rng;
  private readonly narrator: Narrator;
  private readonly startedAt = Date.now();
  private readonly votes = new Map<string, number>();
  private readonly acted = new Map<string, Set<ClassId>>();
  private readonly encounterReady = new Set<string>();
  private readonly loadouts = new Map<string, Map<ItemKind, string>>();
  private waitingForReady = false;
  private autoTimer?: NodeJS.Timeout;
  private queued: Queued[] = [];
  private wardsUsed = 0;
  private called?: { by: string; label: string };
  private pendingSpeech = 0;
  private resolveWhenSpoken = false;
  private bossParley: ParleyTurn[] = [];
  private bossTalk: { said?: string; saidBy?: string; reply?: string } = {};
  private lastChoice?: string;
  private timer?: NodeJS.Timeout;
  private deadline = 0;
  private timerTotal = 0;
  private roundStarted = 0;
  private firstCall?: string;
  private lastFoeMove?: string;
  private shownGlyph = -1;
  private glyphMisses = 0;
  private readonly foundItems = new Set<string>();
  /** The Warden's tally, by handle so it survives a reconnect or a resume. */
  private readonly stats = new Map<string, Stats>();

  constructor(players: GamePlayer[], private readonly opts: GameOptions) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(seed);
    const cp = opts.checkpoint;
    this.story = STORIES[cp?.story ?? opts.story ?? 'adventure'];
    this.breed = BREEDS[cp?.breed ?? this.rng.pick(BREED_IDS)];
    this.wyrmName = cp && this.breed.names.includes(cp.wyrm) ? cp.wyrm : this.rng.pick(this.breed.names);
    this.district = this.rng.pick(DISTRICTS);
    this.corp = this.rng.pick(CORPS);
    this.narrator = opts.narrator ?? new SilentNarrator();

    for (const p of players) {
      this.players.set(p.id, p);
      this.stats.set(p.handle, { ...blankStats(), points: cp?.points[p.handle] ?? 0 });
    }
    if (opts.classes) {
      for (const p of players) this.classes.set(p.id, [...(opts.classes[p.id] ?? ['rogue'])]);
    } else this.assignClasses(this.rng.shuffle(players.map((p) => p.id)));
    if (cp) {
      this.meter = cp.meter;
      for (const b of cp.boons) this.boons.add(b);
      for (const f of cp.flags) this.flags.add(f);
    }
    this.emit({ kind: 'title', title: this.story.title, subtitle: cp ? `resuming at chapter ${cp.chapter}` : this.story.pitch });
    for (const p of players) this.brief(p);
    this.enterNode(cp?.node ?? this.story.start);
  }

  /** Check a checkpoint sent by a client before trusting it. */
  static validCheckpoint(cp: unknown): cp is Checkpoint {
    if (!cp || typeof cp !== 'object') return false;
    const c = cp as Partial<Checkpoint>;
    const story = typeof c.story === 'string' ? STORIES[c.story as ModeId] : undefined;
    return (
      c.v === 1 &&
      !!story &&
      !story.practice &&
      typeof c.node === 'string' &&
      !!story.nodes[c.node] &&
      Number.isInteger(c.meter) && c.meter! >= 0 && c.meter! < 100 &&
      Array.isArray(c.boons) && c.boons.length <= 8 && c.boons.every((b) => typeof b === 'string' && b in BOONS) &&
      Array.isArray(c.flags) && c.flags.length <= 48 && c.flags.every((f) => typeof f === 'string' && f.length <= 24) &&
      typeof c.breed === 'string' && BREED_IDS.includes(c.breed as WyrmColor) &&
      typeof c.wyrm === 'string' &&
      !!c.points && typeof c.points === 'object' && Object.values(c.points).every((n) => Number.isInteger(n) && Math.abs(n as number) < 100_000)
    );
  }

  // ---------------------------------------------------------------- setup

  private assignClasses(ids: string[]) {
    const layouts: Record<number, ClassId[][]> = {
      1: [['rogue', 'mage', 'cleric']],
      2: [['rogue'], ['mage', 'cleric']],
      3: [['rogue'], ['mage'], ['cleric']],
      4: [['rogue'], ['mage'], ['cleric'], ['rogue']],
    };
    const layout = layouts[Math.min(ids.length, 4)]!;
    ids.forEach((id, i) => this.classes.set(id, [...(layout[i] ?? ['rogue'])]));
  }

  private ctx(): StoryCtx {
    return { wyrm: this.wyrmName, breed: this.breed.title, temperament: this.breed.temperament, boast: this.breed.boast, district: this.district, corp: this.corp, flags: this.flags };
  }

  private wyrmInfo(): WyrmInfo {
    return { name: this.wyrmName, title: this.breed.title, color: this.breed.id, temperament: this.breed.temperament };
  }

  private brief(p: GamePlayer) {
    const role: Record<ClassId, string> = {
      rogue: 'You are the ROGUE. Choose attack relics before battle; your Joe will find openings automatically. Only you can touch glyph locks.',
      mage: 'You are the MAGE. Choose magic relics before battle; your Joe will break charges and pierce shells automatically. You can read glyph locks.',
      cleric: 'You are the CLERIC. Choose defense relics before battle; your Joe will ward and restore the crew automatically.',
    };
    const mine = (this.classes.get(p.id) ?? []).map((cls) => role[cls]);
    if (mine.length) p.feed({ kind: 'tip', text: mine.join(' ') });
  }

  // ---------------------------------------------------------------- output

  private log(line: string) {
    for (const p of this.players.values()) p.send(line);
  }

  private feedAll(item: FeedItem) {
    for (const p of this.players.values()) p.feed(item);
  }

  private notice(text: string, tone: 'good' | 'bad' | 'info' = 'info') {
    this.feedAll({ kind: 'notice', text, tone });
    this.log(tone === 'good' ? c.green(text) : tone === 'bad' ? c.red(text) : c.dim(text));
  }

  private say(speaker: string, line: string, portrait: Portrait) {
    this.feedAll({ kind: 'story', speaker, text: line, portrait });
    this.log(`${speaker ? c.bold(`${speaker}: `) : ''}${c.italic(line)}`);
  }

  private emit(fx: Fx) {
    for (const p of this.players.values()) p.fx(fx);
  }

  private member(p: GamePlayer) {
    return { handle: p.handle, avatar: p.avatar ?? 0, classes: [...(this.classes.get(p.id) ?? [])] };
  }

  private refresh() {
    for (const p of this.players.values()) {
      p.setPrompt(`${c.magenta(p.handle)}> `);
      p.setHud(this.hudFor(p.id));
      p.setScene(this.sceneFor(p.id), this.actionsFor(p.id));
    }
  }

  private has(id: string, cls: ClassId) {
    return this.classes.get(id)?.includes(cls) ?? false;
  }

  private statsOf(id: string): Stats {
    const handle = this.players.get(id)?.handle ?? id;
    let st = this.stats.get(handle);
    if (!st) this.stats.set(handle, (st = blankStats()));
    return st;
  }

  /** The Warden awards (or docks) points and shows it over the player's head. */
  private award(id: string, points: number, reason: string, stat?: keyof Omit<Stats, 'points'>, quiet = false) {
    const st = this.statsOf(id);
    st.points += points;
    if (stat) st[stat]++;
    if (!quiet && points !== 0) this.emit({ kind: 'score', by: this.players.get(id)?.handle ?? '', points, reason });
  }

  private scoreLines(viewer: string) {
    return [...this.players.values()].map((p) => ({ handle: p.handle, points: this.statsOf(p.id).points, you: p.id === viewer }));
  }

  private timerView() {
    if (!this.timer || !this.timerTotal) return {};
    return { timer: { leftMs: Math.max(0, this.deadline - Date.now()), totalMs: this.timerTotal } };
  }

  private party(viewer: string): HudMember[] {
    const fighting = this.phase === 'combat' || this.phase === 'boss' || this.waitingForReady;
    return [...this.players.values()].map((p) => ({
      ...this.member(p),
      you: p.id === viewer,
      ...(fighting ? { ready: this.waitingForReady ? this.encounterReady.has(p.id) : true } : {}),
    }));
  }

  private node(): StoryNode {
    return this.story.nodes[this.nodeId]!;
  }

  private wardsLeft() {
    return Math.max(0, this.wards - this.wardsUsed);
  }

  /** Wards the Cleric can still use this chapter. */
  get wardsRemaining() {
    return this.wardsLeft();
  }

  private hudFor(id: string): HudState {
    const n = this.node();
    return {
      mode: 'delve',
      code: this.opts.code ?? '',
      story: this.story.id,
      chapter: `${n.chapter}/${this.story.chapters} · ${n.title}`,
      meter: { name: this.story.meterName, value: this.meter },
      wyrm: this.wyrmInfo(),
      party: this.party(id),
      boons: [...this.boons].map((b) => BOONS[b]!),
      wards: this.wardsLeft(),
    };
  }

  private foeView(viewer: string): Foe | undefined {
    const f = this.foe;
    if (!f) return undefined;
    const intent = intentOf(f.intent);
    const amount = intent.kind === 'shell' ? 0 : Math.round((intent.amount + f.enraged) * f.dmgMult);
    return {
      id: f.spec.id,
      name: f.name,
      hp: f.hp,
      maxHp: f.maxHp,
      ...(this.has(viewer, 'mage') ? { intent: { ...intent, amount, label: intent.kind === 'charge' || intent.kind === 'shell' ? intent.label : `${f.intent.verb} ${amount}` } } : {}),
      ...(this.called ? { called: this.called } : {}),
      ...(f.exposed ? { exposed: true } : {}),
      ...(f.elite ? { elite: true } : {}),
      ...(f.boss ? { boss: true } : {}),
    };
  }

  private sceneFor(id: string): SceneState {
    const n = this.node();
    const view: SceneState['view'] =
      this.phase === 'ended' ? 'end' : this.phase === 'puzzle' ? 'puzzle' : this.phase === 'parley' ? 'parley' : this.phase === 'combat' ? 'combat' : this.phase === 'boss' ? 'boss' : 'story';
    const handles = new Map([...this.players.values()].map((p) => [p.id, p.handle]));
    const foe = this.foeView(id);
    const pz = this.puzzle;
    const pl = this.parley;
    return {
      view,
      story: this.story.id,
      chapter: { index: n.chapter, total: this.story.chapters, title: n.title },
      backdrop: this.phase === 'ended' ? 'city' : n.backdrop,
      music: this.phase === 'ended' ? (this.ending?.win ? 'victory' : 'defeat') : n.music,
      meter: { name: this.story.meterName, value: this.meter },
      party: this.party(id),
      wyrm: this.wyrmInfo(),
      ...(this.phase === 'choice' && n.step.kind === 'choice'
        ? {
            choice: {
              prompt: text(n.step.prompt, this.ctx()),
              options: this.options.map((o, i) => ({
                id: String(i),
                label: text(o.label, this.ctx()),
                detail: text(o.detail, this.ctx()),
                icon: o.icon,
                votes: [...this.votes].filter(([, v]) => v === i).map(([pid]) => handles.get(pid) ?? '?'),
              })),
            },
          }
        : {}),
      ...(this.phase === 'puzzle' && pz
        ? { puzzle: { length: pz.sequence.length, progress: pz.progress, misses: pz.misses, maxMisses: NUM.maxMisses, ...(this.has(id, 'mage') ? { sequence: pz.sequence } : {}), ...(this.shownGlyph === pz.progress ? { shown: pz.sequence[pz.progress] } : {}) } }
        : {}),
      ...(this.phase === 'parley' && pl
        ? { parley: { npc: pl.npc, name: pl.ctx.name, progress: pl.progress, goal: pl.goal, linesLeft: pl.linesLeft, ...(pl.said ? { said: pl.said, saidBy: pl.saidBy } : {}), ...(pl.reply ? { reply: pl.reply } : {}) } }
        : {}),
      ...(this.phase === 'boss'
        ? { parley: { npc: 'wyrm', name: this.wyrmName, progress: 0, goal: 0, linesLeft: 0, ...this.bossTalk } }
        : {}),
      ...(foe ? { foe, round: this.round, wards: this.wardsLeft() } : {}),
      ...((this.phase === 'combat' || this.phase === 'boss') && this.waitingForReady
        ? {
            loadout: {
              selected: [...(this.loadouts.get(id) ?? [])].map(([kind, itemId]) => {
                const item = itemById(itemId)!;
                return { kind, id: item.id, name: item.name, icon: item.icon, power: item.power };
              }),
              ready: this.encounterReady.size,
              total: this.players.size,
            },
          }
        : {}),
      ...(this.waitingForReady ? { waitingForReady: true } : {}),
      ...(this.ending ? { ending: this.ending, result: this.result(id) } : {}),
      ...this.timerView(),
      scores: this.scoreLines(id),
    };
  }

  private stars(win: boolean) {
    if (!win) return 0;
    return this.meter <= 30 ? 3 : this.meter <= 60 ? 2 : 1;
  }

  private result(viewer: string): RunResult {
    const win = this.ending?.win ?? false;
    const players = [...this.players.values()].map((p) => ({ handle: p.handle, you: p.id === viewer, classes: [...(this.classes.get(p.id) ?? [])], ...this.statsOf(p.id) }));
    const best = [...players].sort((a, b) => b.points - a.points)[0];
    const team = Math.max(0, players.reduce((sum, p) => sum + p.points, 0) + (win ? 200 + (100 - this.meter) * 2 : 0));
    return {
      story: this.story.id,
      title: this.ending?.title ?? '',
      win,
      meter: this.meter,
      seconds: Math.round((Date.now() - this.startedAt) / 1000),
      stars: this.stars(win),
      team,
      ...(best && best.points > 0 && players.length > 1 ? { mvp: best.handle } : {}),
      flags: [...this.flags],
      glyphMisses: this.glyphMisses,
      foundItems: [...this.foundItems],
      players,
    };
  }

  private actionsFor(id: string): ActionButton[] {
    if (this.waitingForReady) {
      const ready = this.encounterReady.has(id);
      if (this.phase === 'combat' || this.phase === 'boss') {
        const owned = new Set(this.opts.inventory?.[id] ?? []);
        const selected = this.loadouts.get(id) ?? new Map<ItemKind, string>();
        const kinds = new Set((this.classes.get(id) ?? []).map((cls) => CLASS_ITEM[cls]));
        const gear = ITEMS.filter((item) => kinds.has(item.kind) && owned.has(item.id)).map<ActionButton>((item) => ({
          label: `${selected.get(item.kind) === item.id ? '✓ ' : ''}${item.icon} ${item.name}`,
          cmd: `equip ${item.id}`,
          tone: item.kind === 'attack' ? 'fight' : item.kind === 'magic' ? 'magic' : 'go',
          hint: `${item.rarity} · power ${item.power} · ${item.effect}`,
          group: `${item.kind} relics`,
          disabled: ready,
        }));
        return [
          ...gear,
          {
            label: ready ? 'Waiting for crew' : 'Lock loadout & begin', cmd: 'ready', tone: ready ? 'info' : 'go',
            hint: gear.length ? 'unfilled roles use basic gear' : 'you have no relics yet; the crew will use basic gear',
            group: `crew ${this.encounterReady.size}/${this.players.size}`, disabled: ready,
          },
        ];
      }
      const challenge = this.phase === 'puzzle' ? 'glyph lock' : this.phase === 'parley' ? 'conversation' : 'battle';
      return [{ label: ready ? 'Waiting for crew' : 'Ready', cmd: 'ready', tone: ready ? 'info' : 'go', hint: ready ? `the ${challenge} begins when everyone is ready` : 'I have read the briefing', group: `prepare for ${challenge}`, disabled: ready }];
    }
    switch (this.phase) {
      case 'choice': {
        const mine = this.votes.get(id);
        return this.options.map((o, i) => ({
          label: `${mine === i ? '✓ ' : ''}${text(o.label, this.ctx())}`,
          cmd: `vote ${i + 1}`,
          tone: o.icon === 'fight' ? 'fight' : o.icon === 'risk' ? 'risk' : o.icon === 'talk' ? 'talk' : o.icon === 'rest' || o.icon === 'help' ? 'magic' : 'go',
          hint: text(o.detail, this.ctx()),
          group: 'the crew decides',
        }));
      }
      case 'puzzle': {
        const out: ActionButton[] = [];
        if (this.has(id, 'rogue')) for (const g of GLYPHS) out.push({ label: `${GLYPH_CHAR[g]} ${g}`, cmd: `glyph ${g}`, tone: 'go', group: 'Rogue · press the glyphs' });
        if (this.has(id, 'mage')) for (const g of GLYPHS) out.push({ label: `show ${GLYPH_CHAR[g]}`, cmd: `show ${g}`, tone: 'magic', group: 'Mage · show the crew' });
        return out;
      }
      case 'parley': {
        const pl = this.parley!;
        return [{ label: `Speak to ${pl.ctx.name}`, cmd: 'speak ', input: true, tone: 'talk', hint: pl.ctx.temperament, group: `${pl.linesLeft} line${pl.linesLeft === 1 ? '' : 's'} left`, disabled: pl.busy }];
      }
      case 'combat':
      case 'boss':
        return [{ label: 'Battle unfolding…', cmd: 'watch', tone: 'info', hint: 'your Joes are using the most efficient strategy for their chosen relics', group: 'automatic battle', disabled: true }];
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------- input

  handle(id: string, rawLine: string) {
    const p = this.players.get(id);
    if (!p || this.phase === 'ended') return;
    const line = rawLine.trim();
    if (!line) return;
    const [head = '', ...rest] = line.split(/\s+/);
    const cmd = head.toLowerCase();
    const arg = rest.join(' ');

    if (cmd === 'say' || line.startsWith("'")) return this.chat(p, line.startsWith("'") ? line.slice(1) : arg);
    if (cmd === 'help') return this.help(p);
    if (cmd === 'boons') return p.send([...this.boons].map((b) => `  ${c.magenta(BOONS[b]!.name)} ${c.dim(BOONS[b]!.desc)}`).join('\n') || c.dim('no boons yet.'));
    if (cmd === 'party' || cmd === 'crew') return p.send([...this.players.values()].map((q) => `  ${q.handle.padEnd(14)} ${(this.classes.get(q.id) ?? []).map((cl) => CLASS_NAME[cl]).join(' + ')}`).join('\n'));
    if (this.waitingForReady) {
      if ((this.phase === 'combat' || this.phase === 'boss') && cmd === 'equip') return this.equip(p, rest[0]);
      if (cmd === 'ready') return this.ready(p);
      return p.feed({ kind: 'tip', text: this.phase === 'combat' || this.phase === 'boss' ? 'Choose your relics, then lock your loadout.' : 'Read the briefing, then choose Ready. The challenge will wait for the whole crew.' });
    }

    switch (this.phase) {
      case 'choice':
        if (cmd === 'vote' || /^\d$/.test(cmd)) return this.vote(p, Number(/^\d$/.test(cmd) ? cmd : rest[0]));
        break;
      case 'puzzle':
        if (cmd === 'glyph') return this.pressGlyph(p, rest[0]);
        if (cmd === 'show') return this.showGlyph(p, rest[0]);
        break;
      case 'parley':
        if (cmd === 'speak') return void this.speak(p, arg);
        break;
      case 'combat':
      case 'boss':
        return p.feed({ kind: 'tip', text: 'The crew is fighting automatically. Your preparation decided what they can do.' });
    }
    return this.chat(p, line);
  }

  private help(p: GamePlayer) {
    const lines: Record<Phase, string> = {
      story: 'the story is unfolding.',
      choice: 'vote for an option. most votes wins; ties are settled by fate.',
      puzzle: 'the Mage sees the glyph order and shows it; the Rogue presses the glyphs in order. three mistakes trip the alarm.',
      parley: 'speak <words>. win them over before your lines run out. ' + (this.parley ? `${this.parley.ctx.name} ${this.parley.ctx.temperament}` : ''),
      combat: 'choose one relic for each role you carry, then lock the loadout. The crew reads the foe and performs the strongest strategy automatically.',
      boss: 'choose the relics you trust. The crew will fight automatically; stronger and better-matched equipment changes the outcome.',
      ended: '',
    };
    p.feed({ kind: 'tip', text: lines[this.phase] });
    p.send(c.dim(lines[this.phase]));
  }

  private chat(p: GamePlayer, msg: string) {
    const text = msg.trim();
    if (!text) return;
    this.feedAll({ kind: 'chat', from: this.member(p), text });
    this.log(`${c.magenta(`[${p.handle}]`)} ${text}`);
  }

  // ---------------------------------------------------------------- the story graph

  private enterNode(id: string): void {
    if (this.phase === 'ended') return;
    const node = this.story.nodes[id];
    if (!node) throw new Error(`story ${this.story.id} has no node ${id}`);
    this.clearTimer();
    this.nodeId = id;
    this.trail.push(id);
    this.phase = 'story';
    this.foe = undefined;
    this.puzzle = undefined;
    this.parley = undefined;
    const ctx = this.ctx();

    if (node.chapter !== this.chapter) {
      if (node.chapter >= 2 && !this.story.practice) this.saveCheckpoint(id, node);
      this.chapter = node.chapter;
      this.wards = NUM.wardsPerChapter + (this.boons.has('fortified') ? 1 : 0);
      this.wardsUsed = 0;
      this.emit({ kind: 'title', title: `Chapter ${node.chapter} · ${node.title}`, subtitle: this.story.title });
      this.log(c.bold(c.yellow(`\n── Chapter ${node.chapter} · ${node.title} ──`)));
      void this.narrator
        .narrate({ kind: 'chapter', story: this.story.title, chapter: node.title, ...(this.lastChoice ? { lastChoice: this.lastChoice } : {}), meterName: this.story.meterName, meter: this.meter })
        .then((aside) => aside && this.phase !== 'ended' && this.say('', aside, { type: 'narrator' }));
    }
    if (node.effects) this.apply(node.effects);
    if (this.meter >= 100) return this.lose();

    for (const line of node.lines) {
      const words = text(line.text, ctx);
      if (line.who === 'narrator') this.say('', words, { type: 'narrator' });
      else if (line.who === 'echo') this.say('ECHO', words, { type: 'narrator' });
      else if (line.who === 'wyrm') this.say(this.wyrmName, words, { type: 'npc', id: 'wyrm' });
      else this.say(NPC_NAME[line.npc ?? ''] ?? line.npc ?? '', words, { type: 'npc', id: line.npc ?? '' });
    }

    const step = node.step;
    switch (step.kind) {
      case 'choice':
        return this.openChoice();
      case 'fight':
        return this.startFight(FOES[step.foe]!, !!step.elite, false, step.next, step.win);
      case 'boss':
        return this.startFight(step.foe ? FOES[step.foe]! : { ...WYRM_FOE, name: this.wyrmName }, false, true, step.next);
      case 'puzzle':
        return this.startPuzzle(step.length, step.success, step.failure);
      case 'parley':
        return this.startParley(step.npc, step.goal, step.lines, step.success, step.failure);
      case 'goto':
        return this.enterNode(typeof step.next === 'function' ? step.next(ctx) : step.next);
      case 'ending':
        return this.end(true, text(step.title, ctx), text(step.text, ctx));
    }
  }

  private saveCheckpoint(nodeId: string, node: StoryNode) {
    const cp: Checkpoint = {
      v: 1,
      story: this.story.id,
      node: nodeId,
      chapter: node.chapter,
      title: node.title,
      meter: this.meter,
      boons: [...this.boons],
      flags: [...this.flags],
      breed: this.breed.id,
      wyrm: this.wyrmName,
      points: Object.fromEntries([...this.players.values()].map((p) => [p.handle, this.statsOf(p.id).points])),
      crew: [...this.players.values()].map((p) => p.handle),
      savedAt: Date.now(),
    };
    for (const p of this.players.values()) p.checkpoint?.(cp);
    this.notice(`Checkpoint saved: chapter ${node.chapter}.`, 'info');
  }

  private apply(e: Effects) {
    if (e.flags) for (const f of e.flags) this.flags.add(f);
    if (e.boon && !this.boons.has(e.boon)) {
      this.boons.add(e.boon);
      if (e.boon === 'fortified') this.wards++;
      const b = BOONS[e.boon]!;
      this.emit({ kind: 'boon', name: b.name });
      this.notice(`✦ ${b.name}: ${b.desc}`, 'good');
    }
    if (e.items) for (const id of e.items) {
      const item = itemById(id);
      if (!item || this.foundItems.has(id)) continue;
      this.foundItems.add(id);
      for (const p of this.players.values()) {
        const owned = this.opts.inventory?.[p.id];
        if (owned && !owned.includes(id)) owned.push(id);
      }
      this.notice(`RELIC HARVESTED · ${item.icon} ${item.name} · power ${item.power}`, 'good');
    }
    if (e.meter) this.addMeter(e.meter);
  }

  private addMeter(delta: number) {
    const before = this.meter;
    this.meter = Math.max(0, Math.min(100, this.meter + delta));
    const d = this.meter - before;
    if (d > 0) this.notice(`+${d} ${this.story.meterName} (${this.meter}%)`, 'bad');
    if (d < 0) {
      this.notice(`${d} ${this.story.meterName} (${this.meter}%)`, 'good');
      this.emit({ kind: 'heal', amount: -d });
    }
  }

  private lose() {
    const lose = this.story.lose;
    this.end(false, text(lose.title, this.ctx()), text(lose.text, this.ctx()));
  }

  // ---------------------------------------------------------------- choices

  private openChoice() {
    const step = this.node().step;
    if (step.kind !== 'choice') return;
    this.phase = 'choice';
    this.votes.clear();
    this.options = step.options.filter((o) => (!o.requires || this.flags.has(o.requires)) && (!o.forbids || !this.flags.has(o.forbids)));
    this.log(c.bold(text(step.prompt, this.ctx())) + '\n' + this.options.map((o, i) => `  ${i + 1}. ${text(o.label, this.ctx())} ${c.dim(`· ${text(o.detail, this.ctx())}`)}`).join('\n'));
    this.refresh();
  }

  private vote(p: GamePlayer, n: number) {
    if (!this.options[n - 1]) return p.send(c.dim(`vote 1 to ${this.options.length}`));
    if (!this.votes.size) this.startTimer(this.story.practice ? 0 : (this.opts.voteMs ?? 40_000), () => this.resolveVote());
    this.votes.set(p.id, n - 1);
    this.emit({ kind: 'vote', by: p.handle });
    this.refresh();
    if (this.votes.size >= this.players.size) this.resolveVote();
  }

  private resolveVote() {
    if (this.phase !== 'choice') return;
    this.clearTimer();
    const tally = this.options.map((_, i) => [...this.votes.values()].filter((v) => v === i).length);
    const best = Math.max(...tally);
    const leaders = tally.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
    const pick = leaders.length === 1 ? leaders[0]! : this.rng.pick(leaders);
    const chosen = this.options[pick]!;
    this.lastChoice = text(chosen.label, this.ctx());
    this.notice(`${leaders.length > 1 ? 'Fate breaks the tie: ' : 'The crew chose: '}${this.lastChoice}`, 'info');
    if (chosen.effects) this.apply(chosen.effects);
    if (this.meter >= 100) return this.lose();
    this.enterNode(chosen.next);
  }

  // ---------------------------------------------------------------- glyph locks

  private startPuzzle(length: number, success: string, failure: string) {
    const len = Math.max(2, length - (this.boons.has('core') ? 1 : 0));
    const sequence = this.rng.shuffle(GLYPHS).slice(0, len);
    this.phase = 'puzzle';
    this.encounterReady.clear();
    this.waitingForReady = !this.story.practice;
    this.shownGlyph = -1;
    this.puzzle = { sequence, progress: 0, misses: 0, success, failure };
    for (const p of this.players.values()) {
      if (this.has(p.id, 'mage')) p.feed({ kind: 'tip', text: `Only you can read the lock: ${sequence.map((g) => `${GLYPH_CHAR[g]} ${g}`).join(' → ')}. Show your Rogue, one glyph at a time.` });
      if (this.has(p.id, 'rogue')) p.feed({ kind: 'tip', text: 'Only you can press the glyphs. Watch for your Mage to show you the order.' });
    }
    this.refresh();
  }

  private pressGlyph(p: GamePlayer, name?: string) {
    const pz = this.puzzle!;
    if (!this.has(p.id, 'rogue')) return p.feed({ kind: 'tip', text: 'Only the Rogue can touch the glyphs. Show them the way.' });
    const g = GLYPHS.find((x) => x === name?.toLowerCase());
    if (!g) return p.send(c.dim(`glyph ${GLYPHS.join(' | ')}`));
    if (g === pz.sequence[pz.progress]) {
      pz.progress++;
      this.emit({ kind: 'glyph', ok: true, glyph: g });
      this.award(p.id, WARDEN.glyph, 'right glyph', 'glyphs');
      if (pz.progress >= pz.sequence.length) {
        this.notice('The lock opens with a sound like a held breath let go.', 'good');
        return this.enterNode(pz.success);
      }
    } else {
      pz.misses++;
      pz.progress = 0;
      this.shownGlyph = -1;
      this.glyphMisses++;
      this.emit({ kind: 'glyph', ok: false, glyph: g });
      this.award(p.id, WARDEN.badGlyph, 'wrong glyph');
      this.notice(`Wrong glyph. The lock resets. (${NUM.maxMisses - pz.misses} tries left)`, 'bad');
      this.addMeter(NUM.glyphMissCost);
      if (this.meter >= 100) return this.lose();
      if (pz.misses >= NUM.maxMisses) return this.enterNode(pz.failure);
    }
    this.refresh();
  }

  private showGlyph(p: GamePlayer, name?: string) {
    if (!this.has(p.id, 'mage')) return p.feed({ kind: 'tip', text: 'Only the Mage can read the glyphs.' });
    const g = GLYPHS.find((x) => x === name?.toLowerCase());
    if (!g) return;
    const pz = this.puzzle;
    if (pz && g === pz.sequence[pz.progress] && this.shownGlyph < pz.progress) {
      this.shownGlyph = pz.progress;
      this.award(p.id, WARDEN.showGlyph, 'clear signal', undefined, true);
    }
    this.chat(p, `${GLYPH_CHAR[g]} ${g.toUpperCase()}`);
    this.refresh();
  }

  // ---------------------------------------------------------------- conversations

  private npcContext(npc: string): ParleyContext {
    if (npc === 'wyrm') return { name: this.wyrmName, persona: this.breed.persona, temperament: this.breed.temperament, react: (m) => this.breed.react(m), situation: SITUATION.vault! };
    const base = NPCS[npc]!;
    return { ...base, situation: SITUATION[npc] ?? '' };
  }

  private startParley(npc: string, goal: number, lines: number, success: string, failure: string) {
    this.phase = 'parley';
    this.encounterReady.clear();
    this.waitingForReady = !this.story.practice;
    this.parley = { npc, ctx: this.npcContext(npc), goal, progress: 0, linesLeft: lines, history: [], busy: false, success, failure };
    this.feedAll({ kind: 'tip', text: `${this.parley.ctx.name} ${this.parley.ctx.temperament}. Win them over in ${lines} lines; anyone can speak.` });
    this.refresh();
  }

  private async speak(p: GamePlayer, words: string) {
    const pl = this.parley;
    if (!pl) return;
    if (!words) return p.send(c.dim('speak <what you say>'));
    if (pl.busy) return p.feed({ kind: 'tip', text: `${pl.ctx.name} is still answering.` });
    pl.busy = true;
    const message = words.slice(0, 280);
    pl.said = message;
    pl.saidBy = p.handle;
    pl.reply = undefined;
    this.say(p.handle, message, { type: 'player', ...this.member(p) });
    this.refresh();
    let verdict;
    try {
      verdict = await this.opts.judge.judge(pl.ctx, pl.history, message);
    } catch {
      verdict = { reply: '...', score: 0 };
    }
    if (this.parley !== pl || this.phase !== 'parley') return;
    pl.busy = false;
    pl.history = [...pl.history, { from: 'crew' as const, text: message }, { from: 'wyrm' as const, text: verdict.reply }].slice(-10);
    pl.reply = verdict.reply;
    pl.linesLeft--;
    pl.progress += verdict.score > 0 ? Math.min(8, verdict.score) : -3;
    if (verdict.score > 0) {
      this.award(p.id, Math.min(8, verdict.score) * WARDEN.persuasion, 'well said');
      this.statsOf(p.id).persuasion += Math.min(8, verdict.score);
    } else if (verdict.score < 0) this.award(p.id, -5, 'that went badly');
    this.say(pl.ctx.name, verdict.reply, { type: 'npc', id: pl.npc });
    if (verdict.score < 0) this.addMeter(4);
    if (this.meter >= 100) return this.lose();
    if (pl.progress >= pl.goal) {
      this.notice(`${pl.ctx.name} is won over.`, 'good');
      return this.enterNode(pl.success);
    }
    if (pl.linesLeft <= 0 || pl.progress <= -6) {
      this.notice(`${pl.ctx.name} has heard enough.`, 'bad');
      return this.enterNode(pl.failure);
    }
    this.refresh();
  }

  // ---------------------------------------------------------------- fights

  private pickIntent(spec: FoeSpec, prev?: IntentSpec, round = 1): IntentSpec {
    if (spec.script) return spec.script[(round - 1) % spec.script.length]!;
    // weighted random, but never the same charge or shell twice in a row
    const pool = spec.moves.filter((m) => !(prev && prev.kind === m.kind && (m.kind === 'charge' || m.kind === 'shell')));
    const total = pool.reduce((s, m) => s + m.weight, 0);
    let r = this.rng.next() * total;
    for (const m of pool) {
      r -= m.weight;
      if (r <= 0) return m;
    }
    return pool[0]!;
  }

  private startFight(spec: FoeSpec, elite: boolean, boss: boolean, next: string, win?: Effects) {
    const n = this.players.size;
    const difficulty = this.opts.difficulty ?? (this.story.difficulty ?? 1);
    const pressure = chapterDifficulty(this.node().chapter, this.story.chapters);
    // Pressure is the visible overall threat rating. Split it between endurance
    // and damage so 5× difficulty stays demanding without becoming a one-hit wall.
    const hpPressure = 1 + (pressure - 1) * 0.14;
    const damagePressure = 1 + (pressure - 1) * 0.045;
    const scale = (n >= 4 ? 1.25 : n === 1 ? 0.8 : 1) * NUM.foeHp * difficulty * hpPressure;
    let hp = spec.hp * scale * (elite ? 1.4 : 1);
    if (boss && this.flags.has('sealed')) hp *= 0.7;
    hp = Math.round(hp);
    const name = elite ? `Dread ${spec.name}` : spec.name;
    this.foe = { spec, name, hp, maxHp: hp, intent: this.pickIntent(spec), exposed: boss && this.boons.has('oracle'), enraged: 0, elite, boss, dmgMult: NUM.foeDmg * difficulty * damagePressure * (elite ? 1.25 : 1), next, ...(win ? { win } : {}) };
    this.phase = boss ? 'boss' : 'combat';
    this.round = 1;
    this.queued = [];
    this.acted.clear();
    this.called = undefined;
    this.bossParley = [];
    this.bossTalk = {};
    this.lastFoeMove = undefined;
    this.encounterReady.clear();
    this.loadouts.clear();
    this.waitingForReady = true;
    this.say('', spec.intro, { type: 'narrator' });
    this.feedAll({ kind: 'tip', text: `THREAT ${pressure.toFixed(1)}× · Choose a relic for each role you carry, then lock your loadout. Once every Joe is ready, the crew will fight with the strongest strategy available.` });
    this.announceRound();
  }

  private equip(p: GamePlayer, id?: string) {
    if (!id || this.encounterReady.has(p.id)) return;
    const item = itemById(id);
    const owned = this.opts.inventory?.[p.id] ?? [];
    const kinds = new Set((this.classes.get(p.id) ?? []).map((cls) => CLASS_ITEM[cls]));
    if (!item || !owned.includes(item.id) || !kinds.has(item.kind)) return p.feed({ kind: 'tip', text: 'That relic is not available to this Joe.' });
    const loadout = this.loadouts.get(p.id) ?? new Map<ItemKind, string>();
    loadout.set(item.kind, item.id);
    this.loadouts.set(p.id, loadout);
    this.notice(`${p.handle} prepares ${item.icon} ${item.name}.`, 'info');
    this.refresh();
  }

  private strongestOwned(id: string, kind: ItemKind) {
    const owned = new Set(this.opts.inventory?.[id] ?? []);
    return ITEMS.filter((item) => item.kind === kind && owned.has(item.id)).sort((a, b) => b.power - a.power)[0];
  }

  private ready(p: GamePlayer) {
    if (this.phase === 'combat' || this.phase === 'boss') {
      const loadout = this.loadouts.get(p.id) ?? new Map<ItemKind, string>();
      for (const cls of this.classes.get(p.id) ?? []) {
        const kind = CLASS_ITEM[cls];
        const best = this.strongestOwned(p.id, kind);
        if (!loadout.has(kind) && best) loadout.set(kind, best.id);
      }
      this.loadouts.set(p.id, loadout);
    }
    this.encounterReady.add(p.id);
    this.log(c.dim(`   ${p.handle} is ready`));
    this.refresh();
    if (this.encounterReady.size >= this.players.size) {
      this.waitingForReady = false;
      this.notice(this.phase === 'combat' || this.phase === 'boss' ? 'Loadouts locked. The crew moves as one.' : 'Crew ready. Begin.', 'good');
      this.refresh();
      if (this.phase === 'combat' || this.phase === 'boss') this.scheduleAutoRound(650);
    }
  }

  private scheduleAutoRound(delay = 1250) {
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    if (this.opts.roundMs === 0) return this.autoRound();
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => this.autoRound(), delay);
  }

  /** Read the threat and queue the most efficient move for every role. */
  private autoRound() {
    const f = this.foe;
    if (!f || (this.phase !== 'combat' && this.phase !== 'boss')) return;
    this.autoTimer = undefined;
    const intent = f.intent.kind;
    const willHex = intent === 'charge' || intent !== 'shell';
    this.queued = [];
    this.acted.clear();
    const mage = [...this.players.values()].find((p) => this.has(p.id, 'mage'));
    if (mage) {
      const called = intent === 'heavy' ? 'attack' : intent;
      this.called = { by: mage.handle, label: CALLS[called] ?? intent.toUpperCase() };
      this.firstCall = called;
    }
    for (const p of this.players.values()) {
      const used = new Set<ClassId>();
      for (const cls of this.classes.get(p.id) ?? []) {
        let move: Move;
        if (cls === 'cleric') {
          move = (intent === 'attack' || intent === 'heavy') && this.wardsLeft() > 0 ? 'ward' : 'mend';
          if (move === 'ward') this.wardsUsed++;
        } else if (cls === 'mage') move = intent === 'shell' ? 'bolt' : willHex ? 'hex' : 'bolt';
        else move = willHex && this.meter < 65 ? 'fury' : 'strike';
        used.add(cls);
        this.queued.push({ player: p.id, cls, move, at: Date.now() });
      }
      this.acted.set(p.id, used);
    }
    this.resolve();
  }

  private announceRound() {
    const f = this.foe!;
    this.log(`${c.red(`ROUND ${this.round}`)} · ${f.name} ${f.hp}/${f.maxHp}${f.exposed ? c.cyan(' · EXPOSED') : ''}`);
    for (const p of this.players.values()) {
      if (this.has(p.id, 'mage')) p.send(c.cyan(`   you see its next move: ${intentOf(f.intent).label} (${intentOf(f.intent).hint})`));
    }
    if (this.story.practice) this.coach(f);
    this.roundStarted = 0;
    this.firstCall = undefined;
    this.refresh();
  }

  /** Tutorial: explain the tactic the crew is about to perform. */
  private coach(f: FoeState) {
    const tips: Record<string, string> = {
      attack: 'The Cleric steps forward to Ward while the Rogue and Mage strike from cover.',
      charge: 'The Mage breaks the charge with a Hex, opening a path for the Rogue.',
      heavy: 'The Cleric braces the whole crew against the incoming heavy blow.',
      shell: 'The Mage circles wide and sends a Bolt through the shell while the others reposition.',
      wail: 'The Cleric restores the crew while the Rogue and Mage press the opening.',
    };
    const tip = tips[f.intent.kind];
    if (tip) this.feedAll({ kind: 'tip', text: tip });
  }

  private isReady(id: string) {
    const used = this.acted.get(id);
    return (this.classes.get(id) ?? []).every((cl) => used?.has(cl));
  }

  private call(p: GamePlayer, key?: string) {
    if (!this.has(p.id, 'mage')) return p.feed({ kind: 'tip', text: 'Only the Mage can see what it will do.' });
    const label = key ? CALLS[key] : undefined;
    if (!label) return p.send(c.dim(`call ${Object.keys(CALLS).join(' | ')}`));
    this.ensureRoundTimer();
    this.called = { by: p.handle, label };
    this.firstCall ??= key;
    this.chat(p, `📣 ${label}`);
    this.refresh();
  }

  private act(p: GamePlayer, move: Move) {
    const cls = MOVES[move].cls as ClassId;
    if (!this.has(p.id, cls)) return p.feed({ kind: 'tip', text: `${MOVES[move].label} is the ${CLASS_NAME[cls]}'s move.` });
    const used = this.acted.get(p.id) ?? new Set<ClassId>();
    if (used.has(cls)) return p.feed({ kind: 'tip', text: `Your ${CLASS_NAME[cls]} already acted this round.` });
    this.ensureRoundTimer();
    if (move === 'ward') {
      if (this.wardsLeft() === 0) return p.feed({ kind: 'tip', text: 'No Wards left this chapter. Mend instead.' });
      this.wardsUsed++;
    }
    used.add(cls);
    this.acted.set(p.id, used);
    this.queued.push({ player: p.id, cls, move, at: Date.now() });
    this.log(c.dim(`   ${p.handle} readies ${MOVES[move].label}`));
    this.refresh();
    this.checkReady();
  }

  private async bossSpeak(p: GamePlayer, words: string) {
    if (this.phase !== 'boss') return;
    if (!words) return p.send(c.dim('speak <what you say to the wyrm>'));
    const used = this.acted.get(p.id) ?? new Set<ClassId>();
    const cls = (this.classes.get(p.id) ?? []).find((cl) => !used.has(cl));
    if (!cls) return p.feed({ kind: 'tip', text: 'You already acted this round.' });
    this.ensureRoundTimer();
    used.add(cls);
    this.acted.set(p.id, used);
    this.pendingSpeech++;
    const message = words.slice(0, 280);
    this.bossTalk = { said: message, saidBy: p.handle };
    this.say(p.handle, message, { type: 'player', ...this.member(p) });
    this.refresh();
    let verdict;
    try {
      verdict = await this.opts.judge.judge({ ...this.npcContext('wyrm'), situation: SITUATION.boss! }, this.bossParley, message);
    } catch {
      verdict = { reply: '...', score: 0 };
    }
    this.pendingSpeech--;
    if (this.phase !== 'boss') return;
    this.bossParley = [...this.bossParley, { from: 'crew' as const, text: message }, { from: 'wyrm' as const, text: verdict.reply }].slice(-10);
    const amount = Math.min(NUM.speechCap, Math.round(Math.max(0, verdict.score) * 1.5));
    this.queued.push({ player: p.id, cls, move: 'speak', amount: verdict.score < 0 ? -1 : amount, at: Date.now() });
    this.bossTalk = { said: message, saidBy: p.handle, reply: verdict.reply };
    this.say(this.wyrmName, verdict.reply, { type: 'npc', id: 'wyrm' });
    this.refresh();
    if (this.resolveWhenSpoken && this.pendingSpeech === 0) return this.resolve();
    this.checkReady();
  }

  private checkReady() {
    if ((this.phase !== 'combat' && this.phase !== 'boss') || this.pendingSpeech > 0) return;
    if ([...this.players.keys()].every((id) => this.isReady(id))) this.resolve();
  }

  /** Reading time is free; the countdown begins with the crew's first move. */
  private ensureRoundTimer() {
    if (this.roundStarted) return;
    this.roundStarted = Date.now();
    const f = this.foe;
    const ms = this.story.practice ? 0 : (this.opts.roundMs ?? (f?.boss ? NUM.bossRoundMs : NUM.roundMs));
    this.startTimer(ms, () => this.forceResolve());
  }

  private forceResolve() {
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    if (this.pendingSpeech > 0) this.resolveWhenSpoken = true;
    else this.resolve();
  }

  private resolve() {
    const f = this.foe;
    if (!f) return;
    this.clearTimer();
    this.resolveWhenSpoken = false;
    const handle = (id: string) => this.players.get(id)?.handle ?? 'someone';
    const shelled = f.intent.kind === 'shell';
    const queue = [...this.queued].sort((a, b) => ORDER.indexOf(a.move) - ORDER.indexOf(b.move));
    let warded = false;
    let hexed = false;
    const itemBonus = (id: string, kind: ItemKind) => {
      const item = itemById(this.loadouts.get(id)?.get(kind) ?? '');
      return item?.kind === kind ? item.power * 2 : 0;
    };
    const shield = Math.max(0, ...[...this.players.keys()].map((id) => itemBonus(id, 'defense')));

    // Anyone still undecided at the buzzer leaves the crew open.
    const idle = [...this.players.keys()].filter((id) => !this.isReady(id));
    if (idle.length) {
      for (const id of idle) this.award(id, WARDEN.flatFooted, 'caught flat-footed', 'idle');
      const extra = NUM.flatFooted * idle.length;
      this.meter = Math.min(100, this.meter + extra);
      this.emit({ kind: 'hurt', amount: extra });
      this.notice(`Time! ${idle.map(handle).join(' and ')} ${idle.length > 1 ? 'were' : 'was'} caught flat-footed: +${extra} ${this.story.meterName}, and its hit lands harder.`, 'bad');
      if (this.meter >= 100) return this.lose();
    }

    // The Warden scores each move against what the monster was really doing.
    const intent = f.intent.kind;
    const timed = this.timerTotal > 0;
    const quickBy = this.roundStarted + this.timerTotal * WARDEN.quickShare;
    for (const q of queue) {
      if (timed && q.at <= quickBy && q.move !== 'speak') this.award(q.player, WARDEN.quick, 'quick', undefined, true);
    }
    const mageId = [...this.players.keys()].find((id) => this.has(id, 'mage'));
    if (mageId && this.firstCall && (this.firstCall === intent || (this.firstCall === 'attack' && intent === 'heavy'))) this.award(mageId, WARDEN.goodCall, 'called it', 'goodCalls');

    const hit = (q: Queued, who: string, move: Move, base: number, opts: { doubles?: boolean; pierces?: boolean } = {}) => {
      const kind: ItemKind | undefined = move === 'strike' || move === 'fury' ? 'attack' : move === 'hex' || move === 'bolt' ? 'magic' : undefined;
      let dmg = base + (kind ? itemBonus(q.player, kind) : 0);
      const doubled = !!opts.doubles && f.exposed;
      const blunt = shelled && !opts.pierces;
      if (doubled) dmg *= NUM.exposedMult;
      if (blunt) dmg = Math.ceil(dmg * NUM.shellMult);
      f.hp = Math.max(0, f.hp - dmg);
      this.emit({ kind: 'act', by: who, cls: q.cls, move, amount: dmg });
      this.log(`   ${c.green(`${who} · ${MOVES[move].label}: ${dmg}`)}${doubled ? c.cyan(' ×2') : ''}${blunt ? c.dim(' (shell ½)') : ''} ${c.dim(`→ ${f.hp}/${f.maxHp}`)}`);
      if (f.hp <= 0) this.award(q.player, WARDEN.killingBlow, 'killing blow', undefined, true);
      return { doubled, blunt };
    };

    for (const q of queue) {
      const who = handle(q.player);
      switch (q.move) {
        case 'ward':
          warded = true;
          this.emit({ kind: 'act', by: who, cls: q.cls, move: 'ward' });
          if (intent === 'attack' || intent === 'heavy') this.award(q.player, WARDEN.cleanWard, 'clean ward', 'cleanWards');
          else this.award(q.player, WARDEN.wastedWard, 'wasted ward');
          break;
        case 'mend': {
          const amount = Math.min(this.meter, NUM.mend + (this.boons.has('blessing') ? 4 : 0));
          this.meter -= amount;
          this.emit({ kind: 'act', by: who, cls: q.cls, move: 'mend', amount });
          if (amount) this.log(c.yellow(`   ${who} · Mend: −${amount} → ${this.meter}%`));
          if (amount && (intent === 'wail' || this.lastFoeMove === 'wail')) this.award(q.player, WARDEN.timelyMend, 'timely mend');
          else if (amount) this.award(q.player, WARDEN.mend, 'mend');
          break;
        }
        case 'hex':
          hexed = true;
          f.exposed = true;
          hit(q, who, 'hex', NUM.hex);
          if (intent === 'charge') this.award(q.player, WARDEN.brokeCharge, 'broke the charge', 'brokenCharges');
          else this.award(q.player, WARDEN.setUpHex, 'set up');
          break;
        case 'bolt':
          hit(q, who, 'bolt', NUM.bolt + (this.boons.has('weapons') ? 4 : 0), { pierces: true });
          if (shelled) this.award(q.player, WARDEN.pierce, 'pierced the shell', 'pierced');
          else this.award(q.player, WARDEN.strike, 'bolt');
          break;
        case 'speak':
          if ((q.amount ?? 0) < 0) {
            f.enraged += NUM.enrage;
            this.emit({ kind: 'act', by: who, cls: q.cls, move: 'speak', amount: 0 });
            this.notice(`${who}'s words enrage it: its next attack hits harder.`, 'bad');
            this.award(q.player, -5, 'enraged it');
          } else if (q.amount) {
            hit(q, who, 'speak', q.amount, { pierces: true });
            this.award(q.player, q.amount, 'words that wound');
          }
          break;
        case 'strike': {
          const r = hit(q, who, 'strike', NUM.strike + (this.boons.has('ally') ? 3 : 0), { doubles: true });
          if (r.blunt) this.award(q.player, WARDEN.bluntStrike, 'blunted');
          else if (r.doubled) this.award(q.player, WARDEN.double, 'double strike', 'doubles');
          else this.award(q.player, WARDEN.strike, 'strike');
          break;
        }
        case 'fury': {
          const r = hit(q, who, 'fury', NUM.fury, { doubles: true });
          this.meter = Math.min(100, this.meter + NUM.furyCost);
          if (r.blunt) this.award(q.player, WARDEN.bluntStrike, 'fury into a shell');
          else if (r.doubled) this.award(q.player, WARDEN.doubleFury, 'double fury', 'doubles');
          else this.award(q.player, WARDEN.fury, 'fury');
          break;
        }
      }
      if (f.hp <= 0) return this.winFight();
    }
    if (this.boons.has('survivors')) {
      f.hp = Math.max(0, f.hp - 2);
      if (f.hp <= 0) return this.winFight();
    }
    if (this.meter >= 100) return this.lose();

    // the foe's move
    const it = f.intent;
    let mult = f.dmgMult;
    if (this.round === 1 && this.boons.has('disguise')) mult *= 0.5;
    if (idle.length) mult *= NUM.flatFootedMult;
    this.lastFoeMove = it.kind;
    const amount = Math.max(0, Math.round((it.amount + f.enraged) * mult) - shield);
    switch (it.kind) {
      case 'attack':
      case 'heavy':
        if (warded) {
          this.emit({ kind: 'foe', move: it.kind, amount, blocked: true });
          this.log(c.yellow(`   ${f.name} · ${it.verb}: blocked by the Ward!`));
        } else {
          this.meter = Math.min(100, this.meter + amount);
          this.emit({ kind: 'foe', move: it.kind, amount, blocked: false });
          this.log(c.red(`   ${f.name} · ${it.verb}: +${amount} → ${this.meter}%`));
        }
        f.enraged = 0;
        break;
      case 'charge':
        if (hexed) {
          this.emit({ kind: 'stun' });
          this.notice(`The Hex breaks ${f.name}'s charge!`, 'good');
        } else {
          f.pendingHeavy = { kind: 'heavy', amount: it.amount, verb: it.verb, weight: 0 };
          this.emit({ kind: 'foe', move: 'charge', amount: it.amount, blocked: false });
          this.notice(`${f.name} is gathering itself for something huge...`, 'bad');
        }
        break;
      case 'shell':
        this.emit({ kind: 'foe', move: 'shell', amount: 0, blocked: false });
        break;
      case 'wail':
        this.meter = Math.min(100, this.meter + amount);
        this.emit({ kind: 'foe', move: 'wail', amount, blocked: false });
        this.log(c.red(`   ${f.name} · ${it.verb}: +${amount} (unblockable) → ${this.meter}%`));
        f.enraged = 0;
        break;
    }
    if (this.meter >= 100) return this.lose();

    const prev = f.intent;
    if (f.pendingHeavy) {
      f.intent = f.pendingHeavy;
      f.pendingHeavy = undefined;
    } else f.intent = this.pickIntent(f.spec, prev, this.round + 1);
    f.exposed = f.boss && this.boons.has('oracle') && this.round < 2;
    this.round++;
    this.queued = [];
    this.acted.clear();
    this.called = undefined;
    this.announceRound();
    this.scheduleAutoRound();
  }

  private winFight() {
    const f = this.foe!;
    this.clearTimer();
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
    this.emit({ kind: 'slay', boss: f.boss });
    this.notice(`${f.name} is destroyed.`, 'good');
    for (const id of this.players.keys()) this.award(id, WARDEN.slay + (f.boss ? WARDEN.slay : 0), f.boss ? 'the wyrm falls' : 'monster down', undefined, true);
    if (f.win) this.apply(f.win);
    this.foe = undefined;
    this.enterNode(f.next);
  }

  // ---------------------------------------------------------------- players & lifecycle

  removePlayer(id: string) {
    const orphaned = this.classes.get(id) ?? [];
    const leaving = this.players.get(id);
    this.players.delete(id);
    this.classes.delete(id);
    this.encounterReady.delete(id);
    this.votes.delete(id);
    this.acted.delete(id);
    this.queued = this.queued.filter((q) => q.player !== id);
    if (this.players.size === 0) {
      if (this.autoTimer) clearTimeout(this.autoTimer);
      this.autoTimer = undefined;
      return;
    }
    if (this.phase === 'ended') return;
    for (const cls of orphaned) {
      if ([...this.classes.values()].some((cl) => cl.includes(cls))) continue;
      const heir = [...this.players.values()].sort((a, b) => (this.classes.get(a.id)?.length ?? 0) - (this.classes.get(b.id)?.length ?? 0))[0]!;
      this.classes.get(heir.id)!.push(cls);
      this.notice(`${leaving?.handle ?? 'someone'} faded. ${heir.handle} takes up the ${CLASS_NAME[cls]}.`);
    }
    if (this.waitingForReady && this.encounterReady.size >= this.players.size) {
      this.waitingForReady = false;
      if (this.phase === 'combat' || this.phase === 'boss') this.scheduleAutoRound(400);
    }
    this.refresh();
    if (this.phase === 'choice' && this.votes.size >= this.players.size) this.resolveVote();
    else this.checkReady();
  }

  private startTimer(ms: number, fn: () => void) {
    this.clearTimer();
    if (ms > 0) {
      this.timer = setTimeout(fn, ms);
      this.deadline = Date.now() + ms;
      this.timerTotal = ms;
    }
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerTotal = 0;
  }

  private end(win: boolean, title: string, ending: string) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimer();
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
    this.foe = undefined;
    this.ending = { title, text: ending, win };
    this.emit({ kind: 'end', win });
    this.say('', ending, { type: 'narrator' });
    this.log(win ? c.green(c.bold(`█ ${title.toUpperCase()} █`)) : c.red(c.bold(`█ ${title.toUpperCase()} █`)));
    for (const p of this.players.values()) p.checkpoint?.(null);
    this.refresh();
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    const r = this.result('');
    this.opts.onEnd({ win, title, meter: this.meter, seconds, stars: r.stars, team: r.team });
  }

  dispose() {
    this.clearTimer();
    if (this.autoTimer) clearTimeout(this.autoTimer);
  }
}
