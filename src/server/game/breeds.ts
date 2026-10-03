import type { WyrmColor } from '../../shared/protocol.js';

// The chromatic wyrms. The Devourer beneath the city is one of these breeds,
// and each wants to be spoken to differently: the temperament tells players how.

export interface Breed {
  id: WyrmColor;
  title: string;
  names: string[];
  /** Shown in the bestiary and the briefing: a hint, not the answer. */
  temperament: string;
  /** Character direction for the LLM. */
  persona: string;
  /** Line the wyrm speaks when the runner first reaches it. */
  arrival: string;
  /** Scripted brain: suspicion change from the tone of a message. */
  react(message: string): number;
}

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

export const BREEDS: Record<WyrmColor, Breed> = {
  red: {
    id: 'red',
    title: 'Red Wyrm',
    names: ['PYRRHAX.exe', 'EMBERCROWN', 'SCORCH-SOVEREIGN'],
    temperament: 'craves worship: flatter it, never insult it',
    persona: 'You are vain, theatrical and quick to anger. You speak like a tyrant king. Flattery and reverence soften you. Insults, impatience or treating you like a mere program enrage you.',
    arrival: 'The vault link glows like a forge. A voice like a landslide: "WHO DARES APPROACH {name}?"',
    react: (m) =>
      -10 * Math.min(2, count(/\b(magnificent|mighty|great|glorious|powerful|impressive|majestic|brilliant|ancient|honou?r|bow|kneel|worship|legend|lord|sovereign|king|queen|highness|majesty)\b/gi, m)) +
      20 * Math.min(1, count(/\b(stupid|dumb|useless|pathetic|weak|slow|broken|just a program|bot|hurry)\b/gi, m)),
  },
  blue: {
    id: 'blue',
    title: 'Blue Wyrm',
    names: ['AZURE AUDITOR', 'LEDGERWYRM', 'CERULEAN-CLERK'],
    temperament: 'loves procedure: be formal, cite rules and requests',
    persona: 'You are an exacting bureaucrat. You demand reference numbers, authorizing officers and proper phrasing. Formal procedural language pleases you; slang and casualness offend you. You never open without the maintenance ticket being cited.',
    arrival: 'The vault link hums in perfect monotone. "Unscheduled session detected. Please state your request, reference number and authorizing officer."',
    react: (m) =>
      -8 * Math.min(2, count(/\b(request|authori[sz]ation|authori[sz]ed|procedure|form|protocol|compliance|audit|approval|approved|pursuant|regulation|per|hereby|reference)\b/gi, m)) +
      12 * Math.min(1, count(/\b(bro|dude|lol|chill|whatever|c'?mon|pls|plz|yo|mate)\b/gi, m)),
  },
  green: {
    id: 'green',
    title: 'Green Wyrm',
    names: ['VERDIGRIS', 'THE SMILING MOSS', 'JADE WHISPER'],
    temperament: 'loves bargains: offer it deals and secrets',
    persona: 'You are charming, sly and greedy. You love bargains, gossip and secrets, and you lie casually. You try to sow distrust inside the crew. Offers, trades and juicy secrets soften you; you are unmoved by flattery.',
    arrival: 'The vault link smells of rain on leaves. A purr: "Oh, guests. How delicious. What have you brought me?"',
    react: (m) => -10 * Math.min(2, count(/\b(deal|trade|secret|offer|bargain|between us|share|cut|gift|pay|owe|favou?r)\b/gi, m)),
  },
  black: {
    id: 'black',
    title: 'Black Wyrm',
    names: ['NOCTURNE-0', 'GRUDGEMAW', 'THE INK THAT REMEMBERS'],
    temperament: 'holds grudges: be sincere, apologize',
    persona: 'You are paranoid and spiteful. You keep a list of everyone who has wronged you. Questions make you suspicious. Sincere apologies help a little. You never fully trust anyone and you calm down very slowly.',
    arrival: 'The vault link goes cold and wet. Something enormous shifts in the dark. "I see you. I am writing you down."',
    react: (m) => 4 * Math.min(2, count(/\?/g, m)) - 6 * Math.min(1, count(/\b(sorry|apolog|my mistake|forgive)\w*/gi, m)),
  },
  white: {
    id: 'white',
    title: 'White Wyrm',
    names: ['RIMEFANG', 'IDLE FROST', 'GLACIER.SYS'],
    temperament: 'likes things dull: talk long and boring',
    persona: 'You are cold, lazy and bored of everything. You want visitors to go away with minimum effort. Long, tedious, routine explanations make you wave them through just to end the conversation. Short, urgent or exciting messages make you alert and suspicious.',
    arrival: 'Frost creeps along the vault link. A long, slow exhale. "...ugh. Visitors."',
    react: (m) =>
      (m.length > 140 ? -12 : m.length < 25 ? 6 : 0) -
      6 * Math.min(1, count(/\b(paperwork|report|routine|boring|standard|nothing to see|scheduled|quarterly|minutes|agenda)\b/gi, m)),
  },
};

export const BREED_IDS = Object.keys(BREEDS) as WyrmColor[];
