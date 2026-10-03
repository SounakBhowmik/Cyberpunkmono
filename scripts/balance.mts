import { Game } from '../src/server/game/game.js';
import { ScriptedWarden } from '../src/server/game/ice.js';
import { GATEWAY, VAULT } from '../src/server/game/world.js';
const mk = (id: string) => ({ id, handle: id, send() {}, setPrompt() {}, showRoll() {}, setHud() {} });
const PASSIVE_PER_ACTION = Number(process.env.PASSIVE ?? 0.6); // ~20s tick, ~12s per action
let wins = 0, traces: number[] = [], fights = 0;
const N = 400;
for (let seed = 1; seed <= N; seed++) {
  const ps = [mk('a'), mk('b'), mk('c')];
  let res: any;
  const g = new Game(ps, { warden: new ScriptedWarden(), seed, tickMs: 0, roundMs: 0, onEnd: (r) => (res = r) });
  const who = (r: string) => ps.find((p) => g.roles.get(p.id)!.has(r as any))!;
  const R = who('RUNNER'), O = who('OPERATOR'), Snt = who('SENTRY');
  const w = g.world;
  let passive = 0;
  const act = (line: string) => { if (res) return; g.handle(R.id, line); passive += PASSIVE_PER_ACTION; while (passive >= 1 && !res) { g.addTrace(1, 'tick'); passive--; }
    if (g.trace > 35 && !res) g.handle(Snt.id, 'spoof'); };
  const fight = () => { let n = 0; if (g.encounter) fights++; while (g.encounter && !res && n++ < 30) { g.handle(Snt.id, 'shield'); g.handle(O.id, 'bolt'); g.handle(R.id, 'strike'); } };
  const path = (from: string, to: string) => { const prev = new Map<string, string>(); const q = [from]; const seen = new Set(q);
    while (q.length) { const id = q.shift()!; for (const n of w.nodes.get(id)!.links) { if (n === VAULT || seen.has(n)) continue; seen.add(n); prev.set(n, id); q.push(n); } }
    const p = [to]; while (p[0] !== from) p.unshift(prev.get(p[0]!)!); return p.slice(1); };
  const goto = (to: string) => { for (const id of path(g.runnerAt, to)) { const n = w.nodes.get(id)!;
      for (let t = 0; t < 6 && n.locked && !(g as any).unlocked.has(id) && !res; t++) act(`crack ${id} ${n.port}`);
      act(`move ${id}`); fight(); if (g.runnerAt !== id) return; } };
  for (const id of w.middle) { if (res) break; goto(id); for (const f of w.nodes.get(id)!.files) if (f.intel) act(`cat ${f.name}`); }
  goto(w.gateId); act(`crack vault ${w.passcode}`); act('move vault'); act('download');
  if (res?.win) wins++; traces.push(res?.trace ?? g.trace); g.dispose();
}
traces.sort((a, b) => a - b);
console.log(`passive/action=${PASSIVE_PER_ACTION} win ${(100 * wins / N).toFixed(0)}%  median trace ${traces[N >> 1]}  p90 ${traces[Math.floor(N * 0.9)]}  fights/game ${(fights / N).toFixed(1)}`);
