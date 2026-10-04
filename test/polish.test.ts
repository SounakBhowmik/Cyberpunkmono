import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Checkpoint } from '../src/shared/protocol.js';
import { NUM, WARDEN } from '../src/server/game/content.js';
import { Game, type GameResult } from '../src/server/game/game.js';
import { ScriptedJudge } from '../src/server/game/parley.js';
import { Hub } from '../src/server/hub.js';
import { FakePlayer, fixedJudge, playGame } from './bot.js';
import { FakeSession } from './session.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 3-player adventure, walked into the Sentinel fight at the gate. */
function intoFight(roundMs = 0) {
  const players = ['neo', 'trinity', 'cy'].map((h, i) => new FakePlayer(`p${i}`, h));
  const game = new Game(players, { judge: fixedJudge(0), story: 'adventure', seed: 3, roundMs, voteMs: 0, onEnd: () => {} });
  for (const p of players) game.handle(p.id, 'vote 1');
  assert.equal(game.phase, 'combat');
  const by = (cls: 'rogue' | 'mage' | 'cleric') => players.find((p) => game.classes.get(p.id)!.includes(cls))!;
  return { game, players, by };
}

test('the monster attacks when the timer runs out, and idle players cost the crew', async () => {
  const { game, players, by } = intoFight(60);
  assert.ok(players[0]!.scene!.timer, 'a ticking timer is shown');
  game.handle(by('rogue').id, 'strike');
  const before = game.meter;
  await wait(120);
  assert.equal(game.round, 2, 'the round resolved without waiting for everyone');
  assert.ok(game.meter >= before + NUM.flatFooted * 2, 'two undecided players: flat-footed damage');
  const score = (h: string) => players.find((p) => p.handle === h)!.scene!.scores!.find((s) => s.handle === h)!.points;
  assert.ok(score(by('mage').handle) < 0 && score(by('cleric').handle) < 0, 'the Warden docks the idle');
  game.dispose();
});

test('the Warden rewards answering the threat: a ward against an attack', () => {
  for (let seed = 1; seed < 40; seed++) {
    const players = ['neo', 'trinity', 'cy'].map((h, i) => new FakePlayer(`p${i}`, h));
    const game = new Game(players, { judge: fixedJudge(0), story: 'adventure', seed, roundMs: 0, voteMs: 0, onEnd: () => {} });
    for (const p of players) game.handle(p.id, 'vote 1');
    const mage = players.find((p) => game.classes.get(p.id)!.includes('mage'))!;
    if (mage.scene!.foe!.intent!.kind !== 'attack') continue;
    const cleric = players.find((p) => game.classes.get(p.id)!.includes('cleric'))!;
    const rogue = players.find((p) => game.classes.get(p.id)!.includes('rogue'))!;
    game.handle(mage.id, 'call attack');
    game.handle(cleric.id, 'ward');
    game.handle(mage.id, 'hex');
    game.handle(rogue.id, 'strike');
    const fx = cleric.fxs.filter((f) => f.kind === 'score');
    assert.ok(fx.some((f) => f.kind === 'score' && f.reason === 'clean ward' && f.points === WARDEN.cleanWard));
    assert.ok(rogue.fxs.some((f) => f.kind === 'score' && f.reason === 'double strike'));
    assert.ok(mage.scene!.scores!.find((s) => s.handle === mage.handle)!.points >= WARDEN.goodCall);
    return;
  }
  assert.fail('no seed opened with an attack');
});

test('a run ends with stars, a team score and per-player stats', async () => {
  let result: GameResult | undefined;
  const { players } = await playGame({ story: 'adventure', policy: 'smart', seed: 2, choose: () => 0 }).then((r) => {
    result = r.result;
    return r;
  });
  const final = players[0]!.scene!.result!;
  assert.ok(final, 'the end scene carries the result');
  assert.equal(final.win, result!.win);
  assert.ok(final.stars >= (final.win ? 1 : 0) && final.stars <= 3);
  assert.equal(final.players.length, 3);
  assert.ok(final.players.some((p) => p.you));
  if (final.win) assert.ok(final.team > 200);
});

test('chapters save a checkpoint, and a crew can resume from it', async () => {
  const { players } = await playGame({ story: 'heist', policy: 'smart', seed: 5, choose: () => 0 });
  const saves = players[0]!.checkpoints;
  const cp = saves.find((c): c is Checkpoint => !!c && c.chapter === 3)!;
  assert.ok(cp, 'chapter 3 was saved');
  assert.equal(saves[saves.length - 1], null, 'the save is cleared when the story ends');
  assert.ok(Game.validCheckpoint(cp));

  const crew = ['neo', 'trinity'].map((h, i) => new FakePlayer(`q${i}`, h));
  const resumed = new Game(crew, { judge: fixedJudge(6), checkpoint: cp, roundMs: 0, voteMs: 0, onEnd: () => {} });
  assert.equal(resumed.story.id, 'heist');
  assert.equal(resumed.chapter, 3);
  assert.equal(resumed.wyrmName, cp.wyrm);
  assert.deepEqual([...resumed.boons].sort(), [...cp.boons].sort());
  resumed.dispose();
});

test('tampered saves are refused', () => {
  const good: Checkpoint = { v: 1, story: 'adventure', node: 'bridge', chapter: 3, title: 'x', meter: 10, boons: [], flags: [], breed: 'red', wyrm: 'x', points: {}, crew: [], savedAt: 0 };
  assert.ok(Game.validCheckpoint(good));
  assert.ok(!Game.validCheckpoint({ ...good, node: 'nowhere' }));
  assert.ok(!Game.validCheckpoint({ ...good, meter: 100 }));
  assert.ok(!Game.validCheckpoint({ ...good, boons: ['godmode'] }));
  assert.ok(!Game.validCheckpoint({ ...good, story: 'tutorial', node: 'welcome' }));
  assert.ok(!Game.validCheckpoint({ ...good, points: { neo: 1e9 } }));
});

test('real stories need two players; the tutorial is solo and walks every lesson', async () => {
  const hub = new Hub({ judge: new ScriptedJudge(), roundMs: 0, voteMs: 0, returnMs: 0 });
  const a = new FakeSession('a');
  hub.connect(a);
  hub.handleLine('a', 'neo');
  hub.handleLine('a', 'create');
  hub.handleLine('a', 'start');
  assert.ok(!a.scenes.length, 'a crew of one cannot begin a story');
  hub.handleLine('a', 'leave');

  hub.handleLine('a', 'tutorial');
  const scene = () => a.scenes[a.scenes.length - 1]!;
  assert.equal(scene().story, 'tutorial');
  assert.ok(!scene().timer, 'no timers in practice');
  hub.handleLine('a', 'vote 1');
  assert.equal(scene().view, 'combat');
  // the construct shows its moves in a fixed order; answer each one
  const answer: Record<string, string[]> = { attack: ['ward', 'strike', 'bolt'], charge: ['hex', 'strike', 'mend'], heavy: ['ward', 'strike', 'bolt'], shell: ['bolt', 'strike', 'mend'], wail: ['mend', 'strike', 'bolt'] };
  for (let i = 0; i < 20 && scene().view === 'combat'; i++) {
    for (const m of answer[scene().foe!.intent!.kind]!) hub.handleLine('a', m);
  }
  assert.equal(scene().view, 'puzzle');
  for (const g of scene().puzzle!.sequence!) hub.handleLine('a', `glyph ${g}`);
  assert.equal(scene().view, 'parley');
  hub.handleLine('a', 'speak we walk toward it to protect everyone we love, not for ourselves');
  await wait(10);
  hub.handleLine('a', 'speak for the city, for the children, for all of them');
  await wait(10);
  hub.handleLine('a', 'speak because no one else will');
  await wait(10);
  assert.equal(scene().view, 'end');
  assert.equal(scene().ending!.title, 'Training Complete');
  assert.ok(a.checkpoints.every((c) => c === null), 'practice is never saved');
});
