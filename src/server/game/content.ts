import type { ClassId, Intent, IntentKind, Move, RouteKind } from '../../shared/protocol.js';

// Everything a player needs to learn lives here, and it is deliberately small:
// three classes with two moves each, foes that announce their next move, and a
// handful of relics.

export const CLASS_NAME: Record<ClassId, string> = { striker: 'Striker', mystic: 'Mystic', guardian: 'Guardian' };

export const NUM = {
  strike: 8,
  fury: 16,
  furyCost: 6,
  hex: 3,
  bolt: 7,
  mend: 6,
  exposedMult: 2,
  shellMult: 0.5,
  shrineHeal: 25,
  bellReflect: 6,
  fangBonus: 3,
  glassBonus: 5,
  featherBonus: 5,
  enrage: 4,
  speechCap: 15,
  sealCut: 0.12,
  maxSeals: 4,
  floors: 6,
  /** Global dials for balancing: foe damage and foe health multipliers. */
  foeDmg: 1.9,
  foeHp: 1.4,
};

export interface MoveSpec {
  cls: ClassId | 'any';
  label: string;
  /** One line that tells a new player exactly when to press it. */
  hint: string;
  tone: 'fight' | 'magic' | 'go' | 'talk' | 'risk';
}

export const MOVES: Record<Move, MoveSpec> = {
  strike: { cls: 'striker', label: 'Strike', hint: `${NUM.strike} damage. Double on an exposed foe.`, tone: 'fight' },
  fury: { cls: 'striker', label: 'Fury', hint: `${NUM.fury} damage, but the crew takes +${NUM.furyCost}% corruption.`, tone: 'risk' },
  hex: { cls: 'mystic', label: 'Hex', hint: 'Exposes the foe (strikes do double) and interrupts a charge.', tone: 'magic' },
  bolt: { cls: 'mystic', label: 'Bolt', hint: `${NUM.bolt} damage that pierces a shell.`, tone: 'fight' },
  ward: { cls: 'guardian', label: 'Ward', hint: "Blocks the foe's attack this round.", tone: 'go' },
  mend: { cls: 'guardian', label: 'Mend', hint: `Cleanses ${NUM.mend}% corruption.`, tone: 'magic' },
  speak: { cls: 'any', label: 'Speak', hint: 'Use your turn to talk to the wyrm. Play to its nature.', tone: 'talk' },
};

export const CLASS_MOVES: Record<ClassId, Move[]> = {
  striker: ['strike', 'fury'],
  mystic: ['hex', 'bolt'],
  guardian: ['ward', 'mend'],
};

/** A step in a foe's pattern. For a charge, `amount` is the heavy hit that follows. */
export interface IntentSpec {
  kind: IntentKind;
  amount: number;
  verb: string;
}

export interface FoeSpec {
  id: string;
  name: string;
  hp: number;
  pattern: IntentSpec[];
  intro: string;
}

export const FOES: FoeSpec[] = [
  {
    id: 'crimson',
    name: 'The Crimson Face',
    hp: 52,
    intro: 'A gaunt figure steps out of the static. Its face is painted the red of an emergency light, and it is smiling at you.',
    pattern: [
      { kind: 'attack', amount: 11, verb: 'RAKE' },
      { kind: 'charge', amount: 30, verb: 'LUNGE' },
      { kind: 'wail', amount: 7, verb: 'SHRIEK' },
    ],
  },
  {
    id: 'crawler',
    name: 'The Hollow Bride',
    hp: 46,
    intro: 'Something crawls out of a dead monitor, hair first. It moves in jerks, like a video missing frames.',
    pattern: [
      { kind: 'attack', amount: 8, verb: 'GRASP' },
      { kind: 'attack', amount: 8, verb: 'GRASP' },
      { kind: 'wail', amount: 9, verb: 'WAIL' },
      { kind: 'attack', amount: 14, verb: 'DRAG UNDER' },
    ],
  },
  {
    id: 'stalker',
    name: 'The Husk Stalker',
    hp: 60,
    intro: 'Ribs like a cathedral, a skull like a bullet, and a second jaw waiting behind the first.',
    pattern: [
      { kind: 'shell', amount: 0, verb: 'CARAPACE' },
      { kind: 'attack', amount: 13, verb: 'BITE' },
      { kind: 'charge', amount: 32, verb: 'INNER JAW' },
    ],
  },
  {
    id: 'wretch',
    name: 'The Many-Elbowed',
    hp: 54,
    intro: 'It unfolds from the corner of the ceiling: pale, grinning, and with far too many elbows.',
    pattern: [
      { kind: 'wail', amount: 8, verb: 'WHISPER' },
      { kind: 'attack', amount: 12, verb: 'CLUTCH' },
      { kind: 'shell', amount: 0, verb: 'CURL UP' },
      { kind: 'attack', amount: 16, verb: 'EMBRACE' },
    ],
  },
];

export const BOSS: Omit<FoeSpec, 'name'> = {
  id: 'devourer',
  hp: 170,
  intro: 'The floor of the net falls away. Below, coiled around the city’s heart, the Devourer opens its eyes.',
  pattern: [
    { kind: 'attack', amount: 14, verb: 'BITE' },
    { kind: 'charge', amount: 38, verb: 'DEVOURING BREATH' },
    { kind: 'wail', amount: 10, verb: 'DREAD ROAR' },
    { kind: 'shell', amount: 0, verb: 'COIL' },
    { kind: 'attack', amount: 18, verb: 'TAIL LASH' },
  ],
};

export function intentOf(spec: IntentSpec): Intent {
  switch (spec.kind) {
    case 'attack':
      return { kind: 'attack', amount: spec.amount, label: `${spec.verb} ${spec.amount}`, hint: 'a Ward blocks it' };
    case 'charge':
      return { kind: 'charge', amount: spec.amount, label: `CHARGING ${spec.verb}`, hint: `next round hits for ${spec.amount}. Hex to interrupt` };
    case 'heavy':
      return { kind: 'heavy', amount: spec.amount, label: `${spec.verb} ${spec.amount}`, hint: 'huge hit. Ward it!' };
    case 'shell':
      return { kind: 'shell', amount: 0, label: spec.verb, hint: 'strikes do half. Bolt pierces' };
    case 'wail':
      return { kind: 'wail', amount: spec.amount, label: `${spec.verb} ${spec.amount}`, hint: "can't be blocked. Mend after" };
  }
}

export type RelicId = 'feather' | 'fang' | 'mask' | 'bell' | 'glass' | 'eye';

export const RELICS: Record<RelicId, { name: string; desc: string }> = {
  feather: { name: 'Ember Feather', desc: `Mend cleanses ${NUM.mend + NUM.featherBonus}% instead of ${NUM.mend}%.` },
  fang: { name: 'Thunder Fang', desc: `Strike deals +${NUM.fangBonus} damage.` },
  mask: { name: 'Oni Mask', desc: 'Fury no longer corrupts the crew.' },
  bell: { name: 'Jade Bell', desc: `A Ward also reflects ${NUM.bellReflect} damage.` },
  glass: { name: 'Starglass', desc: `Bolt deals +${NUM.glassBonus} damage.` },
  eye: { name: 'Moon Eye', desc: 'Every foe starts its first round exposed.' },
};

export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

export const ROOM_INFO: Record<RouteKind, { label: string; detail: string }> = {
  fight: { label: 'Haunted node', detail: 'fight a horror · +1 seal on the Devourer' },
  elite: { label: 'Dread lair', detail: 'a stronger horror · +2 seals and a relic' },
  shrine: { label: 'Quiet shrine', detail: `rest · cleanse ${NUM.shrineHeal}% corruption` },
  cache: { label: 'Relic cache', detail: 'take a relic, no fight' },
  boss: { label: 'The Devourer', detail: 'seal it, or the city falls' },
};

export const DISTRICTS = ['the Undercroft', 'Glasswater', 'Spire Row', 'the Ashmarket', 'Lantern Hill'];
