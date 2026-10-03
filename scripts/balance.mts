// Plays many full games with bot crews to check that strategy matters:
// a crew that reads the foe's intent should win far more often than one
// that mashes random buttons.
import type { ActionButton, SceneState } from '../src/shared/protocol.js';
import { Game } from '../src/server/game/game.js';
import { ScriptedJudge } from '../src/server/game/parley.js';
import { NUM } from '../src/server/game/content.js';

if (process.env.FOE_DMG) NUM.foeDmg = Number(process.env.FOE_DMG);
if (process.env.FOE_HP) NUM.foeHp = Number(process.env.FOE_HP);

type Policy = 'smart' | 'human' | 'random';
const N = Number(process.env.N ?? 500);
const CREW = Number(process.env.CREW ?? 3);

async function play(seed: number, policy: Policy) {
  const scenes = new Map<string, SceneState>();
  const actions = new Map<string, ActionButton[]>();
  const players = Array.from({ length: CREW }, (_, i) => ({
    id: `p${i}`, handle: `p${i}`, send() {}, setPrompt() {}, setHud() {}, fx() {},
    setScene(s: SceneState, a: ActionButton[]) { scenes.set(`p${i}`, s); actions.set(`p${i}`, a); },
  }));
  let result: { win: boolean; corruption: number } | undefined;
  const game = new Game(players, { judge: new ScriptedJudge(), seed, roundMs: 0, voteMs: 0, onEnd: (r) => (result = r) });
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

  for (let guard = 0; !result && guard < 400; guard++) {
    const s = scenes.get('p0')!;
    if (s.view === 'route') {
      for (const p of players) {
        const opts = s.options!;
        let choice = 1;
        if (policy !== 'smart') choice = 1 + Math.floor(Math.random() * opts.length);
        else {
          const rank = (k: string) => (k === 'shrine' ? (s.corruption > 40 ? 5 : 0) : k === 'elite' ? (s.corruption < 25 ? 4 : -1) : k === 'cache' ? 3 : k === 'fight' ? 2 : 1);
          choice = 1 + opts.reduce((best, o, i) => (rank(o.kind) > rank(opts[best]!.kind) ? i : best), 0);
        }
        game.handle(p.id, `vote ${choice}`);
      }
      continue;
    }
    const foe = s.foe!;
    const intent = foe.intent.kind;
    for (const p of players) {
      for (const cls of game.classes.get(p.id) ?? []) {
        if (result || scenes.get('p0')!.round !== s.round || scenes.get('p0')!.view === 'route') break;
        let move: string;
        const careless = policy === 'random' || (policy === 'human' && Math.random() < 0.3);
        if (careless) move = pick({ striker: ['strike', 'fury'], mystic: ['hex', 'bolt'], guardian: ['ward', 'mend'] }[cls]);
        else if (cls === 'guardian') move = intent === 'attack' || intent === 'heavy' ? 'ward' : 'mend';
        else if (cls === 'mystic') move = intent === 'charge' ? 'hex' : intent === 'shell' ? 'bolt' : 'hex';
        else move = intent !== 'shell' && s.corruption < 45 && foe.hp > 12 ? 'fury' : 'strike';
        game.handle(p.id, move);
      }
    }
  }
  game.dispose();
  return result ?? { win: false, corruption: 100 };
}

for (const policy of ['smart', 'human', 'random'] as Policy[]) {
  let wins = 0;
  const left: number[] = [];
  for (let i = 1; i <= N; i++) {
    const r = await play(i * 7919, policy);
    if (r.win) {
      wins++;
      left.push(r.corruption);
    }
  }
  left.sort((a, b) => a - b);
  console.log(`${policy.padEnd(6)} crew of ${CREW}: win ${((100 * wins) / N).toFixed(0)}%  median corruption on a win ${left[left.length >> 1] ?? '-'}%`);
}
