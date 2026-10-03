import type {
  ActionButton, ClassId, FeedItem, Foe, Fx, Glyph, HudMember, HudState, ModeId, Move, Portrait, SceneState, WyrmInfo,
} from '../../shared/protocol.js';
import { c } from '../ansi.js';
import { BREEDS, BREED_IDS, type Breed } from './breeds.js';
import {
  BOONS, CALLS, CLASS_MOVES, CLASS_NAME, DISTRICTS, FOES, GLYPHS, GLYPH_CHAR, MOVES, NUM, WYRM_FOE, intentOf,
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
}

export interface GameResult {
  win: boolean;
  title: string;
  meter: number;
  seconds: number;
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
}

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
const CORPS = ['Arasaka-Vey', 'Kiroshi Dynamics', 'Militech Halcyon', 'Zetatech Lumen', 'Biotechnica Rho'];
const NPC_NAME: Record<string, string> = { kitsune: 'The Kitsune', fixer: 'The Fixer', oracle: 'The Oracle', scavenger: 'Rook' };
const SITUATION: Record<string, string> = {
  oracle: 'Small spirits on the way to seal the Devourer ask you to reveal where it can be hurt. Only a true, selfless reason earns it.',
  scavenger: 'A crew holding the last lit safehouse wants your medkits and your help on the final night.',
  vault: 'Thieves have reached the vault where you are chained. Let them take your heart only if they convince you they will free you, not sell you.',
  boss: 'A crew of small spirits is fighting to seal you. Some of them speak instead of attacking.',
};

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
  private queued: Queued[] = [];
  private wardsUsed = 0;
  private called?: { by: string; label: string };
  private pendingSpeech = 0;
  private resolveWhenSpoken = false;
  private bossParley: ParleyTurn[] = [];
  private bossTalk: { said?: string; saidBy?: string; reply?: string } = {};
  private lastChoice?: string;
  private timer?: NodeJS.Timeout;

  constructor(players: GamePlayer[], private readonly opts: GameOptions) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(seed);
    this.story = STORIES[opts.story ?? 'adventure'];
    this.breed = BREEDS[this.rng.pick(BREED_IDS)];
    this.wyrmName = this.rng.pick(this.breed.names);
    this.district = this.rng.pick(DISTRICTS);
    this.corp = this.rng.pick(CORPS);
    this.narrator = opts.narrator ?? new SilentNarrator();

    for (const p of players) this.players.set(p.id, p);
    this.assignClasses(this.rng.shuffle(players.map((p) => p.id)));
    this.emit({ kind: 'title', title: this.story.title, subtitle: this.story.pitch });
    for (const p of players) this.brief(p);
    this.enterNode(this.story.start);
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
    return { wyrm: this.wyrmName, breed: this.breed.title, temperament: this.breed.temperament, district: this.district, corp: this.corp, flags: this.flags };
  }

  private wyrmInfo(): WyrmInfo {
    return { name: this.wyrmName, title: this.breed.title, color: this.breed.id, temperament: this.breed.temperament };
  }

  private brief(p: GamePlayer) {
    const role: Record<ClassId, string> = {
      rogue: 'You are the ROGUE. You deal the damage, and only you can touch the glyphs on a lock.',
      mage: 'You are the MAGE. Only you can see what a monster will do next, and read the glyphs on a lock. Call it out to your crew.',
      cleric: 'You are the CLERIC. You Ward the crew from attacks (only a few each chapter) and Mend their wounds.',
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

  private party(viewer: string): HudMember[] {
    const fighting = this.phase === 'combat' || this.phase === 'boss';
    return [...this.players.values()].map((p) => ({ ...this.member(p), you: p.id === viewer, ...(fighting ? { ready: this.isReady(p.id) } : {}) }));
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
        ? { puzzle: { length: pz.sequence.length, progress: pz.progress, misses: pz.misses, maxMisses: NUM.maxMisses, ...(this.has(id, 'mage') ? { sequence: pz.sequence } : {}) } }
        : {}),
      ...(this.phase === 'parley' && pl
        ? { parley: { npc: pl.npc, name: pl.ctx.name, progress: pl.progress, goal: pl.goal, linesLeft: pl.linesLeft, ...(pl.said ? { said: pl.said, saidBy: pl.saidBy } : {}), ...(pl.reply ? { reply: pl.reply } : {}) } }
        : {}),
      ...(this.phase === 'boss'
        ? { parley: { npc: 'wyrm', name: this.wyrmName, progress: 0, goal: 0, linesLeft: 0, ...this.bossTalk } }
        : {}),
      ...(foe ? { foe, round: this.round, wards: this.wardsLeft() } : {}),
      ...(this.ending ? { ending: this.ending } : {}),
    };
  }

  private actionsFor(id: string): ActionButton[] {
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
      case 'boss': {
        const out: ActionButton[] = [];
        const used = this.acted.get(id) ?? new Set<ClassId>();
        for (const cls of this.classes.get(id) ?? []) {
          for (const move of CLASS_MOVES[cls]) {
            const spec = MOVES[move];
            const noWards = move === 'ward' && this.wardsLeft() === 0;
            out.push({
              label: move === 'ward' ? `Ward (${this.wardsLeft()})` : spec.label,
              cmd: move,
              tone: spec.tone,
              hint: noWards ? 'no Wards left this chapter' : spec.hint,
              group: CLASS_NAME[cls],
              disabled: used.has(cls) || noWards,
            });
          }
        }
        if (this.has(id, 'mage')) {
          for (const [key, label] of Object.entries(CALLS)) out.push({ label: label.split(':')[0]!, cmd: `call ${key}`, tone: 'info', hint: `free: tell the crew "${label}"`, group: 'call out (free)' });
        }
        if (this.phase === 'boss') {
          const free = (this.classes.get(id) ?? []).some((cl) => !used.has(cl));
          out.push({ label: `Speak to ${this.wyrmName}`, cmd: 'speak ', input: true, tone: 'talk', hint: `instead of a move · it ${this.breed.temperament}`, group: 'or', disabled: !free });
        }
        return out;
      }
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
        if (cmd === 'call') return this.call(p, rest[0]);
        if (cmd === 'speak') return void this.bossSpeak(p, arg);
        if (cmd in MOVES) return this.act(p, cmd as Move);
        break;
    }
    return this.chat(p, line);
  }

  private help(p: GamePlayer) {
    const lines: Record<Phase, string> = {
      story: 'the story is unfolding.',
      choice: 'vote for an option. most votes wins; ties are settled by fate.',
      puzzle: 'the Mage sees the glyph order and shows it; the Rogue presses the glyphs in order. three mistakes trip the alarm.',
      parley: 'speak <words>. win them over before your lines run out. ' + (this.parley ? `${this.parley.ctx.name} ${this.parley.ctx.temperament}` : ''),
      combat: 'only the Mage sees the foe’s next move: they call it out. Ward blocks attacks (limited), Hex breaks charges and makes the Rogue hit double, Bolt pierces shells, Mend heals.',
      boss: 'as in any fight, but anyone may speak <words> to the wyrm instead of a move. it ' + this.breed.temperament,
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
        return this.startFight({ ...WYRM_FOE, name: this.wyrmName }, false, true, step.next);
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

  private apply(e: Effects) {
    if (e.flags) for (const f of e.flags) this.flags.add(f);
    if (e.boon && !this.boons.has(e.boon)) {
      this.boons.add(e.boon);
      if (e.boon === 'fortified') this.wards++;
      const b = BOONS[e.boon]!;
      this.emit({ kind: 'boon', name: b.name });
      this.notice(`✦ ${b.name}: ${b.desc}`, 'good');
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
    this.startTimer(this.opts.voteMs ?? 40_000, () => this.resolveVote());
  }

  private vote(p: GamePlayer, n: number) {
    if (!this.options[n - 1]) return p.send(c.dim(`vote 1 to ${this.options.length}`));
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
      if (pz.progress >= pz.sequence.length) {
        this.notice('The lock opens with a sound like a held breath let go.', 'good');
        return this.enterNode(pz.success);
      }
    } else {
      pz.misses++;
      pz.progress = 0;
      this.emit({ kind: 'glyph', ok: false, glyph: g });
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
    this.chat(p, `${GLYPH_CHAR[g]} ${g.toUpperCase()}`);
  }

  // ---------------------------------------------------------------- conversations

  private npcContext(npc: string): ParleyContext {
    if (npc === 'wyrm') return { name: this.wyrmName, persona: this.breed.persona, temperament: this.breed.temperament, react: (m) => this.breed.react(m), situation: SITUATION.vault! };
    const base = NPCS[npc]!;
    return { ...base, situation: SITUATION[npc] ?? '' };
  }

  private startParley(npc: string, goal: number, lines: number, success: string, failure: string) {
    this.phase = 'parley';
    this.parley = { npc, ctx: this.npcContext(npc), goal, progress: 0, linesLeft: lines, history: [], busy: false, success, failure };
    this.feedAll({ kind: 'tip', text: `Win over ${this.parley.ctx.name} in ${lines} lines: ${this.parley.ctx.name} ${this.parley.ctx.temperament}. Anyone can speak.` });
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

  private pickIntent(spec: FoeSpec, prev?: IntentSpec): IntentSpec {
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
    const scale = (n >= 4 ? 1.25 : n === 1 ? 0.8 : 1) * NUM.foeHp;
    let hp = spec.hp * scale * (elite ? 1.4 : 1);
    if (boss && this.flags.has('sealed')) hp *= 0.7;
    hp = Math.round(hp);
    const name = elite ? `Dread ${spec.name}` : spec.name;
    this.foe = { spec, name, hp, maxHp: hp, intent: this.pickIntent(spec), exposed: boss && this.boons.has('oracle'), enraged: 0, elite, boss, dmgMult: NUM.foeDmg * (this.story.difficulty ?? 1) * (elite ? 1.25 : 1), next, ...(win ? { win } : {}) };
    this.phase = boss ? 'boss' : 'combat';
    this.round = 1;
    this.queued = [];
    this.acted.clear();
    this.called = undefined;
    this.bossParley = [];
    this.bossTalk = {};
    this.say('', spec.intro, { type: 'narrator' });
    if (this.chapter <= 2 && !boss) this.feedAll({ kind: 'tip', text: 'Only the Mage can see what it will do next. Mage: call it out. Everyone: pick a move.' });
    if (boss) this.feedAll({ kind: 'tip', text: `It ${this.breed.temperament}. Anyone can speak to it instead of using a move.` });
    this.announceRound();
  }

  private announceRound() {
    const f = this.foe!;
    this.log(`${c.red(`ROUND ${this.round}`)} · ${f.name} ${f.hp}/${f.maxHp}${f.exposed ? c.cyan(' · EXPOSED') : ''}`);
    for (const p of this.players.values()) {
      if (this.has(p.id, 'mage')) p.send(c.cyan(`   you see its next move: ${intentOf(f.intent).label} (${intentOf(f.intent).hint})`));
    }
    this.refresh();
    this.startTimer(this.opts.roundMs ?? 45_000, () => this.forceResolve());
  }

  private isReady(id: string) {
    const used = this.acted.get(id);
    return (this.classes.get(id) ?? []).every((cl) => used?.has(cl));
  }

  private call(p: GamePlayer, key?: string) {
    if (!this.has(p.id, 'mage')) return p.feed({ kind: 'tip', text: 'Only the Mage can see what it will do.' });
    const label = key ? CALLS[key] : undefined;
    if (!label) return p.send(c.dim(`call ${Object.keys(CALLS).join(' | ')}`));
    this.called = { by: p.handle, label };
    this.chat(p, `📣 ${label}`);
    this.refresh();
  }

  private act(p: GamePlayer, move: Move) {
    const cls = MOVES[move].cls as ClassId;
    if (!this.has(p.id, cls)) return p.feed({ kind: 'tip', text: `${MOVES[move].label} is the ${CLASS_NAME[cls]}'s move.` });
    const used = this.acted.get(p.id) ?? new Set<ClassId>();
    if (used.has(cls)) return p.feed({ kind: 'tip', text: `Your ${CLASS_NAME[cls]} already acted this round.` });
    if (move === 'ward') {
      if (this.wardsLeft() === 0) return p.feed({ kind: 'tip', text: 'No Wards left this chapter. Mend instead.' });
      this.wardsUsed++;
    }
    used.add(cls);
    this.acted.set(p.id, used);
    this.queued.push({ player: p.id, cls, move });
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
    this.queued.push({ player: p.id, cls, move: 'speak', amount: verdict.score < 0 ? -1 : amount });
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

  private forceResolve() {
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    this.notice('Time! Anyone undecided holds back this round.');
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

    const hit = (who: string, cls: ClassId, move: Move, base: number, opts: { doubles?: boolean; pierces?: boolean } = {}) => {
      let dmg = base;
      const doubled = opts.doubles && f.exposed;
      if (doubled) dmg *= NUM.exposedMult;
      if (shelled && !opts.pierces) dmg = Math.ceil(dmg * NUM.shellMult);
      f.hp = Math.max(0, f.hp - dmg);
      this.emit({ kind: 'act', by: who, cls, move, amount: dmg });
      this.log(`   ${c.green(`${who} · ${MOVES[move].label}: ${dmg}`)}${doubled ? c.cyan(' ×2') : ''}${shelled && !opts.pierces ? c.dim(' (shell ½)') : ''} ${c.dim(`→ ${f.hp}/${f.maxHp}`)}`);
    };

    for (const q of queue) {
      const who = handle(q.player);
      switch (q.move) {
        case 'ward':
          warded = true;
          this.emit({ kind: 'act', by: who, cls: q.cls, move: 'ward' });
          break;
        case 'mend': {
          const amount = Math.min(this.meter, NUM.mend + (this.boons.has('blessing') ? 4 : 0));
          this.meter -= amount;
          this.emit({ kind: 'act', by: who, cls: q.cls, move: 'mend', amount });
          if (amount) this.log(c.yellow(`   ${who} · Mend: −${amount} → ${this.meter}%`));
          break;
        }
        case 'hex':
          hexed = true;
          f.exposed = true;
          hit(who, q.cls, 'hex', NUM.hex);
          break;
        case 'bolt':
          hit(who, q.cls, 'bolt', NUM.bolt + (this.boons.has('weapons') ? 4 : 0), { pierces: true });
          break;
        case 'speak':
          if ((q.amount ?? 0) < 0) {
            f.enraged += NUM.enrage;
            this.emit({ kind: 'act', by: who, cls: q.cls, move: 'speak', amount: 0 });
            this.notice(`${who}'s words enrage it: its next attack hits harder.`, 'bad');
          } else if (q.amount) hit(who, q.cls, 'speak', q.amount, { pierces: true });
          break;
        case 'strike':
          hit(who, q.cls, 'strike', NUM.strike + (this.boons.has('ally') ? 3 : 0), { doubles: true });
          break;
        case 'fury':
          hit(who, q.cls, 'fury', NUM.fury, { doubles: true });
          this.meter = Math.min(100, this.meter + NUM.furyCost);
          break;
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
    const amount = Math.round((it.amount + f.enraged) * mult);
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
    } else f.intent = this.pickIntent(f.spec, prev);
    f.exposed = f.boss && this.boons.has('oracle') && this.round < 2;
    this.round++;
    this.queued = [];
    this.acted.clear();
    this.called = undefined;
    this.announceRound();
  }

  private winFight() {
    const f = this.foe!;
    this.clearTimer();
    this.emit({ kind: 'slay', boss: f.boss });
    this.notice(`${f.name} is destroyed.`, 'good');
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
    this.votes.delete(id);
    this.acted.delete(id);
    this.queued = this.queued.filter((q) => q.player !== id);
    if (this.phase === 'ended' || this.players.size === 0) return;
    for (const cls of orphaned) {
      if ([...this.classes.values()].some((cl) => cl.includes(cls))) continue;
      const heir = [...this.players.values()].sort((a, b) => (this.classes.get(a.id)?.length ?? 0) - (this.classes.get(b.id)?.length ?? 0))[0]!;
      this.classes.get(heir.id)!.push(cls);
      this.notice(`${leaving?.handle ?? 'someone'} faded. ${heir.handle} takes up the ${CLASS_NAME[cls]}.`);
    }
    this.refresh();
    if (this.phase === 'choice' && this.votes.size >= this.players.size) this.resolveVote();
    else this.checkReady();
  }

  private startTimer(ms: number, fn: () => void) {
    this.clearTimer();
    if (ms > 0) this.timer = setTimeout(fn, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private end(win: boolean, title: string, ending: string) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimer();
    this.foe = undefined;
    this.ending = { title, text: ending, win };
    this.emit({ kind: 'end', win });
    this.say('', ending, { type: 'narrator' });
    this.log(win ? c.green(c.bold(`█ ${title.toUpperCase()} █`)) : c.red(c.bold(`█ ${title.toUpperCase()} █`)));
    this.refresh();
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    this.opts.onEnd({ win, title, meter: this.meter, seconds });
  }

  dispose() {
    this.clearTimer();
  }
}
