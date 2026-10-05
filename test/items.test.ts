import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEMS } from '../src/shared/items.js';
import { ARTIFACTS, PLAYER_NAMES } from '../src/client/progress.js';

test('equipment starts early and grows rarer with committed play time', () => {
  assert.equal(ITEMS[0]?.seconds, 120);
  assert.ok(ITEMS.some((item) => item.seconds === 180));
  assert.deepEqual(new Set(ITEMS.map((item) => item.kind)), new Set(['attack', 'magic', 'defense']));
  for (let i = 1; i < ITEMS.length; i++) assert.ok(ITEMS[i]!.seconds > ITEMS[i - 1]!.seconds);
  assert.ok(ITEMS.find((item) => item.rarity === 'epic')!.power > ITEMS.find((item) => item.rarity === 'common')!.power);
  assert.ok(ITEMS.filter((item) => item.quests === 0).length >= 3, 'new Joes can find a complete starter set');
  assert.ok(ITEMS.every((item) => item.effect.length > 10));
  assert.ok(ITEMS.filter((item) => item.rarity === 'epic').every((item) => item.quests >= 5));
});

test('player identities follow the five texture name families and quests have artifacts', () => {
  assert.equal(PLAYER_NAMES.length, 50);
  assert.equal(new Set(PLAYER_NAMES).size, 50);
  assert.ok(PLAYER_NAMES.every((name) => /^[a-z]+$/.test(name)));
  assert.deepEqual(new Set(ARTIFACTS.map((artifact) => artifact.story)), new Set(['tutorial', 'adventure', 'heist', 'survival']));
  assert.ok(ITEMS.some((item) => item.rarity === 'mythic' && item.power >= 13));
});
