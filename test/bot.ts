// A bot crew that plays LAST LIGHT through the real Game API. Used by the
// tests (to walk every story) and by the balance simulator.
import type { ActionButton, Checkpoint, FeedItem, Fx, HudState, ModeId, SceneState } from '../src/shared/protocol.js';
import { ITEMS } from '../src/shared/items.js';
import { Game, type GamePlayer, type GameResult } from '../src/server/game/game.js';
import type { ParleyJudge } from '../src/server/game/parley.js';

export type Policy = 'smart' | 'human' | 'random';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

export class FakePlayer implements GamePlayer {
  out: string[] = [];
  feeds: FeedItem[] = [];
  fxs: Fx[] = [];
  hud?: HudState;
  scene?: SceneState;
  actions: ActionButton[] = [];
  constructor(readonly id: string, readonly handle: string, readonly avatar = 0) {}
  send(t: string) {
    this.out.push(strip(t));
  }
  setPrompt() {}
  setHud(h: HudState) {
    this.hud = h;
  }
  setScene(s: SceneState, a: ActionButton[]) {
    this.scene = s;
    this.actions = a;
  }
  feed(item: FeedItem) {
    this.feeds.push(item);
  }
  fx(f: Fx) {
    this.fxs.push(f);
  }
  checkpoints: (Checkpoint | null)[] = [];
  checkpoint(cp: Checkpoint | null) {
    this.checkpoints.push(cp);
  }
  get transcript() {
    return [...this.out, ...this.feeds.map((f) => ('text' in f ? f.text : ''))].join('\n');
  }
}

export const fixedJudge = (score: number): ParleyJudge => ({ label: `fixed:${score}`, judge: async () => ({ reply: 'hm.', score }) });

export interface RunOpts {
  story: ModeId;
  crew?: number;
  seed?: number;
  policy?: Policy;
  judge?: ParleyJudge;
  /** Choice picker: index into the options offered. Defaults to random. */
  choose?: (labels: string[], game: Game) => number;
  random?: () => number;
  /** Defaults to a prepared crew so full-campaign tests validate strategy, not progression storage. */
  inventory?: string[];
}

export async function playGame(o: RunOpts) {
  const crew = o.crew ?? 3;
  const rand = o.random ?? Math.random;
  const players = Array.from({ length: crew }, (_, i) => new FakePlayer(`p${i}`, ['neo', 'trinity', 'cy', 'orbit'][i]!));
  let result: GameResult | undefined;
  const gear = o.inventory ?? ITEMS.map((item) => item.id);
  const game = new Game(players, { judge: o.judge ?? fixedJudge(6), story: o.story, seed: o.seed ?? 1, roundMs: 0, voteMs: 0, inventory: Object.fromEntries(players.map((p) => [p.id, [...gear]])), onEnd: (r) => (result = r) });
  const policy = o.policy ?? 'smart';
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const holders = (cls: string) => players.filter((p) => game.classes.get(p.id)?.includes(cls as never));

  for (let guard = 0; !result && guard < 600; guard++) {
    if (players[0]!.scene?.waitingForReady) {
      for (const p of players) game.handle(p.id, 'ready');
      continue;
    }
    switch (game.phase) {
      case 'choice': {
        const labels = players[0]!.scene!.choice!.options.map((x) => x.label);
        const i = o.choose ? o.choose(labels, game) : Math.floor(rand() * labels.length);
        for (const p of players) game.handle(p.id, `vote ${i + 1}`);
        break;
      }
      case 'puzzle': {
        const pz = game.puzzle!;
        const rogue = holders('rogue')[0]!;
        const careless = policy === 'random' || (policy === 'human' && rand() < 0.15);
        game.handle(rogue.id, `glyph ${careless ? pick(['moon', 'eye', 'serpent', 'crown', 'key']) : pz.sequence[pz.progress]}`);
        break;
      }
      case 'parley': {
        game.handle(players[Math.floor(rand() * crew)]!.id, 'speak we come to protect the city and everyone in it');
        await new Promise((r) => setImmediate(r));
        break;
      }
      case 'combat':
      case 'boss': {
        const f = game.foe!;
        const k = f.intent.kind;
        const round = game.round;
        const mageWillHex = k === 'charge' || (k !== 'shell' && game.meter < 70);
        for (const p of players) {
          for (const cls of game.classes.get(p.id) ?? []) {
            if (result || game.round !== round || !game.foe) break;
            const careless = policy === 'random' || (policy === 'human' && rand() < 0.3);
            let move: string;
            if (careless) move = pick({ rogue: ['strike', 'fury'], mage: ['hex', 'bolt'], cleric: ['ward', 'mend'] }[cls]);
            else if (cls === 'cleric') move = (k === 'attack' || k === 'heavy') && game.wardsRemaining > 0 ? 'ward' : 'mend';
            else if (cls === 'mage') move = k === 'shell' ? 'bolt' : mageWillHex ? 'hex' : 'bolt';
            else move = mageWillHex && game.meter < 60 ? 'fury' : 'strike';
            if (move === 'ward' && game.wardsRemaining === 0) move = 'mend';
            game.handle(p.id, move);
          }
        }
        break;
      }
      default:
        await new Promise((r) => setImmediate(r));
    }
  }
  game.dispose();
  return { result, game, players, visited: game.trail };
}
