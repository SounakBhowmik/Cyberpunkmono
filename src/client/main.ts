import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { MAX_LINE_LENGTH, type ActionButton, type ClientMessage, type Fx, type HudMember, type HudState, type ModeId, type SceneState, type ServerMessage } from '../shared/protocol';
import { avatarDataUrl, avatarSeed } from './avatar';
import { GameConsole } from './console';
import { SceneView } from './scene';
import { Sound, type Sfx } from './sound';

const STORIES: Record<ModeId, { title: string; pitch: string }> = {
  adventure: { title: 'The Pilgrimage', pitch: 'carry the seal across the city to the Devourer' },
  heist: { title: 'The Heart of the Wyrm', pitch: 'rob a corp tower of the wyrm it keeps chained' },
  survival: { title: 'Four Nights', pitch: 'hold the last lit safehouse until dawn' },
};

/** Phones and tablets type into a real input box; desktops type straight into the terminal. */
const touch = window.matchMedia('(pointer: coarse)').matches;
const sound = new Sound();

// ---------------------------------------------------------------- terminal (for typed commands)

const term = new Terminal({
  cursorBlink: !touch,
  disableStdin: touch,
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
  fontSize: window.innerWidth < 600 ? 11 : 12,
  theme: {
    background: '#07060d', foreground: '#c8d2ee', cursor: '#ffb800', selectionBackground: '#3b1e5a',
    cyan: '#00f0ff', brightCyan: '#5ff9ff', magenta: '#ff2bd6', brightMagenta: '#ff6be6', yellow: '#ffe600',
    brightYellow: '#fff27a', green: '#39ff88', brightGreen: '#7dffb0', red: '#ff3860', brightRed: '#ff6b88', blue: '#8fa8ff', brightBlue: '#b3c4ff',
  },
});
const fit = new FitAddon();
term.loadAddon(fit);
await Promise.race([document.fonts.load('15px "JetBrains Mono"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
const termEl = document.getElementById('terminal')!;
term.open(termEl);
fit.fit();
new ResizeObserver(() => fit.fit()).observe(termEl);

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
    case '\r': return submit();
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
  }
  if (data.startsWith('\x1b')) return;
  const parts = data.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '').split(/\r\n|\r|\n/);
  parts.forEach((part, i) => {
    if (part) insert(part);
    if (i < parts.length - 1) submit();
  });
});

// The log is tucked away by default: the game console carries the story.
const logBtn = document.getElementById('log') as HTMLButtonElement;
function setLog(open: boolean) {
  document.body.classList.toggle('log-open', open);
  logBtn.setAttribute('aria-pressed', String(open));
  logBtn.textContent = open ? '⌨ hide log' : '⌨ log';
  requestAnimationFrame(() => fit.fit());
}
logBtn.onclick = () => setLog(!document.body.classList.contains('log-open'));
setLog(false);

// ---------------------------------------------------------------- commands

const cmdForm = document.getElementById('cmdbar') as HTMLFormElement;
const cmdInput = document.getElementById('cmd') as HTMLInputElement;
cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const line = cmdInput.value;
  cmdInput.value = '';
  sound.unlock();
  run(line);
});

/** Put a command in the input for the player to finish (e.g. what to say). */
function prefill(cmd: string) {
  cmdInput.value = cmd;
  cmdInput.focus();
  cmdInput.setSelectionRange(cmd.length, cmd.length);
}

/** Run a command as if typed. */
function run(cmd: string) {
  term.write('\r\x1b[2K' + prompt + cmd + '\r\n');
  buffer = '';
  cursor = 0;
  send({ type: 'line', text: cmd });
}

// ---------------------------------------------------------------- scene, console, sound

let lastScene: SceneState | undefined;
let lastActions: ActionButton[] = [];
let lastHud: HudState | undefined;

const stage = document.querySelector('.stage') as HTMLElement;
const scene = new SceneView(document.getElementById('scene') as HTMLCanvasElement, (index) => {
  sound.play('click');
  run(`vote ${index + 1}`);
});
const gameConsole = new GameConsole(stage);
gameConsole.onLine = (kind) => sound.play(kind === 'npc' ? 'npc' : kind === 'player' ? 'speak' : 'notice');

const soundBtn = document.getElementById('sound') as HTMLButtonElement;
function renderSoundBtn() {
  soundBtn.textContent = sound.enabled ? '♪ on' : '♪ off';
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
    case 'title': return 'title';
    case 'act': return fx.move;
    case 'foe': return fx.blocked ? 'blocked' : fx.move === 'charge' ? 'charge' : fx.move === 'wail' ? 'wail' : fx.move === 'shell' ? undefined : 'foeHit';
    case 'stun': return 'stun';
    case 'heal': return 'mend';
    case 'hurt': return 'foeHit';
    case 'slay': return fx.boss ? 'bossSlay' : 'slay';
    case 'glyph': return fx.ok ? 'glyphOk' : 'glyphBad';
    case 'boon': return 'boon';
    case 'vote': return 'vote';
    case 'end': return fx.win ? 'win' : 'lose';
  }
}

// ---------------------------------------------------------------- buttons

const actionsEl = document.getElementById('actions')!;

function lobbyActions(): ActionButton[] {
  const h = lastHud;
  if (!h) return [];
  if (h.mode === 'street') {
    return [
      { label: 'create a safehouse', cmd: 'create', tone: 'go' },
      { label: 'join a crew', cmd: 'join ', input: true, tone: 'talk', hint: 'type the 4-letter code' },
      { label: 'reroll avatar', cmd: 'reroll', tone: 'magic' },
    ];
  }
  if (h.mode === 'safehouse') {
    const me = h.party.find((m) => m.you);
    const out: ActionButton[] = [];
    if (me?.host) {
      for (const [id, s] of Object.entries(STORIES) as [ModeId, (typeof STORIES)[ModeId]][]) {
        out.push({ label: `${h.story === id ? '✓ ' : ''}${s.title}`, cmd: `mode ${id}`, tone: h.story === id ? 'go' : 'info', hint: s.pitch, group: 'story' });
      }
      out.push({ label: 'begin', cmd: 'start', tone: 'go', disabled: h.party.length < 2, hint: 'needs at least 2 players', group: 'crew' });
    }
    out.push({ label: 'reroll avatar', cmd: 'reroll', tone: 'magic', group: 'crew' }, { label: 'leave', cmd: 'leave', tone: 'info', group: 'crew' });
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
      const box = document.createElement('div');
      box.className = 'act-group';
      if (a.group) {
        box.dataset.group = a.group;
        const label = document.createElement('span');
        label.className = 'act-label';
        label.textContent = a.group;
        box.append(label);
      }
      group = document.createElement('div');
      group.className = 'act-row';
      box.append(group);
      actionsEl.append(box);
    }
    const b = document.createElement('button');
    b.className = `act tone-${a.tone ?? 'info'}`;
    b.disabled = !!a.disabled;
    const name = document.createElement('b');
    name.textContent = a.input ? `${a.label} …` : a.label;
    b.append(name);
    if (a.hint) {
      const hint = document.createElement('small');
      hint.textContent = a.hint;
      b.append(hint);
    }
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
    hint.textContent = lastScene ? (lastScene.view === 'end' ? 'the story is over' : 'listen…') : 'type a name below to begin';
    actionsEl.append(hint);
  }
}

// ---------------------------------------------------------------- hud

const hudEl = document.getElementById('hud')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const chip = (text: string, cls = '') => `<span class="chip ${cls}">${text}</span>`;
const bar = (value: number, cls: string) => `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></span>`;

function memberChip(m: HudMember) {
  const av = `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(m.handle, m.avatar), m.classes, 2)}">`;
  const classes = m.classes.length ? ` <i>${esc(m.classes.join('+'))}</i>` : '';
  const mark = m.host ? ' ★' : m.ready === true ? ' <em class="ok">ready</em>' : m.ready === false ? ' <em>choosing</em>' : '';
  return chip(`${av}${esc(m.handle)}${classes}${mark}`, m.you ? 'you' : '');
}

function renderHud(h: HudState) {
  if (h.mode === 'street') {
    const av = h.handle ? `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(h.handle, h.avatar ?? 0), [], 2)}">` : '';
    hudEl.innerHTML = `<div class="row">${chip('NEO-AVALON', 'tag')}${h.handle ? chip(`${av}${esc(h.handle)}`, 'you') : ''}</div>`;
    return;
  }
  const party = h.party.map(memberChip).join('');
  if (h.mode === 'safehouse') {
    hudEl.innerHTML = `<div class="row">${chip(`SAFEHOUSE ${esc(h.code)}`, 'tag')}${chip(esc(STORIES[h.story].title), 'prog')}${party}</div>`;
    return;
  }
  const cls = h.meter.value >= 70 ? 'hot' : h.meter.value >= 40 ? 'warm' : 'cool';
  const boons = h.boons.map((b) => `<span class="chip prog" title="${esc(b.desc)}">✦ ${esc(b.name)}</span>`).join('');
  hudEl.innerHTML = `
    <div class="row">
      ${chip(esc(h.chapter), 'tag')}
      <span class="label">${esc(h.meter.name.toUpperCase())}</span>${bar(h.meter.value, cls)}<span class="${cls}">${h.meter.value}%</span>
      <span class="wards" title="Wards left this chapter">${'⬡'.repeat(h.wards) || '<span class="muted">no wards</span>'}</span>
      <span class="wyrm ${h.wyrm.color}">${esc(h.wyrm.name)} <i class="wide-only">${esc(h.wyrm.title)}</i></span>
    </div>
    <div class="row">${party}${boons ? `<span class="sep"></span>${boons}` : ''}</div>`;
}

// ---------------------------------------------------------------- network

let ws: WebSocket;

function apply(msg: ServerMessage) {
  switch (msg.type) {
    case 'out':
      print(msg.text);
      break;
    case 'feed':
      gameConsole.push(msg.item);
      if (msg.item.kind === 'chat') sound.play('chat');
      if (msg.item.kind === 'notice' && msg.item.tone === 'good') sound.play('notice');
      break;
    case 'hud':
      lastHud = msg.hud;
      renderHud(msg.hud);
      if (msg.hud.mode === 'delve') gameConsole.wyrmColor = msg.hud.wyrm.color;
      if (msg.hud.mode !== 'delve') {
        lastScene = undefined;
        lastActions = [];
        scene.setLobby(
          msg.hud.mode === 'street'
            ? { title: 'LAST LIGHT', subtitle: 'create a safehouse, or join your crew', ...(msg.hud.handle ? { crew: [{ handle: msg.hud.handle, avatar: msg.hud.avatar ?? 0, you: true }] } : {}) }
            : { title: `SAFEHOUSE ${msg.hud.code}`, subtitle: `${STORIES[msg.hud.story].title}: ${STORIES[msg.hud.story].pitch}`, crew: msg.hud.party.map((m) => ({ handle: m.handle, avatar: m.avatar, host: m.host, you: m.you })) },
        );
        renderActions();
        sound.setMood('lobby');
      }
      break;
    case 'scene':
      lastScene = msg.scene;
      lastActions = msg.actions;
      scene.setScene(msg.scene);
      sound.setMood(msg.scene.music);
      renderActions();
      break;
    case 'fx': {
      // a new chapter starts a fresh page: drop lines left over from the last one
      if (msg.fx.kind === 'title') gameConsole.clear();
      scene.playFx(msg.fx);
      const sfx = fxSound(msg.fx);
      if (sfx) sound.play(sfx);
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

function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else gameConsole.push({ kind: 'notice', text: 'Offline. Refresh the page to reconnect.', tone: 'bad' });
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => apply(JSON.parse(String(ev.data)) as ServerMessage);
  ws.onclose = () => {
    prompt = '';
    gameConsole.push({ kind: 'notice', text: 'Connection lost. Refresh to reconnect.', tone: 'bad' });
  };
}

renderActions();
sound.setMood('lobby');
connect();
if (!touch) cmdInput.focus();
