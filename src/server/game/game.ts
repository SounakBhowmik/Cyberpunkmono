import { c } from '../ansi.js';
import { intelMentioned, type IntelKey, type WardenBrain, type WardenTurn } from './ice.js';
import { Rng } from './rng.js';
import { GATEWAY, VAULT, generateWorld, type IntelKind, type NetNode, type World } from './world.js';

export type Role = 'RUNNER' | 'OPERATOR' | 'SENTRY';

export interface GamePlayer {
  readonly id: string;
  readonly handle: string;
  send(text: string): void;
  setPrompt(text: string): void;
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
  seed?: number;
  /** Passive trace interval in ms. 0 disables it (tests). */
  tickMs?: number;
}

export const RULES = {
  moveCost: 2,
  catCost: 1,
  crackCostPerSecurity: 3,
  crackFailCost: 12,
  talkCost: 3,
  patrolHitCost: 20,
  patrolSweepCost: 10,
  patrolEvery: 3,
  spoofAmount: 15,
  spoofCooldown: 4,
  lockoutCost: 20,
  grantMaxSuspicion: 60,
  grantIntelNeeded: 2,
  startingSuspicion: 35,
  historyLimit: 12,
};

const ROLE_COLOR: Record<Role, (s: string) => string> = { RUNNER: c.green, OPERATOR: c.cyan, SENTRY: c.yellow };
const INTEL_LABEL: Record<IntelKind, string> = {
  fragment: 'passcode fragment',
  personnel: 'personnel record',
  comms: 'sysadmin mail',
};

const COMMAND_ROLE: Record<string, Role> = {
  ls: 'RUNNER', look: 'RUNNER', cat: 'RUNNER', move: 'RUNNER', cd: 'RUNNER', crack: 'RUNNER',
  talk: 'RUNNER', download: 'RUNNER',
  map: 'OPERATOR',
  logs: 'SENTRY', spoof: 'SENTRY', trace: 'SENTRY',
};

export class Game {
  readonly world: World;
  readonly roles = new Map<string, Set<Role>>();
  runnerAt = GATEWAY;
  trace = 0;
  patrolAt: string;
  ended = false;

  private readonly players = new Map<string, GamePlayer>();
  private readonly rng: Rng;
  private readonly unlocked = new Set<string>([GATEWAY]);
  private readonly iceLog: string[] = [];
  private readonly startedAt = Date.now();
  private actions = 0;
  private spoofReadyAt = 0;
  private warnedAt = 0;
  private ticker?: NodeJS.Timeout;

  private wardenHistory: WardenTurn[] = [];
  private wardenSuspicion = RULES.startingSuspicion;
  private wardenLocked = false;
  private wardenBusy = false;
  private readonly mentioned = new Set<IntelKey>();

  constructor(players: GamePlayer[], private readonly opts: GameOptions) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.world = generateWorld(seed);
    this.rng = new Rng(seed ^ 0x5eed);
    // Never start the patrol on the gate or right next to the runner's entry point.
    const entry = this.world.nodes.get(GATEWAY)!.links;
    const spawn = this.world.middle.filter((id) => id !== this.world.gateId && !entry.includes(id));
    this.patrolAt = this.rng.pick(spawn.length ? spawn : this.world.middle);

    for (const p of players) this.players.set(p.id, p);
    this.assignRoles(this.rng.shuffle(players.map((p) => p.id)));
    for (const p of players) this.brief(p);
    this.refreshPrompts();

    const tickMs = opts.tickMs ?? 12_000;
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
    return [...(this.roles.get(id) ?? [])].map((r) => ROLE_COLOR[r](r)).join('+');
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
    this.refreshPrompts();
  }

  // ---------------------------------------------------------------- output

  private broadcast(text: string) {
    for (const p of this.players.values()) p.send(text);
  }

  private toRole(role: Role, text: string) {
    for (const p of this.holdersOf(role)) p.send(text);
  }

  private refreshPrompts() {
    for (const p of this.players.values()) p.setPrompt(this.promptFor(p.id));
  }

  private promptFor(id: string): string {
    const tracePart = this.has(id, 'SENTRY') ? ` ${traceColor(this.trace)(`[trace ${this.trace}%]`)}` : '';
    if (this.has(id, 'RUNNER')) return `${c.green('runner')}@${c.bold(this.runnerAt)}${tracePart}> `;
    if (this.has(id, 'SENTRY')) return `${c.yellow('sentry')}${tracePart}> `;
    return `${c.cyan('operator')}> `;
  }

  private brief(p: GamePlayer) {
    const w = this.world;
    const lines = [
      '',
      c.bold(`JOB  // breach ${c.magenta(w.corp)}'s black vault and pull ${c.green('payload.dat')}.`),
      c.dim(`       the vault is guarded by an AI called ${w.wardenName}. if trace hits 100%, you're flatlined.`),
      `crew // ${[...this.players.values()].map((q) => `${q.handle} (${this.roleTag(q.id)})`).join(', ')}`,
      '',
    ];
    for (const role of this.roles.get(p.id) ?? []) lines.push(this.roleBrief(role), this.roleCommands(role), '');
    lines.push(c.dim(`talk to your crew with:  say <message>   (or start a line with ')`));
    p.send(lines.join('\n'));
  }

  private roleBrief(role: Role): string {
    switch (role) {
      case 'RUNNER':
        return `${ROLE_COLOR.RUNNER('RUNNER')}: you're jacked in at the gateway. you can only see the node you're standing in. your crew sees what you can't, so ask them.`;
      case 'OPERATOR':
        return `${ROLE_COLOR.OPERATOR('OPERATOR')}: you hold the stolen schematics: the map, the ports that open locked nodes, and where the intel is. you can't touch the net yourself.`;
      case 'SENTRY':
        return `${ROLE_COLOR.SENTRY('SENTRY')}: you watch the trace and the ICE patrol. warn the runner before they walk into it. spoof buys time.`;
    }
  }

  private roleCommands(role: Role): string {
    const cmds: Record<Role, [string, string][]> = {
      RUNNER: [
        ['ls', 'look around the current node'],
        ['cat <file>', 'read a file'],
        ['move <node>', 'jack into a linked node'],
        ['crack <node> <port|code>', 'break a locked node (ask your operator for the port)'],
        ['talk <message>', `speak to ${this.world.wardenName} (only next to the vault)`],
        ['download', 'pull the payload (inside the vault)'],
      ],
      OPERATOR: [['map', 'the network schematic, ports, intel and the runner signal']],
      SENTRY: [
        ['logs', 'ICE patrol position and recent events'],
        ['spoof', `drop trace by ${RULES.spoofAmount}% (recharges)`],
        ['trace', 'exact trace level'],
      ],
    };
    return cmds[role].map(([k, v]) => `  ${ROLE_COLOR[role](k.padEnd(26))}${c.dim(v)}`).join('\n');
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

    const needed = COMMAND_ROLE[cmd];
    if (needed && !this.has(id, needed)) {
      const who = this.holdersOf(needed).map((q) => q.handle).join(' / ') || 'nobody';
      return p.send(c.dim(`that's the ${needed}'s job (${who}). tell them:  say <message>`));
    }

    switch (cmd) {
      case 'say': return this.say(p, arg);
      case 'help': return p.send([...(this.roles.get(id) ?? [])].map((r) => this.roleCommands(r)).join('\n') + '\n' + c.dim('  say <msg>  crew chat   |  crew  who is who   |  leave  bail out'));
      case 'crew': case 'who': return p.send([...this.players.values()].map((q) => `  ${q.handle.padEnd(16)} ${this.roleTag(q.id)}`).join('\n'));
      case 'ls': case 'look': return this.look(p);
      case 'cat': return this.cat(p, arg);
      case 'move': case 'cd': return this.move(p, arg);
      case 'crack': return this.crack(p, rest[0], rest[1]);
      case 'talk': return void this.talk(p, arg);
      case 'download': return this.download(p);
      case 'map': return this.map(p);
      case 'logs': return this.logs(p);
      case 'spoof': return this.spoof(p);
      case 'trace': return p.send(`trace: ${traceColor(this.trace)(`${this.trace}%`)}`);
      default:
        return p.send(c.dim(`unknown command '${head}'. type help. (to talk to your crew: say <message>)`));
    }
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
    p.send(
      [
        `${c.green('NODE')} ${c.bold(n.id)} ${c.dim(`// ${n.label}`)}`,
        `files: ${n.files.map((f) => f.name).join('  ') || c.dim('(none)')}`,
        `links: ${links.join('  ')}`,
        this.runnerAt === this.world.gateId && !this.isOpen(VAULT)
          ? c.red(`a cold presence watches the vault link. ${this.world.wardenName} is listening. (talk <message>)`)
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  private cat(p: GamePlayer, name: string) {
    const file = this.node().files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!file) return p.send(c.dim(name ? `no file '${name}' here. try ls.` : 'usage: cat <file>'));
    p.send(`${c.dim(`--- ${file.name} ---`)}\n${file.body}\n${c.dim('---')}`);
    this.addTrace(RULES.catCost, `read ${file.name}`);
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
          : c.red(`ICE wall on ${to}. crack ${to} <port>. your operator has the port.`),
      );
    }
    this.runnerAt = to;
    this.broadcast(c.dim(`>> runner moved to ${to}`));
    this.look(p);
    this.refreshPrompts();
    if (this.patrolAt === to) {
      this.broadcast(c.red(`!! ${p.handle} walked straight into the ICE patrol on ${to}`));
      this.addTrace(RULES.patrolHitCost, `patrol contact on ${to}`);
    } else {
      this.addTrace(RULES.moveCost, `hop to ${to}`);
    }
    this.tick();
  }

  private crack(p: GamePlayer, rawTarget?: string, guess?: string) {
    const target = rawTarget?.toLowerCase();
    if (!target || !guess) return p.send(c.dim('usage: crack <node> <port>   or   crack vault <6-digit code>'));
    if (!this.node().links.includes(target)) return p.send(c.dim(`'${target}' isn't linked to this node.`));
    if (this.isOpen(target)) return p.send(c.dim(`${target} is already open.`));

    const n = this.node(target);
    const correct = target === VAULT ? guess === this.world.passcode : guess === String(n.port);
    if (correct) {
      this.unlocked.add(target);
      this.broadcast(c.green(`>> ${target} cracked. ICE wall down.`));
      this.addTrace(RULES.crackCostPerSecurity * n.security, `cracked ${target}`);
    } else {
      this.broadcast(c.red(`!! crack on ${target} rejected. the ICE noticed.`));
      this.addTrace(RULES.crackFailCost, `failed crack on ${target}`);
    }
    this.tick();
  }

  private async talk(p: GamePlayer, message: string) {
    const w = this.world;
    if (!message) return p.send(c.dim('usage: talk <message>'));
    if (this.runnerAt !== w.gateId || this.isOpen(VAULT)) return p.send(c.dim('nobody here is listening.'));
    if (this.wardenLocked) return p.send(c.red(`${w.wardenName} has cut the channel. only the code will open the vault now.`));
    if (this.wardenBusy) return p.send(c.dim(`${w.wardenName} is still composing its contempt. wait.`));

    this.wardenBusy = true;
    this.broadcast(`${c.green(`${p.handle} → ${w.wardenName}:`)} ${message}`);
    intelMentioned(message, w.intel).forEach((k) => this.mentioned.add(k));

    let verdict;
    try {
      verdict = await this.opts.warden.respond({
        context: { wardenName: w.wardenName, corp: w.corp, intel: w.intel },
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

    this.wardenHistory.push({ from: 'runner', text: message }, { from: 'warden', text: verdict.reply });
    this.wardenHistory = this.wardenHistory.slice(-RULES.historyLimit);
    this.wardenSuspicion = verdict.suspicion;
    this.broadcast(c.red(`${verdict.reply}`));

    const verified = this.mentioned.size >= RULES.grantIntelNeeded && verdict.suspicion < RULES.grantMaxSuspicion;
    if (verdict.grant && verified) {
      this.unlocked.add(VAULT);
      this.broadcast(c.green(`>> ${w.wardenName} opened the vault link. move vault.`));
      this.log(`warden granted maintenance session (suspicion ${verdict.suspicion}%)`);
    } else if (verdict.grant) {
      this.broadcast(c.dim(`[ICE] clearance request bounced by the verification subsystem.`));
    }
    this.toRole('SENTRY', c.yellow(`   warden suspicion: ${verdict.suspicion}%`));

    if (verdict.suspicion >= 100) {
      this.wardenLocked = true;
      this.broadcast(c.red(`!! ${w.wardenName} has locked you out and flagged the signal.`));
      this.addTrace(RULES.lockoutCost, 'warden lockout');
    } else {
      this.addTrace(RULES.talkCost + (verdict.suspicion > 70 ? 5 : 0), 'warden channel open');
    }
    this.tick();
  }

  private download(p: GamePlayer) {
    if (this.runnerAt !== VAULT) return p.send(c.dim('nothing to download here. the payload is in the vault.'));
    this.end(true, `${p.handle} pulled payload.dat out of ${this.world.corp}'s vault`);
  }

  // ---------------------------------------------------------------- operator

  private map(p: GamePlayer) {
    const w = this.world;
    const order = [GATEWAY, ...w.middle, VAULT];
    const lines = [c.cyan(`SCHEMATIC // ${w.corp}`)];
    for (const id of order) {
      const n = this.node(id);
      let lock = '';
      if (id === VAULT) lock = this.isOpen(id) ? c.green(' [OPEN]') : c.red(` [6-digit code | ${w.wardenName} clearance]`);
      else if (n.locked) lock = this.isOpen(id) ? c.green(' [cracked]') : c.red(` [LOCKED port ${n.port}]`);
      const intel = n.files.filter((f) => f.intel).map((f) => c.yellow(` ◆ ${INTEL_LABEL[f.intel!]}`)).join('');
      const here = this.runnerAt === id ? c.green(' ◀ runner') : '';
      lines.push(`  ${c.bold(id)}${lock}${intel}${here}`, c.dim(`    └─ links: ${n.links.join(', ')}`));
    }
    p.send(lines.join('\n'));
  }

  // ---------------------------------------------------------------- sentry

  private logs(p: GamePlayer) {
    const near = this.node().links.includes(this.patrolAt);
    p.send(
      [
        `${c.yellow('ICE PATROL')} @ ${c.bold(this.patrolAt)}${this.patrolAt === this.runnerAt ? c.red('  (ON THE RUNNER)') : near ? c.red('  (adjacent to runner)') : ''}`,
        `trace ${traceColor(this.trace)(`${this.trace}%`)} · warden suspicion ${this.wardenSuspicion}% · spoof ${this.spoofReady() ? c.green('ready') : c.dim(`recharging (${this.spoofReadyAt - this.actions} runner actions)`)}`,
        ...this.iceLog.slice(-6).map((l) => c.dim(`  ${l}`)),
      ].join('\n'),
    );
  }

  private spoofReady() {
    return this.actions >= this.spoofReadyAt;
  }

  private spoof(p: GamePlayer) {
    if (!this.spoofReady()) return p.send(c.dim(`spoof coil recharging: ${this.spoofReadyAt - this.actions} more runner actions.`));
    this.spoofReadyAt = this.actions + RULES.spoofCooldown;
    this.broadcast(c.yellow(`>> ${p.handle} fed the tracers a ghost signal.`));
    this.addTrace(-RULES.spoofAmount, 'spoofed');
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
        this.broadcast(traceColor(level)(`!! TRACE ${level}% — they're closing in`));
      }
    }
    if (this.trace < 50) this.warnedAt = 0;
    else if (this.trace < this.warnedAt) this.warnedAt = [50, 75, 90].filter((l) => l <= this.trace).pop() ?? 0;
    this.refreshPrompts();
    if (this.trace >= 100) this.end(false, `trace complete. ${this.world.corp} security burned the crew's rigs`);
  }

  /** Called after each runner action: the patrol moves on its own clock. */
  private tick() {
    if (this.ended) return;
    this.actions++;
    if (this.actions % RULES.patrolEvery !== 0) return;
    const options = this.node(this.patrolAt).links.filter((l) => l !== GATEWAY && l !== VAULT);
    if (options.length === 0) return;
    this.patrolAt = this.rng.pick(options);
    this.toRole('SENTRY', c.yellow(`   ICE patrol moved to ${this.patrolAt}`));
    if (this.patrolAt === this.runnerAt) {
      this.broadcast(c.red(`!! the ICE patrol swept through ${this.runnerAt}`));
      this.addTrace(RULES.patrolSweepCost, `patrol swept ${this.runnerAt}`);
    }
  }

  private end(win: boolean, reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.dispose();
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    const w = this.world;
    this.broadcast(
      [
        '',
        win ? c.green(c.bold('█ JOB COMPLETE █')) : c.red(c.bold('█ FLATLINED █')),
        reason + '.',
        c.dim(`time ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s · trace ${this.trace}% · vault code was ${w.passcode} · seed ${w.seed}`),
        '',
      ].join('\n'),
    );
    this.opts.onEnd({ win, reason, trace: this.trace, seconds });
  }

  dispose() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }
}

function traceColor(trace: number) {
  return trace >= 75 ? c.red : trace >= 50 ? c.yellow : c.green;
}
