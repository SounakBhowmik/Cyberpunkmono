import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActionButton, FeedItem, Fx, HudState, SceneState } from '../src/shared/protocol.js';
import { ScriptedJudge } from '../src/server/game/parley.js';
import { Hub, type Session } from '../src/server/hub.js';

class FakeSession implements Session {
  huds: HudState[] = [];
  scenes: SceneState[] = [];
  out: string[] = [];
  constructor(readonly id: string) {}
  send(text: string) {
    this.out.push(text);
  }
  setPrompt() {}
  hud(h: HudState) {
    this.huds.push(h);
  }
  scene(s: SceneState, _a: ActionButton[]) {
    this.scenes.push(s);
  }
  fx(_f: Fx) {}
  feeds: FeedItem[] = [];
  feed(item: FeedItem) {
    this.feeds.push(item);
  }
  clear() {}
  close() {}
  get lastHud() {
    return this.huds[this.huds.length - 1];
  }
}

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

test('rerolling an avatar updates everyone in the safehouse', () => {
  const { hub, a, b } = lobby();
  const before = a.lastHud;
  assert.equal(before?.mode, 'safehouse');
  if (before?.mode !== 'safehouse') return;
  assert.equal(before.party.find((m) => m.handle === 'trinity')!.avatar, 0);

  hub.handleLine('b', 'reroll');
  hub.handleLine('b', 'reroll');
  for (const s of [a, b]) {
    const h = s.lastHud;
    assert.equal(h?.mode === 'safehouse' && h.party.find((m) => m.handle === 'trinity')!.avatar, 2);
  }
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
  assert.deepEqual(s.lastHud, { mode: 'street', handle: 'zero', avatar: 1 });
});
