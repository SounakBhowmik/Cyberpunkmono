import { c } from '../ansi.js';

export type Outcome = 'crit' | 'success' | 'fail' | 'fumble';

export interface CheckResult {
  natural: number;
  bonus: number;
  total: number;
  dc: number;
  outcome: Outcome;
}

/** Dice driven by an injectable random source, so tests can load them. */
export class Dice {
  constructor(private readonly random: () => number = Math.random) {}

  d(sides: number): number {
    const r = Math.min(Math.max(this.random(), 0), 0.999999);
    return 1 + Math.floor(r * sides);
  }

  /** NdS + plus, e.g. sum(2, 6, 3) for 2d6+3. */
  sum(count: number, sides: number, plus = 0): number {
    let total = plus;
    for (let i = 0; i < count; i++) total += this.d(sides);
    return total;
  }

  /** A d20 check: natural 20 always crits, natural 1 always fumbles. */
  check(bonus: number, dc: number): CheckResult {
    const natural = this.d(20);
    const total = natural + bonus;
    const outcome: Outcome = natural === 20 ? 'crit' : natural === 1 ? 'fumble' : total >= dc ? 'success' : 'fail';
    return { natural, bonus, total, dc, outcome };
  }
}

export const passed = (o: Outcome) => o === 'crit' || o === 'success';

const OUTCOME_TEXT: Record<Outcome, string> = {
  crit: c.bold(c.green('CRITICAL!')),
  success: c.green('success'),
  fail: c.red('fail'),
  fumble: c.bold(c.red('FUMBLE!')),
};

export function describeCheck(who: string, label: string, r: CheckResult): string {
  const bonus = r.bonus ? ` ${r.bonus > 0 ? '+' : '-'} ${Math.abs(r.bonus)}` : '';
  return `${c.yellow('⚄')} ${c.bold(who)} ${label}: d20 ${c.bold(r.natural)}${bonus} = ${c.bold(r.total)} vs DC ${r.dc} … ${OUTCOME_TEXT[r.outcome]}`;
}
