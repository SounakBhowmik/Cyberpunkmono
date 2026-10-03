import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { MAX_LINE_LENGTH, type ClientMessage, type ServerMessage } from '../shared/protocol';

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

// ---------------------------------------------------------------- network

let ws: WebSocket;

function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else print('\x1b[91m(offline. refresh the page to reconnect.)\x1b[0m');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.type === 'out') print(msg.text);
    else if (msg.type === 'prompt') {
      prompt = msg.text;
      redraw();
    } else if (msg.type === 'clear') {
      term.clear();
      redraw();
    }
  };
  ws.onclose = () => {
    prompt = '';
    print('\r\n\x1b[91m>> connection to the net lost. refresh to jack back in.\x1b[0m');
  };
}

print('\x1b[2mdialing the net...\x1b[0m');
connect();
