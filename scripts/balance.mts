// Plays many full stories with bot crews to check that thinking matters:
// a crew that reads the Mage's calls and spends Wards wisely should win far
// more often than one that mashes buttons.
import type { ModeId } from '../src/shared/protocol.js';
import { NUM } from '../src/server/game/content.js';
import { playGame, fixedJudge, type Policy } from '../test/bot.js';

if (process.env.FOE_DMG) NUM.foeDmg = Number(process.env.FOE_DMG);
if (process.env.FOE_HP) NUM.foeHp = Number(process.env.FOE_HP);
const N = Number(process.env.N ?? 150);
const CREW = Number(process.env.CREW ?? 3);
const modes = (process.env.MODES?.split(',') ?? ['adventure', 'heist', 'survival']) as ModeId[];

for (const story of modes) {
  const row: string[] = [];
  for (const policy of ['smart', 'human', 'random'] as Policy[]) {
    let wins = 0;
    const meters: number[] = [];
    for (let i = 1; i <= N; i++) {
      // conversations go well about half the time, as they would with real players
      const { result } = await playGame({ story, crew: CREW, seed: i * 7919, policy, judge: fixedJudge(i % 2 ? 7 : 2) });
      if (result?.win) {
        wins++;
        meters.push(result.meter);
      }
    }
    meters.sort((a, b) => a - b);
    row.push(`${policy} ${((100 * wins) / N).toFixed(0)}% (left at ${meters[meters.length >> 1] ?? '-'})`);
  }
  console.log(`${story.padEnd(9)} crew ${CREW}: ${row.join(' · ')}`);
}
