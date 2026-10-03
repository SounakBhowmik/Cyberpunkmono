import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { MAX_LINE_LENGTH, type ActionButton, type ClientMessage, type Fx, type HudMember, type HudState, type SceneState, type ServerMessage } from '../shared/protocol';
import { avatarDataUrl, avatarSeed } from './avatar';
import { SceneView } from './scene';
import { Sound, type Mood, type Sfx } from './sound';

/** Phones and tablets type into a real input box; desktops type straight into the terminal. */
const touch = window.matchMedia('(pointer: coarse)').matches;
const sound = new Sound();

const term = new Terminal({
  cursorBlink: !touch,
  disableStdin: touch,
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
  fontSize: window.innerWidth < 600 ? 11 : 13,
  theme: {
    background: '#07060d',
    foreground: '#d7e3ff',
    cursor: '#ffb800',
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
    blue: '#8fa8ff',
    brightBlue: '#b3c4ff',
  },
});
const fit = new FitAddon();
term.loadAddon(fit);
// xterm measures glyphs when it opens; opening before the web font arrives
// leaves every character spaced for the fallback font.
await Promise.race([document.fonts.load('15px "JetBrains Mono"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
term.open(document.getElementById('terminal')!);
fit.fit();
new ResizeObserver(() => fit.fit()).observe(document.getElementById('terminal')!);
if (!touch) term.focus();

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
    case '\x1b[3~':
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
    case '\x03':
      buffer = '';
      cursor = 0;
      term.write('^C\r\n');
      return redraw();
    case '\x0c':
      term.clear();
      return redraw();
  }
  if (data.startsWith('\x1b')) return;
  const parts = data.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '').split(/\r\n|\r|\n/);
  parts.forEach((part, i) => {
    if (part) insert(part);
    if (i < parts.length - 1) submit();
  });
});

// ---------------------------------------------------------------- commands

/** Put a command in the editor for the player to finish (e.g. what to say). */
function prefill(cmd: string) {
  if (touch) {
    cmdInput.value = cmd;
    cmdInput.focus();
    cmdInput.setSelectionRange(cmd.length, cmd.length);
    return;
  }
  buffer = cmd;
  cursor = buffer.length;
  redraw();
  term.focus();
}

/** Run a command as if typed, echoing it so the log reads naturally. */
function run(cmd: string) {
  term.write('\r\x1b[2K' + prompt + cmd + '\r\n');
  buffer = '';
  cursor = 0;
  send({ type: 'line', text: cmd });
  if (!touch) term.focus();
}

const cmdForm = document.getElementById('cmdbar') as HTMLFormElement;
const cmdInput = document.getElementById('cmd') as HTMLInputElement;
cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const line = cmdInput.value;
  cmdInput.value = '';
  sound.unlock();
  run(line);
});

// ---------------------------------------------------------------- scene, buttons, sound

let lastScene: SceneState | undefined;
let lastActions: ActionButton[] = [];
let lastHud: HudState | undefined;

const scene = new SceneView(document.getElementById('scene') as HTMLCanvasElement, (index) => {
  sound.play('click');
  run(`vote ${index + 1}`);
});

const soundBtn = document.getElementById('sound') as HTMLButtonElement;
function renderSoundBtn() {
  soundBtn.textContent = sound.enabled ? '♪ sound on' : '♪ sound off';
  soundBtn.setAttribute('aria-pressed', String(sound.enabled));
}
soundBtn.onclick = () => {
  sound.setEnabled(!sound.enabled);
  renderSoundBtn();
};
renderSoundBtn();
for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, () => sound.unlock(), { passive: true });

function fxSound(fx: Fx): Sfx | undefined {
  switch (fx.kind) {
    case 'intro': return 'intro';
    case 'enter': return 'enter';
    case 'act': return fx.move;
    case 'foe': return fx.blocked ? 'blocked' : fx.move === 'charge' ? 'charge' : fx.move === 'wail' ? 'wail' : fx.move === 'shell' ? undefined : 'foeHit';
    case 'stun': return 'stun';
    case 'heal': return 'shrine';
    case 'slay': return fx.boss ? 'bossSlay' : 'slay';
    case 'relic': return 'relic';
    case 'vote': return 'vote';
    case 'end': return fx.win ? 'win' : 'lose';
  }
}

const actionsEl = document.getElementById('actions')!;

/** Buttons for the street and the safehouse, where the server sends no scene. */
function lobbyActions(): ActionButton[] {
  const h = lastHud;
  if (!h) return [];
  if (h.mode === 'street') {
    return [
      { label: 'create a safehouse', cmd: 'create', tone: 'go' },
      { label: 'join', cmd: 'join ', input: true, tone: 'talk', hint: 'type the 4-letter code' },
      { label: 'reroll avatar', cmd: 'reroll', tone: 'magic' },
    ];
  }
  if (h.mode === 'safehouse') {
    const me = h.party.find((m) => m.you);
    const out: ActionButton[] = [];
    if (me?.host) out.push({ label: 'begin the descent', cmd: 'start', tone: 'go', disabled: h.party.length < 2, hint: 'needs at least 2 players' });
    out.push({ label: 'reroll avatar', cmd: 'reroll', tone: 'magic' }, { label: 'leave', cmd: 'leave', tone: 'info' });
    return out;
  }
  return [];
}

function renderActions() {
  actionsEl.replaceChildren();
  const list = lastScene ? lastActions : lobbyActions();
  let group: HTMLElement | undefined;
  let groupName: string | undefined;
  for (const a of list) {
    if (a.group !== groupName || !group) {
      groupName = a.group;
      group = document.createElement('div');
      group.className = 'act-group';
      if (a.group) {
        const label = document.createElement('span');
        label.className = 'act-label';
        label.textContent = a.group;
        group.append(label);
      }
      actionsEl.append(group);
    }
    const b = document.createElement('button');
    b.className = `act tone-${a.tone ?? 'info'}`;
    b.disabled = !!a.disabled;
    const name = document.createElement('b');
    name.textContent = a.input ? `${a.label} …` : a.label;
    b.append(name);
    if (a.hint && lastScene) {
      const hint = document.createElement('small');
      hint.textContent = a.hint;
      b.append(hint);
    } else if (a.hint) b.title = a.hint;
    b.onclick = () => {
      sound.play('click');
      if (a.input) prefill(a.cmd);
      else run(a.cmd);
    };
    group.append(b);
  }
  if (!list.length) {
    const hint = document.createElement('span');
    hint.className = 'act-hint';
    hint.textContent = lastScene ? 'waiting for the crew…' : 'pick a name: type it below';
    actionsEl.append(hint);
  }
}

// ---------------------------------------------------------------- hud

const hudEl = document.getElementById('hud')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const chip = (text: string, cls = '') => `<span class="chip ${cls}">${text}</span>`;
const bar = (value: number, max: number, cls: string) => `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, Math.round((value / max) * 100)))}%"></span></span>`;

function memberChip(m: HudMember) {
  const av = `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(m.handle, m.avatar), m.classes, 2)}">`;
  const classes = m.classes.length ? ` <i>${esc(m.classes.join('+'))}</i>` : '';
  const mark = m.host ? ' ★' : m.ready === true ? ' <em class="ok">ready</em>' : m.ready === false ? ' <em>choosing</em>' : '';
  return chip(`${av}${esc(m.handle)}${classes}${mark}`, m.you ? 'you' : '');
}

function renderHud(h: HudState) {
  if (h.mode === 'street') {
    const av = h.handle ? `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(h.handle, h.avatar ?? 0), [], 2)}">` : '';
    hudEl.innerHTML = `<div class="row">${chip('NEO-AVALON', 'tag')}${h.handle ? chip(`${av}${esc(h.handle)}`, 'you') : ''}<span class="muted">create a safehouse or join your crew</span></div>`;
    return;
  }
  const party = h.party.map(memberChip).join('');
  if (h.mode === 'safehouse') {
    hudEl.innerHTML = `<div class="row">${chip(`SAFEHOUSE ${esc(h.code)}`, 'tag')}${party}<span class="muted">${h.party.length}/4</span></div>`;
    return;
  }
  const cls = h.corruption >= 70 ? 'hot' : h.corruption >= 40 ? 'warm' : 'cool';
  const relics = h.relics.map((r) => `<span class="chip prog" title="${esc(r.desc)}">${esc(r.name)}</span>`).join('');
  hudEl.innerHTML = `
    <div class="row">
      ${chip(h.floor >= h.floors ? 'THE BOTTOM' : `FLOOR ${h.floor}/${h.floors - 1}`, 'tag')}
      <span class="label">CORRUPTION</span>${bar(h.corruption, 100, cls)}<span class="${cls}">${h.corruption}%</span>
      <span class="muted wide-only">seals ${h.seals}</span>
      <span class="wyrm ${h.wyrm.color}">${esc(h.wyrm.name)} <i class="wide-only">${esc(h.wyrm.title)}</i></span>
    </div>
    <div class="row">${party}${relics ? `<span class="sep"></span>${relics}` : ''}</div>`;
}

// ---------------------------------------------------------------- network

let ws: WebSocket;
const queue: ServerMessage[] = [];
let draining = false;

function crewMember(handle: string): HudMember | undefined {
  const party = lastScene?.party ?? (lastHud && lastHud.mode !== 'street' ? lastHud.party : []);
  return party.find((m) => m.handle === handle);
}

function apply(msg: ServerMessage) {
  switch (msg.type) {
    case 'out': {
      const chat = /^\x1b\[95m\[([^\]]+)\]\x1b\[0m ([\s\S]*)$/.exec(msg.text);
      if (chat) {
        sound.play('chat');
        const who = crewMember(chat[1]!);
        if (who) scene.chat(who, chat[2]!);
      }
      print(msg.text);
      break;
    }
    case 'hud':
      lastHud = msg.hud;
      renderHud(msg.hud);
      if (msg.hud.mode !== 'delve') {
        lastScene = undefined;
        lastActions = [];
        scene.setLobby(
          msg.hud.mode === 'street'
            ? { title: 'LAST LIGHT', subtitle: 'create a safehouse, or join your crew', ...(msg.hud.handle ? { crew: [{ handle: msg.hud.handle, avatar: msg.hud.avatar ?? 0, you: true }] } : {}) }
            : { title: `SAFEHOUSE ${msg.hud.code}`, subtitle: `${msg.hud.party.length}/4 · share the code with your crew`, crew: msg.hud.party.map((m) => ({ handle: m.handle, avatar: m.avatar, host: m.host, you: m.you })) },
        );
        renderActions();
        sound.setMood('lobby');
      }
      break;
    case 'scene': {
      const prev = lastScene;
      if (msg.scene.parley?.reply && msg.scene.parley.reply !== prev?.parley?.reply) sound.play('wyrm');
      if (!prev || prev.view !== msg.scene.view) sound.setMood(msg.scene.view as Mood);
      lastScene = msg.scene;
      lastActions = msg.actions;
      scene.setScene(msg.scene);
      renderActions();
      break;
    }
    case 'fx': {
      scene.playFx(msg.fx);
      const sfx = fxSound(msg.fx);
      if (sfx) sound.play(sfx);
      if (msg.fx.kind === 'end') sound.setMood('off');
      break;
    }
    case 'prompt':
      prompt = msg.text;
      redraw();
      break;
    case 'clear':
      term.clear();
      redraw();
      break;
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) apply(queue.shift()!);
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
    queue.push({ type: 'prompt', text: '' }, { type: 'out', text: '\r\n\x1b[91m>> connection lost. refresh to reconnect.\x1b[0m' });
    void drain();
  };
}

print('\x1b[2mreaching into the net...\x1b[0m');
renderActions();
sound.setMood('lobby');
connect();
