import { c } from '../ansi.js';
import { PROGRAMS, type MonsterSpec, type ProgramId } from './bestiary.js';
import { passed, type CheckResult, type Dice } from './dice.js';
import type { Fx } from '../../shared/protocol.js';
import type { GamePlayer, Role } from './game.js';

export type CombatAction =
  | { kind: 'strike' }
  | { kind: 'flee' }
  | { kind: 'bolt' }
  | { kind: 'analyze' }
  | { kind: 'shield' }
  | { kind: 'wait' }
  | { kind: 'cast'; program: ProgramId };

/** Combat verbs and the role that can use them (null: anyone). */
export const COMBAT_VERBS: Record<string, Role | null> = {
  strike: 'RUNNER',
  flee: 'RUNNER',
  bolt: 'OPERATOR',
  analyze: 'OPERATOR',
  shield: 'SENTRY',
  wait: null,
};

export const PARTY_AC = 11;
const ORDER: Record<CombatAction['kind'], number> = { shield: 0, analyze: 1, bolt: 2, strike: 3, cast: 4, flee: 5, wait: 6 };

export interface CombatHost {
  readonly dice: Dice;
  players(): GamePlayer[];
  has(id: string, role: Role): boolean;
  /** Roll a visible d20 check for everyone to watch. */
  check(who: string, label: string, bonus: number, dc: number): CheckResult;
  broadcast(text: string): void;
  addTrace(amount: number, reason: string): void;
  ended(): boolean;
  hasProgram(id: ProgramId): boolean;
  spendProgram(id: ProgramId): void;
  refresh(): void;
  fx(fx: Fx): void;
  finish(result: 'slain' | 'fled'): void;
}

export class Encounter {
  hp: number;
  round = 1;
  readonly actions = new Map<string, CombatAction>();
  private analyzed = false;
  private over = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly host: CombatHost,
    readonly monster: MonsterSpec,
    readonly nodeId: string,
    private readonly roundMs: number,
    hp?: number,
  ) {
    this.hp = hp ?? monster.hp;
  }

  start() {
    const m = this.monster;
    this.host.broadcast(
      [
        '',
        c.red(c.bold(`⚔ ENCOUNTER // ${m.name.toUpperCase()}`)),
        c.italic(m.intro),
        c.dim(`HP ${this.hp}/${m.hp} · AC ${m.ac} · it hits back with trace`),
      ].join('\n'),
    );
    this.announceRound();
  }

  private announceRound() {
    this.host.broadcast(`${c.red(`ROUND ${this.round}`)} ${c.dim('· everyone pick an action')}`);
    this.host.refresh();
    if (this.roundMs > 0) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.over) return;
        this.host.broadcast(c.dim('(round timer ran out: anyone undecided waits.)'));
        this.resolve();
      }, this.roundMs);
    }
  }

  menuFor(p: GamePlayer): string {
    const opts: string[] = [];
    if (this.host.has(p.id, 'RUNNER')) opts.push('strike', 'flee');
    if (this.host.has(p.id, 'OPERATOR')) opts.push('bolt', 'analyze');
    if (this.host.has(p.id, 'SENTRY')) opts.push('shield');
    for (const id of ['nova', 'mend', 'ghost'] as const) if (this.host.hasProgram(id)) opts.push(`cast ${id}`);
    opts.push('wait');
    return opts.map((o) => c.bold(o)).join(c.dim(' · '));
  }

  /** Lock in an action. Returns an error message, or null when accepted. */
  act(p: GamePlayer, action: CombatAction): string | null {
    if (this.over) return 'the fight is over.';
    if (this.actions.has(p.id)) return 'you already locked in an action this round.';
    if (action.kind === 'cast') {
      const spec = PROGRAMS[action.program];
      if (spec.noCombat) return `${spec.file} is no use mid-fight.`;
      if (!this.host.hasProgram(action.program)) return `no ${spec.file} charges in the deck.`;
      this.host.spendProgram(action.program);
    } else {
      const role = COMBAT_VERBS[action.kind];
      if (role && !this.host.has(p.id, role)) return `only the ${role} can ${action.kind}.`;
    }
    this.actions.set(p.id, action);
    const players = this.host.players();
    this.host.broadcast(c.dim(`   ${p.handle} is ready (${this.actions.size}/${players.length})`));
    this.host.refresh();
    this.checkReady();
    return null;
  }

  /** Resolve the round once everyone still connected has acted. */
  checkReady() {
    const players = this.host.players();
    if (!this.over && players.length > 0 && players.every((p) => this.actions.has(p.id))) this.resolve();
  }

  private damage(who: string, count: number, sides: number, plus: number, crit: boolean): boolean {
    const dmg = this.host.dice.sum(crit ? count * 2 : count, sides, plus);
    this.hp = Math.max(0, this.hp - dmg);
    this.host.fx({ kind: 'strike', amount: dmg, by: who });
    this.host.broadcast(`   ${c.green(`→ ${who} deals ${dmg} damage.`)} ${this.monster.name}: ${this.hp}/${this.monster.hp} HP`);
    if (this.hp > 0) return false;
    this.over = true;
    clearTimeout(this.timer);
    this.host.finish('slain');
    return true;
  }

  resolve() {
    if (this.over) return;
    clearTimeout(this.timer);
    const handles = new Map(this.host.players().map((p) => [p.id, p.handle]));
    const queue = [...this.actions.entries()].sort(([, a], [, b]) => ORDER[a.kind] - ORDER[b.kind]);
    const m = this.monster;
    const hitBonus = this.analyzed ? 3 : 0;
    let shielded = false;
    let fled = false;

    for (const [id, action] of queue) {
      const who = handles.get(id) ?? 'someone';
      switch (action.kind) {
        case 'shield':
          shielded = true;
          this.host.broadcast(c.yellow(`   ${who} throws up a firewall shield. (+4 defense, half damage this round)`));
          break;
        case 'analyze': {
          const r = this.host.check(who, 'analyzes the ICE', 3, 10);
          if (passed(r.outcome)) {
            this.analyzed = true;
            this.host.broadcast(c.cyan(`   weak points exposed: everyone gets +3 to hit for the rest of the fight.`));
          }
          break;
        }
        case 'bolt': {
          const r = this.host.check(who, 'hurls a data bolt', 3 + hitBonus, m.ac);
          if (passed(r.outcome) && this.damage(who, 1, 6, 1, r.outcome === 'crit')) return;
          break;
        }
        case 'strike': {
          const r = this.host.check(who, 'strikes', 4 + hitBonus, m.ac);
          if (passed(r.outcome) && this.damage(who, 1, 8, 2, r.outcome === 'crit')) return;
          break;
        }
        case 'cast':
          if (action.program === 'nova') {
            this.host.broadcast(c.magenta(`   ${who} runs nova.exe. white noise floods the node.`));
            if (this.damage(who, 3, 6, 0, false)) return;
          } else if (action.program === 'mend') {
            this.host.broadcast(c.magenta(`   ${who} runs mend.sys and rewrites the access logs.`));
            this.host.fx({ kind: 'heal', amount: 12 });
            this.host.addTrace(-12, 'mend.sys');
          } else if (action.program === 'ghost') {
            this.host.broadcast(c.magenta(`   ${who} runs ghost.exe. the runner flickers out of sight.`));
            fled = true;
          }
          break;
        case 'flee': {
          const r = this.host.check(who, 'tries to slip away', 4, 11);
          if (passed(r.outcome)) fled = true;
          break;
        }
        case 'wait':
          break;
      }
      if (this.host.ended()) return;
    }

    if (fled) {
      this.over = true;
      this.host.broadcast(c.yellow(`   the runner breaks away. the ${m.name} stays in its lair, licking its wounds (${this.hp}/${m.hp} HP).`));
      this.host.finish('fled');
      return;
    }

    const r = this.host.check(m.name, 'lunges', m.attack, PARTY_AC + (shielded ? 4 : 0));
    if (passed(r.outcome)) {
      let dmg = this.host.dice.sum(r.outcome === 'crit' ? m.damage[0] * 2 : m.damage[0], m.damage[1], m.damage[2]);
      if (shielded) dmg = Math.ceil(dmg / 2);
      this.host.broadcast(c.red(`   ← the ${m.name} tears into your signal: +${dmg}% trace.`));
      this.host.fx({ kind: 'hurt', amount: dmg });
      this.host.addTrace(dmg, `${m.name} hit`);
    } else {
      this.host.broadcast(c.dim(`   the ${m.name} misses.`));
    }
    if (this.host.ended()) return;

    this.round++;
    this.actions.clear();
    this.announceRound();
  }

  dispose() {
    this.over = true;
    clearTimeout(this.timer);
  }
}
