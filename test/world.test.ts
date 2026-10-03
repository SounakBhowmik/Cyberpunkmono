import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GATEWAY, VAULT, bfsDepths, generateWorld } from '../src/server/game/world.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

test('same seed gives the same world', () => {
  const a = generateWorld(42);
  const b = generateWorld(42);
  assert.equal(a.passcode, b.passcode);
  assert.deepEqual([...a.nodes.keys()], [...b.nodes.keys()]);
  assert.deepEqual(a.intel, b.intel);
});

test('every world is connected, and the vault hangs off the gate node', () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed);
    const depth = bfsDepths(w.nodes, GATEWAY);
    assert.equal(depth.size, w.nodes.size, `seed ${seed}: unreachable nodes`);
    assert.deepEqual(w.nodes.get(VAULT)!.links, [w.gateId], `seed ${seed}`);
    assert.ok(w.middle.includes(w.gateId));
    for (const n of w.nodes.values()) for (const l of n.links) assert.ok(w.nodes.get(l)!.links.includes(n.id), 'links are symmetric');
  }
});

test('all intel is placed exactly once, one piece per middle node', () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed);
    const intel = w.middle.flatMap((id) => w.nodes.get(id)!.files.filter((f) => f.intel));
    assert.equal(intel.length, 5, `seed ${seed}`);
    for (const id of w.middle) assert.equal(w.nodes.get(id)!.files.filter((f) => f.intel).length, 1);

    const fragments = intel.filter((f) => f.intel === 'fragment').sort((a, b) => a.name.localeCompare(b.name));
    const digits = fragments.map((f) => /:: (\d\d)/.exec(f.body)![1]).join('');
    assert.equal(digits, w.passcode, `seed ${seed}: fragments must spell the passcode`);
  }
});
