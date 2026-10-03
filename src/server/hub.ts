import { randomInt } from 'node:crypto';
import type { ActionButton, FeedItem, Fx, HudState, ModeId, SceneState } from '../shared/protocol.js';
import { c } from './ansi.js';
import { Game, type GamePlayer } from './game/game.js';
import type { Narrator } from './game/narrator.js';
import type { ParleyJudge } from './game/parley.js';
import { STORIES } from './game/story.js';

/** A connected client, independent of transport. */
export interface Session {
  readonly id: string;
  send(text: string): void;
  setPrompt(text: string): void;
  hud(hud: HudState): void;
  scene(scene: SceneState, actions: ActionButton[]): void;
  feed(item: FeedItem): void;
  fx(fx: Fx): void;
  clear(): void;
  close(): void;
}

type PlayerState = 'naming' | 'lobby' | 'room';

class Player implements GamePlayer {
  handle = '';
  avatar = 0;
  state: PlayerState = 'naming';
  room?: Room;

  constructor(readonly session: Session) {}

  get id() {
    return this.session.id;
  }
  send(text: string) {
    this.session.send(text);
  }
  setPrompt(text: string) {
    this.session.setPrompt(text);
  }
  setHud(hud: HudState) {
    this.session.hud(hud);
  }
  setScene(scene: SceneState, actions: ActionButton[]) {
    this.session.scene(scene, actions);
  }
  feed(item: FeedItem) {
    this.session.feed(item);
  }
  fx(fx: Fx) {
    this.session.fx(fx);
  }
  get member() {
    return { handle: this.handle, avatar: this.avatar, classes: [] };
  }
}

interface Room {
  code: string;
  host: Player;
  players: Player[];
  story: ModeId;
  game?: Game;
}

export const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HANDLE_RE = /^[A-Za-z0-9_-]{2,16}$/;
const MODES = Object.keys(STORIES) as ModeId[];

export interface HubOptions {
  judge: ParleyJudge;
  narrator?: Narrator;
  minPlayers?: number;
  roundMs?: number;
  voteMs?: number;
}

export class Hub {
  private readonly rooms = new Map<string, Room>();
  private readonly players = new Map<string, Player>();

  constructor(private readonly opts: HubOptions) {}

  get minPlayers() {
    return this.opts.minPlayers ?? 2;
  }

  connect(session: Session) {
    const p = new Player(session);
    this.players.set(session.id, p);
    p.send(c.bold(c.yellow('LAST LIGHT')) + c.dim(' · a co-op story for 2-4 players · type help for commands'));
    p.feed({ kind: 'story', speaker: '', text: 'Beneath the neon city of Neo-Avalon, something ancient is waking.', portrait: { type: 'narrator' } });
    p.feed({ kind: 'story', speaker: '', text: 'A few small spirits of the net stand in its way. You are one of them.', portrait: { type: 'narrator' } });
    p.feed({ kind: 'tip', text: 'Type a name below to begin.' });
    p.setPrompt(c.cyan('name> '));
  }

  disconnect(sessionId: string) {
    const p = this.players.get(sessionId);
    if (!p) return;
    this.leaveRoom(p, true);
    this.players.delete(sessionId);
  }

  handleLine(sessionId: string, line: string) {
    const p = this.players.get(sessionId);
    if (!p) return;
    const text = line.trim();
    if (p.state === 'naming') return this.pickHandle(p, text);
    const [head = '', ...rest] = text.split(/\s+/);
    const cmd = head.toLowerCase();
    if (cmd === 'clear') return p.session.clear();
    if (p.state === 'room' && p.room?.game) {
      if (cmd === 'leave') return this.leaveRoom(p);
      return p.room.game.handle(p.id, text);
    }
    if (!text) return;
    if (p.state === 'lobby') return this.lobbyCommand(p, cmd, rest);
    return this.roomCommand(p, cmd, text, rest);
  }

  // ---------------------------------------------------------------- street

  private pickHandle(p: Player, text: string) {
    if (!HANDLE_RE.test(text)) return p.feed({ kind: 'tip', text: 'Names are 2-16 letters, numbers, - or _.' });
    p.handle = text;
    p.state = 'lobby';
    p.feed({ kind: 'tip', text: `Welcome, ${text}. Create a safehouse for your crew, or join one with its code.` });
    p.send(`welcome, ${c.bold(text)}. commands: create · join <code> · reroll`);
    p.setPrompt(`${c.magenta(p.handle)}> `);
    p.setHud({ mode: 'street', handle: p.handle, avatar: p.avatar });
  }

  private reroll(p: Player) {
    p.avatar++;
    if (p.room) this.pushSafehouseHud(p.room);
    else p.setHud({ mode: 'street', handle: p.handle, avatar: p.avatar });
  }

  private pushSafehouseHud(room: Room) {
    for (const q of room.players) {
      q.setHud({
        mode: 'safehouse',
        code: room.code,
        story: room.story,
        party: room.players.map((r) => ({ handle: r.handle, avatar: r.avatar, classes: [], you: r === q, host: r === room.host })),
      });
    }
  }

  private lobbyCommand(p: Player, cmd: string, rest: string[]) {
    switch (cmd) {
      case 'create':
        return this.createRoom(p);
      case 'join':
        return this.joinRoom(p, (rest[0] ?? '').toUpperCase());
      case 'reroll':
        return this.reroll(p);
      default:
        return p.feed({ kind: 'tip', text: 'Create a safehouse, or join one with its 4-letter code.' });
    }
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  private createRoom(p: Player) {
    const room: Room = { code: this.newCode(), host: p, players: [], story: 'adventure' };
    this.rooms.set(room.code, room);
    this.enterRoom(p, room);
    p.send(`safehouse ${c.bold(c.yellow(room.code))} is open. your crew joins with: join ${room.code}`);
    p.feed({ kind: 'tip', text: `Your safehouse code is ${room.code}. Send it to your crew, pick a story, then begin.` });
  }

  private joinRoom(p: Player, code: string) {
    const room = this.rooms.get(code);
    const no = (text: string) => p.feed({ kind: 'notice', text, tone: 'bad' });
    if (!code) return p.feed({ kind: 'tip', text: 'Type join and the 4-letter code.' });
    if (!room) return no(`No safehouse called ${code}.`);
    if (room.game) return no(`${code} is mid-story. Wait for them to finish.`);
    if (room.players.length >= MAX_PLAYERS) return no(`${code} is full.`);
    if (room.players.some((q) => q.handle.toLowerCase() === p.handle.toLowerCase())) return no(`Someone in ${code} already goes by ${p.handle}.`);
    this.enterRoom(p, room);
  }

  // ---------------------------------------------------------------- safehouse

  private enterRoom(p: Player, room: Room) {
    room.players.push(p);
    p.room = room;
    p.state = 'room';
    this.toRoom(room, { kind: 'notice', text: `${p.handle} entered the safehouse (${room.players.length}/${MAX_PLAYERS})`, tone: 'info' });
    p.setPrompt(`${c.magenta(p.handle)}@${c.yellow(room.code)}> `);
    this.pushSafehouseHud(room);
  }

  private roomCommand(p: Player, cmd: string, text: string, rest: string[]) {
    const room = p.room!;
    switch (cmd) {
      case 'leave':
        return this.leaveRoom(p);
      case 'start':
        return this.startGame(p, room);
      case 'reroll':
        return this.reroll(p);
      case 'mode':
      case 'story':
        return this.setStory(p, room, (rest[0] ?? '').toLowerCase());
      case 'say':
        return this.chat(room, p, rest.join(' '));
      default:
        return this.chat(room, p, text.replace(/^'/, ''));
    }
  }

  private chat(room: Room, p: Player, text: string) {
    if (!text.trim()) return;
    this.toRoom(room, { kind: 'chat', from: p.member, text: text.trim() });
    for (const q of room.players) q.send(`${c.magenta(`[${p.handle}]`)} ${text.trim()}`);
  }

  private setStory(p: Player, room: Room, mode: string) {
    if (room.host !== p) return p.feed({ kind: 'tip', text: `Only the host (${room.host.handle}) picks the story.` });
    const m = MODES.find((x) => x === mode);
    if (!m) return p.feed({ kind: 'tip', text: `Stories: ${MODES.join(', ')}` });
    room.story = m;
    this.toRoom(room, { kind: 'notice', text: `Story: ${STORIES[m].title} — ${STORIES[m].pitch}`, tone: 'info' });
    this.pushSafehouseHud(room);
  }

  private startGame(p: Player, room: Room) {
    if (room.host !== p) return p.feed({ kind: 'tip', text: `Only the host (${room.host.handle}) can begin.` });
    if (room.players.length < this.minPlayers) return p.feed({ kind: 'tip', text: `You need at least ${this.minPlayers} players. Share the code: ${room.code}` });
    room.game = new Game(room.players, {
      judge: this.opts.judge,
      story: room.story,
      code: room.code,
      ...(this.opts.narrator ? { narrator: this.opts.narrator } : {}),
      ...(this.opts.roundMs !== undefined ? { roundMs: this.opts.roundMs } : {}),
      ...(this.opts.voteMs !== undefined ? { voteMs: this.opts.voteMs } : {}),
      onEnd: () => {
        room.game = undefined;
        for (const q of room.players) q.setPrompt(`${c.magenta(q.handle)}@${c.yellow(room.code)}> `);
        setTimeout(() => {
          if (room.game) return;
          this.toRoom(room, { kind: 'tip', text: `Back in the safehouse. ${room.host.handle} can begin another story.` });
          this.pushSafehouseHud(room);
        }, 9000);
      },
    });
  }

  private leaveRoom(p: Player, disconnected = false) {
    const room = p.room;
    if (!room) return;
    room.players = room.players.filter((q) => q !== p);
    room.game?.removePlayer(p.id);
    p.room = undefined;
    if (room.players.length === 0) {
      room.game?.dispose();
      this.rooms.delete(room.code);
    } else {
      if (room.host === p) room.host = room.players[0]!;
      this.toRoom(room, { kind: 'notice', text: `${p.handle} ${disconnected ? 'lost connection' : 'left'}. ${room.host.handle} is host.`, tone: 'info' });
      if (!room.game) this.pushSafehouseHud(room);
    }
    if (!disconnected) {
      p.state = 'lobby';
      p.setPrompt(`${c.magenta(p.handle)}> `);
      p.setHud({ mode: 'street', handle: p.handle, avatar: p.avatar });
    }
  }

  private toRoom(room: Room, item: FeedItem) {
    for (const q of room.players) q.feed(item);
  }
}
