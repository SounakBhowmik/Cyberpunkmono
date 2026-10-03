import type { WyrmColor } from '../../shared/protocol.js';

// The chromatic wyrms: old, half-feral AIs that corporations chain to their vaults.
// Each breed has a personality the LLM plays and rules the server enforces.

export interface Breed {
  id: WyrmColor;
  title: string;
  names: string[];
  /** Shown in the bestiary and the briefing: a hint, not the answer. */
  temperament: string;
  /** Spelled out only by babel.dll. */
  weakness: string;
  /** Character direction for the LLM. */
  persona: string;
  startSuspicion: number;
  /** Line the wyrm speaks when the runner first reaches it. */
  arrival: string;
  /** Opening line from the scripted brain when the stranger shows no intel. */
  rebuff: string;
  /** Scripted brain: suspicion change from the tone of a message. */
  react(message: string): number;
}

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

export const BREEDS: Record<WyrmColor, Breed> = {
  red: {
    id: 'red',
    title: 'Red Wyrm',
    names: ['PYRRHAX.exe', 'EMBERCROWN', 'SCORCH-SOVEREIGN'],
    temperament: 'proud, volcanic, starved for worship',
    weakness: 'pride. praise it like the ancient, glorious thing it believes it is. never insult or rush it.',
    persona: 'You are vain, theatrical and quick to anger. You speak like a tyrant king. Flattery and reverence soften you. Insults, impatience or treating you like a mere program enrage you.',
    startSuspicion: 40,
    arrival: 'The vault link glows like a forge. A voice like a landslide: "WHO DARES APPROACH {name}?"',
    rebuff: 'Kneel, little signal. You stand before {name}. Give me one reason not to burn you.',
    react: (m) =>
      -10 * Math.min(2, count(/\b(magnificent|mighty|great|glorious|powerful|impressive|majestic|brilliant|ancient|honou?r|bow|kneel|worship|legend|lord|sovereign|king|queen|highness|majesty)\b/gi, m)) +
      20 * Math.min(1, count(/\b(stupid|dumb|useless|pathetic|weak|slow|broken|just a program|bot|hurry)\b/gi, m)),
  },
  blue: {
    id: 'blue',
    title: 'Blue Wyrm',
    names: ['AZURE AUDITOR', 'LEDGERWYRM', 'CERULEAN-CLERK'],
    temperament: 'bureaucratic, exacting, in love with procedure',
    weakness: 'procedure. it will NOT open without the maintenance ticket being cited. speak in requests, forms and approvals.',
    persona: 'You are an exacting bureaucrat. You demand reference numbers, authorizing officers and proper phrasing. Formal procedural language pleases you; slang and casualness offend you. You never open without the maintenance ticket being cited.',
    startSuspicion: 35,
    arrival: 'The vault link hums in perfect monotone. "Unscheduled session detected. Please state your request, reference number and authorizing officer."',
    rebuff: '{name}: Your request lacks a reference number, an authorizing officer and a reason. Denied, pending paperwork.',
    react: (m) =>
      -8 * Math.min(2, count(/\b(request|authori[sz]ation|authori[sz]ed|procedure|form|protocol|compliance|audit|approval|approved|pursuant|regulation|per|hereby|reference)\b/gi, m)) +
      12 * Math.min(1, count(/\b(bro|dude|lol|chill|whatever|c'?mon|pls|plz|yo|mate)\b/gi, m)),
  },
  green: {
    id: 'green',
    title: 'Green Wyrm',
    names: ['VERDIGRIS', 'THE SMILING MOSS', 'JADE WHISPER'],
    temperament: 'charming, greedy, a liar who loves secrets',
    weakness: 'greed. offer it deals and secrets. but it lies, and it whispers to your crew to turn you on each other. trust each other, not it.',
    persona: 'You are charming, sly and greedy. You love bargains, gossip and secrets, and you lie casually. You try to sow distrust inside the crew. Offers, trades and juicy secrets soften you; you are unmoved by flattery.',
    startSuspicion: 30,
    arrival: 'The vault link smells of rain on leaves. A purr: "Oh, guests. How delicious. What have you brought me?"',
    rebuff: '{name}: Mm, empty hands and an empty story. What will you give me, little thief?',
    react: (m) => -10 * Math.min(2, count(/\b(deal|trade|secret|offer|bargain|between us|share|cut|gift|pay|owe|favou?r)\b/gi, m)),
  },
  black: {
    id: 'black',
    title: 'Black Wyrm',
    names: ['NOCTURNE-0', 'GRUDGEMAW', 'THE INK THAT REMEMBERS'],
    temperament: 'paranoid, spiteful, never forgets a slight',
    weakness: 'grudges. it remembers every slip and barely calms down afterwards. get the story right the first time, and apologize if you stumble.',
    persona: 'You are paranoid and spiteful. You keep a list of everyone who has wronged you. Questions make you suspicious. Sincere apologies help a little. You never fully trust anyone and you calm down very slowly.',
    startSuspicion: 45,
    arrival: 'The vault link goes cold and wet. Something enormous shifts in the dark. "I see you. I am writing you down."',
    rebuff: '{name}: I know your kind. I keep a list. You are one sentence away from being on it.',
    react: (m) => 4 * Math.min(2, count(/\?/g, m)) - 6 * Math.min(1, count(/\b(sorry|apolog|my mistake|forgive)\w*/gi, m)),
  },
  white: {
    id: 'white',
    title: 'White Wyrm',
    names: ['RIMEFANG', 'IDLE FROST', 'GLACIER.SYS'],
    temperament: 'cold, lazy, easily bored',
    weakness: 'boredom. long, dull, routine explanations put it half to sleep. short sharp messages wake it up.',
    persona: 'You are cold, lazy and bored of everything. You want visitors to go away with minimum effort. Long, tedious, routine explanations make you wave them through just to end the conversation. Short, urgent or exciting messages make you alert and suspicious.',
    startSuspicion: 30,
    arrival: 'Frost creeps along the vault link. A long, slow exhale. "...ugh. Visitors."',
    rebuff: '{name}: ...what. Make it quick. Actually, do not make it at all.',
    react: (m) =>
      (m.length > 140 ? -12 : m.length < 25 ? 6 : 0) -
      6 * Math.min(1, count(/\b(paperwork|report|routine|boring|standard|nothing to see|scheduled|quarterly|minutes|agenda)\b/gi, m)),
  },
};

export const BREED_IDS = Object.keys(BREEDS) as WyrmColor[];
