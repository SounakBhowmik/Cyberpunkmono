import { randomInt } from 'node:crypto';
import { BANNER, c } from './ansi.js';
import { Game, type GamePlayer } from './game/game.js';
import type { WardenBrain } from './game/ice.js';

/** A connected terminal, independent of transport (WebSocket today, SSH later). */
export interface Session {
  readonly id: string;
  send(text: string): void;
  setPrompt(text: string): void;
  clear(): void;
  close(): void;
}

type PlayerState = 'naming' | 'lobby' | 'room';

class Player implements GamePlayer {
  handle = '';
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
}

interface Room {
  code: string;
  host: Player;
  players: Player[];
  game?: Game;
}

export const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HANDLE_RE = /^[A-Za-z0-9_-]{2,16}$/;

export interface HubOptions {
  warden: WardenBrain;
  minPlayers?: number;
  tickMs?: number;
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
    p.send(
      [
        BANNER,
        c.dim('  a co-op heist for 2-4 netrunners · one corp · one very insecure AI'),
        '',
        'pick a handle, choom.',
      ].join('\n'),
    );
    p.setPrompt(c.cyan('handle> '));
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

  // ---------------------------------------------------------------- lobby

  private pickHandle(p: Player, text: string) {
    if (!HANDLE_RE.test(text)) return p.send(c.dim('2-16 characters: letters, numbers, - or _'));
    p.handle = text;
    p.state = 'lobby';
    p.send(`welcome to the net, ${c.bold(text)}.\n${this.lobbyHelp()}`);
    p.setPrompt(`${c.magenta(p.handle)}> `);
  }

  private lobbyHelp() {
    return [
      `  ${c.cyan('create'.padEnd(12))}${c.dim('open a safehouse and get a room code')}`,
      `  ${c.cyan('join <code>'.padEnd(12))}${c.dim('join your crew')}`,
    ].join('\n');
  }

  private lobbyCommand(p: Player, cmd: string, rest: string[]) {
    switch (cmd) {
      case 'create':
        return this.createRoom(p);
      case 'join':
        return this.joinRoom(p, (rest[0] ?? '').toUpperCase());
      case 'help':
        return p.send(this.lobbyHelp());
      default:
        return p.send(c.dim(`unknown command. ${this.lobbyHelp().trimStart()}`));
    }
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  private createRoom(p: Player) {
    const room: Room = { code: this.newCode(), host: p, players: [] };
    this.rooms.set(room.code, room);
    this.enterRoom(p, room);
    p.send(`safehouse ${c.bold(c.yellow(room.code))} is open. send the code to your crew. they join with: join ${room.code}`);
  }

  private joinRoom(p: Player, code: string) {
    const room = this.rooms.get(code);
    if (!code) return p.send(c.dim('usage: join <code>'));
    if (!room) return p.send(c.red(`no safehouse called ${code}.`));
    if (room.game) return p.send(c.red(`${code} is mid-heist. wait for them to finish.`));
    if (room.players.length >= MAX_PLAYERS) return p.send(c.red(`${code} is full (${MAX_PLAYERS} max).`));
    if (room.players.some((q) => q.handle.toLowerCase() === p.handle.toLowerCase())) {
      return p.send(c.red(`someone in ${code} already goes by ${p.handle}. reconnect with another handle.`));
    }
    this.enterRoom(p, room);
  }

  private enterRoom(p: Player, room: Room) {
    room.players.push(p);
    p.room = room;
    p.state = 'room';
    this.toRoom(room, c.magenta(`>> ${p.handle} entered the safehouse (${room.players.length}/${MAX_PLAYERS})`));
    p.send(this.roomHelp(room, p));
    p.setPrompt(this.roomPrompt(p));
  }

  // ---------------------------------------------------------------- room

  private roomPrompt(p: Player) {
    return `${c.magenta(p.handle)}@${c.yellow(p.room?.code ?? '')}> `;
  }

  private roomHelp(room: Room, p: Player) {
    const lines = [
      `  ${c.cyan('say <msg>'.padEnd(12))}${c.dim('chat with the crew')}`,
      `  ${c.cyan('who'.padEnd(12))}${c.dim('who is here')}`,
      `  ${c.cyan('leave'.padEnd(12))}${c.dim('back to the lobby')}`,
    ];
    if (room.host === p) lines.unshift(`  ${c.cyan('start'.padEnd(12))}${c.dim(`begin the heist (needs ${this.minPlayers}+ players)`)}`);
    return lines.join('\n');
  }

  private roomCommand(p: Player, cmd: string, text: string, rest: string[]) {
    const room = p.room!;
    if (text.startsWith("'") || text.startsWith('"')) return this.toRoom(room, `${c.magenta(`[${p.handle}]`)} ${text.slice(1).trim()}`);
    switch (cmd) {
      case 'say':
        return rest.length ? this.toRoom(room, `${c.magenta(`[${p.handle}]`)} ${rest.join(' ')}`) : undefined;
      case 'who':
        return p.send(room.players.map((q) => `  ${q.handle}${q === room.host ? c.dim(' (host)') : ''}`).join('\n'));
      case 'leave':
        return this.leaveRoom(p);
      case 'start':
        return this.startGame(p, room);
      case 'help':
        return p.send(this.roomHelp(room, p));
      default:
        return p.send(c.dim(`unknown command. type help.`));
    }
  }

  private startGame(p: Player, room: Room) {
    if (room.host !== p) return p.send(c.dim(`only the host (${room.host.handle}) can start.`));
    if (room.players.length < this.minPlayers) {
      return p.send(c.red(`you need at least ${this.minPlayers} netrunners. share the code: ${room.code}`));
    }
    this.toRoom(room, c.cyan('\n>> jacking in...'));
    room.game = new Game(room.players, {
      warden: this.opts.warden,
      tickMs: this.opts.tickMs,
      onEnd: () => {
        room.game = undefined;
        for (const q of room.players) q.setPrompt(this.roomPrompt(q));
        this.toRoom(room, c.dim(`back in the safehouse. ${room.host.handle} can start another job.`));
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
      this.toRoom(room, c.magenta(`>> ${p.handle} ${disconnected ? 'lost connection' : 'left'}. host is ${room.host.handle}.`));
      if (room.game && room.players.length < this.minPlayers) {
        this.toRoom(room, c.dim('(not enough crew left to finish properly, but you can try.)'));
      }
    }

    if (!disconnected) {
      p.state = 'lobby';
      p.send(`back on the street.\n${this.lobbyHelp()}`);
      p.setPrompt(`${c.magenta(p.handle)}> `);
    }
  }

  private toRoom(room: Room, text: string) {
    for (const q of room.players) q.send(text);
  }
}
