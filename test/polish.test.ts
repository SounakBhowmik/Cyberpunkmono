import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Checkpoint } from '../src/shared/protocol.js';
import { NUM, WARDEN } from '../src/server/game/content.js';
import { Game, type GameResult } from '../src/server/game/game.js';
import { ScriptedJudge } from '../src/server/game/parley.js';
import { Hub } from '../src/server/hub.js';
import { FakePlayer, fixedJudge, playGame } from './bot.js';
import { FakeSession } from './session.js';
import { messageChunks } from '../src/client/console.js';

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

test('the automatic battle waits for every loadout, then moves the whole crew', () => {
  const { game, players } = intoFight(0);
  assert.equal(players[0]!.scene!.timer, undefined, 'reading time is free');
  assert.equal(players[0]!.scene!.waitingForReady, true);
  game.handle(players[0]!.id, 'ready');
  game.handle(players[1]!.id, 'ready');
  assert.equal(players[0]!.scene!.waitingForReady, true, 'one Joe still has all the time they need');
  game.handle(players[2]!.id, 'ready');
  assert.ok(players.every((p) => p.fxs.some((fx) => fx.kind === 'act')), 'all Joes move once preparation is locked');
  assert.ok(players.every((p) => !p.fxs.some((fx) => fx.kind === 'score' && fx.reason === 'caught flat-footed')));
  game.dispose();
});

test('coordinator messages are split into readable chunks', () => {
  const chunks = messageChunks('The city is in danger. Reach the bridge, find the Oracle, and carry the last seal before the second eye opens.');
  assert.deepEqual(chunks, ['The city is in danger.', 'Reach the bridge, find the Oracle, and carry the last seal before the second eye opens.']);
  assert.ok(chunks.every((line) => line.length <= 96));
  assert.deepEqual(messageChunks('"Watch the monster. Then answer it."'), ['Watch the monster.', 'Then answer it.']);
  assert.ok(!messageChunks('"A final line."').includes('"'));
});

test('the automatic strategy answers an attack with a Ward and coordinated offense', () => {
  for (let seed = 1; seed < 40; seed++) {
    const players = ['neo', 'trinity', 'cy'].map((h, i) => new FakePlayer(`p${i}`, h));
    const game = new Game(players, { judge: fixedJudge(0), story: 'adventure', seed, roundMs: 0, voteMs: 0, onEnd: () => {} });
    for (const p of players) game.handle(p.id, 'vote 1');
    const mage = players.find((p) => game.classes.get(p.id)!.includes('mage'))!;
    if (mage.scene!.foe!.intent!.kind !== 'attack') continue;
    const cleric = players.find((p) => game.classes.get(p.id)!.includes('cleric'))!;
    const rogue = players.find((p) => game.classes.get(p.id)!.includes('rogue'))!;
    for (const p of players) game.handle(p.id, 'ready');
    const fx = cleric.fxs.filter((f) => f.kind === 'score');
    assert.ok(fx.some((f) => f.kind === 'score' && f.reason === 'clean ward' && f.points === WARDEN.cleanWard));
    assert.ok(rogue.fxs.some((f) => f.kind === 'score' && f.reason.startsWith('double')));
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
  hub.handleLine('a', 'ready');
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
