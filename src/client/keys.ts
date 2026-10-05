import type { ActionButton } from '../shared/protocol';

// Story decisions and locks keep short keyboard controls. Battles are
// automatic after each Joe chooses equipment.

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
  { keys: 'Before fights', what: 'Choose one relic for each role, then lock your loadout' },
  { keys: 'Automatic', what: 'The crew reads the enemy and performs the strongest strategy available' },
  { keys: '1 – 4', what: 'Vote for a choice' },
  { keys: '1 – 5', what: 'Rogue: press a glyph on a lock (the Mage shows them with the same keys)' },
  { keys: 'T', what: 'Talk to someone you are trying to win over' },
  { keys: 'Enter', what: 'Chat with your crew (Esc to stop typing)' },
  { keys: 'Arrow keys', what: 'Move through menus; Enter selects' },
  { keys: 'B / L / R', what: 'Safehouse: begin, leave, reroll your avatar' },
];
