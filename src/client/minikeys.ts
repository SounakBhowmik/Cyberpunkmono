// A small on-screen keyboard for phones, so typing a chat line or a few words
// to the wyrm never brings up the device keyboard over the whole game.

export interface MiniKeyboardHandlers {
  type(ch: string): void;
  backspace(): void;
  enter(): void;
  /** Quick phrases replace what's in the box. */
  chip(text: string): void;
}

const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['1234567890', "-/:;()'\"!?", '.,@#&*+'];
const CHIPS: [string, string][] = [
  ['speak…', 'speak '],
  ['say…', 'say '],
  ['help', 'help'],
  ['ready!', 'ready!'],
];

export class MiniKeyboard {
  private shift = false;
  private symbols = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly on: MiniKeyboardHandlers,
  ) {
    root.classList.add('minikeys');
    // pointerdown so keys feel instant and never steal focus
    root.addEventListener('pointerdown', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (!key) return;
      e.preventDefault();
      key.classList.add('down');
      setTimeout(() => key.classList.remove('down'), 120);
      this.press(key.dataset.k!);
    });
    this.render();
  }

  private press(k: string) {
    if (k === 'shift') {
      this.shift = !this.shift;
      return this.render();
    }
    if (k === 'sym') {
      this.symbols = !this.symbols;
      return this.render();
    }
    if (k === 'back') return this.on.backspace();
    if (k === 'enter') return this.on.enter();
    if (k === 'space') return this.on.type(' ');
    if (k.startsWith('chip:')) return this.on.chip(k.slice(5));
    this.on.type(this.shift ? k.toUpperCase() : k);
    if (this.shift) {
      this.shift = false;
      this.render();
    }
  }

  private render() {
    const rows = this.symbols ? SYMBOLS : LETTERS;
    const key = (k: string, label = k, cls = '') => `<button type="button" class="key ${cls}" data-k="${k.replace(/"/g, '&quot;')}">${label}</button>`;
    const chars = (row: string) => [...row].map((c) => key(c, this.shift ? c.toUpperCase() : c)).join('');
    this.root.innerHTML = `
      <div class="chips">${CHIPS.map(([label, text]) => key(`chip:${text}`, label, 'chip')).join('')}</div>
      <div class="row">${chars(rows[0]!)}</div>
      <div class="row">${chars(rows[1]!)}</div>
      <div class="row">${key('shift', '⇧', `wide${this.shift ? ' on' : ''}`)}${chars(rows[2]!)}${key('back', '⌫', 'wide')}</div>
      <div class="row">${key('sym', this.symbols ? 'abc' : '?123', 'wide')}${key('space', 'space', 'space')}${key('enter', 'send ↵', 'wide go')}</div>`;
  }
}
