import type { ActionButton } from '../shared/protocol';

// One key per action, the same on every device: on a keyboard you press it,
// on a phone you tap the round pad button with the same letter.
//
//   Rogue   A Strike   S Fury
//   Cleric  D Ward     F Mend
//   Mage    Q Hex      W Bolt     1-5 call out what the monster will do
//   anyone  T talk     1-4 vote   1-5 glyphs     Enter chat

export const MOVE_KEYS: Record<string, string> = { strike: 'A', fury: 'S', ward: 'D', mend: 'F', hex: 'Q', bolt: 'W' };
const CALL_KEYS: Record<string, string> = { attack: '1', charge: '2', shell: '3', wail: '4', hexing: '5' };
const GLYPHS = ['moon', 'eye', 'serpent', 'crown', 'key'];

/** The key shown on (and bound to) an action, if it has one. */
export function keyFor(a: ActionButton, all: ActionButton[]): string | undefined {
  const [head = '', arg = ''] = a.cmd.trim().split(/\s+/);
  if (MOVE_KEYS[head]) return MOVE_KEYS[head];
  if (head === 'speak') return 'T';
  if (head === 'call') return CALL_KEYS[arg];
  if (head === 'vote') return arg;
  if (head === 'glyph') return String(GLYPHS.indexOf(arg) + 1);
  if (head === 'show') {
    // when the same player can also press glyphs (the tutorial), showing needs Shift
    const n = String(GLYPHS.indexOf(arg) + 1);
    return all.some((b) => b.cmd.startsWith('glyph ')) ? `⇧${n}` : n;
  }
  if (head === 'mode') return String(['adventure', 'heist', 'survival'].indexOf(arg) + 1);
  if (head === 'start') return 'B';
  if (head === 'reroll') return 'R';
  if (head === 'leave') return 'L';
  return undefined;
}

/** Turn a keyboard event into the key label used above, or undefined. */
export function eventKey(e: KeyboardEvent): string | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
  if (digit) return e.shiftKey ? `⇧${digit}` : digit;
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  return letter && !e.shiftKey ? letter : undefined;
}

export const CONTROLS: { keys: string; what: string }[] = [
  { keys: 'A / S', what: 'Rogue: Strike / Fury' },
  { keys: 'D / F', what: 'Cleric: Ward / Mend' },
  { keys: 'Q / W', what: 'Mage: Hex / Bolt' },
  { keys: '1 – 5', what: 'Mage: call out the monster’s move (attack, charge, shell, wail, I’m hexing)' },
  { keys: '1 – 4', what: 'Vote for a choice' },
  { keys: '1 – 5', what: 'Rogue: press a glyph on a lock (the Mage shows them with the same keys)' },
  { keys: 'T', what: 'Talk to someone you are trying to win over' },
  { keys: 'Enter', what: 'Chat with your crew (Esc to stop typing)' },
  { keys: 'B / L / R', what: 'Safehouse: begin, leave, reroll your avatar' },
];
