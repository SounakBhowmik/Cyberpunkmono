import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import {
  MAX_LINE_LENGTH, type ActionButton, type Checkpoint, type ClientMessage, type Fx, type HudMember, type HudState, type ModeId, type RunResult, type SceneState, type ServerMessage,
} from '../shared/protocol';
import { avatarDataUrl, avatarSeed } from './avatar';
import { GameConsole } from './console';
import { CONTROLS, MOVE_KEYS, eventKey, keyFor } from './keys';
import { MiniKeyboard } from './minikeys';
import { ACHIEVEMENTS, Progress, type Achievement } from './progress';
import { SceneView } from './scene';
import { Sound, type Sfx } from './sound';

const STORIES: Record<ModeId, { title: string; pitch: string }> = {
  adventure: { title: 'The Pilgrimage', pitch: 'carry the seal across the city to the Devourer' },
  heist: { title: 'The Heart of the Wyrm', pitch: 'rob a corp tower of the wyrm it keeps chained' },
  survival: { title: 'Four Nights', pitch: 'hold the last lit safehouse until dawn' },
  tutorial: { title: 'Training', pitch: 'learn the controls, the roles and how to read a monster' },
};
const CREW_STORIES: ModeId[] = ['adventure', 'heist', 'survival'];
const NAME_RE = /^[A-Za-z0-9_-]{2,16}$/;

/** Phones and tablets get the on-screen pad and the slide-in log; desktops get hotkeys and the bottom log. */
const touch = window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);
const sound = new Sound();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- terminal (the log, and typed commands)

const term = new Terminal({
  cursorBlink: !touch,
  disableStdin: touch,
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
  fontSize: touch ? 10 : 12,
  theme: {
    background: '#07060d', foreground: '#c8d2ee', cursor: '#ffb800', selectionBackground: '#3b1e5a',
    cyan: '#00f0ff', brightCyan: '#5ff9ff', magenta: '#ff2bd6', brightMagenta: '#ff6be6', yellow: '#ffe600',
    brightYellow: '#fff27a', green: '#39ff88', brightGreen: '#7dffb0', red: '#ff3860', brightRed: '#ff6b88', blue: '#8fa8ff', brightBlue: '#b3c4ff',
  },
});
const fit = new FitAddon();
term.loadAddon(fit);
await Promise.race([document.fonts.load('15px "JetBrains Mono"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
const termEl = $('terminal');
const cmdForm = $<HTMLFormElement>('cmdbar');
const cmdInput = $<HTMLInputElement>('cmd');
if (touch) {
  // on a phone the log and the input live in the drawer, and typing uses our own small keyboard
  $('drawer-log').append(termEl);
  $('drawer-input').append(cmdForm);
  cmdInput.readOnly = true;
  cmdInput.inputMode = 'none';
  cmdInput.placeholder = 'type with the keys below';
}
term.open(termEl);
const refit = () => {
  try {
    fit.fit();
  } catch {
    /* hidden */
  }
};
refit();
new ResizeObserver(refit).observe(termEl);

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

function submitTerm() {
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
    case '\r': return submitTerm();
    case '\x7f':
    case '\b':
      if (cursor > 0) {
        buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
        cursor--;
        redraw();
      }
      return;
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
  }
  if (data.startsWith('\x1b')) return;
  const parts = data.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '').split(/\r\n|\r|\n/);
  parts.forEach((part, i) => {
    if (part) insert(part);
    if (i < parts.length - 1) submitTerm();
  });
});

// ---------------------------------------------------------------- the log: bottom panel on desktop, slide-in drawer on phones

const logBtn = $<HTMLButtonElement>('log');
const drawer = $('drawer');

function setLog(open: boolean) {
  if (touch) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
  } else document.body.classList.toggle('log-open', open);
  logBtn.setAttribute('aria-pressed', String(open));
  logBtn.textContent = touch ? (open ? '✕ chat' : '💬 chat') : open ? '⌨ hide log' : '⌨ log';
  requestAnimationFrame(refit);
}
const logOpen = () => (touch ? drawer.classList.contains('open') : document.body.classList.contains('log-open'));
logBtn.onclick = () => setLog(!logOpen());
$('drawer-close').onclick = () => setLog(false);
setLog(false);

if (touch) {
  new MiniKeyboard($('minikeys'), {
    type: (ch) => {
      cmdInput.value = (cmdInput.value + ch).slice(0, MAX_LINE_LENGTH);
    },
    backspace: () => {
      cmdInput.value = cmdInput.value.slice(0, -1);
    },
    enter: () => cmdForm.requestSubmit(),
    chip: (text) => {
      cmdInput.value = text;
    },
  });
}

// ---------------------------------------------------------------- commands

cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const line = cmdInput.value;
  cmdInput.value = '';
  sound.unlock();
  if (line.trim()) run(line);
  if (!touch) cmdInput.blur();
});

/** Put a command in the input for the player to finish (e.g. what to say). */
function prefill(cmd: string) {
  cmdInput.value = cmd;
  if (touch) setLog(true);
  else {
    cmdInput.focus();
    cmdInput.setSelectionRange(cmd.length, cmd.length);
  }
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
let myHandle = '';

const stage = document.querySelector('.stage') as HTMLElement;
const scene = new SceneView($<HTMLCanvasElement>('scene'), (index) => {
  sound.play('click');
  run(`vote ${index + 1}`);
});
const gameConsole = new GameConsole(stage);
gameConsole.onLine = (kind) => sound.play(kind === 'npc' ? 'npc' : kind === 'player' ? 'speak' : 'notice');

const soundBtn = $<HTMLButtonElement>('sound');
function renderSoundBtn() {
  soundBtn.textContent = sound.enabled ? '♪ on' : '♪ off';
  soundBtn.setAttribute('aria-pressed', String(sound.enabled));
}
soundBtn.onclick = () => {
  sound.setEnabled(!sound.enabled);
  renderSoundBtn();
};
renderSoundBtn();
// Browsers only let a page make sound after the first tap or key press; the menu is that first press.
for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, () => sound.unlock(), { passive: true, capture: true });

function fxSound(fx: Fx): Sfx | undefined {
  switch (fx.kind) {
    case 'title': return 'title';
    case 'act': return fx.move;
    case 'foe': return fx.blocked ? 'blocked' : fx.move === 'charge' ? 'charge' : fx.move === 'wail' ? 'wail' : fx.move === 'shell' ? undefined : 'foeHit';
    case 'stun': return 'stun';
    case 'heal': return 'mend';
    case 'hurt': return 'flat';
    case 'slay': return fx.boss ? 'bossSlay' : 'slay';
    case 'glyph': return fx.ok ? 'glyphOk' : 'glyphBad';
    case 'boon': return 'boon';
    case 'vote': return 'vote';
    case 'score': return fx.by === myHandle && fx.points > 0 ? 'score' : undefined;
    case 'end': return fx.win ? 'win' : 'lose';
  }
}

// the last three seconds before the monster moves tick out loud
let lastTick = -1;
setInterval(() => {
  const left = scene.secondsLeft;
  const fighting = lastScene?.view === 'combat' || lastScene?.view === 'boss';
  if (left === undefined || !fighting) return;
  const s = Math.ceil(left);
  if (s !== lastTick && s <= 3 && s > 0) sound.play('tick');
  lastTick = s;
}, 120);

// ---------------------------------------------------------------- buttons, hotkeys and the phone pad

const actionsEl = $('actions');

function lobbyActions(): ActionButton[] {
  const h = lastHud;
  if (!h) return [];
  if (h.mode === 'street') {
    return [
      { label: 'create a safehouse', cmd: 'create', tone: 'go' },
      { label: 'join a crew', cmd: 'join ', input: true, tone: 'talk', hint: 'type the 4-letter code' },
      { label: 'training', cmd: 'tutorial', tone: 'magic', hint: 'learn the controls, solo' },
      { label: 'reroll avatar', cmd: 'reroll', tone: 'magic' },
    ];
  }
  if (h.mode === 'safehouse') {
    const me = h.party.find((m) => m.you);
    const out: ActionButton[] = [];
    if (me?.host) {
      for (const id of CREW_STORIES) {
        const s = STORIES[id];
        const resuming = h.resume && h.story === id;
        out.push({ label: `${h.story === id ? '✓ ' : ''}${s.title}`, cmd: `mode ${id}`, tone: h.story === id ? 'go' : 'info', hint: resuming ? `resume at chapter ${h.resume!.chapter}` : s.pitch, group: 'story' });
      }
      out.push({ label: h.resume ? 'resume' : 'begin', cmd: 'start', tone: 'go', disabled: h.party.length < 2, hint: h.party.length < 2 ? 'needs at least 2 players' : 'start the story', group: 'crew' });
    }
    out.push({ label: 'reroll avatar', cmd: 'reroll', tone: 'magic', group: 'crew' }, { label: 'leave', cmd: 'leave', tone: 'info', group: 'crew' });
    return out;
  }
  return [];
}

let shownActions: ActionButton[] = [];
const buttonByKey = new Map<string, HTMLButtonElement>();

function trigger(a: ActionButton, el?: HTMLElement) {
  if (a.disabled) return;
  sound.play('click');
  el?.classList.add('pressed');
  setTimeout(() => el?.classList.remove('pressed'), 160);
  if (a.input) prefill(a.cmd);
  else run(a.cmd);
}

function renderActions() {
  actionsEl.replaceChildren();
  buttonByKey.clear();
  const list = lastScene ? lastActions : lobbyActions();
  shownActions = list;
  const fighting = lastScene?.view === 'combat' || lastScene?.view === 'boss';
  actionsEl.classList.toggle('fighting', !!fighting);
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
    const key = keyFor(a, list);
    const head = a.cmd.trim().split(/\s+/)[0] ?? '';
    const b = document.createElement('button');
    b.className = `act tone-${a.tone ?? 'info'}${MOVE_KEYS[head] ? ' move' : ''}`;
    b.disabled = !!a.disabled;
    if (key) {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      b.append(kbd);
      if (!a.disabled) buttonByKey.set(key, b);
    }
    const name = document.createElement('b');
    // on the phone pad a call-out only needs its one loud word
    const short = touch && head === 'call' ? /[A-Z]{3,}/.exec(a.label)?.[0] : undefined;
    name.textContent = short ?? (a.input ? `${a.label} …` : a.label);
    b.append(name);
    if (a.hint) {
      const hint = document.createElement('small');
      hint.textContent = a.hint;
      b.append(hint);
    }
    if (a.hint) b.title = a.hint;
    b.onclick = () => trigger(a, b);
    group.append(b);
  }
  if (!list.length) {
    const hint = document.createElement('span');
    hint.className = 'act-hint';
    hint.textContent = lastScene ? (lastScene.view === 'end' ? 'the story is over' : 'listen…') : 'open the menu to begin';
    actionsEl.append(hint);
  }
}

document.addEventListener('keydown', (e) => {
  if (menuOpen()) {
    if (e.key === 'Escape' && canCloseMenu()) closeMenu();
    return;
  }
  if (!resultsEl.hidden && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    return hideResults();
  }
  const t = e.target as HTMLElement | null;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  if (typing) {
    if (e.key === 'Escape') (t as HTMLInputElement).blur();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (touch) setLog(true);
    else cmdInput.focus();
    return;
  }
  if (e.key === 'Escape') return setLog(false);
  const key = eventKey(e);
  if (!key) return;
  const a = shownActions.find((x) => !x.disabled && keyFor(x, shownActions) === key);
  if (!a) return;
  e.preventDefault();
  trigger(a, buttonByKey.get(key));
});

// ---------------------------------------------------------------- hud

const hudEl = $('hud');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const chip = (text: string, cls = '') => `<span class="chip ${cls}">${text}</span>`;
const bar = (value: number, cls: string) => `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></span>`;

function memberChip(m: HudMember) {
  const av = `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(m.handle, m.avatar), m.classes, 2)}">`;
  const classes = m.classes.length ? ` <i>${esc(m.classes.join('+'))}</i>` : '';
  const points = lastScene?.scores?.find((s) => s.handle === m.handle)?.points;
  const pts = points !== undefined ? ` <b class="pts">${points}</b>` : '';
  const mark = m.host ? ' ★' : m.ready === true ? ' <em class="ok">ready</em>' : m.ready === false ? ' <em>choosing</em>' : '';
  return chip(`${av}${esc(m.handle)}${classes}${pts}${mark}`, m.you ? 'you' : '');
}

function renderHud(h: HudState) {
  if (h.mode === 'street') {
    const av = h.handle ? `<img class="av" alt="" src="${avatarDataUrl(avatarSeed(h.handle, h.avatar ?? 0), [], 2)}">` : '';
    hudEl.innerHTML = `<div class="row">${chip('NEO-AVALON', 'tag')}${h.handle ? chip(`${av}${esc(h.handle)}`, 'you') : ''}</div>`;
    return;
  }
  const party = h.party.map(memberChip).join('');
  if (h.mode === 'safehouse') {
    const resume = h.resume ? chip(`resume · chapter ${h.resume.chapter}`, 'prog') : '';
    hudEl.innerHTML = `<div class="row">${chip(`SAFEHOUSE ${esc(h.code)}`, 'tag')}${chip(esc(STORIES[h.story].title), 'prog')}${resume}${party}</div>`;
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

// ---------------------------------------------------------------- results: stars, scores, achievements

const resultsEl = $('results');
let recordedRun = '';

function stars(n: number) {
  return [0, 1, 2].map((i) => `<span class="star${i < n ? ' on' : ''}" style="animation-delay:${0.3 + i * 0.25}s">★</span>`).join('');
}

function showResults(r: RunResult) {
  const key = `${r.story}:${r.title}:${r.seconds}:${r.team}`;
  if (recordedRun === key) return;
  recordedRun = key;
  const fresh = Progress.record(r);
  const me = r.players.find((p) => p.you);
  const rows = [...r.players]
    .sort((a, b) => b.points - a.points)
    .map((p) => {
      const feats = [
        p.cleanWards && `${p.cleanWards} clean ward${p.cleanWards > 1 ? 's' : ''}`,
        p.brokenCharges && `${p.brokenCharges} charge${p.brokenCharges > 1 ? 's' : ''} broken`,
        p.pierced && `${p.pierced} shell${p.pierced > 1 ? 's' : ''} pierced`,
        p.doubles && `${p.doubles} double hit${p.doubles > 1 ? 's' : ''}`,
        p.goodCalls && `${p.goodCalls} good call${p.goodCalls > 1 ? 's' : ''}`,
        p.glyphs && `${p.glyphs} glyph${p.glyphs > 1 ? 's' : ''}`,
        p.persuasion && `${p.persuasion} persuasion`,
        p.idle && `caught flat-footed ×${p.idle}`,
      ].filter(Boolean);
      return `<tr class="${p.you ? 'you' : ''}"><td>${r.mvp === p.handle ? '🏅 ' : ''}${esc(p.handle)}</td><td class="num">${p.points}</td><td class="feats">${esc(feats.join(' · ') || '—')}</td></tr>`;
    })
    .join('');
  resultsEl.innerHTML = `
    <div class="panel">
      <h2 class="${r.win ? 'win' : 'lose'}">${esc(r.title)}</h2>
      <div class="stars">${stars(r.stars)}</div>
      <div class="totals"><span>team score <b>${r.team}</b></span>${me ? `<span>your points <b>${me.points}</b></span>` : ''}${r.mvp ? `<span>Warden’s pick <b>${esc(r.mvp)}</b></span>` : ''}</div>
      <table>${rows}</table>
      ${fresh.length ? `<div class="unlocked"><h3>achievements unlocked</h3>${fresh.map((a) => `<span class="ach on">${a.icon} ${esc(a.name)}</span>`).join('')}</div>` : ''}
      <p class="muted">${r.story === 'tutorial' ? 'You are ready for a real crew.' : r.win ? 'Stars come from how much of the meter you kept clear.' : 'The Warden keeps your points. Try again from the menu.'}</p>
      <button type="button" id="results-ok"><kbd>Enter</kbd> continue</button>
    </div>`;
  resultsEl.hidden = false;
  $('results-ok').onclick = hideResults;
  if (fresh.length) setTimeout(() => sound.play('achieve'), 1200);
}

function hideResults() {
  resultsEl.hidden = true;
}

// ---------------------------------------------------------------- the main menu

const menuEl = $('menu');
let panel: 'main' | 'join' | 'controls' | 'past' | 'achievements' = 'main';

const menuOpen = () => !menuEl.hidden;
const inRoom = () => lastHud?.mode === 'safehouse' || lastHud?.mode === 'delve';
const canCloseMenu = () => !!myHandle;

function goLandscape() {
  if (!touch) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(lock, () => {});
  else void lock();
}

function callsign(): string | undefined {
  const input = menuEl.querySelector<HTMLInputElement>('#callsign');
  const name = (input?.value ?? Progress.name).trim();
  if (!NAME_RE.test(name)) {
    input?.focus();
    menuEl.querySelector('.name-error')?.classList.add('show');
    return undefined;
  }
  Progress.name = name;
  return name;
}

/** Everything the menu does goes through here: it unlocks sound and makes sure we have a name. */
function menuAction(fn: () => void) {
  sound.unlock();
  sound.play('click');
  goLandscape();
  const name = callsign();
  if (!name) return;
  if (myHandle && myHandle !== name) {
    // a new callsign means a fresh connection
    pendingAfterConnect = fn;
    connect();
    send({ type: 'line', text: name });
    myHandle = name;
    closeMenu();
    return;
  }
  if (!myHandle) {
    send({ type: 'line', text: name });
    myHandle = name;
  } else if (inRoom()) run('leave');
  fn();
  closeMenu();
}
let pendingAfterConnect: (() => void) | undefined;

function renderMenu() {
  const cp = Progress.checkpoint;
  const unlocked = Progress.unlocked;
  const got = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
  const back = inRoom() ? `<button type="button" class="big" data-act="back"><span>▶</span> back to the ${lastHud?.mode === 'delve' ? 'story' : 'safehouse'}</button>` : '';
  let body = '';
  if (panel === 'main') {
    body = `
      <label class="field"><span>your callsign</span><input id="callsign" maxlength="16" autocomplete="off" spellcheck="false" value="${esc(Progress.name)}" placeholder="2-16 letters or numbers" /></label>
      <p class="name-error">Callsigns are 2-16 letters, numbers, - or _.</p>
      <div class="menu-buttons">
        ${back}
        ${cp ? `<button type="button" class="big go" data-act="resume"><span>⟲</span> continue <small>${esc(STORIES[cp.story].title)} · chapter ${cp.chapter}: ${esc(cp.title)}</small></button>` : ''}
        <button type="button" class="big ${cp ? '' : 'go'}" data-act="new"><span>✦</span> new story <small>open a safehouse and invite your crew</small></button>
        <button type="button" class="big" data-act="join"><span>⇥</span> join a crew <small>with a 4-letter code</small></button>
        <button type="button" class="big ${Progress.trained ? '' : 'hot'}" data-act="tutorial"><span>🎓</span> training ${Progress.trained ? '' : '<em>start here</em>'} <small>learn the controls solo, no timer</small></button>
        <div class="menu-row">
          <button type="button" data-act="controls">controls</button>
          <button type="button" data-act="past">past adventures</button>
          <button type="button" data-act="achievements">achievements ${got}/${ACHIEVEMENTS.length}</button>
        </div>
      </div>`;
  } else if (panel === 'join') {
    body = `
      <label class="field"><span>crew code</span><input id="code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD" style="text-transform:uppercase" /></label>
      <div class="menu-buttons"><button type="button" class="big go" data-act="join-go"><span>⇥</span> join</button><button type="button" data-act="main">back</button></div>`;
  } else if (panel === 'controls') {
    body = `
      <table class="controls">${CONTROLS.map((c) => `<tr><td><kbd>${esc(c.keys)}</kbd></td><td>${esc(c.what)}</td></tr>`).join('')}</table>
      <p class="muted">${touch ? 'On a phone, tap the round buttons on the right: they carry the same letters. Tap 💬 chat to open the log and its keyboard.' : 'On a phone, the same letters appear on round buttons beside the screen.'}</p>
      <p class="muted">Each round has a timer. When it runs out the monster moves, and anyone who hasn’t chosen leaves the crew open: extra damage, and the Warden docks points.</p>
      <div class="menu-buttons"><button type="button" data-act="main">back</button></div>`;
  } else if (panel === 'past') {
    const runs = Progress.runs;
    body = `
      ${runs.length ? `<table class="past">${runs.slice(0, 12).map((r) => `<tr><td>${new Date(r.at).toLocaleDateString()}</td><td>${esc(STORIES[r.story].title)}</td><td class="${r.win ? 'win' : 'lose'}">${esc(r.title)}</td><td class="stars-sm">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</td><td class="num">${r.points}</td></tr>`).join('')}</table>` : '<p class="muted">No adventures yet. Your finished stories will be listed here.</p>'}
      <p class="muted">Best: ${Math.max(0, ...runs.map((r) => r.points))} points · ${runs.reduce((s, r) => s + r.stars, 0)} stars in total. A global ranking is coming once accounts exist.</p>
      <div class="menu-buttons"><button type="button" data-act="main">back</button></div>`;
  } else {
    body = `
      <div class="achievements">${ACHIEVEMENTS.map((a: Achievement) => `<div class="ach ${unlocked[a.id] ? 'on' : ''}"><span class="icon">${a.icon}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`).join('')}</div>
      <div class="menu-buttons"><button type="button" data-act="main">back</button></div>`;
  }
  menuEl.innerHTML = `<div class="menu-card"><h1>LAST LIGHT</h1><p class="tagline">a co-op story for 2-4 players · beneath Neo-Avalon an ancient wyrm is waking</p>${body}</div>`;
  const code = menuEl.querySelector<HTMLInputElement>('#code');
  code?.focus();
  menuEl.querySelector<HTMLInputElement>('#callsign')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') menuEl.querySelector<HTMLButtonElement>('button.go')?.click();
  });
  code?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') menuEl.querySelector<HTMLButtonElement>('[data-act="join-go"]')?.click();
  });
}

menuEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act!;
  sound.unlock();
  switch (act) {
    case 'back':
      sound.play('click');
      return closeMenu();
    case 'new':
      return menuAction(() => run('create'));
    case 'tutorial':
      return menuAction(() => run('tutorial'));
    case 'resume': {
      const cp = Progress.checkpoint;
      if (cp) menuAction(() => send({ type: 'resume', checkpoint: cp }));
      return;
    }
    case 'join-go': {
      const code = (menuEl.querySelector<HTMLInputElement>('#code')?.value ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return;
      panel = 'main';
      return menuAction(() => run(`join ${code}`));
    }
    case 'join':
      if (!callsign()) return;
      sound.play('click');
      panel = 'join';
      return renderMenu();
    default:
      sound.play('click');
      panel = act as typeof panel;
      return renderMenu();
  }
});

function openMenu() {
  panel = 'main';
  renderMenu();
  menuEl.hidden = false;
  document.body.classList.add('menu-open');
  sound.setMood('lobby');
}

function closeMenu() {
  menuEl.hidden = true;
  document.body.classList.remove('menu-open');
  if (lastScene) sound.setMood(lastScene.music);
}

$('menu-btn').onclick = () => {
  sound.play('click');
  openMenu();
};

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
      if (msg.hud.mode === 'street' && msg.hud.handle) myHandle = msg.hud.handle;
      if (msg.hud.mode !== 'delve') {
        lastScene = undefined;
        lastActions = [];
        stage.classList.remove('fight');
        hideResults();
        scene.setLobby(
          msg.hud.mode === 'street'
            ? { title: 'LAST LIGHT', subtitle: 'create a safehouse, or join your crew', ...(msg.hud.handle ? { crew: [{ handle: msg.hud.handle, avatar: msg.hud.avatar ?? 0, you: true }] } : {}) }
            : { title: `SAFEHOUSE ${msg.hud.code}`, subtitle: `${STORIES[msg.hud.story].title}: ${msg.hud.resume ? `resuming at chapter ${msg.hud.resume.chapter}` : STORIES[msg.hud.story].pitch}`, crew: msg.hud.party.map((m) => ({ handle: m.handle, avatar: m.avatar, host: m.host, you: m.you })) },
        );
        renderActions();
        if (!menuOpen()) sound.setMood('lobby');
      }
      break;
    case 'scene':
      lastScene = msg.scene;
      (window as unknown as { __scene?: SceneState }).__scene = msg.scene; // for automated playtests
      lastActions = msg.actions;
      scene.setScene(msg.scene);
      stage.classList.toggle('fight', msg.scene.view === 'combat' || msg.scene.view === 'boss');
      if (!menuOpen()) sound.setMood(msg.scene.music);
      if (lastHud) renderHud(lastHud);
      renderActions();
      if (msg.scene.result) setTimeout(() => showResults(msg.scene.result!), 2600);
      break;
    case 'fx': {
      // a new chapter starts a fresh page: drop lines left over from the last one
      if (msg.fx.kind === 'title') gameConsole.clear();
      scene.playFx(msg.fx);
      const sfx = fxSound(msg.fx);
      if (sfx) sound.play(sfx);
      break;
    }
    case 'checkpoint':
      Progress.checkpoint = msg.checkpoint as Checkpoint | null;
      break;
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

const outbox: string[] = [];
function send(msg: ClientMessage) {
  const data = JSON.stringify(msg);
  if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  else if (ws?.readyState === WebSocket.CONNECTING) outbox.push(data);
  else gameConsole.push({ kind: 'notice', text: 'Offline. Refresh the page to reconnect.', tone: 'bad' });
}

function connect() {
  ws?.close();
  outbox.length = 0;
  lastHud = undefined;
  lastScene = undefined;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    for (const m of outbox.splice(0)) sock.send(m);
    const next = pendingAfterConnect;
    pendingAfterConnect = undefined;
    next?.();
  };
  sock.onmessage = (ev) => apply(JSON.parse(String(ev.data)) as ServerMessage);
  sock.onclose = () => {
    if (ws !== sock) return;
    prompt = '';
    gameConsole.push({ kind: 'notice', text: 'Connection lost. Refresh to reconnect.', tone: 'bad' });
  };
}

renderActions();
sound.setMood('lobby');
connect();
openMenu();
if (!touch) menuEl.querySelector<HTMLInputElement>('#callsign')?.focus();
