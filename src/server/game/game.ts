import type { ActionButton, ClassId, Foe, Fx, HudMember, HudState, Intent, Move, RouteKind, RouteOption, SceneState, WyrmInfo } from '../../shared/protocol.js';
import { c } from '../ansi.js';
import { BREEDS, BREED_IDS, type Breed } from './breeds.js';
import {
  BOSS, CLASS_MOVES, CLASS_NAME, DISTRICTS, FOES, MOVES, NUM, RELICS, RELIC_IDS, ROOM_INFO, intentOf,
  type FoeSpec, type IntentSpec, type RelicId,
} from './content.js';
import { ScriptedNarrator, type NarrationEvent, type Narrator } from './narrator.js';
import type { ParleyJudge, ParleyTurn } from './parley.js';
import { Rng } from './rng.js';

export interface GamePlayer {
  readonly id: string;
  readonly handle: string;
  /** Avatar reroll count, chosen in the lobby. */
  readonly avatar?: number;
  send(text: string): void;
  setPrompt(text: string): void;
  setHud(hud: HudState): void;
  setScene(scene: SceneState, actions: ActionButton[]): void;
  fx(fx: Fx): void;
}

export interface GameResult {
  win: boolean;
  reason: string;
  corruption: number;
  seconds: number;
}

export interface GameOptions {
  judge: ParleyJudge;
  onEnd: (result: GameResult) => void;
  narrator?: Narrator;
  seed?: number;
  /** Room code, shown in the HUD. */
  code?: string;
  /** Combat round timer in ms. 0 disables it (tests). */
  roundMs?: number;
  /** Route vote timer in ms. 0 disables it (tests). */
  voteMs?: number;
}

type Phase = 'route' | 'combat' | 'boss' | 'ended';

interface FoeState {
  spec: FoeSpec;
  name: string;
  hp: number;
  maxHp: number;
  step: number;
  intent: IntentSpec;
  pendingHeavy?: IntentSpec;
  exposed: boolean;
  enraged: number;
  elite: boolean;
  boss: boolean;
}

interface Queued {
  player: string;
  cls: ClassId;
  move: Move;
  /** Speech damage, already judged; negative means it enraged the wyrm. */
  amount?: number;
}

/** Shields and heals land first, then set-ups, then the big hits. */
const ORDER: Move[] = ['ward', 'mend', 'hex', 'bolt', 'speak', 'strike', 'fury'];
const CLASS_COLOR: Record<ClassId, (s: string) => string> = { striker: c.red, mystic: c.cyan, guardian: c.yellow };

export class Game {
  readonly breed: Breed;
  readonly wyrmName: string;
  readonly district: string;
  readonly classes = new Map<string, ClassId[]>();
  corruption = 0;
  floor = 1;
  seals = 0;
  phase: Phase = 'route';
  readonly relics = new Set<RelicId>();
  readonly path: RouteKind[] = [];
  options: RouteOption[] = [];
  foe?: FoeState;
  round = 0;

  private readonly players = new Map<string, GamePlayer>();
  private readonly rng: Rng;
  private readonly narrator: Narrator;
  private readonly startedAt = Date.now();
  private readonly votes = new Map<string, string>();
  private readonly acted = new Map<string, Set<ClassId>>();
  private queued: Queued[] = [];
  private pendingSpeech = 0;
  private resolveWhenSpoken = false;
  private lastFoe?: string;
  /** The horror waiting behind each fight option, rolled when the floor opens. */
  private readonly optionFoes = new Map<string, FoeSpec>();
  private timer?: NodeJS.Timeout;
  private parley: NonNullable<SceneState['parley']> = {};
  private parleyHistory: ParleyTurn[] = [];

  constructor(players: GamePlayer[], private readonly opts: GameOptions) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(seed);
    this.breed = BREEDS[this.rng.pick(BREED_IDS)];
    this.wyrmName = this.rng.pick(this.breed.names);
    this.district = this.rng.pick(DISTRICTS);
    this.narrator = opts.narrator ?? new ScriptedNarrator();

    for (const p of players) this.players.set(p.id, p);
    this.assignClasses(this.rng.shuffle(players.map((p) => p.id)));
    this.emit({ kind: 'intro', wyrm: this.wyrmInfo() });
    for (const p of players) this.brief(p);
    this.narrate({ kind: 'start', wyrmName: this.wyrmName, breedTitle: this.breed.title, district: this.district });
    this.openRoute();
  }

  // ---------------------------------------------------------------- setup

  private assignClasses(ids: string[]) {
    const layouts: Record<number, ClassId[][]> = {
      1: [['striker', 'mystic', 'guardian']],
      2: [['striker'], ['mystic', 'guardian']],
      3: [['striker'], ['mystic'], ['guardian']],
      4: [['striker'], ['mystic'], ['guardian'], ['striker']],
    };
    const layout = layouts[Math.min(ids.length, 4)]!;
    ids.forEach((id, i) => this.classes.set(id, [...(layout[i] ?? ['striker'])]));
  }

  private wyrmInfo(): WyrmInfo {
    return { name: this.wyrmName, title: this.breed.title, color: this.breed.id, temperament: this.breed.temperament };
  }

  private brief(p: GamePlayer) {
    const roleLine: Record<ClassId, string> = {
      striker: `${c.red('you are the STRIKER')}: you deal the damage. Strike hits double after the Mystic's Hex.`,
      mystic: `${c.cyan('you are the MYSTIC')}: Hex sets up the Striker and interrupts charges. Bolt breaks shells.`,
      guardian: `${c.yellow('you are the GUARDIAN')}: Ward when the foe is about to attack. Mend when corruption climbs.`,
    };
    p.send(
      [
        '',
        c.bold(`LAST LIGHT // Neo-Avalon · ${this.district}`),
        `${c.red(this.wyrmName)}, the Devourer, is waking beneath the city. When it wakes, every mind in Neo-Avalon goes dark.`,
        `your crew is the last light. descend, and seal it at the bottom. ${c.red('corruption 100% = the city falls.')}`,
        ...(this.classes.get(p.id) ?? []).map((cl) => roleLine[cl]),
        c.dim(`every foe shows its next move. answer it. (this wyrm ${this.breed.temperament}: you can speak to it at the end.)`),
      ].join('\n'),
    );
  }

  // ---------------------------------------------------------------- output

  private broadcast(text: string) {
    for (const p of this.players.values()) p.send(text);
  }

  private emit(fx: Fx) {
    for (const p of this.players.values()) p.fx(fx);
  }

  private narrate(event: NarrationEvent) {
    void this.narrator.narrate(event).then((text) => {
      if (this.phase === 'ended' && event.kind !== 'end') return;
      this.broadcast(c.italic(c.blue(`› ${text}`)));
    });
  }

  private refresh() {
    for (const p of this.players.values()) {
      p.setPrompt(`${c.magenta(p.handle)}> `);
      p.setHud(this.hudFor(p.id));
      p.setScene(this.sceneFor(p.id), this.actionsFor(p.id));
    }
  }

  private party(viewer: string): HudMember[] {
    const fighting = this.phase === 'combat' || this.phase === 'boss';
    return [...this.players.values()].map((p) => ({
      handle: p.handle,
      avatar: p.avatar ?? 0,
      classes: [...(this.classes.get(p.id) ?? [])],
      you: p.id === viewer,
      ...(fighting ? { ready: this.isReady(p.id) } : {}),
    }));
  }

  private hudFor(id: string): HudState {
    return {
      mode: 'delve',
      code: this.opts.code ?? '',
      wyrm: this.wyrmInfo(),
      corruption: this.corruption,
      floor: this.floor,
      floors: NUM.floors,
      seals: this.seals,
      party: this.party(id),
      relics: [...this.relics].map((r) => RELICS[r]),
    };
  }

  private foeView(): Foe | undefined {
    const f = this.foe;
    if (!f) return undefined;
    return {
      id: f.spec.id,
      name: f.name,
      hp: f.hp,
      maxHp: f.maxHp,
      intent: this.displayIntent(),
      ...(f.exposed ? { exposed: true } : {}),
      ...(f.elite ? { elite: true } : {}),
      ...(f.boss ? { boss: true } : {}),
    };
  }

  private displayIntent(): Intent {
    const f = this.foe!;
    const base = intentOf(f.intent);
    if (!f.enraged || f.intent.kind === 'shell' || f.intent.kind === 'charge') return base;
    const amount = f.intent.amount + f.enraged;
    return { ...base, amount, label: `${f.intent.verb} ${amount}`, hint: `${base.hint} (enraged +${f.enraged})` };
  }

  private sceneFor(id: string): SceneState {
    const view = this.phase === 'combat' ? 'combat' : this.phase === 'boss' ? 'boss' : 'route';
    const handles = new Map([...this.players.values()].map((p) => [p.id, p.handle]));
    const foe = this.foeView();
    return {
      view,
      floor: this.floor,
      floors: NUM.floors,
      corruption: this.corruption,
      seals: this.seals,
      party: this.party(id),
      wyrm: this.wyrmInfo(),
      path: [...this.path],
      ...(view === 'route'
        ? { options: this.options.map((o) => ({ ...o, votes: [...this.votes].filter(([, v]) => v === o.id).map(([pid]) => handles.get(pid) ?? '?') })) }
        : {}),
      ...(foe ? { foe, round: this.round } : {}),
      ...(view === 'boss' ? { parley: { ...this.parley } } : {}),
    };
  }

  private actionsFor(id: string): ActionButton[] {
    if (this.phase === 'ended') return [];
    if (this.phase === 'route') {
      const mine = this.votes.get(id);
      return this.options.map((o, i) => ({
        label: `${mine === o.id ? '✓ ' : ''}${i + 1}. ${o.label}`,
        cmd: `vote ${i + 1}`,
        tone: o.kind === 'boss' ? 'fight' : o.kind === 'shrine' ? 'magic' : o.kind === 'cache' ? 'talk' : 'go',
        hint: o.detail,
        group: 'vote',
      }));
    }
    const out: ActionButton[] = [];
    const used = this.acted.get(id) ?? new Set<ClassId>();
    for (const cls of this.classes.get(id) ?? []) {
      for (const move of CLASS_MOVES[cls]) {
        const spec = MOVES[move];
        out.push({ label: spec.label, cmd: move, tone: spec.tone, hint: spec.hint, group: CLASS_NAME[cls], disabled: used.has(cls) });
      }
    }
    if (this.phase === 'boss') {
      const free = (this.classes.get(id) ?? []).some((cl) => !used.has(cl));
      out.push({ label: `Speak to ${this.wyrmName}`, cmd: 'speak ', input: true, tone: 'talk', hint: `${MOVES.speak.hint} It ${this.breed.temperament}.`, group: 'or', disabled: !free });
    }
    return out;
  }

  // ---------------------------------------------------------------- input

  handle(id: string, rawLine: string) {
    const p = this.players.get(id);
    if (!p || this.phase === 'ended') return;
    const line = rawLine.trim();
    if (!line) return;
    const [head = '', ...rest] = line.split(/\s+/);
    const cmd = head.toLowerCase();

    if (cmd === 'say' || line.startsWith("'")) return this.say(p, line.startsWith("'") ? line.slice(1) : rest.join(' '));
    if (cmd === 'help') return this.help(p);
    if (cmd === 'relics') return p.send([...this.relics].map((r) => `  ${c.magenta(RELICS[r].name)} ${c.dim(RELICS[r].desc)}`).join('\n') || c.dim('no relics yet.'));
    if (cmd === 'party' || cmd === 'crew') {
      return p.send([...this.players.values()].map((q) => `  ${q.handle.padEnd(14)} ${(this.classes.get(q.id) ?? []).map((cl) => CLASS_COLOR[cl](CLASS_NAME[cl])).join(' + ')}`).join('\n'));
    }

    if (this.phase === 'route' && (cmd === 'vote' || cmd === 'go' || /^\d$/.test(cmd))) return this.vote(p, /^\d$/.test(cmd) ? cmd : rest[0]);
    if ((this.phase === 'combat' || this.phase === 'boss') && cmd in MOVES) {
      if (cmd === 'speak') return void this.speak(p, rest.join(' '));
      return this.act(p, cmd as Move);
    }
    return this.say(p, line);
  }

  private help(p: GamePlayer) {
    p.send(
      [
        c.bold('how to play'),
        `  each foe shows its ${c.bold('next move')} above its head. answer it before it lands.`,
        `  ${c.yellow('Ward')} blocks an attack · ${c.cyan('Hex')} interrupts a charge and makes ${c.red('Strike')} hit double · ${c.cyan('Bolt')} pierces a shell · ${c.yellow('Mend')} cleanses corruption.`,
        `  between fights, vote on the way down. every foe you beat ${c.bold('weakens the Devourer')} (seals).`,
        `  in the final fight anyone can ${c.bold('speak')} to the wyrm instead of attacking. it ${this.breed.temperament}.`,
        c.dim('  anything else you type is crew chat.'),
      ].join('\n'),
    );
  }

  private say(p: GamePlayer, text: string) {
    const msg = text.trim();
    if (msg) this.broadcast(`${c.magenta(`[${p.handle}]`)} ${msg}`);
  }

  // ---------------------------------------------------------------- route

  private openRoute() {
    this.phase = 'route';
    this.foe = undefined;
    this.votes.clear();
    this.options = this.rollOptions();
    const lines = this.options.map((o, i) => `  ${c.bold(`${i + 1}.`)} ${o.label} ${c.dim(`· ${o.detail}`)}`);
    this.broadcast(['', c.bold(this.floor === NUM.floors ? 'THE BOTTOM · the Devourer waits' : `FLOOR ${this.floor} of ${NUM.floors - 1} · choose the way down`), ...lines].join('\n'));
    this.refresh();
    this.startTimer(this.opts.voteMs ?? 25_000, () => this.resolveVote(true));
  }

  private rollOptions(): RouteOption[] {
    this.optionFoes.clear();
    const used = new Set<string>(this.lastFoe ? [this.lastFoe] : []);
    const make = (kind: RouteKind, i: number): RouteOption => {
      const id = `${this.floor}-${i}`;
      if (kind !== 'fight' && kind !== 'elite') return { id, kind, ...ROOM_INFO[kind], votes: [] };
      // show exactly which horror waits behind this door
      const spec = this.rng.pick(FOES.filter((f) => !used.has(f.id)));
      used.add(spec.id);
      this.optionFoes.set(id, spec);
      const name = kind === 'elite' ? `Dread ${spec.name.replace(/^The /, '')}` : spec.name;
      return { id, kind, label: name, detail: ROOM_INFO[kind].detail, votes: [], foe: spec.id };
    };
    if (this.floor === NUM.floors) return [make('boss', 0)];
    if (this.floor === 1) return [make('fight', 0), make('fight', 1)];
    const pool: RouteKind[] = ['fight', 'fight', 'fight', 'shrine', 'shrine', 'cache', 'cache', ...(this.floor >= 3 ? (['elite', 'elite'] as RouteKind[]) : [])];
    const a = this.rng.pick(pool);
    let b = this.rng.pick(pool);
    for (let i = 0; i < 8 && b === a && a !== 'fight'; i++) b = this.rng.pick(pool);
    return [make(a, 0), make(b, 1)];
  }

  private vote(p: GamePlayer, arg?: string) {
    const option = this.options[Number(arg) - 1];
    if (!option) return p.send(c.dim(this.options.length > 1 ? 'vote 1 or vote 2' : 'vote 1'));
    this.votes.set(p.id, option.id);
    this.emit({ kind: 'vote', by: p.handle });
    this.broadcast(c.dim(`   ${p.handle} votes for ${option.label}`));
    this.refresh();
    if (this.votes.size >= this.players.size) this.resolveVote(false);
  }

  private resolveVote(timedOut: boolean) {
    if (this.phase !== 'route') return;
    this.clearTimer();
    const tally = this.options.map((o) => ({ o, n: [...this.votes.values()].filter((v) => v === o.id).length }));
    const best = Math.max(...tally.map((t) => t.n));
    const leaders = tally.filter((t) => t.n === best).map((t) => t.o);
    const chosen = leaders.length === 1 ? leaders[0]! : this.rng.pick(leaders);
    if (leaders.length > 1) this.broadcast(c.dim(`   ${timedOut && best === 0 ? 'no votes' : 'a tie'}: fate picks ${chosen.label}.`));
    this.enter(chosen.kind, this.optionFoes.get(chosen.id));
  }

  private enter(kind: RouteKind, foe?: FoeSpec) {
    this.path.push(kind);
    this.emit({ kind: 'enter', room: kind });
    switch (kind) {
      case 'shrine': {
        const before = this.corruption;
        this.corruption = Math.max(0, this.corruption - NUM.shrineHeal);
        this.broadcast(c.green(`✦ a quiet shrine. the crew rests: corruption ${before}% → ${this.corruption}%.`));
        this.emit({ kind: 'heal', amount: before - this.corruption });
        return this.nextFloor();
      }
      case 'cache':
        this.grantRelic('the cache held');
        return this.nextFloor();
      case 'boss':
        return this.startFight(true, false);
      default:
        return this.startFight(false, kind === 'elite', foe);
    }
  }

  private nextFloor() {
    this.floor++;
    this.openRoute();
  }

  private grantRelic(how: string) {
    const free = RELIC_IDS.filter((r) => !this.relics.has(r));
    if (!free.length) {
      this.corruption = Math.max(0, this.corruption - 10);
      this.broadcast(c.green(`✦ ${how} nothing new, but the crew cleanses 10% corruption.`));
      return;
    }
    const r = this.rng.pick(free);
    this.relics.add(r);
    this.emit({ kind: 'relic', name: RELICS[r].name });
    this.broadcast(c.magenta(`✦ ${how} ${c.bold(RELICS[r].name)}: ${RELICS[r].desc}`));
  }

  // ---------------------------------------------------------------- combat

  private startFight(boss: boolean, elite: boolean, chosen?: FoeSpec) {
    const scale = (this.players.size >= 4 ? 1.25 : 1) * NUM.foeHp;
    const harden = (p: IntentSpec[], mult: number) => p.map((st) => ({ ...st, amount: Math.round(st.amount * mult * NUM.foeDmg) }));
    let spec: FoeSpec;
    let hp: number;
    if (boss) {
      spec = { ...BOSS, name: this.wyrmName, pattern: harden(BOSS.pattern, 1) };
      hp = Math.round(BOSS.hp * scale * (1 - Math.min(this.seals, NUM.maxSeals) * NUM.sealCut));
    } else {
      spec = chosen ?? this.rng.pick(FOES.filter((f) => f.id !== this.lastFoe));
      this.lastFoe = spec.id;
      spec = { ...spec, pattern: harden(spec.pattern, elite ? 1.3 : 1), ...(elite ? { name: `Dread ${spec.name.replace(/^The /, '')}` } : {}) };
      hp = Math.round(spec.hp * scale * (elite ? 1.5 : 1));
    }
    this.foe = { spec, name: spec.name, hp, maxHp: hp, step: 0, intent: spec.pattern[0]!, exposed: this.relics.has('eye'), enraged: 0, elite, boss };
    this.phase = boss ? 'boss' : 'combat';
    this.round = 1;
    this.queued = [];
    this.acted.clear();
    this.parley = {};
    this.parleyHistory = [];
    this.broadcast(['', c.red(c.bold(`${boss ? '☠ THE DEVOURER' : elite ? '☠ DREAD LAIR' : '⚔ HAUNTED NODE'} // ${spec.name.toUpperCase()}`)), c.italic(spec.intro)].join('\n'));
    if (boss) {
      const n = Math.min(this.seals, NUM.maxSeals);
      this.broadcast(c.dim(`your ${n} seal${n === 1 ? '' : 's'} weakened it to ${hp} HP. it ${this.breed.temperament}: anyone can speak to it instead of attacking.`));
    }
    this.announceRound();
  }

  private announceRound() {
    const f = this.foe!;
    const it = this.displayIntent();
    this.broadcast(`${c.red(`ROUND ${this.round}`)} · ${f.name} ${f.hp}/${f.maxHp} HP · next move: ${c.bold(it.label)} ${c.dim(`(${it.hint})`)}${f.exposed ? c.cyan(' · EXPOSED') : ''}`);
    this.refresh();
    this.startTimer(this.opts.roundMs ?? 40_000, () => this.forceResolve());
  }

  private isReady(id: string) {
    const used = this.acted.get(id);
    return (this.classes.get(id) ?? []).every((cl) => used?.has(cl));
  }

  private act(p: GamePlayer, move: Move) {
    const cls = MOVES[move].cls as ClassId;
    if (!(this.classes.get(p.id) ?? []).includes(cls)) {
      const who = [...this.players.values()].filter((q) => this.classes.get(q.id)?.includes(cls)).map((q) => q.handle).join(' / ');
      return p.send(c.dim(`${MOVES[move].label} is the ${CLASS_NAME[cls]}'s move (${who || 'nobody'}).`));
    }
    const used = this.acted.get(p.id) ?? new Set<ClassId>();
    if (used.has(cls)) return p.send(c.dim(`your ${CLASS_NAME[cls]} already acted this round.`));
    used.add(cls);
    this.acted.set(p.id, used);
    this.queued.push({ player: p.id, cls, move });
    this.broadcast(c.dim(`   ${p.handle} readies ${MOVES[move].label}`));
    this.refresh();
    this.checkReady();
  }

  private async speak(p: GamePlayer, text: string) {
    if (this.phase !== 'boss') return p.send(c.dim('only the Devourer is worth talking to.'));
    if (!text) return p.send(c.dim('speak <what you say to the wyrm>'));
    const used = this.acted.get(p.id) ?? new Set<ClassId>();
    const cls = (this.classes.get(p.id) ?? []).find((cl) => !used.has(cl));
    if (!cls) return p.send(c.dim('you already acted this round.'));
    used.add(cls);
    this.acted.set(p.id, used);
    this.pendingSpeech++;
    const message = text.slice(0, 280);
    this.parley = { said: message, saidBy: p.handle };
    this.broadcast(`${c.green(`${p.handle} → ${this.wyrmName}:`)} ${message}`);
    this.refresh();

    let verdict;
    try {
      verdict = await this.opts.judge.judge({ wyrmName: this.wyrmName, breed: this.breed }, this.parleyHistory, message);
    } catch {
      verdict = { reply: `${this.wyrmName}: ...`, score: 0 };
    }
    this.pendingSpeech--;
    if (this.phase !== 'boss') return;
    this.parleyHistory = [...this.parleyHistory, { from: 'crew' as const, text: message }, { from: 'wyrm' as const, text: verdict.reply }].slice(-10);
    const amount = Math.min(NUM.speechCap, Math.round(Math.max(0, verdict.score) * 1.5));
    this.queued.push({ player: p.id, cls, move: 'speak', amount: verdict.score < 0 ? -1 : amount });
    this.parley = { said: message, saidBy: p.handle, reply: verdict.reply, mood: verdict.score >= 4 ? 'calmer' : verdict.score < 0 ? 'angrier' : 'same' };
    this.broadcast(c.red(verdict.reply));
    this.refresh();
    if (this.resolveWhenSpoken && this.pendingSpeech === 0) return this.resolve();
    this.checkReady();
  }

  private checkReady() {
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    if (this.pendingSpeech > 0) return;
    if ([...this.players.keys()].every((id) => this.isReady(id))) this.resolve();
  }

  private forceResolve() {
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    this.broadcast(c.dim('   (time! anyone undecided holds back this round.)'));
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
      const notes = [doubled ? c.cyan('exposed ×2') : '', shelled && !opts.pierces ? c.dim('shell ½') : ''].filter(Boolean).join(' ');
      this.broadcast(`   ${c.green(`${who} · ${MOVES[move].label}: ${dmg} damage`)} ${notes} ${c.dim(`→ ${f.hp}/${f.maxHp}`)}`);
    };

    for (const q of queue) {
      const who = handle(q.player);
      switch (q.move) {
        case 'ward':
          warded = true;
          this.emit({ kind: 'act', by: who, cls: q.cls, move: 'ward' });
          this.broadcast(`   ${c.yellow(`${who} · Ward: the crew is shielded this round`)}`);
          break;
        case 'mend': {
          const amount = Math.min(this.corruption, NUM.mend + (this.relics.has('feather') ? NUM.featherBonus : 0));
          this.corruption -= amount;
          this.emit({ kind: 'act', by: who, cls: q.cls, move: 'mend', amount });
          if (amount) this.broadcast(`   ${c.yellow(`${who} · Mend: −${amount}% corruption`)} ${c.dim(`→ ${this.corruption}%`)}`);
          else this.broadcast(c.dim(`   ${who} · Mend: nothing to cleanse yet`));
          break;
        }
        case 'hex':
          hexed = true;
          f.exposed = true;
          hit(who, q.cls, 'hex', NUM.hex);
          break;
        case 'bolt':
          hit(who, q.cls, 'bolt', NUM.bolt + (this.relics.has('glass') ? NUM.glassBonus : 0), { pierces: true });
          break;
        case 'speak':
          if ((q.amount ?? 0) < 0) {
            f.enraged += NUM.enrage;
            this.emit({ kind: 'act', by: who, cls: q.cls, move: 'speak', amount: 0 });
            this.broadcast(`   ${c.red(`${who}'s words enrage it: its next attack hits +${NUM.enrage}`)}`);
          } else if (q.amount) {
            hit(who, q.cls, 'speak', q.amount, { pierces: true });
          } else {
            this.broadcast(c.dim(`   ${who}'s words slide off its scales.`));
          }
          break;
        case 'strike':
          hit(who, q.cls, 'strike', NUM.strike + (this.relics.has('fang') ? NUM.fangBonus : 0), { doubles: true });
          break;
        case 'fury':
          hit(who, q.cls, 'fury', NUM.fury, { doubles: true });
          if (!this.relics.has('mask')) {
            this.corruption = Math.min(100, this.corruption + NUM.furyCost);
            this.broadcast(c.dim(`   the fury costs the crew +${NUM.furyCost}% corruption`));
          }
          break;
      }
      if (f.hp <= 0) return this.winFight();
    }
    if (this.corruption >= 100) return this.end(false);

    // the foe's move
    const it = f.intent;
    const extra = f.enraged;
    switch (it.kind) {
      case 'attack':
      case 'heavy': {
        const amount = it.amount + extra;
        if (warded) {
          this.emit({ kind: 'foe', move: it.kind, amount, blocked: true });
          this.broadcast(`   ${c.yellow(`${f.name} · ${it.verb}: blocked by the Ward!`)}`);
          if (this.relics.has('bell')) {
            f.hp = Math.max(0, f.hp - NUM.bellReflect);
            this.broadcast(`   ${c.magenta(`the Jade Bell rings: ${NUM.bellReflect} damage reflected`)}`);
            if (f.hp <= 0) return this.winFight();
          }
        } else {
          this.corruption = Math.min(100, this.corruption + amount);
          this.emit({ kind: 'foe', move: it.kind, amount, blocked: false });
          this.broadcast(`   ${c.red(`${f.name} · ${it.verb}: +${amount}% corruption`)} ${c.dim(`→ ${this.corruption}%`)}`);
        }
        f.enraged = 0;
        break;
      }
      case 'charge':
        if (hexed) {
          this.emit({ kind: 'stun' });
          this.broadcast(`   ${c.cyan(`the Hex breaks ${f.name}'s charge. it staggers.`)}`);
        } else {
          f.pendingHeavy = { kind: 'heavy', amount: it.amount, verb: it.verb };
          this.emit({ kind: 'foe', move: 'charge', amount: it.amount, blocked: false });
          this.broadcast(`   ${c.red(`${f.name} gathers itself. ${it.verb} ${it.amount} is coming next round!`)}`);
        }
        break;
      case 'shell':
        this.emit({ kind: 'foe', move: 'shell', amount: 0, blocked: false });
        this.broadcast(c.dim(`   ${f.name} hardens.`));
        break;
      case 'wail': {
        const amount = it.amount + extra;
        this.corruption = Math.min(100, this.corruption + amount);
        this.emit({ kind: 'foe', move: 'wail', amount, blocked: false });
        this.broadcast(`   ${c.red(`${f.name} · ${it.verb}: +${amount}% corruption (unblockable)`)} ${c.dim(`→ ${this.corruption}%`)}`);
        f.enraged = 0;
        break;
      }
    }
    if (this.corruption >= 100) return this.end(false);

    // what it does next
    if (f.pendingHeavy) {
      f.intent = f.pendingHeavy;
      f.pendingHeavy = undefined;
    } else {
      f.step = (f.step + 1) % f.spec.pattern.length;
      f.intent = f.spec.pattern[f.step]!;
    }
    f.exposed = false;
    this.round++;
    this.queued = [];
    this.acted.clear();
    this.announceRound();
  }

  private winFight() {
    const f = this.foe!;
    this.clearTimer();
    this.emit({ kind: 'slay', boss: f.boss });
    if (f.boss) return this.end(true);
    this.broadcast(c.green(c.bold(`✔ ${f.name} is destroyed.`)));
    this.narrate({ kind: 'slay', foe: f.name });
    const gained = f.elite ? 2 : 1;
    this.seals += gained;
    const weaker = Math.round(Math.min(this.seals, NUM.maxSeals) * NUM.sealCut * 100);
    this.broadcast(c.magenta(`✦ +${gained} seal${gained > 1 ? 's' : ''} on the Devourer: it will be ${weaker}% weaker.`));
    if (f.elite) this.grantRelic('the lair held');
    this.foe = undefined;
    this.nextFloor();
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
      this.broadcast(c.magenta(`>> ${leaving?.handle ?? 'someone'} faded. ${heir.handle} takes up the ${CLASS_NAME[cls]}.`));
    }
    this.refresh();
    if (this.phase === 'route' && this.votes.size >= this.players.size) this.resolveVote(false);
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

  private end(win: boolean) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimer();
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    const reason = win ? `${this.wyrmName} is sealed. Neo-Avalon wakes.` : `corruption reached 100%. ${this.wyrmName} wakes, and the city goes dark.`;
    this.broadcast(
      ['', win ? c.green(c.bold('█ THE LIGHT HOLDS █')) : c.red(c.bold('█ THE CITY FALLS █')), reason, c.dim(`floor ${this.floor} · corruption ${this.corruption}% · ${this.seals} seals · ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`), ''].join('\n'),
    );
    this.emit({ kind: 'end', win });
    this.narrate({ kind: 'end', win, wyrmName: this.wyrmName });
    this.refresh();
    this.opts.onEnd({ win, reason, corruption: this.corruption, seconds });
  }

  dispose() {
    this.clearTimer();
  }
}
