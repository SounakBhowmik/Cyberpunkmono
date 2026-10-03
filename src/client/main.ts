import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { MAX_LINE_LENGTH, type ActionButton, type ClientMessage, type HudMember, type HudState, type RollView, type SceneRoom, type SceneState, type ServerMessage } from '../shared/protocol';
import { avatarDataUrl, avatarSeed } from './avatar';
import { SceneView } from './scene';
import { Sound, type Ambience } from './sound';

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

// ---------------------------------------------------------------- scene & actions

let animating = false;
let lastScene: SceneState | undefined;
let lastActions: ActionButton[] = [];
let lastHud: HudState | undefined;

const scene = new SceneView(document.getElementById('scene') as HTMLCanvasElement, (room, sc) => clickRoom(room, sc));

async function animateRoll(roll: RollView) {
  sound.dice(roll.outcome);
  animating = true;
  await scene.rollDie(roll);
  animating = false;
  print(roll.text);
}

/** Put a command in the editor for the player to finish (e.g. a port number). */
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

// ---------------------------------------------------------------- touch input bar

const cmdForm = document.getElementById('cmdbar') as HTMLFormElement;
const cmdInput = document.getElementById('cmd') as HTMLInputElement;
cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const line = cmdInput.value;
  cmdInput.value = '';
  sound.unlock();
  run(line);
});

// ---------------------------------------------------------------- sound

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

const FX_SOUND: Partial<Record<string, Parameters<Sound['play']>[0]>> = {
  move: 'move', unlock: 'unlock', alarm: 'alarm', hurt: 'hurt', heal: 'heal', strike: 'strike', slay: 'slay', loot: 'loot', intro: 'intro',
};

function clickRoom(room: SceneRoom, sc: SceneState) {
  const me = sc.party.find((m) => m.you);
  const here = sc.rooms.find((r) => r.id === sc.runnerAt);
  if (!me?.classes.includes('rogue') || !here?.links.includes(room.id)) return;
  if (!room.locked) run(`move ${room.id}`);
  else prefill(room.kind === 'vault' ? 'crack vault ' : `crack ${room.id} `);
}

const actionsEl = document.getElementById('actions')!;

/** Buttons for the street and the safehouse, where the server sends no scene. */
function lobbyActions(): ActionButton[] {
  const h = lastHud;
  if (!h) return [];
  if (h.mode === 'street') {
    return [
      { label: 'create safehouse', cmd: 'create', tone: 'go' },
      { label: 'join', cmd: 'join ', input: true, tone: 'talk', hint: 'type the 4-letter code' },
      { label: 'reroll avatar', cmd: 'reroll', tone: 'magic' },
    ];
  }
  if (h.mode === 'safehouse') {
    const me = h.party.find((m) => m.you);
    const out: ActionButton[] = [];
    if (me?.host) out.push({ label: 'start the delve', cmd: 'start', tone: 'go', disabled: h.party.length < 2, hint: 'needs at least 2 netrunners' });
    out.push({ label: 'reroll avatar', cmd: 'reroll', tone: 'magic' }, { label: 'leave', cmd: 'leave', tone: 'info' });
    return out;
  }
  return [];
}

function renderActions() {
  actionsEl.replaceChildren();
  if (lastScene) {
    const map = document.createElement('button');
    map.className = 'act tone-info toggle';
    map.textContent = scene.mapForced ? '◫ back to scene' : '◫ map';
    map.title = 'toggle the dungeon map';
    map.onclick = () => {
      sound.play('click');
      scene.toggleMap();
      renderActions();
    };
    if (lastScene.view !== 'explore') actionsEl.append(map);
  }
  for (const a of lastScene ? lastActions : lobbyActions()) {
    const b = document.createElement('button');
    b.className = `act tone-${a.tone ?? 'info'}`;
    b.textContent = a.input ? `${a.label} …` : a.label;
    b.disabled = !!a.disabled;
    if (a.hint) b.title = a.hint;
    b.onclick = () => {
      sound.play('click');
      if (a.input) prefill(a.cmd);
      else run(a.cmd);
    };
    actionsEl.append(b);
  }
  if (!actionsEl.children.length) {
    const hint = document.createElement('span');
    hint.className = 'act-hint';
    hint.textContent = lastScene ? 'watch the map and talk to your crew. type to chat.' : 'pick a handle: type it below';
    actionsEl.append(hint);
  }
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
    const av = h.handle ? `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(h.handle, h.avatar ?? 0), [], 2)}">` : '';
    hudEl.innerHTML = `<div class="row">${chip('THE STREET', 'tag')}${h.handle ? chip(`${av}${esc(h.handle)}`, 'you') : ''}<span class="muted">create a safehouse or join one</span></div>`;
    return;
  }
  const party = h.party
    .map((m) => {
      const classes = m.classes.length ? ` <i>${esc(m.classes.join('+'))}</i>` : '';
      const mark = m.host ? ' ★' : m.ready === true ? ' <em class="ok">ready</em>' : m.ready === false ? ' <em>choosing</em>' : '';
      const av = `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(m.handle, m.avatar), m.classes, 2)}">`;
      return chip(`${av}${esc(m.handle)}${classes}${mark}`, m.you ? 'you' : '');
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
      ${chip(esc(h.code), 'tag')}<b class="corp">${esc(h.corp)}</b><span class="muted wide-only">${esc(h.district)} · runner @ ${esc(h.location)}</span>
      <span class="wyrm ${h.wyrm.color}">${esc(h.wyrm.name)} <i class="wide-only">${esc(h.wyrm.title)}</i></span>
    </div>
    <div class="row">
      <span class="label">TRACE</span>${bar(h.trace, 100, traceCls)}<span class="${traceCls}">${h.trace}%</span>
      <span class="sep"></span>${party}
    </div>
    <div class="row deck${h.deck.length ? '' : ' empty'}"><span class="label">DECK</span>${deck}${h.lastRoll ? `<span class="roll" title="last roll">${esc(h.lastRoll)}</span>` : ''}</div>
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
    if (msg.type === 'out') {
      // crew chat lines start with a magenta [handle]
      const chat = /^\x1b\[95m\[([^\]]+)\]\x1b\[0m ([\s\S]*)$/.exec(msg.text);
      if (chat) {
        sound.play('chat');
        const who = crewMember(chat[1]!);
        if (who) scene.chat(who, chat[2]!);
      }
      print(msg.text);
    }
    else if (msg.type === 'roll') await animateRoll(msg.roll);
    else if (msg.type === 'hud') {
      lastHud = msg.hud;
      renderHud(msg.hud);
      if (msg.hud.mode !== 'delve') {
        lastScene = undefined;
        lastActions = [];
        scene.setLobby(
          msg.hud.mode === 'street'
            ? {
                title: 'NEO-AVALON',
                subtitle: 'create a safehouse, or join your crew',
                ...(msg.hud.handle ? { crew: [{ handle: msg.hud.handle, avatar: msg.hud.avatar ?? 0, you: true }] } : {}),
              }
            : {
                title: `SAFEHOUSE ${msg.hud.code}`,
                subtitle: `${msg.hud.party.length}/4 netrunners · share the code`,
                crew: msg.hud.party.map((m) => ({ handle: m.handle, avatar: m.avatar, host: m.host, you: m.you })),
              },
        );
        renderActions();
        sound.setAmbience('lobby');
      }
    } else if (msg.type === 'scene') {
      const prev = lastScene;
      if (msg.scene.view === 'combat' && prev && prev.view !== 'combat') sound.play('encounter');
      if (msg.scene.parley?.reply && msg.scene.parley.reply !== prev?.parley?.reply) sound.play('wyrm');
      if (!prev || prev.view !== msg.scene.view) sound.setAmbience(msg.scene.view as Ambience);
      lastScene = msg.scene;
      lastActions = msg.actions;
      scene.setScene(msg.scene);
      renderActions();
    } else if (msg.type === 'fx') {
      scene.playFx(msg.fx);
      if (msg.fx.kind === 'end') sound.play(msg.fx.win ? 'win' : 'lose');
      else {
        const sfx = FX_SOUND[msg.fx.kind];
        if (sfx) sound.play(sfx);
      }
    }
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

function crewMember(handle: string): HudMember | undefined {
  const party = lastScene?.party ?? (lastHud && lastHud.mode !== 'street' ? lastHud.party : []);
  return party.find((m) => m.handle === handle);
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
renderActions();
sound.setAmbience('lobby');
connect();
