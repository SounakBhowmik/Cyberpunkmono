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
  /** The monster attacks when this runs out, ready or not. */
  roundMs: 15_000,
  bossRoundMs: 20_000,
  /** Each crew member still undecided at the buzzer adds this much... */
  flatFooted: 6,
  /** ...and the monster's hit that round lands this much harder. */
  flatFootedMult: 1.25,
};

/**
 * The Warden watches every round and scores each player on how well they
 * answered the threat. Points are per player, so a crew can also compete.
 */
export const WARDEN = {
  cleanWard: 15,
  wastedWard: -5,
  brokeCharge: 15,
  setUpHex: 5,
  pierce: 12,
  bluntStrike: 0,
  double: 10,
  strike: 5,
  fury: 4,
  doubleFury: 14,
  timelyMend: 10,
  mend: 3,
  goodCall: 8,
  quick: 5,
  /** acted in the first third of the timer */
  quickShare: 1 / 3,
  flatFooted: -10,
  slay: 20,
  killingBlow: 10,
  glyph: 5,
  badGlyph: -5,
  showGlyph: 3,
  /** per point the parley judge gave a line */
  persuasion: 3,
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
  /** A fixed order of moves instead of random ones (the tutorial's training dummy). */
  script?: IntentSpec[];
}

export const FOES: Record<string, FoeSpec> = {
  hound: {
    id: 'hound', name: 'Gloamfang', hp: 40,
    intro: 'Gloamfang uncurls from the packet stream: six legs, too many teeth, and no shadow of its own.',
    moves: [
      { kind: 'attack', amount: 10, verb: 'BITE', weight: 3 },
      { kind: 'charge', amount: 24, verb: 'POUNCE', weight: 1 },
      { kind: 'wail', amount: 6, verb: 'HOWL', weight: 1 },
    ],
  },
  ooze: {
    id: 'ooze', name: 'The Mireborn', hp: 52,
    intro: 'The floor goes soft. The Mireborn rises in a black tide, wearing faces it drowned long ago.',
    moves: [
      { kind: 'attack', amount: 8, verb: 'ENGULF', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'HARDEN', weight: 2 },
      { kind: 'wail', amount: 7, verb: 'SEEP', weight: 1 },
    ],
  },
  sentinel: {
    id: 'sentinel', name: 'The Mourning Sentinel', hp: 46,
    intro: 'The Mourning Sentinel steps from the firewall and draws a blade engraved with the names of failed crews.',
    moves: [
      { kind: 'attack', amount: 12, verb: 'CLEAVE', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'SHIELD WALL', weight: 1 },
      { kind: 'charge', amount: 26, verb: 'JUDGEMENT', weight: 1 },
    ],
  },
  kraken: {
    id: 'kraken', name: 'Vespercoil', hp: 56,
    intro: 'Vespercoil pours through the walls on limbs of broken light. The room tears open around it.',
    moves: [
      { kind: 'attack', amount: 9, verb: 'LASH', weight: 3 },
      { kind: 'wail', amount: 8, verb: 'STATIC SCREAM', weight: 1 },
      { kind: 'charge', amount: 22, verb: 'CRUSH', weight: 1 },
    ],
  },
  mimic: {
    id: 'mimic', name: 'The Hollow Archive', hp: 44,
    intro: 'The Hollow Archive opens a mouth between its pages. Every tooth bears a stolen memory.',
    moves: [
      { kind: 'attack', amount: 11, verb: 'CHOMP', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'SNAP SHUT', weight: 2 },
      { kind: 'charge', amount: 22, verb: 'SWALLOW', weight: 1 },
    ],
  },
  'crowned-hound': {
    id: 'hound', name: 'Gloamfang, the Crowned Hunt', hp: 72,
    intro: 'The first hunter has learned. Gloamfang returns in moon-iron armor, wearing a crown made from the bridge it once guarded.',
    moves: [
      { kind: 'attack', amount: 15, verb: 'CROWN BITE', weight: 2 },
      { kind: 'charge', amount: 34, verb: 'MOON POUNCE', weight: 2 },
      { kind: 'wail', amount: 11, verb: 'STOLEN NAMES', weight: 1 },
    ],
  },
  'argent-sentinel': {
    id: 'sentinel', name: 'The Argent Mourner', hp: 78,
    intro: 'A taller Sentinel assembles itself from painted armor. Its blade carries tomorrow’s date beside your names.',
    moves: [
      { kind: 'attack', amount: 17, verb: 'SILVER CLEAVE', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'MIRROR GUARD', weight: 2 },
      { kind: 'charge', amount: 38, verb: 'LAST RITES', weight: 1 },
    ],
  },
  glasswing: {
    id: 'kraken', name: 'The Glasswing Manticore', hp: 84,
    intro: 'A lion of black glass unfolds moth-wings wide enough to blot out the dead moon. Its scorpion tail draws glowing runes in the air.',
    moves: [
      { kind: 'attack', amount: 16, verb: 'MIRROR CLAW', weight: 2 },
      { kind: 'wail', amount: 13, verb: 'PRISM SHRIEK', weight: 2 },
      { kind: 'charge', amount: 40, verb: 'SUNSPEAR', weight: 1 },
    ],
  },
  bonecoil: {
    id: 'kraken', name: 'Vespercoil Ossuary', hp: 94,
    intro: 'Vespercoil molts from the walls in a body made of cage-bones. Each limb ends in a different stolen key.',
    moves: [
      { kind: 'attack', amount: 18, verb: 'BONE LASH', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'OSSUARY COIL', weight: 2 },
      { kind: 'charge', amount: 42, verb: 'CAGE CRUSH', weight: 1 },
    ],
  },
  'glass-seraph': {
    id: 'sentinel', name: 'Seraph of the Broken Rose', hp: 108,
    intro: 'Six glass wings open above six engraved blades. The Seraph speaks every crew name at once, then dives.',
    moves: [
      { kind: 'attack', amount: 20, verb: 'SIXFOLD CUT', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'ROSE WINDOW', weight: 1 },
      { kind: 'charge', amount: 48, verb: 'FALLING HEAVEN', weight: 2 },
    ],
  },
  'abyss-mire': {
    id: 'ooze', name: 'The Mireborn Abyss', hp: 124,
    intro: 'The black tide rises cathedral-high. Every face it drowned opens its eyes, and all of them recognize ECHO.',
    moves: [
      { kind: 'attack', amount: 22, verb: 'BLACK TIDE', weight: 2 },
      { kind: 'shell', amount: 0, verb: 'DROWNED CITY', weight: 2 },
      { kind: 'wail', amount: 16, verb: 'A THOUSAND MOUTHS', weight: 1 },
    ],
  },
  noctyra: {
    id: 'wyrm', name: 'Noctyra, the Eclipse Sovereign', hp: 170,
    intro: 'An eclipse tears free of the sky. Noctyra descends wearing the old wyrm as armor, its wings stretching from one edge of Neo-Avalon to the other.',
    moves: [
      { kind: 'attack', amount: 25, verb: 'ECLIPSE TALON', weight: 2 },
      { kind: 'charge', amount: 58, verb: 'NIGHTFALL', weight: 2 },
      { kind: 'wail', amount: 19, verb: 'UNMAKE HOPE', weight: 1 },
      { kind: 'shell', amount: 0, verb: 'BLACK SUN', weight: 1 },
    ],
  },
  'noctyra-true': {
    id: 'wyrm', name: 'NOCTYRA // THE NIGHT BETWEEN', hp: 220,
    intro: 'The body breaks. What remains is older than monsters: a living absence with a crown of extinguished suns and ECHO’s face buried in its throat.',
    moves: [
      { kind: 'attack', amount: 30, verb: 'ERASE', weight: 2 },
      { kind: 'charge', amount: 70, verb: 'END EVERY DAWN', weight: 2 },
      { kind: 'wail', amount: 24, verb: 'NAMELESS CHOIR', weight: 1 },
      { kind: 'shell', amount: 0, verb: 'PERFECT NIGHT', weight: 1 },
    ],
  },
};

/** The tutorial's punching bag: it shows every kind of move, in order. */
export const DUMMY: FoeSpec = {
  id: 'sentinel',
  name: 'The Pale Construct',
  hp: 30,
  intro: 'A practice construct flickers on, a faceless knight of soft white light. It will show you every trick a monster has.',
  moves: [{ kind: 'attack', amount: 6, verb: 'SWIPE', weight: 1 }],
  script: [
    { kind: 'attack', amount: 6, verb: 'SWIPE', weight: 1 },
    { kind: 'charge', amount: 14, verb: 'BIG SWING', weight: 1 },
    { kind: 'shell', amount: 0, verb: 'GUARD UP', weight: 1 },
    { kind: 'wail', amount: 4, verb: 'SCREECH', weight: 1 },
  ],
};

FOES.dummy = DUMMY;

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
