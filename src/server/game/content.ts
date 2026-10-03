import type { ClassId, Glyph, Intent, IntentKind, Move } from '../../shared/protocol.js';

// Every number and name a player meets lives here. The rules stay small:
// three classes with two moves each. What keeps it from being a no-brainer
// is information: only the Mage can see what a foe will do next, and the
// Cleric's Wards are limited.

export const CLASS_NAME: Record<ClassId, string> = { rogue: 'Rogue', mage: 'Mage', cleric: 'Cleric' };

export const NUM = {
  strike: 8,
  fury: 15,
  furyCost: 6,
  hex: 3,
  bolt: 7,
  mend: 7,
  exposedMult: 2,
  shellMult: 0.5,
  wardsPerChapter: 2,
  enrage: 5,
  speechCap: 15,
  glyphMissCost: 8,
  maxMisses: 3,
  /** Global balance dials. */
  foeDmg: 1.6,
  foeHp: 1.5,
};

export interface MoveSpec {
  cls: ClassId | 'any';
  label: string;
  /** One line that tells a new player exactly when to press it. */
  hint: string;
  tone: 'fight' | 'magic' | 'go' | 'talk' | 'risk';
}

export const MOVES: Record<Move, MoveSpec> = {
  strike: { cls: 'rogue', label: 'Strike', hint: `${NUM.strike} damage. Double if the Mage hexes this round.`, tone: 'fight' },
  fury: { cls: 'rogue', label: 'Fury', hint: `${NUM.fury} damage (double on a hex), but costs the crew ${NUM.furyCost}.`, tone: 'risk' },
  hex: { cls: 'mage', label: 'Hex', hint: 'Exposes the foe so the Rogue hits double, and breaks a charge.', tone: 'magic' },
  bolt: { cls: 'mage', label: 'Bolt', hint: `${NUM.bolt} damage that pierces a shell.`, tone: 'fight' },
  ward: { cls: 'cleric', label: 'Ward', hint: 'Blocks the foe’s attack this round. Limited per chapter.', tone: 'go' },
  mend: { cls: 'cleric', label: 'Mend', hint: `Heals the crew by ${NUM.mend}.`, tone: 'magic' },
  speak: { cls: 'any', label: 'Speak', hint: 'Use your turn to talk instead.', tone: 'talk' },
};

export const CLASS_MOVES: Record<ClassId, Move[]> = {
  rogue: ['strike', 'fury'],
  mage: ['hex', 'bolt'],
  cleric: ['ward', 'mend'],
};

export interface IntentSpec {
  kind: IntentKind;
  amount: number;
  verb: string;
  /** Relative chance of picking this move each round. */
  weight: number;
}

export interface FoeSpec {
  id: string;
  name: string;
  hp: number;
  moves: IntentSpec[];
  intro: string;
}

export const FOES: Record<string, FoeSpec> = {
  hound: {
    id: 'hound', name: 'Black ICE Hound', hp: 40,
    intro: 'Something with too many teeth uncurls from the packet stream and catches your scent.',
    moves: [
      { kind: 'attack', amount: 10, verb: 'BITE', weight: 3 },
      { kind: 'charge', amount: 24, verb: 'POUNCE', weight: 1 },
      { kind: 'wail', amount: 6, verb: 'HOWL', weight: 1 },
    ],
  },
  ooze: {
    id: 'ooze', name: 'Tar-Pit Ooze', hp: 52,
    intro: 'The floor goes soft. A slow black mass of corrupted cache rises to swallow you.',
    moves: [
      { kind: 'attack', amount: 8, verb: 'ENGULF', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'HARDEN', weight: 2 },
      { kind: 'wail', amount: 7, verb: 'SEEP', weight: 1 },
    ],
  },
  sentinel: {
    id: 'sentinel', name: 'Sentinel Daemon', hp: 46,
    intro: 'A faceless knight of white light steps out of the firewall and raises a blade made of audit logs.',
    moves: [
      { kind: 'attack', amount: 12, verb: 'CLEAVE', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'SHIELD WALL', weight: 1 },
      { kind: 'charge', amount: 26, verb: 'JUDGEMENT', weight: 1 },
    ],
  },
  kraken: {
    id: 'kraken', name: 'Glitch Kraken', hp: 56,
    intro: 'Tentacles of broken pixels burst through the walls. The room starts tearing at the seams.',
    moves: [
      { kind: 'attack', amount: 9, verb: 'LASH', weight: 3 },
      { kind: 'wail', amount: 8, verb: 'STATIC SCREAM', weight: 1 },
      { kind: 'charge', amount: 22, verb: 'CRUSH', weight: 1 },
    ],
  },
  mimic: {
    id: 'mimic', name: 'Mimic Archive', hp: 44,
    intro: 'The file you were about to open grows a mouth. It was never a file.',
    moves: [
      { kind: 'attack', amount: 11, verb: 'CHOMP', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'SNAP SHUT', weight: 2 },
      { kind: 'charge', amount: 22, verb: 'SWALLOW', weight: 1 },
    ],
  },
};

export const WYRM_FOE: Omit<FoeSpec, 'name'> = {
  id: 'wyrm',
  hp: 130,
  intro: 'The dark coils. Two eyes open, each the size of a door.',
  moves: [
    { kind: 'attack', amount: 13, verb: 'BITE', weight: 3 },
    { kind: 'charge', amount: 30, verb: 'DEVOURING BREATH', weight: 1 },
    { kind: 'wail', amount: 9, verb: 'DREAD ROAR', weight: 1 },
    { kind: 'shell', amount: 0, verb: 'COIL', weight: 1 },
  ],
};

export function intentOf(spec: Pick<IntentSpec, 'kind' | 'amount' | 'verb'>): Intent {
  switch (spec.kind) {
    case 'attack':
      return { kind: 'attack', amount: spec.amount, label: `${spec.verb} ${spec.amount}`, hint: 'a Ward blocks it' };
    case 'charge':
      return { kind: 'charge', amount: spec.amount, label: `CHARGING ${spec.verb}`, hint: `${spec.amount} next round unless the Mage hexes it` };
    case 'heavy':
      return { kind: 'heavy', amount: spec.amount, label: `${spec.verb} ${spec.amount}`, hint: 'a huge hit: Ward it!' };
    case 'shell':
      return { kind: 'shell', amount: 0, label: spec.verb, hint: 'strikes do half; Bolt pierces' };
    case 'wail':
      return { kind: 'wail', amount: spec.amount, label: `${spec.verb} ${spec.amount}`, hint: "can't be blocked; Mend after" };
  }
}

/** What the Mage can shout to the crew. */
export const CALLS: Record<string, string> = {
  attack: 'it will ATTACK: Ward!',
  charge: "it's CHARGING: I'll Hex!",
  shell: 'it will SHELL: hold your Fury',
  wail: "it will WAIL: can't block, Mend after",
  hexing: "I'm HEXING: go Fury!",
};

export const GLYPHS: Glyph[] = ['moon', 'eye', 'serpent', 'crown', 'key'];
export const GLYPH_CHAR: Record<Glyph, string> = { moon: '☾', eye: '◉', serpent: '∿', crown: '♛', key: '⚷' };

/** Boons are earned through story choices and quietly help in fights. */
export const BOONS: Record<string, { name: string; desc: string }> = {
  ally: { name: 'Kitsune ally', desc: 'Strike deals +3.' },
  oracle: { name: "Oracle's sight", desc: 'The wyrm starts every round exposed for its first two rounds.' },
  fortified: { name: 'Fortified', desc: '+1 Ward each chapter.' },
  blessing: { name: 'Shrine blessing', desc: 'Mend heals +4.' },
  disguise: { name: 'Corp disguise', desc: 'Guards hesitate: the first round of each fight, foes hit for half.' },
  core: { name: 'Stolen keycard', desc: 'The vault opens one glyph sooner.' },
  survivors: { name: 'Survivors', desc: 'They fight beside you: every round, foes take 2 damage.' },
  weapons: { name: 'Scavenged rail-gun', desc: 'Bolt deals +4.' },
};

export const DISTRICTS = ['the Undercroft', 'Glasswater', 'Spire Row', 'the Ashmarket', 'Lantern Hill'];
