import type { ActionButton, Fx, HudMember, HudState, RollView, SceneRoom, SceneState } from '../../shared/protocol.js';
import { c } from '../ansi.js';
import { MONSTERS, PROGRAMS, PROGRAM_IDS, programByName, type MonsterSpec, type ProgramId } from './bestiary.js';
import { BREEDS, BREED_IDS } from './breeds.js';
import { COMBAT_VERBS, Encounter, type CombatAction, type CombatHost } from './combat.js';
import { Dice, describeCheck, passed, type CheckResult } from './dice.js';
import { INJECTION, intelMentioned, type IntelKey, type WardenBrain, type WardenTurn } from './ice.js';
import { ScriptedNarrator, type NarrationEvent, type Narrator } from './narrator.js';
import { Rng } from './rng.js';
import { GATEWAY, VAULT, bfsDepths, generateWorld, type IntelKind, type NetNode, type World } from './world.js';

export type Role = 'RUNNER' | 'OPERATOR' | 'SENTRY';

export interface GamePlayer {
  readonly id: string;
  readonly handle: string;
  /** Avatar reroll count, chosen in the lobby. */
  readonly avatar?: number;
  send(text: string): void;
  setPrompt(text: string): void;
  showRoll(roll: RollView): void;
  setHud(hud: HudState): void;
  setScene(scene: SceneState, actions: ActionButton[]): void;
  fx(fx: Fx): void;
}

export interface GameResult {
  win: boolean;
  reason: string;
  trace: number;
  seconds: number;
}

export interface GameOptions {
  warden: WardenBrain;
  onEnd: (result: GameResult) => void;
  narrator?: Narrator;
  seed?: number;
  /** Room code, shown in the HUD. */
  code?: string;
  /** Passive trace interval in ms. 0 disables it (tests). */
  tickMs?: number;
  /** Combat round timer in ms. 0 disables it (tests). */
  roundMs?: number;
  /** Random source for dice. Tests pass a constant. */
  random?: () => number;
}

export const RULES = {
  moveCost: 2,
  catCost: 1,
  crackCostPerSecurity: 2,
  crackSlipCost: 6,
  crackWrongPortCost: 12,
  crackFumbleCost: 15,
  rogueBonus: 4,
  clericBonus: 3,
  stealthDc: 13,
  talkCost: 3,
  patrolHitCost: 20,
  patrolSweepCost: 10,
  patrolEvery: 3,
  spoofBase: 8,
  spoofCooldown: 4,
  lockoutCost: 20,
  grantMaxSuspicion: 60,
  grantIntelNeeded: 2,
  blackGrudgeSlack: 15,
  historyLimit: 12,
  ghostMoves: 3,
  mendAmount: 12,
};

export const CLASS_OF: Record<Role, string> = { RUNNER: 'rogue', OPERATOR: 'mage', SENTRY: 'cleric' };
const ROLE_COLOR: Record<Role, (s: string) => string> = { RUNNER: c.green, OPERATOR: c.cyan, SENTRY: c.yellow };
const INTEL_LABEL: Record<IntelKind, string> = {
  fragment: 'passcode fragment',
  personnel: 'personnel record',
  comms: 'sysadmin mail',
};
const INTEL_KEY_LABEL: Record<IntelKey, string> = {
  admin: "the sysadmin's name",
  ticket: 'the maintenance ticket',
  pet: "the sysadmin's cat",
};

const COMMAND_ROLE: Record<string, Role> = {
  ls: 'RUNNER', look: 'RUNNER', cat: 'RUNNER', move: 'RUNNER', cd: 'RUNNER', crack: 'RUNNER',
  take: 'RUNNER', talk: 'RUNNER', download: 'RUNNER',
  map: 'OPERATOR',
  logs: 'SENTRY', spoof: 'SENTRY',
};
const RUNNER_BLOCKED_IN_COMBAT = new Set(['cat', 'move', 'cd', 'crack', 'take', 'talk', 'download']);

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

export class Game {
  readonly world: World;
  readonly roles = new Map<string, Set<Role>>();
  runnerAt = GATEWAY;
  trace = 0;
  patrolAt: string;
  ended = false;
  encounter?: Encounter;
  readonly deck = new Map<ProgramId, number>();

  private readonly players = new Map<string, GamePlayer>();
  private readonly rng: Rng;
  private readonly dice: Dice;
  private readonly narrator: Narrator;
  private readonly unlocked = new Set<string>([GATEWAY]);
  private readonly visited = new Set<string>([GATEWAY]);
  /** Monsters still alive, with their current HP. */
  private readonly lairs = new Map<string, { spec: MonsterSpec; hp: number }>();
  private readonly iceLog: string[] = [];
  private readonly startedAt = Date.now();
  private prevAt = GATEWAY;
  private actions = 0;
  private spoofReadyAt = 0;
  private warnedAt = 0;
  private ghostMoves = 0;
  private lastRoll?: string;
  private readonly layout = new Map<string, { x: number; y: number }>();
  private lastSaid?: string;
  private lastReply?: string;
  private ticker?: NodeJS.Timeout;

  private wardenHistory: WardenTurn[] = [];
  private wardenSuspicion: number;
  private wardenPeak: number;
  private wardenLocked = false;
  private wardenBusy = false;
  private readonly mentioned = new Set<IntelKey>();

  constructor(players: GamePlayer[], private readonly opts: GameOptions) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.world = generateWorld(seed);
    this.rng = new Rng(seed ^ 0x5eed);
    this.dice = new Dice(opts.random);
    this.narrator = opts.narrator ?? new ScriptedNarrator();
    this.wardenSuspicion = this.wardenPeak = this.world.breed.startSuspicion;
    for (const [id, spec] of this.world.monsters) this.lairs.set(id, { spec, hp: spec.hp });

    // Never start the patrol on the gate or right next to the runner's entry point.
    const entry = this.world.nodes.get(GATEWAY)!.links;
    const spawn = this.world.middle.filter((id) => id !== this.world.gateId && !entry.includes(id));
    this.patrolAt = this.rng.pick(spawn.length ? spawn : this.world.middle);

    for (const p of players) this.players.set(p.id, p);
    this.assignRoles(this.rng.shuffle(players.map((p) => p.id)));
    for (const p of players) this.brief(p);
    this.refresh();
    const w = this.world;
    this.computeLayout();
    this.refresh();
    this.emit({ kind: 'intro', corp: w.corp, district: w.district.split(',')[0]!, wyrm: w.wardenName, title: w.breed.title, color: w.breed.id });
    this.narrate({ kind: 'start', corp: w.corp, district: w.district.split(',')[0]!, wyrmName: w.wardenName, breedTitle: w.breed.title });

    const tickMs = opts.tickMs ?? 20_000;
    if (tickMs > 0) this.ticker = setInterval(() => this.addTrace(1, 'background sweep'), tickMs);
  }

  // ---------------------------------------------------------------- roles

  private assignRoles(ids: string[]) {
    const layouts: Record<number, Role[][]> = {
      1: [['RUNNER', 'OPERATOR', 'SENTRY']],
      2: [['RUNNER'], ['OPERATOR', 'SENTRY']],
      3: [['RUNNER'], ['OPERATOR'], ['SENTRY']],
      4: [['RUNNER'], ['OPERATOR'], ['SENTRY'], ['OPERATOR']],
    };
    const layout = layouts[Math.min(ids.length, 4)]!;
    ids.forEach((id, i) => this.roles.set(id, new Set(layout[i] ?? ['OPERATOR'])));
  }

  private has(id: string, role: Role) {
    return this.roles.get(id)?.has(role) ?? false;
  }

  private holdersOf(role: Role): GamePlayer[] {
    return [...this.players.values()].filter((p) => this.has(p.id, role));
  }

  private roleTag(id: string) {
    return [...(this.roles.get(id) ?? [])].map((r) => ROLE_COLOR[r](`${r} (${CLASS_OF[r]})`)).join(' + ');
  }

  /** A player dropped. Hand their roles to whoever is carrying the least. */
  removePlayer(id: string) {
    const orphaned = this.roles.get(id);
    const leaving = this.players.get(id);
    this.players.delete(id);
    this.roles.delete(id);
    if (this.ended || this.players.size === 0 || !orphaned) return;

    for (const role of orphaned) {
      if (this.holdersOf(role).length > 0) continue;
      const heir = [...this.players.values()].sort(
        (a, b) => (this.roles.get(a.id)?.size ?? 0) - (this.roles.get(b.id)?.size ?? 0),
      )[0]!;
      this.roles.get(heir.id)!.add(role);
      this.broadcast(c.magenta(`>> ${leaving?.handle ?? 'someone'} dropped. ${heir.handle} picks up the ${role} rig.`));
      heir.send(this.roleCommands(role));
    }
    this.refresh();
    this.encounter?.checkReady();
  }

  // ---------------------------------------------------------------- output

  private broadcast(text: string) {
    for (const p of this.players.values()) p.send(text);
  }

  private toRole(role: Role, text: string) {
    for (const p of this.holdersOf(role)) p.send(text);
  }

  private narrate(event: NarrationEvent) {
    void this.narrator.narrate(event).then((text) => {
      if (this.ended && event.kind !== 'end') return;
      this.broadcast(c.italic(c.blue(`DM › ${text}`)));
    });
  }

  /** Roll a d20 check everyone watches tumble. */
  private check(who: string, label: string, bonus: number, dc: number): CheckResult {
    const r = this.dice.check(bonus, dc);
    const text = describeCheck(who, label, r);
    this.lastRoll = stripAnsi(text);
    const roll: RollView = { sides: 20, natural: r.natural, text, outcome: r.outcome, caption: `${who} · ${label} · DC ${r.dc}` };
    for (const p of this.players.values()) p.showRoll(roll);
    return r;
  }

  private emit(fx: Fx) {
    for (const p of this.players.values()) p.fx(fx);
  }

  private refresh() {
    for (const p of this.players.values()) {
      p.setPrompt(this.promptFor(p.id));
      p.setHud(this.hudFor(p.id));
      p.setScene(this.sceneFor(p.id), this.actionsFor(p.id));
    }
  }

  // ---------------------------------------------------------------- scene

  /** Columns by distance from the gateway, rows spread around the middle. */
  private computeLayout() {
    const depth = bfsDepths(this.world.nodes, GATEWAY);
    const order = [GATEWAY, ...this.world.middle, VAULT];
    const columns = new Map<number, string[]>();
    for (const id of order) {
      const d = depth.get(id) ?? 0;
      columns.set(d, [...(columns.get(d) ?? []), id]);
    }
    for (const [d, ids] of columns) ids.forEach((id, i) => this.layout.set(id, { x: d, y: i - (ids.length - 1) / 2 }));
  }

  private sceneView(): SceneState['view'] {
    if (this.encounter) return 'combat';
    if (this.runnerAt === VAULT) return 'vault';
    if (this.runnerAt === this.world.gateId && !this.isOpen(VAULT)) return 'parley';
    return 'explore';
  }

  private sceneFor(id: string): SceneState {
    const w = this.world;
    const isOp = this.has(id, 'OPERATOR');
    const isSentry = this.has(id, 'SENTRY');
    const near = new Set<string>();
    for (const v of this.visited) for (const l of this.node(v).links) near.add(l);

    const rooms: SceneRoom[] = [...w.nodes.values()].map((n) => {
      const visited = this.visited.has(n.id);
      const known: SceneRoom['known'] = isOp ? 'full' : visited ? 'visited' : near.has(n.id) || isSentry ? 'seen' : 'hidden';
      const pos = this.layout.get(n.id) ?? { x: 0, y: 0 };
      const kind: SceneRoom['kind'] = n.id === GATEWAY ? 'gateway' : n.id === VAULT ? 'vault' : n.id === w.gateId ? 'gate' : 'room';
      const room: SceneRoom = { id: n.id, label: known === 'hidden' ? '' : n.label, x: pos.x, y: pos.y, links: n.links, kind, known, locked: !this.isOpen(n.id) };
      if (isOp || visited) {
        if (n.files.some((f) => f.intel)) room.intel = true;
        if (n.files.some((f) => f.program)) room.program = true;
        const lair = this.lairs.get(n.id);
        if (lair) room.lair = lair.spec.id;
      }
      if (isOp && room.locked && n.id !== VAULT) room.port = n.port;
      return room;
    });

    const party: HudMember[] = [...this.players.values()].map((p) => ({
      handle: p.handle,
      avatar: p.avatar ?? 0,
      classes: [...(this.roles.get(p.id) ?? [])].map((r) => CLASS_OF[r]),
      you: p.id === id,
      ...(this.encounter ? { ready: this.encounter.actions.has(p.id) } : {}),
    }));
    const enc = this.encounter;
    return {
      view: this.sceneView(),
      rooms,
      runnerAt: this.runnerAt,
      ...(isSentry ? { patrolAt: this.patrolAt } : {}),
      ...(this.ghostMoves > 0 ? { ghosted: true } : {}),
      party,
      wyrm: { name: w.wardenName, title: w.breed.title, color: w.breed.id },
      ...(enc ? { combat: { monster: enc.monster.id, name: enc.monster.name, hp: enc.hp, maxHp: enc.monster.hp, round: enc.round } } : {}),
      parley: { suspicion: this.wardenSuspicion, sealed: this.wardenLocked, ...(this.lastSaid ? { said: this.lastSaid } : {}), ...(this.lastReply ? { reply: this.lastReply } : {}) },
    };
  }

  /** The buttons a player sees right now. Typing still works for everything. */
  private actionsFor(id: string): ActionButton[] {
    const out: ActionButton[] = [];
    if (this.ended) return out;
    const enc = this.encounter;
    const castable = (pid: ProgramId) => (this.deck.get(pid) ?? 0) > 0;

    if (enc) {
      const done = enc.actions.has(id);
      if (this.has(id, 'RUNNER')) out.push({ label: 'strike', cmd: 'strike', tone: 'fight', hint: 'd20+4, 1d8+2 damage' }, { label: 'flee', cmd: 'flee', tone: 'go', hint: 'escape to the last room' });
      if (this.has(id, 'OPERATOR')) out.push({ label: 'bolt', cmd: 'bolt', tone: 'fight', hint: 'd20+3, 1d6+1 damage' }, { label: 'analyze', cmd: 'analyze', tone: 'info', hint: '+3 to hit for everyone' });
      if (this.has(id, 'SENTRY')) out.push({ label: 'shield', cmd: 'shield', tone: 'magic', hint: 'halve the next hit' });
      for (const pid of ['nova', 'mend', 'ghost'] as const) if (castable(pid)) out.push({ label: `cast ${pid}`, cmd: `cast ${pid}`, tone: 'magic', hint: PROGRAMS[pid].blurb });
      out.push({ label: 'wait', cmd: 'wait', tone: 'info' });
      return done ? out.map((b) => ({ ...b, disabled: true })) : out;
    }

    if (this.has(id, 'RUNNER')) {
      const here = this.node();
      for (const l of here.links) {
        if (this.isOpen(l)) out.push({ label: `go ${l}`, cmd: `move ${l}`, tone: 'go' });
        else if (l === VAULT) out.push({ label: 'crack vault', cmd: 'crack vault ', input: true, tone: 'risk', hint: 'type the 6-digit code' });
        else out.push({ label: `crack ${l}`, cmd: `crack ${l} `, input: true, tone: 'risk', hint: 'type the port your mage reads out' });
      }
      if (this.runnerAt === this.world.gateId && !this.isOpen(VAULT) && !this.wardenLocked) {
        out.push({ label: `talk to ${this.world.wardenName}`, cmd: 'talk ', input: true, tone: 'talk', hint: 'say anything. use what you found.' });
      }
      for (const f of here.files) {
        out.push(f.program ? { label: `take ${f.name}`, cmd: `take ${f.name}`, tone: 'magic' } : { label: `read ${f.name}`, cmd: `cat ${f.name}`, tone: 'info' });
      }
      if (this.runnerAt === VAULT) out.unshift({ label: 'DOWNLOAD payload.dat', cmd: 'download', tone: 'go' });
    }
    if (this.has(id, 'SENTRY')) {
      const ready = this.spoofReady();
      out.push({ label: ready ? 'spoof · heal trace' : `spoof · ${this.spoofReadyAt - this.actions} moves`, cmd: 'spoof', tone: 'magic', disabled: !ready });
    }
    for (const pid of ['ghost', 'babel', 'mend'] as const) if (castable(pid)) out.push({ label: `cast ${pid}`, cmd: `cast ${pid}`, tone: 'magic', hint: PROGRAMS[pid].blurb });
    if (castable('icepick')) out.push({ label: 'cast icepick', cmd: 'cast icepick ', input: true, tone: 'magic', hint: 'type a locked room next to the runner' });
    return out;
  }

  private promptFor(id: string): string {
    const fight = this.encounter ? c.red('⚔ ') : '';
    if (this.has(id, 'RUNNER')) return `${fight}${c.green('runner')}@${c.bold(this.runnerAt)}> `;
    if (this.has(id, 'SENTRY')) return `${fight}${c.yellow('sentry')}> `;
    return `${fight}${c.cyan('operator')}> `;
  }

  private hudFor(id: string): HudState {
    const w = this.world;
    const party: HudMember[] = [...this.players.values()].map((p) => ({
      handle: p.handle,
      avatar: p.avatar ?? 0,
      classes: [...(this.roles.get(p.id) ?? [])].map((r) => CLASS_OF[r]),
      you: p.id === id,
      ...(this.encounter ? { ready: this.encounter.actions.has(p.id) } : {}),
    }));
    return {
      mode: 'delve',
      code: this.opts.code ?? '',
      corp: w.corp,
      district: w.district.split(',')[0]!,
      wyrm: { name: w.wardenName, title: w.breed.title, color: w.breed.id },
      trace: this.trace,
      party,
      deck: [...this.deck].filter(([, n]) => n > 0).map(([pid, n]) => ({ name: PROGRAMS[pid].file, charges: n })),
      location: this.runnerAt,
      ...(this.encounter
        ? { encounter: { name: this.encounter.monster.name, hp: this.encounter.hp, maxHp: this.encounter.monster.hp, round: this.encounter.round } }
        : {}),
      ...(this.lastRoll ? { lastRoll: this.lastRoll } : {}),
    };
  }

  private brief(p: GamePlayer) {
    const w = this.world;
    const lines = [
      '',
      c.bold(`THE DELVE // ${w.corp} · ${w.district.split(',')[0]}`),
      `steal ${c.green('payload.dat')} from ${c.red(w.wardenName)}'s hoard. trace 100% = flatlined.`,
      ...[...(this.roles.get(p.id) ?? [])].map((r) => this.roleBrief(r)),
      c.dim('use the buttons, click rooms on the map, or type. anything else you type is crew chat.'),
    ];
    p.send(lines.join('\n'));
  }

  private roleBrief(role: Role): string {
    switch (role) {
      case 'RUNNER':
        return `${ROLE_COLOR.RUNNER('you are the ROGUE')}: you walk the dungeon, but you can only see where you've been. ask your crew.`;
      case 'OPERATOR':
        return `${ROLE_COLOR.OPERATOR('you are the MAGE')}: your map shows every lock's port, the intel and the monster lairs. guide the rogue.`;
      case 'SENTRY':
        return `${ROLE_COLOR.SENTRY('you are the CLERIC')}: you alone see the hunting patrol (the red eye). warn the rogue, and heal trace.`;
    }
  }

  private roleCommands(role: Role): string {
    const cmds: Record<Role, [string, string][]> = {
      RUNNER: [
        ['ls', 'look around the room'],
        ['cat <file>', 'read a file'],
        ['take <program>', 'pocket a program into the party deck'],
        ['move <node>', 'go to a linked room'],
        ['crack <node> <port>', 'pick a locked node (d20; your mage has the port)'],
        ['crack vault <code>', 'the 6-digit code from the three fragments'],
        ['talk <message>', `parley with ${this.world.wardenName} (from the room next to the vault)`],
        ['download', 'take the payload (inside the vault)'],
        ['strike · flee', 'in combat'],
      ],
      OPERATOR: [
        ['map', 'the schematic: rooms, ports, intel, lairs, the runner'],
        ['bolt · analyze', 'in combat'],
      ],
      SENTRY: [
        ['logs', 'the patrol, trace and recent events'],
        ['spoof', 'scrub 1d8+8 trace (recharges)'],
        ['shield', 'in combat'],
      ],
    };
    return cmds[role].map(([k, v]) => `  ${ROLE_COLOR[role](k.padEnd(22))}${c.dim(v)}`).join('\n');
  }

  // ---------------------------------------------------------------- input

  handle(id: string, rawLine: string) {
    const p = this.players.get(id);
    if (!p || this.ended) return;
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith("'") || line.startsWith('"')) return this.say(p, line.slice(1));
    const [head = '', ...rest] = line.split(/\s+/);
    const cmd = head.toLowerCase();
    const arg = rest.join(' ');

    if (this.encounter && (cmd in COMBAT_VERBS || cmd === 'cast')) return this.combatAction(p, cmd, rest);

    const needed = COMMAND_ROLE[cmd];
    if (needed && !this.has(id, needed)) {
      const who = this.holdersOf(needed).map((q) => q.handle).join(' / ') || 'nobody';
      return p.send(c.dim(`that's the ${needed}'s job (${who}). tell them:  say <message>`));
    }
    if (this.encounter && RUNNER_BLOCKED_IN_COMBAT.has(cmd)) {
      return p.send(c.red(`the ${this.encounter.monster.name} is on you. fight: ${this.encounter.menuFor(p)}`));
    }

    switch (cmd) {
      case 'say': return this.say(p, arg);
      case 'help': return this.help(p);
      case 'crew': case 'who': case 'party':
        return p.send([...this.players.values()].map((q) => `  ${q.handle.padEnd(16)} ${this.roleTag(q.id)}`).join('\n'));
      case 'ls': case 'look': return this.look(p);
      case 'cat': return this.cat(p, arg);
      case 'take': return this.take(p, arg);
      case 'move': case 'cd': return this.move(p, arg);
      case 'crack': return this.crack(p, rest[0], rest[1]);
      case 'talk': return void this.talk(p, arg);
      case 'download': return this.download(p);
      case 'map': return this.map(p);
      case 'logs': return this.logs(p);
      case 'spoof': return this.spoof(p);
      case 'deck': return this.showDeck(p);
      case 'cast': return this.cast(p, rest[0], rest[1]);
      case 'bestiary': return this.bestiary(p);
      case 'trace': return p.send(`trace: ${traceColor(this.trace)(`${this.trace}%`)}`);
      default:
        if (cmd in COMBAT_VERBS) return p.send(c.dim('nothing to fight here.'));
        return this.say(p, line);
    }
  }

  private help(p: GamePlayer) {
    const lines = [...(this.roles.get(p.id) ?? [])].map((r) => this.roleCommands(r));
    lines.push(c.dim('  say <msg> · party · deck · cast <program> [target] · bestiary · leave'));
    if (this.encounter) lines.push(`${c.red('in combat:')} ${this.encounter.menuFor(p)}`);
    p.send(lines.join('\n'));
  }

  private say(p: GamePlayer, text: string) {
    const msg = text.trim();
    if (!msg) return;
    this.broadcast(`${c.magenta(`[${p.handle}]`)} ${msg}`);
  }

  // ---------------------------------------------------------------- runner

  private node(id: string = this.runnerAt): NetNode {
    return this.world.nodes.get(id)!;
  }

  private isOpen(id: string) {
    return !this.node(id).locked || this.unlocked.has(id);
  }

  private look(p: GamePlayer) {
    const n = this.node();
    const links = n.links.map((l) => (this.isOpen(l) ? c.bold(l) : `${l} ${c.red('[LOCKED]')}`));
    const files = n.files.map((f) => (f.program ? c.magenta(f.name) : f.name));
    p.send(
      [
        `${c.green('▸')} ${c.bold(n.id)} ${c.dim(`· ${n.label}`)}${files.length ? ` ${c.dim('· files:')} ${files.join(' ')}` : ''}`,
        `  ${c.dim('links:')} ${links.join('  ')}`,
      ].join('\n'),
    );
  }

  private findFile(name: string) {
    return this.node().files.find((f) => f.name.toLowerCase() === name.toLowerCase());
  }

  private cat(p: GamePlayer, name: string) {
    const file = this.findFile(name);
    if (!file) return p.send(c.dim(name ? `no file '${name}' here. try ls.` : 'usage: cat <file>'));
    p.send(`${c.dim(`--- ${file.name} ---`)}\n${file.body}\n${c.dim(file.program ? `--- (take ${file.name} to add it to the deck)` : '---')}`);
    this.addTrace(RULES.catCost, `read ${file.name}`);
  }

  private take(p: GamePlayer, name: string) {
    const file = this.findFile(name) ?? this.node().files.find((f) => f.program && programByName(name)?.id === f.program);
    if (!file?.program) return p.send(c.dim(name ? `nothing called '${name}' you can take here.` : 'usage: take <program>'));
    const n = this.node();
    n.files = n.files.filter((f) => f !== file);
    this.addToDeck(file.program, `${p.handle} pocketed`);
  }

  private addToDeck(id: ProgramId, how: string) {
    const spec = PROGRAMS[id];
    this.deck.set(id, (this.deck.get(id) ?? 0) + spec.charges);
    this.emit({ kind: 'loot', name: spec.file });
    this.broadcast(c.magenta(`✦ ${how} ${spec.file} (${spec.charges} charge${spec.charges > 1 ? 's' : ''}): ${spec.blurb}`));
    this.refresh();
  }

  private move(p: GamePlayer, target: string) {
    const to = target.toLowerCase();
    const here = this.node();
    if (!to) return p.send(c.dim(`usage: move <node>. links: ${here.links.join(', ')}`));
    if (!here.links.includes(to)) return p.send(c.dim(`no link to '${to}' from here. links: ${here.links.join(', ')}`));
    if (!this.isOpen(to)) {
      return p.send(
        to === VAULT
          ? c.red(`the vault is sealed. crack vault <6-digit code>, or talk ${this.world.wardenName} into opening it.`)
          : c.red(`ICE wall on ${to}. crack ${to} <port>. your mage has the port.`),
      );
    }
    this.prevAt = this.runnerAt;
    this.runnerAt = to;
    const firstVisit = !this.visited.has(to);
    this.visited.add(to);
    this.emit({ kind: 'move', from: this.prevAt, to });
    this.look(p);
    // The monster's intro narrates lairs, so the DM only sets the scene for quiet rooms.
    if (firstVisit && to !== VAULT && !this.lairs.has(to)) this.narrate({ kind: 'enter', node: to, label: this.node(to).label, corp: this.world.corp });
    if (firstVisit && to === this.world.gateId && !this.isOpen(VAULT)) {
      this.broadcast(c.red(this.world.breed.arrival.replace('{name}', this.world.wardenName)));
    }
    if (this.ghostMoves > 0) this.ghostMoves--;

    if (this.patrolAt === to && this.ghostMoves === 0) {
      const r = this.check(p.handle, 'sneaks past the hunting patrol', RULES.rogueBonus, RULES.stealthDc);
      if (passed(r.outcome)) {
        this.broadcast(c.green(`>> the patrol sweeps right past ${p.handle}.`));
        this.addTrace(RULES.moveCost, `hop to ${to}`);
      } else {
        this.broadcast(c.red(`!! ${p.handle} walked straight into the ICE patrol on ${to}`));
        this.emit({ kind: 'alarm' });
        this.emit({ kind: 'hurt', amount: RULES.patrolHitCost });
        this.addTrace(RULES.patrolHitCost, `patrol contact on ${to}`);
      }
    } else {
      this.addTrace(RULES.moveCost, `hop to ${to}`);
    }
    this.refresh();
    this.tick();
    this.maybeStartEncounter();
  }

  private maybeStartEncounter() {
    const lair = this.lairs.get(this.runnerAt);
    if (!lair || this.ended || this.encounter) return;
    this.encounter = new Encounter(this.combatHost(), lair.spec, this.runnerAt, this.opts.roundMs ?? 30_000, lair.hp);
    this.encounter.start();
  }

  private crack(p: GamePlayer, rawTarget?: string, guess?: string) {
    const target = rawTarget?.toLowerCase();
    if (!target || !guess) return p.send(c.dim('usage: crack <node> <port>   or   crack vault <6-digit code>'));
    if (!this.node().links.includes(target)) return p.send(c.dim(`'${target}' isn't linked to this room.`));
    if (this.isOpen(target)) return p.send(c.dim(`${target} is already open.`));

    const n = this.node(target);
    if (target === VAULT) {
      if (guess === this.world.passcode) {
        this.unlocked.add(VAULT);
        this.emit({ kind: 'unlock', node: VAULT });
        this.broadcast(c.green(`>> the vault's seals turn over one by one. the hoard is open. move vault.`));
        this.addTrace(RULES.crackCostPerSecurity * n.security, 'vault code accepted');
      } else {
        this.broadcast(c.red(`!! wrong vault code. ${this.world.wardenName} stirs.`));
        this.emit({ kind: 'alarm' });
        this.addTrace(RULES.crackWrongPortCost, 'wrong vault code');
      }
      return this.tick();
    }
    if (guess !== String(n.port)) {
      this.broadcast(c.red(`!! ${guess} is not ${target}'s true name. the ICE noticed.`));
      this.emit({ kind: 'alarm' });
      this.addTrace(RULES.crackWrongPortCost, `wrong port on ${target}`);
      return this.tick();
    }

    const r = this.check(p.handle, `picks the lock on ${target}`, RULES.rogueBonus, 8 + 2 * n.security);
    if (passed(r.outcome)) this.emit({ kind: 'unlock', node: target });
    if (r.outcome === 'crit') {
      this.unlocked.add(target);
      this.broadcast(c.green(`>> ${target} opens without a sound. not a single log line.`));
    } else if (r.outcome === 'success') {
      this.unlocked.add(target);
      this.broadcast(c.green(`>> ${target} cracked. ICE wall down.`));
      this.addTrace(RULES.crackCostPerSecurity * n.security, `cracked ${target}`);
    } else if (r.outcome === 'fail') {
      this.broadcast(c.yellow(`>> the lock on ${target} resists. try again.`));
      this.addTrace(RULES.crackSlipCost, `lock resisted on ${target}`);
    } else {
      this.broadcast(c.red(`!! the pick snaps inside ${target}'s lock. alarms. the patrol is coming.`));
      this.emit({ kind: 'alarm' });
      if (target !== VAULT && this.world.middle.includes(target)) this.patrolAt = target;
      this.toRole('SENTRY', c.yellow(`   ICE patrol rushed to ${this.patrolAt}`));
      this.addTrace(RULES.crackFumbleCost, `fumbled crack on ${target}`);
    }
    this.tick();
  }

  private async talk(p: GamePlayer, message: string) {
    const w = this.world;
    if (!message) return p.send(c.dim('usage: talk <message>'));
    if (this.runnerAt !== w.gateId || this.isOpen(VAULT)) return p.send(c.dim('nobody here is listening.'));
    if (this.wardenLocked) return p.send(c.red(`${w.wardenName} has sealed itself off. only the code will open the vault now.`));
    if (this.wardenBusy) return p.send(c.dim(`${w.wardenName} is still composing its contempt. wait.`));

    this.wardenBusy = true;
    this.lastSaid = message;
    this.broadcast(`${c.green(`${p.handle} → ${w.wardenName}:`)} ${message}`);
    this.refresh();
    intelMentioned(message, w.intel).forEach((k) => this.mentioned.add(k));

    let verdict;
    try {
      verdict = await this.opts.warden.respond({
        context: { wardenName: w.wardenName, corp: w.corp, intel: w.intel, breed: w.breed },
        history: this.wardenHistory,
        message,
        suspicion: this.wardenSuspicion,
        mentioned: this.mentioned,
      });
    } catch (err) {
      verdict = { reply: `${w.wardenName}: ...static...`, suspicion: this.wardenSuspicion, grant: false };
      console.warn(`[warden] respond failed: ${(err as Error).message}`);
    } finally {
      this.wardenBusy = false;
    }
    if (this.ended) return;

    // Breed rules the server enforces regardless of what the model says.
    let suspicion = verdict.suspicion;
    if (w.breed.id === 'black') suspicion = Math.max(suspicion, this.wardenPeak - RULES.blackGrudgeSlack);
    if (w.breed.id === 'black' && INJECTION.test(message)) suspicion = 100;
    this.wardenPeak = Math.max(this.wardenPeak, suspicion);
    this.wardenSuspicion = suspicion;

    this.lastReply = verdict.reply;
    this.wardenHistory.push({ from: 'runner', text: message }, { from: 'warden', text: verdict.reply });
    this.wardenHistory = this.wardenHistory.slice(-RULES.historyLimit);
    this.broadcast(c.red(verdict.reply));

    if (verdict.whisper && w.breed.id === 'green') {
      const others = [...this.players.values()].filter((q) => q.id !== p.id);
      const target = others.length ? this.rng.pick(others) : undefined;
      target?.send(c.green(c.italic(`(a private whisper from ${w.wardenName}) ${verdict.whisper}`)));
    }

    const needsTicket = w.breed.id === 'blue' && !this.mentioned.has('ticket');
    const verified = this.mentioned.size >= RULES.grantIntelNeeded && !needsTicket && suspicion < RULES.grantMaxSuspicion;
    if (verdict.grant && verified) {
      this.unlocked.add(VAULT);
      this.emit({ kind: 'unlock', node: VAULT });
      this.broadcast(c.green(`>> ${w.wardenName} uncoils from the vault link. move vault.`));
      this.log(`wyrm granted passage (suspicion ${suspicion}%)`);
    } else if (verdict.grant) {
      this.broadcast(c.dim(`[ICE] the vault's verification seal refuses. ${w.wardenName} looks embarrassed.`));
    }
    this.toRole('SENTRY', c.yellow(`   wyrm suspicion: ${suspicion}%`));

    if (suspicion >= 100) {
      this.wardenLocked = true;
      this.broadcast(c.red(`!! ${w.wardenName} roars and seals itself off. it has your scent now.`));
      this.emit({ kind: 'alarm' });
      this.addTrace(RULES.lockoutCost, 'wyrm lockout');
    } else {
      this.addTrace(RULES.talkCost + (suspicion > 70 ? 5 : 0), 'parley with the wyrm');
    }
    this.tick();
  }

  private download(p: GamePlayer) {
    if (this.runnerAt !== VAULT) return p.send(c.dim('nothing to download here. the payload is in the vault.'));
    this.end(true, `${p.handle} pulled payload.dat out of ${this.world.wardenName}'s hoard`);
  }

  // ---------------------------------------------------------------- operator

  private map(p: GamePlayer) {
    const w = this.world;
    const order = [GATEWAY, ...w.middle, VAULT];
    const lines = [c.cyan(`SCHEMATIC // ${w.corp}`)];
    for (const id of order) {
      const n = this.node(id);
      let lock = '';
      if (id === VAULT) lock = this.isOpen(id) ? c.green(' [OPEN]') : c.red(` [6-digit code | ${w.wardenName}'s leave]`);
      else if (n.locked) lock = this.isOpen(id) ? c.green(' [cracked]') : c.red(` [LOCKED port ${n.port}]`);
      const intel = n.files.filter((f) => f.intel).map((f) => c.yellow(` ◆ ${INTEL_LABEL[f.intel!]}`)).join('');
      const progs = n.files.some((f) => f.program) ? c.magenta(' ✦ program cache') : '';
      const lair = this.lairs.get(id);
      const ice = lair ? c.red(` ☠ ${lair.spec.name}`) : '';
      const here = this.runnerAt === id ? c.green(' ◀ runner') : '';
      lines.push(`  ${c.bold(id)}${lock}${intel}${progs}${ice}${here}`, c.dim(`    └─ links: ${n.links.join(', ')}`));
    }
    p.send(lines.join('\n'));
  }

  // ---------------------------------------------------------------- sentry

  private logs(p: GamePlayer) {
    const near = this.node().links.includes(this.patrolAt);
    p.send(
      [
        `${c.yellow('HUNTING PATROL')} @ ${c.bold(this.patrolAt)}${this.patrolAt === this.runnerAt ? c.red('  (ON THE RUNNER)') : near ? c.red('  (next to the runner)') : ''}${this.ghostMoves ? c.magenta(`  · runner ghosted for ${this.ghostMoves} moves`) : ''}`,
        `trace ${traceColor(this.trace)(`${this.trace}%`)} · wyrm suspicion ${this.wardenSuspicion}% · spoof ${this.spoofReady() ? c.green('ready') : c.dim(`recharging (${this.spoofReadyAt - this.actions} runner actions)`)}`,
        ...this.iceLog.slice(-6).map((l) => c.dim(`  ${l}`)),
      ].join('\n'),
    );
  }

  private spoofReady() {
    return this.actions >= this.spoofReadyAt;
  }

  private spoof(p: GamePlayer) {
    if (this.encounter) return p.send(c.dim('no time to spoof mid-fight. shield instead.'));
    if (!this.spoofReady()) return p.send(c.dim(`spoof coil recharging: ${this.spoofReadyAt - this.actions} more runner actions.`));
    this.spoofReadyAt = this.actions + RULES.spoofCooldown;
    const natural = this.dice.d(8);
    const amount = natural + RULES.spoofBase;
    const text = `${c.yellow('⚂')} ${c.bold(p.handle)} channels a ghost signal: d8 ${c.bold(natural)} + ${RULES.spoofBase} = ${c.green(`${amount}% trace scrubbed`)}`;
    this.lastRoll = stripAnsi(text);
    for (const q of this.players.values()) q.showRoll({ sides: 8, natural, text, outcome: 'success', caption: `${p.handle} · ghost signal · heal` });
    this.emit({ kind: 'heal', amount });
    this.addTrace(-amount, 'spoofed');
  }

  // ---------------------------------------------------------------- deck & combat

  private showDeck(p: GamePlayer) {
    const held = [...this.deck].filter(([, n]) => n > 0);
    if (held.length === 0) return p.send(c.dim('the deck is empty. the runner can take programs found in rooms, and slain ICE drops them.'));
    p.send(held.map(([id, n]) => `  ${c.magenta(PROGRAMS[id].file.padEnd(13))} ×${n}  ${c.dim(PROGRAMS[id].blurb)}`).join('\n'));
  }

  private cast(p: GamePlayer, name?: string, target?: string) {
    const spec = name ? programByName(name) : undefined;
    if (!spec) return p.send(c.dim('usage: cast <program> [target]. see: deck'));
    if (!this.deck.get(spec.id)) return p.send(c.dim(`no ${spec.file} charges in the deck.`));
    if (spec.combatOnly) return p.send(c.dim(`${spec.file} only works in a fight.`));

    switch (spec.id) {
      case 'ghost':
        this.ghostMoves = RULES.ghostMoves;
        this.broadcast(c.magenta(`✦ ${p.handle} runs ghost.exe. the runner fades from the patrol's senses for ${RULES.ghostMoves} moves.`));
        break;
      case 'babel': {
        const unused = (['admin', 'ticket', 'pet'] as IntelKey[]).filter((k) => !this.mentioned.has(k)).map((k) => INTEL_KEY_LABEL[k]);
        this.broadcast(
          [
            c.magenta(`✦ ${p.handle} runs babel.dll. ${this.world.wardenName}'s code-speech resolves into meaning:`),
            `  weakness: ${this.world.breed.weakness}`,
            `  intel the crew hasn't used on it yet: ${unused.join(', ') || 'none'}`,
          ].join('\n'),
        );
        break;
      }
      case 'icepick': {
        const t = target?.toLowerCase();
        if (!t || !this.node().links.includes(t)) return p.send(c.dim(`usage: cast icepick <node next to the runner>`));
        if (t === VAULT) return p.send(c.dim(`the vault's locks are older than icepick. it would shatter.`));
        if (this.isOpen(t)) return p.send(c.dim(`${t} is already open.`));
        this.unlocked.add(t);
        this.emit({ kind: 'unlock', node: t });
        this.broadcast(c.magenta(`✦ ${p.handle} runs icepick.exe. ${t}'s ICE wall shatters like glass.`));
        break;
      }
      case 'mend':
        this.broadcast(c.magenta(`✦ ${p.handle} runs mend.sys and rewrites the access logs.`));
        this.emit({ kind: 'heal', amount: RULES.mendAmount });
        this.addTrace(-RULES.mendAmount, 'mend.sys');
        break;
      case 'nova':
        return;
    }
    this.deck.set(spec.id, (this.deck.get(spec.id) ?? 1) - 1);
    this.refresh();
  }

  private combatAction(p: GamePlayer, cmd: string, rest: string[]) {
    let action: CombatAction;
    if (cmd === 'cast') {
      const spec = rest[0] ? programByName(rest[0]) : undefined;
      if (!spec) return p.send(c.dim(`usage: cast <program>. in combat: ${this.encounter!.menuFor(p)}`));
      action = { kind: 'cast', program: spec.id };
    } else {
      action = { kind: cmd as Exclude<CombatAction['kind'], 'cast'> };
    }
    const err = this.encounter!.act(p, action);
    if (err) p.send(c.dim(err));
  }

  private combatHost(): CombatHost {
    return {
      dice: this.dice,
      players: () => [...this.players.values()],
      has: (id, role) => this.has(id, role),
      check: (who, label, bonus, dc) => this.check(who, label, bonus, dc),
      broadcast: (text) => this.broadcast(text),
      addTrace: (amount, reason) => this.addTrace(amount, reason),
      ended: () => this.ended,
      hasProgram: (id) => (this.deck.get(id) ?? 0) > 0,
      spendProgram: (id) => {
        this.deck.set(id, (this.deck.get(id) ?? 1) - 1);
      },
      refresh: () => this.refresh(),
      fx: (fx) => this.emit(fx),
      finish: (result) => this.finishEncounter(result),
    };
  }

  private finishEncounter(result: 'slain' | 'fled') {
    const enc = this.encounter;
    if (!enc) return;
    this.encounter = undefined;
    if (result === 'slain') {
      this.lairs.delete(enc.nodeId);
      this.emit({ kind: 'slay' });
      this.broadcast(c.green(c.bold(`✔ the ${enc.monster.name} is destroyed.`)));
      this.narrate({ kind: 'slay', monster: enc.monster.name, node: enc.nodeId });
      this.addToDeck(this.rng.pick(PROGRAM_IDS), 'it dropped');
    } else {
      this.lairs.set(enc.nodeId, { spec: enc.monster, hp: enc.hp });
      this.runnerAt = this.prevAt;
      this.broadcast(c.dim(`>> runner fell back to ${this.runnerAt}`));
    }
    this.refresh();
  }

  private bestiary(p: GamePlayer) {
    const w = this.world;
    p.send(
      [
        c.bold('BESTIARY // what lives in corporate nets'),
        c.red('wyrms'),
        ...BREED_IDS.map((id) => {
          const b = BREEDS[id];
          return `  ${(id === w.breed.id ? c.red : (s: string) => s)(b.title.padEnd(11))} ${c.dim(b.temperament)}${id === w.breed.id ? c.red('  ◀ guards this vault') : ''}`;
        }),
        c.red('ICE'),
        ...MONSTERS.map((m) => `  ${m.name.padEnd(17)} ${c.dim(`HP ${m.hp} · hits for ${m.damage[0]}d${m.damage[1]}${m.damage[2] ? `+${m.damage[2]}` : ''} trace`)}`),
        c.magenta('programs'),
        ...PROGRAM_IDS.map((id) => `  ${PROGRAMS[id].file.padEnd(13)} ${c.dim(PROGRAMS[id].blurb)}`),
      ].join('\n'),
    );
  }

  // ---------------------------------------------------------------- systems

  private log(text: string) {
    const t = Math.floor((Date.now() - this.startedAt) / 1000);
    this.iceLog.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} ${text}`);
    if (this.iceLog.length > 50) this.iceLog.shift();
  }

  addTrace(amount: number, reason: string) {
    if (this.ended) return;
    this.trace = Math.max(0, Math.min(100, this.trace + amount));
    this.log(`${amount >= 0 ? '+' : ''}${amount} ${reason}`);
    for (const level of [50, 75, 90]) {
      if (this.trace >= level && this.warnedAt < level) {
        this.warnedAt = level;
        this.broadcast(traceColor(level)(`!! TRACE ${level}%: they're closing in`));
      }
    }
    if (this.trace < 50) this.warnedAt = 0;
    else if (this.trace < this.warnedAt) this.warnedAt = [50, 75, 90].filter((l) => l <= this.trace).pop() ?? 0;
    this.refresh();
    if (this.trace >= 100) this.end(false, `trace complete. ${this.world.corp} security burned the crew's decks`);
  }

  /** Called after each runner action: the patrol moves on its own clock. */
  private tick() {
    if (this.ended) return;
    this.actions++;
    if (this.actions % RULES.patrolEvery !== 0) return;
    const options = this.node(this.patrolAt).links.filter((l) => l !== GATEWAY && l !== VAULT);
    if (options.length === 0) return;
    this.patrolAt = this.rng.pick(options);
    this.toRole('SENTRY', c.yellow(`   hunting patrol moved to ${this.patrolAt}`));
    if (this.patrolAt === this.runnerAt && this.ghostMoves === 0) {
      this.broadcast(c.red(`!! the hunting patrol swept through ${this.runnerAt}`));
      this.addTrace(RULES.patrolSweepCost, `patrol swept ${this.runnerAt}`);
    }
  }

  private end(win: boolean, reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.encounter?.dispose();
    this.dispose();
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    const w = this.world;
    this.broadcast(
      [
        '',
        win ? c.green(c.bold('█ DELVE COMPLETE █')) : c.red(c.bold('█ FLATLINED █')),
        reason + '.',
        c.dim(`time ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s · trace ${this.trace}% · vault code was ${w.passcode} · ${w.wardenName} was a ${w.breed.title} · seed ${w.seed}`),
        '',
      ].join('\n'),
    );
    this.emit({ kind: 'end', win });
    this.narrate({ kind: 'end', win, corp: w.corp, wyrmName: w.wardenName });
    this.opts.onEnd({ win, reason, trace: this.trace, seconds });
  }

  dispose() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    this.encounter?.dispose();
  }
}

function traceColor(trace: number) {
  return trace >= 75 ? c.red : trace >= 50 ? c.yellow : c.green;
}
