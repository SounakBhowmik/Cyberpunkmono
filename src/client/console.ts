import type { FeedItem, Portrait, WyrmColor } from '../shared/protocol';
import { avatarDataUrl, avatarSeed } from './avatar';
import { portraitDataUrl } from './portraits';

// The game console: everything a player needs to read appears here, over the
// scene, instead of in the terminal. Story lines play in a dialogue box with
// a portrait and a typewriter; notices pop up and fade; crew messages appear
// as bubbles with the sender's avatar; tips sit in a banner until read.

const WYRM_COLORS: Record<WyrmColor, string> = { red: '#ff5a3c', blue: '#4da3ff', green: '#3dff8f', black: '#9d8cff', white: '#dff4ff' };

interface Line {
  speaker: string;
  text: string;
  portrait: string;
  kind: Portrait['type'];
}

/** Keep coordinator messages readable without rewriting every story node. */
export function messageChunks(text: string, max = 96): string[] {
  const clean = text.trim().replace(/^["“](.*)["”]$/s, '$1');
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => !!s && !/^["'“”‘’]+$/.test(s)) ?? [clean];
  const out: string[] = [];
  for (const sentence of sentences) {
    let line = '';
    for (const word of sentence.split(/\s+/)) {
      if (line && `${line} ${word}`.length > max) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
}

export class GameConsole {
  private readonly dialogue: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly speaker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly more: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly toasts: HTMLElement;
  private readonly chats: HTMLElement;
  private queue: Line[] = [];
  private current?: Line;
  private skipping = false;
  private typed = 0;
  private typer?: number;
  wyrmColor: WyrmColor = 'red';
  onLine?: (kind: Portrait['type'], speaker: string) => void;
  onAdvance?: () => void;
  onReadingChange?: (reading: boolean, speaker?: string) => void;

  constructor(stage: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'console';
    root.innerHTML = `
      <div class="toasts" aria-live="polite"></div>
      <div class="chats" aria-live="polite"></div>
      <div class="dialogue" role="log" aria-live="polite">
        <img class="portrait" alt="">
        <div class="body"><div class="speaker"></div><div class="line"></div></div>
        <button class="skip-briefing" type="button">skip briefing</button>
        <span class="more">click ▸</span>
      </div>`;
    stage.append(root);
    this.dialogue = root.querySelector('.dialogue')!;
    this.portrait = root.querySelector('.portrait')!;
    this.speaker = root.querySelector('.speaker')!;
    this.line = root.querySelector('.line')!;
    this.more = root.querySelector('.more')!;
    this.skipBtn = root.querySelector('.skip-briefing')!;
    this.toasts = root.querySelector('.toasts')!;
    this.chats = root.querySelector('.chats')!;
    this.dialogue.addEventListener('click', () => {
      this.onAdvance?.();
      this.advance();
    });
    this.skipBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.skipping = true;
      this.queue = [];
      this.finishHide();
    });
  }

  push(item: FeedItem) {
    switch (item.kind) {
      case 'story':
        return this.story(item.speaker, item.text, item.portrait);
      case 'notice':
        return this.toast(item.text, item.tone ?? 'info');
      case 'chat':
        return this.chat(item.from, item.text);
      case 'tip':
        return this.story('ECHO', item.text, { type: 'narrator' });
    }
  }

  clear() {
    this.skipping = false;
    this.queue = [];
    this.finishHide();
  }

  // ---------------------------------------------------------------- dialogue

  private portraitUrl(p: Portrait, speaker: string) {
    if (speaker === 'ECHO') return avatarDataUrl(avatarSeed('ECHO', 7), ['mage'], 4);
    if (p.type === 'player') return avatarDataUrl(avatarSeed(p.handle, p.avatar), p.classes, 4);
    if (p.type === 'npc') return portraitDataUrl(p.id, WYRM_COLORS[this.wyrmColor]);
    return portraitDataUrl('narrator');
  }

  private story(speaker: string, text: string, portrait: Portrait) {
    if (this.skipping) return;
    const name = speaker;
    for (const chunk of messageChunks(text)) this.queue.push({ speaker: name, text: chunk, portrait: this.portraitUrl(portrait, name), kind: portrait.type });
    if (!this.current) this.next();
    else this.more.classList.add('show');
  }

  private next() {
    clearInterval(this.typer);
    const line = this.queue.shift();
    this.current = line;
    if (!line) {
      this.dialogue.classList.remove('show');
      this.onReadingChange?.(false);
      return;
    }
    this.onReadingChange?.(true, line.speaker);
    this.onLine?.(line.kind, line.speaker);
    this.dialogue.classList.add('show');
    this.dialogue.classList.toggle('narrator', line.kind === 'narrator');
    this.dialogue.classList.toggle('player', line.kind === 'player');
    this.dialogue.classList.toggle('narration', !line.speaker);
    this.dialogue.classList.toggle('echo', line.speaker === 'ECHO');
    this.portrait.src = line.portrait;
    this.speaker.textContent = line.speaker;
    this.speaker.hidden = !line.speaker;
    this.line.textContent = '';
    this.typed = 0;
    this.more.classList.remove('show');
    // speed up when the story is getting ahead of the reader
    const step = this.queue.length > 1 ? 6 : 3;
    this.typer = window.setInterval(() => {
      this.typed = Math.min(line.text.length, this.typed + step);
      this.line.textContent = line.text.slice(0, this.typed);
      if (this.typed >= line.text.length) this.finishTyping();
    }, 22);
  }

  private finishTyping() {
    const line = this.current;
    if (!line) return;
    clearInterval(this.typer);
    this.line.textContent = line.text;
    this.typed = line.text.length;
    this.more.classList.add('show');
  }

  private advance() {
    if (!this.current) return;
    if (this.typed < this.current.text.length) this.finishTyping();
    else this.next();
  }

  private finishHide() {
    clearInterval(this.typer);
    this.current = undefined;
    this.dialogue.classList.remove('show');
    this.onReadingChange?.(false);
  }

  // ---------------------------------------------------------------- notices, chat, tips

  private toast(text: string, tone: 'good' | 'bad' | 'info') {
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = text;
    this.toasts.append(el);
    const max = window.innerWidth < 600 ? 2 : 4;
    while (this.toasts.children.length > max) this.toasts.firstElementChild?.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3200);
  }

  private chat(from: { handle: string; avatar: number; classes: string[] }, text: string) {
    const el = document.createElement('div');
    el.className = 'chat';
    const img = document.createElement('img');
    img.alt = '';
    img.src = avatarDataUrl(avatarSeed(from.handle, from.avatar), from.classes, 3);
    const body = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = from.handle;
    const msg = document.createElement('span');
    msg.textContent = text;
    body.append(name, msg);
    el.append(img, body);
    this.chats.append(el);
    while (this.chats.children.length > 3) this.chats.firstElementChild?.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 6500);
  }

}
