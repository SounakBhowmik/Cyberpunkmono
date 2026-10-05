import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScriptedJudge } from '../src/server/game/parley.js';
import { Hub } from '../src/server/hub.js';
import { FakeSession } from './session.js';

function lobby() {
  const hub = new Hub({ judge: new ScriptedJudge(), roundMs: 0, voteMs: 0 });
  const a = new FakeSession('a');
  const b = new FakeSession('b');
  hub.connect(a);
  hub.connect(b);
  hub.handleLine('a', 'neo');
  hub.handleLine('b', 'trinity');
  hub.handleLine('a', 'create');
  const code = /safehouse \x1b\[1m\x1b\[93m(\w{4})/.exec(a.out.join('\n'))?.[1];
  assert.ok(code, 'room code announced');
  hub.handleLine('b', `join ${code}`);
  return { hub, a, b };
}

test('the single avatar reroll updates everyone in the safehouse', () => {
  const { hub, a, b } = lobby();
  const before = a.lastHud;
  assert.equal(before?.mode, 'safehouse');
  if (before?.mode !== 'safehouse') return;
  assert.equal(before.party.find((m) => m.handle === 'trinity')!.avatar, 0);

  hub.handleLine('b', 'reroll');
  hub.handleLine('b', 'reroll');
  for (const s of [a, b]) {
    const h = s.lastHud;
    assert.equal(h?.mode === 'safehouse' && h.party.find((m) => m.handle === 'trinity')!.avatar, 1);
  }
  assert.match(b.feeds.at(-1)?.text ?? '', /one identity reroll/i);
});

test('the rerolled avatar follows the player into the delve', () => {
  const { hub, a } = lobby();
  hub.handleLine('a', 'reroll');
  hub.handleLine('a', 'start');
  const scene = a.scenes[a.scenes.length - 1]!;
  assert.equal(scene.party.find((m) => m.handle === 'neo')!.avatar, 1);
  assert.equal(scene.party.find((m) => m.handle === 'trinity')!.avatar, 0);
});

test('rerolling works on the street too', () => {
  const hub = new Hub({ judge: new ScriptedJudge(), voteMs: 0 });
  const s = new FakeSession('s');
  hub.connect(s);
  hub.handleLine('s', 'zero');
  hub.handleLine('s', 'reroll');
  assert.deepEqual(s.lastHud, { mode: 'street', handle: 'zero', avatar: 1, rooms: [] });
});

test('open crews are listed and disappear when joined', () => {
  const hub = new Hub({ judge: new ScriptedJudge(), voteMs: 0 });
  const host = new FakeSession('host');
  const guest = new FakeSession('guest');
  hub.connect(host);
  hub.connect(guest);
  hub.handleLine('host', 'Amber-Fox-47');
  hub.handleLine('guest', 'Echo-Moth-21');
  hub.handleLine('host', 'create');
  const street = guest.lastHud;
  assert.equal(street?.mode, 'street');
  if (street?.mode !== 'street') return;
  assert.equal(street.rooms?.length, 1);
  const room = street.rooms![0]!;
  assert.equal(room.host, 'Amber-Fox-47');
  assert.equal(room.players, 1);
  hub.handleLine('guest', `join ${room.code}`);
  assert.equal(guest.lastHud?.mode, 'safehouse');
});

test('a solo side quest fills all three roles with two allies', () => {
  const hub = new Hub({ judge: new ScriptedJudge(), roundMs: 0, voteMs: 0 });
  const player = new FakeSession('solo');
  hub.connect(player);
  hub.handleLine('solo', 'Solar-Wisp-88');
  hub.handleLine('solo', 'solo mage medium adventure');
  const scene = player.scenes.at(-1);
  assert.ok(scene);
  assert.equal(scene.party.length, 3);
  assert.deepEqual(scene.party.flatMap((member) => member.classes).sort(), ['cleric', 'mage', 'rogue']);
  assert.equal(scene.party.find((member) => member.you)?.classes[0], 'mage');
  assert.deepEqual(scene.party.filter((member) => !member.you).map((member) => member.handle).sort(), ['fuzzyhat', 'roughmat']);
});
