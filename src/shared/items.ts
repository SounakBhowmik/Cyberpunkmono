export type ItemKind = 'attack' | 'magic' | 'defense';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic';

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: ItemRarity;
  power: number;
  /** Total committed story time needed to discover it. */
  seconds: number;
  /** Finished quests needed as proof the Joe can wield it. */
  quests: number;
  icon: string;
  effect: string;
}

/** Equipment arrives early, then asks for both time and completed journeys. */
export const ITEMS: Item[] = [
  { id: 'edge-wire', name: 'Threadknife', kind: 'attack', rarity: 'common', power: 1, seconds: 120, quests: 0, icon: '🗡', effect: 'A quick blade for clean openings.' },
  { id: 'spark-rune', name: 'Ember Rune', kind: 'magic', rarity: 'common', power: 1, seconds: 180, quests: 0, icon: '✦', effect: 'Turns a whisper of code into flame.' },
  { id: 'patch-shield', name: 'Patch Shield', kind: 'defense', rarity: 'common', power: 1, seconds: 240, quests: 0, icon: '⬡', effect: 'Softens the first cracks in a crew.' },
  { id: 'gloam-hook', name: 'Gloam Hook', kind: 'attack', rarity: 'uncommon', power: 2, seconds: 360, quests: 1, icon: '⚔', effect: 'Pulls a foe off balance before the strike.' },
  { id: 'echo-lens', name: 'ECHO Lens', kind: 'magic', rarity: 'uncommon', power: 2, seconds: 480, quests: 1, icon: '◉', effect: 'Replays the instant before an enemy moves.' },
  { id: 'crew-knot', name: 'Crew-Knot Charm', kind: 'defense', rarity: 'uncommon', power: 2, seconds: 600, quests: 1, icon: '⛉', effect: 'A ward strengthened by nearby Joes.' },
  { id: 'ghost-blade', name: 'Sentinel Fang', kind: 'attack', rarity: 'uncommon', power: 3, seconds: 720, quests: 2, icon: '☄', effect: 'Cuts through armor stolen from the Hall of Names.' },
  { id: 'oracle-shard', name: 'Oracle Shard', kind: 'magic', rarity: 'uncommon', power: 3, seconds: 840, quests: 2, icon: '◈', effect: 'Finds the one future where the spell lands.' },
  { id: 'aegis-loop', name: 'Mourning Plate', kind: 'defense', rarity: 'uncommon', power: 3, seconds: 960, quests: 2, icon: '▣', effect: 'Remembers every blow it survived.' },
  { id: 'sunless-edge', name: 'Nullglass Sabre', kind: 'attack', rarity: 'rare', power: 5, seconds: 1080, quests: 3, icon: '◆', effect: 'Steps through a shell before becoming solid.' },
  { id: 'wyrm-sigil', name: 'Bellbreaker Sigil', kind: 'magic', rarity: 'rare', power: 5, seconds: 1200, quests: 3, icon: '♛', effect: 'Silences a charging monster mid-breath.' },
  { id: 'dawn-aegis', name: 'Dawn Aegis', kind: 'defense', rarity: 'rare', power: 5, seconds: 1320, quests: 3, icon: '☀', effect: 'Turns the darkest impact toward morning.' },
  { id: 'vesper-talon', name: 'Vespercoil Talon', kind: 'attack', rarity: 'epic', power: 7, seconds: 1560, quests: 5, icon: '☾', effect: 'A trophy that hunts as fiercely as its old owner.' },
  { id: 'starless-book', name: 'Starless Grimoire', kind: 'magic', rarity: 'epic', power: 7, seconds: 1800, quests: 5, icon: '✺', effect: 'Writes the foe’s weakness into the air.' },
  { id: 'last-mantle', name: 'Last Light Mantle', kind: 'defense', rarity: 'epic', power: 7, seconds: 2100, quests: 5, icon: '♢', effect: 'Keeps one final light alive for the whole crew.' },
  { id: 'moon-silk', name: 'Moon-Silk Shiv', kind: 'attack', rarity: 'rare', power: 6, seconds: 2400, quests: 6, icon: '〆', effect: 'Harvested in Ashenwake; cuts the shadow before the beast.' },
  { id: 'gloam-crown', name: 'Gloam Crown', kind: 'magic', rarity: 'rare', power: 6, seconds: 2700, quests: 6, icon: '♧', effect: 'Steals one memory from a charging monster.' },
  { id: 'moon-iron', name: 'Moon-Iron Bulwark', kind: 'defense', rarity: 'rare', power: 6, seconds: 3000, quests: 7, icon: '⬢', effect: 'Forged from a Moonkennel cage; refuses to bend twice.' },
  { id: 'glasswing-scale', name: 'Glasswing Talon', kind: 'attack', rarity: 'epic', power: 9, seconds: 3300, quests: 7, icon: '❖', effect: 'Splits into mirrored strikes when it finds moonlight.' },
  { id: 'oracle-thread', name: 'Oracle’s Red Thread', kind: 'magic', rarity: 'epic', power: 9, seconds: 3600, quests: 8, icon: '∞', effect: 'Finds a survivable future and pulls the spell toward it.' },
  { id: 'crownshard', name: 'Crownshard Edge', kind: 'attack', rarity: 'epic', power: 10, seconds: 3900, quests: 8, icon: '♛', effect: 'Made by refusing a false throne; strongest against rulers.' },
  { id: 'seraph-feather', name: 'Seraph Ward', kind: 'defense', rarity: 'epic', power: 10, seconds: 4200, quests: 9, icon: '♢', effect: 'A glass feather that becomes six shields at impact.' },
  { id: 'echo-heart', name: 'ECHO’s Borrowed Heart', kind: 'magic', rarity: 'mythic', power: 13, seconds: 4800, quests: 10, icon: '✧', effect: 'A warm key that remembers choosing to become a person.' },
  { id: 'abyss-heart', name: 'Heart of the Root Below', kind: 'defense', rarity: 'mythic', power: 13, seconds: 5400, quests: 12, icon: '◉', effect: 'The abyss braces around its bearer instead of swallowing them.' },
];

export const itemById = (id: string) => ITEMS.find((item) => item.id === id);
