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

export class GameConsole {
  private readonly dialogue: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly speaker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly more: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly chats: HTMLElement;
  private readonly tipEl: HTMLElement;
  private queue: Line[] = [];
  private current?: Line;
  private typed = 0;
  private typer?: number;
  private holder?: number;
  private hider?: number;
  private tipTimer?: number;
  wyrmColor: WyrmColor = 'red';
  onLine?: (kind: Portrait['type']) => void;

  constructor(stage: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'console';
    root.innerHTML = `
      <div class="toasts" aria-live="polite"></div>
      <div class="chats" aria-live="polite"></div>
      <div class="dialogue" role="log" aria-live="polite">
        <img class="portrait" alt="">
        <div class="body"><div class="speaker"></div><div class="line"></div></div>
        <span class="more">▸</span>
      </div>
      <div class="tip" role="status"></div>`;
    stage.append(root);
    this.dialogue = root.querySelector('.dialogue')!;
    this.portrait = root.querySelector('.portrait')!;
    this.speaker = root.querySelector('.speaker')!;
    this.line = root.querySelector('.line')!;
    this.more = root.querySelector('.more')!;
    this.toasts = root.querySelector('.toasts')!;
    this.chats = root.querySelector('.chats')!;
    this.tipEl = root.querySelector('.tip')!;
    this.dialogue.addEventListener('click', () => this.advance());
    this.tipEl.addEventListener('click', () => this.tipEl.classList.remove('show'));
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
        return this.tip(item.text);
    }
  }

  clear() {
    this.queue = [];
    this.finishHide();
  }

  // ---------------------------------------------------------------- dialogue

  private portraitUrl(p: Portrait) {
    if (p.type === 'player') return avatarDataUrl(avatarSeed(p.handle, p.avatar), p.classes, 4);
    if (p.type === 'npc') return portraitDataUrl(p.id, WYRM_COLORS[this.wyrmColor]);
    return portraitDataUrl('narrator');
  }

  private story(speaker: string, text: string, portrait: Portrait) {
    this.queue.push({ speaker, text, portrait: this.portraitUrl(portrait), kind: portrait.type });
    // never fall more than a few lines behind what is happening on screen
    while (this.queue.length > 4) this.queue.shift();
    if (!this.current) this.next();
    else this.more.classList.add('show');
  }

  private next() {
    clearTimeout(this.holder);
    clearTimeout(this.hider);
    clearInterval(this.typer);
    const line = this.queue.shift();
    this.current = line;
    if (!line) {
      // nothing left to say: fade the box out so the scene can breathe
      this.hider = window.setTimeout(() => this.dialogue.classList.remove('show'), 4500);
      return;
    }
    this.onLine?.(line.kind);
    this.dialogue.classList.add('show');
    this.dialogue.classList.toggle('narrator', line.kind === 'narrator');
    this.dialogue.classList.toggle('player', line.kind === 'player');
    this.portrait.src = line.portrait;
    this.speaker.textContent = line.speaker;
    this.speaker.hidden = !line.speaker;
    this.line.textContent = '';
    this.typed = 0;
    this.more.classList.toggle('show', this.queue.length > 0);
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
    const hold = this.queue.length > 1 ? 900 : Math.min(4500, 1400 + line.text.length * 25);
    clearTimeout(this.holder);
    this.holder = window.setTimeout(() => this.next(), hold);
  }

  private advance() {
    if (!this.current) return;
    if (this.typed < this.current.text.length) this.finishTyping();
    else this.next();
  }

  private finishHide() {
    clearInterval(this.typer);
    clearTimeout(this.holder);
    this.current = undefined;
    this.dialogue.classList.remove('show');
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

  private tip(text: string) {
    this.tipEl.textContent = text;
    this.tipEl.classList.add('show');
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => this.tipEl.classList.remove('show'), 9000);
  }
}
