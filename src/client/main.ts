import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { MAX_LINE_LENGTH, type ClientMessage, type HudState, type RollView, type ServerMessage } from '../shared/protocol';

const term = new Terminal({
  cursorBlink: true,
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
  fontSize: window.innerWidth < 600 ? 12 : 15,
  theme: {
    background: '#07060d',
    foreground: '#d7e3ff',
    cursor: '#ff2bd6',
    selectionBackground: '#3b1e5a',
    cyan: '#00f0ff',
    brightCyan: '#5ff9ff',
    magenta: '#ff2bd6',
    brightMagenta: '#ff6be6',
    yellow: '#ffe600',
    brightYellow: '#fff27a',
    green: '#39ff88',
    brightGreen: '#7dffb0',
    red: '#ff3860',
    brightRed: '#ff6b88',
  },
});
const fit = new FitAddon();
term.loadAddon(fit);
// xterm measures glyphs when it opens; opening before the web font arrives
// leaves every character spaced for the fallback font and garbles ASCII art.
await Promise.race([document.fonts.load('15px "JetBrains Mono"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
term.open(document.getElementById('terminal')!);
fit.fit();
window.addEventListener('resize', () => fit.fit());
term.focus();

// ---------------------------------------------------------------- line editor
// The server sends finished lines and a prompt; we own the input line and
// redraw it whenever output arrives so incoming chat never clobbers typing.

let prompt = '';
let buffer = '';
let cursor = 0;
const history: string[] = [];
let historyIndex = 0;

const visibleLength = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

function redraw() {
  if (animating) return;
  term.write('\r\x1b[2K' + prompt + buffer);
  const back = buffer.length - cursor;
  if (back > 0) term.write(`\x1b[${back}D`);
}

function print(text: string) {
  term.write('\r\x1b[2K' + text.replace(/\r?\n/g, '\r\n') + '\r\n');
  redraw();
}

function submit() {
  const line = buffer;
  term.write('\r\n');
  if (line.trim()) {
    history.push(line);
    if (history.length > 100) history.shift();
  }
  historyIndex = history.length;
  buffer = '';
  cursor = 0;
  send({ type: 'line', text: line });
}

function insert(text: string) {
  const room = Math.min(MAX_LINE_LENGTH, Math.max(8, term.cols - visibleLength(prompt) - 1)) - buffer.length;
  if (room <= 0) return;
  const chunk = text.slice(0, room);
  buffer = buffer.slice(0, cursor) + chunk + buffer.slice(cursor);
  cursor += chunk.length;
  redraw();
}

term.onData((data) => {
  switch (data) {
    case '\r':
      return submit();
    case '\x7f':
    case '\b':
      if (cursor > 0) {
        buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
        cursor--;
        redraw();
      }
      return;
    case '\x1b[3~': // delete
      buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
      return redraw();
    case '\x1b[D':
      if (cursor > 0) cursor--;
      return redraw();
    case '\x1b[C':
      if (cursor < buffer.length) cursor++;
      return redraw();
    case '\x1b[H':
    case '\x01':
      cursor = 0;
      return redraw();
    case '\x1b[F':
    case '\x05':
      cursor = buffer.length;
      return redraw();
    case '\x1b[A':
      if (historyIndex > 0) {
        buffer = history[--historyIndex] ?? '';
        cursor = buffer.length;
        redraw();
      }
      return;
    case '\x1b[B':
      if (historyIndex < history.length) {
        buffer = history[++historyIndex] ?? '';
        cursor = buffer.length;
        redraw();
      }
      return;
    case '\x03': // ctrl+c
      buffer = '';
      cursor = 0;
      term.write('^C\r\n');
      return redraw();
    case '\x0c': // ctrl+l
      term.clear();
      return redraw();
  }
  if (data.startsWith('\x1b')) return;
  // Typed characters or a paste: keep printable text, submit on embedded newlines.
  const parts = data.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '').split(/\r\n|\r|\n/);
  parts.forEach((part, i) => {
    if (part) insert(part);
    if (i < parts.length - 1) submit();
  });
});

// ---------------------------------------------------------------- dice

let animating = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function animateRoll(roll: RollView) {
  if (!reducedMotion) {
    animating = true;
    const frames = 9;
    for (let i = 0; i < frames; i++) {
      const face = i === frames - 1 ? roll.natural : 1 + Math.floor(Math.random() * roll.sides);
      const tint = roll.sides === 20 && face === 20 ? '92' : roll.sides === 20 && face === 1 ? '91' : '93';
      term.write(`\r\x1b[2K  \x1b[${tint}m⟦ d${roll.sides} · ${String(face).padStart(2, ' ')} ⟧\x1b[0m`);
      await sleep(35 + i * 9);
    }
    animating = false;
  }
  print(roll.text);
}

// ---------------------------------------------------------------- hud

const hudEl = document.getElementById('hud')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function chip(text: string, cls = '') {
  return `<span class="chip ${cls}">${text}</span>`;
}

function bar(value: number, max: number, cls: string) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return `<span class="bar ${cls}"><span style="width:${pct}%"></span></span>`;
}

function renderHud(h: HudState) {
  if (h.mode === 'street') {
    hudEl.innerHTML = `<div class="row">${chip('THE STREET', 'tag')}<span class="muted">${esc(h.handle ?? '')} · create a safehouse or join one</span></div>`;
    return;
  }
  const party = h.party
    .map((m) => {
      const classes = m.classes.length ? ` <i>${esc(m.classes.join('+'))}</i>` : '';
      const mark = m.host ? ' ★' : m.ready === true ? ' <em class="ok">ready</em>' : m.ready === false ? ' <em>choosing</em>' : '';
      return chip(`${esc(m.handle)}${classes}${mark}`, m.you ? 'you' : '');
    })
    .join('');
  if (h.mode === 'safehouse') {
    hudEl.innerHTML = `<div class="row">${chip(`SAFEHOUSE ${esc(h.code)}`, 'tag')}${party}<span class="muted">${h.party.length}/4 · host starts the delve</span></div>`;
    return;
  }
  const traceCls = h.trace >= 75 ? 'hot' : h.trace >= 50 ? 'warm' : 'cool';
  const deck = h.deck.length ? h.deck.map((d) => chip(`${esc(d.name)} ×${d.charges}`, 'prog')).join('') : '<span class="muted">deck empty</span>';
  const enc = h.encounter
    ? `<div class="row fight">${chip(`⚔ ROUND ${h.encounter.round}`, 'tag hot')}<b>${esc(h.encounter.name)}</b>${bar(h.encounter.hp, h.encounter.maxHp, 'hp')}<span>${h.encounter.hp}/${h.encounter.maxHp} HP</span></div>`
    : '';
  hudEl.innerHTML = `
    <div class="row">
      ${chip(esc(h.code), 'tag')}<b class="corp">${esc(h.corp)}</b><span class="muted">${esc(h.district)} · runner @ ${esc(h.location)}</span>
      <span class="wyrm ${h.wyrm.color}">${esc(h.wyrm.name)} <i>${esc(h.wyrm.title)}</i></span>
    </div>
    <div class="row">
      <span class="label">TRACE</span>${bar(h.trace, 100, traceCls)}<span class="${traceCls}">${h.trace}%</span>
      <span class="sep"></span>${party}
    </div>
    <div class="row"><span class="label">DECK</span>${deck}${h.lastRoll ? `<span class="roll" title="last roll">${esc(h.lastRoll)}</span>` : ''}</div>
    ${enc}`;
}

// ---------------------------------------------------------------- network

let ws: WebSocket;
const queue: ServerMessage[] = [];
let draining = false;

// Messages are applied strictly in order so a dice roll finishes tumbling
// before the outcome it caused is printed.
async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const msg = queue.shift()!;
    if (msg.type === 'out') print(msg.text);
    else if (msg.type === 'roll') await animateRoll(msg.roll);
    else if (msg.type === 'hud') renderHud(msg.hud);
    else if (msg.type === 'prompt') {
      prompt = msg.text;
      redraw();
    } else if (msg.type === 'clear') {
      term.clear();
      redraw();
    }
  }
  draining = false;
}

function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else print('\x1b[91m(offline. refresh the page to reconnect.)\x1b[0m');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    queue.push(JSON.parse(String(ev.data)) as ServerMessage);
    void drain();
  };
  ws.onclose = () => {
    queue.push({ type: 'prompt', text: '' }, { type: 'out', text: '\r\n\x1b[91m>> connection to the net lost. refresh to jack back in.\x1b[0m' });
    void drain();
  };
}

print('\x1b[2mdialing the net...\x1b[0m');
connect();
