import { randomInt } from 'node:crypto';
import type { ActionButton, AvailableRoom, Checkpoint, ClassId, FeedItem, Fx, HudState, ModeId, SceneState } from '../shared/protocol.js';
import { ITEMS } from '../shared/items.js';
import { c } from './ansi.js';
import { Game, type GamePlayer } from './game/game.js';
import type { Narrator } from './game/narrator.js';
import type { ParleyJudge } from './game/parley.js';
import { CREW_STORIES, SOLO_STORIES, STORIES } from './game/story.js';

/** A connected client, independent of transport. */
export interface Session {
  readonly id: string;
  send(text: string): void;
  setPrompt(text: string): void;
  hud(hud: HudState): void;
  scene(scene: SceneState, actions: ActionButton[]): void;
  feed(item: FeedItem): void;
  fx(fx: Fx): void;
  checkpoint(cp: Checkpoint | null): void;
  clear(): void;
  close(): void;
}

type PlayerState = 'naming' | 'lobby' | 'room';

class Player implements GamePlayer {
  handle = '';
  avatar = 0;
  rerolled = false;
  state: PlayerState = 'naming';
  room?: Room;
  inventory: string[] = [];
  bot = false;

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
  checkpoint(cp: Checkpoint | null) {
    this.session.checkpoint(cp);
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
  /** A saved chapter the next story starts from. */
  checkpoint?: Checkpoint;
  /** The solo tutorial: nobody else can join. */
  practice?: boolean;
  solo?: { role: ClassId; difficulty: Difficulty };
}

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTY: Record<Difficulty, { bot: number; foe: number }> = {
  easy: { bot: 0.65, foe: 0.85 },
  medium: { bot: 0.8, foe: 1 },
  hard: { bot: 0.95, foe: 1.18 },
};

/** A normal GamePlayer driven through the same commands as a human. */
class BotSession implements Session {
  private key = '';
  constructor(readonly id: string, readonly role: ClassId, private readonly efficiency: number, private readonly game: () => Game | undefined) {}
  send() {}
  setPrompt() {}
  hud() {}
  feed() {}
  fx() {}
  checkpoint() {}
  clear() {}
  close() {}

  scene(scene: SceneState, actions: ActionButton[]) {
    const votes = scene.choice?.options.reduce((sum, option) => sum + option.votes.length, 0) ?? 0;
    const key = `${scene.view}:${scene.chapter.index}:${scene.foe?.name ?? ''}:${scene.choice?.prompt ?? ''}:${scene.round ?? 0}:${scene.puzzle?.progress ?? 0}:${scene.parley?.linesLeft ?? 0}:${votes}:${actions.filter((a) => !a.disabled).map((a) => a.cmd).join(',')}`;
    if (key === this.key || scene.view === 'end') return;
    this.key = key;
    const delay = scene.choice ? 900 : 350 + Math.floor(Math.random() * 400);
    setTimeout(() => this.act(scene), delay);
  }

  private act(scene: SceneState) {
    const game = this.game();
    if (!game || game.phase === 'ended') return;
    if (scene.waitingForReady) return void game.handle(this.id, 'ready');
    const smart = Math.random() < this.efficiency;
    if (game.phase === 'choice') {
      const options = scene.choice?.options ?? [];
      const led = options.map((o, i) => ({ i, n: o.votes.length })).sort((a, b) => b.n - a.n)[0];
      if (!led?.n) return; // the human leads side-quest decisions
      return game.handle(this.id, `vote ${smart ? led.i + 1 : 1 + Math.floor(Math.random() * options.length)}`);
    }
    if (game.phase === 'puzzle') {
      if (this.role === 'cleric') return;
      const puzzle = game.puzzle;
      if (!puzzle) return;
      const right = puzzle.sequence[puzzle.progress]!;
      const glyph = smart ? right : ['moon', 'eye', 'serpent', 'crown', 'key'][Math.floor(Math.random() * 5)]!;
      return game.handle(this.id, `${this.role === 'mage' ? 'show' : 'glyph'} ${glyph}`);
    }
    if (game.phase === 'parley') return void game.handle(this.id, smart ? 'speak We will protect the city and everyone in it.' : 'speak Give us what we want.');
    if (game.phase !== 'combat' && game.phase !== 'boss') return;
    const intent = scene.foe?.intent?.kind;
    if (this.role === 'mage' && intent) game.handle(this.id, `call ${intent === 'heavy' ? 'attack' : intent}`);
    const random = (moves: string[]) => moves[Math.floor(Math.random() * moves.length)]!;
    let move: string;
    if (!smart) move = random(this.role === 'rogue' ? ['strike', 'fury'] : this.role === 'mage' ? ['hex', 'bolt'] : ['ward', 'mend']);
    else if (this.role === 'rogue') move = scene.foe?.exposed || scene.foe?.called?.label.includes('HEXING') ? 'fury' : 'strike';
    else if (this.role === 'mage') move = intent === 'shell' ? 'bolt' : 'hex';
    else move = (intent === 'attack' || intent === 'heavy') && game.wardsRemaining > 0 ? 'ward' : 'mend';
    if (move === 'ward' && game.wardsRemaining === 0) move = 'mend';
    game.handle(this.id, move);
  }
}

export const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HANDLE_RE = /^[A-Za-z0-9_-]{2,16}$/;
const MODES = CREW_STORIES;

export interface HubOptions {
  judge: ParleyJudge;
  narrator?: Narrator;
  minPlayers?: number;
  roundMs?: number;
  voteMs?: number;
  /** How long the ending stays up before the crew is back in the safehouse. */
  returnMs?: number;
}

export class Hub {
  private readonly rooms = new Map<string, Room>();
  private readonly players = new Map<string, Player>();

  constructor(private readonly opts: HubOptions) {}

  /** Real stories need a crew of at least two; only the tutorial is solo. */
  get minPlayers() {
    return Math.max(1, this.opts.minPlayers ?? 2);
  }

  connect(session: Session) {
    const p = new Player(session);
    this.players.set(session.id, p);
    p.send(c.bold(c.yellow('LAST LIGHT')) + c.dim(' · a story adventure · solo or crew · type help for commands'));
    p.feed({ kind: 'story', speaker: '', text: 'Beneath the neon city of Neo-Avalon, something ancient is waking.', portrait: { type: 'narrator' } });
    p.feed({ kind: 'story', speaker: '', text: 'A few small spirits of the net stand in its way. You are one of them.', portrait: { type: 'narrator' } });
    p.feed({ kind: 'tip', text: 'Type a name below to begin.' });
    p.setPrompt(c.cyan('name> '));
  }

  identify(sessionId: string, name: string, inventory: unknown) {
    const p = this.players.get(sessionId);
    if (!p || p.state !== 'naming') return;
    p.inventory = Array.isArray(inventory) ? inventory.filter((id): id is string => typeof id === 'string' && ITEMS.some((item) => item.id === id)).slice(0, ITEMS.length) : [];
    this.pickHandle(p, name);
  }

  updateInventory(sessionId: string, inventory: unknown) {
    const p = this.players.get(sessionId);
    if (!p || !Array.isArray(inventory)) return;
    p.inventory = inventory.filter((id): id is string => typeof id === 'string' && ITEMS.some((item) => item.id === id)).slice(0, ITEMS.length);
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
    this.pushStreetHud(p);
  }

  private availableRooms(): AvailableRoom[] {
    return [...this.rooms.values()]
      .filter((room) => !room.practice && !room.solo && !room.game && room.players.length < MAX_PLAYERS)
      .map((room) => ({ code: room.code, host: room.host.handle, players: room.players.length, max: MAX_PLAYERS, story: room.story }));
  }

  private pushStreetHud(p: Player) {
    p.setHud({ mode: 'street', handle: p.handle, avatar: p.avatar, rooms: this.availableRooms() });
  }

  private refreshLobbyRooms() {
    for (const p of this.players.values()) if (p.state === 'lobby') this.pushStreetHud(p);
  }

  private reroll(p: Player) {
    if (p.rerolled) return p.feed({ kind: 'tip', text: 'Your one identity reroll has already been used.' });
    p.rerolled = true;
    p.avatar++;
    if (p.room) this.pushSafehouseHud(p.room);
    else this.pushStreetHud(p);
  }

  private pushSafehouseHud(room: Room) {
    for (const q of room.players) {
      q.setHud({
        mode: 'safehouse',
        code: room.code,
        story: room.story,
        party: room.players.map((r) => ({ handle: r.handle, avatar: r.avatar, classes: [], you: r === q, host: r === room.host })),
        ...(room.checkpoint ? { resume: { chapter: room.checkpoint.chapter, title: room.checkpoint.title } } : {}),
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
      case 'tutorial':
      case 'train':
        return this.startTutorial(p);
      case 'solo':
        return this.startSolo(p, rest[0], rest[1], rest[2]);
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
    this.refreshLobbyRooms();
  }

  private joinRoom(p: Player, code: string) {
    const room = this.rooms.get(code);
    const no = (text: string) => p.feed({ kind: 'notice', text, tone: 'bad' });
    if (!code) return p.feed({ kind: 'tip', text: 'Type join and the 4-letter code.' });
    if (!room) return no(`No safehouse called ${code}.`);
    if (room.practice) return no(`No safehouse called ${code}.`);
    if (room.game) return no(`${code} is mid-story. Wait for them to finish.`);
    if (room.players.length >= MAX_PLAYERS) return no(`${code} is full.`);
    if (room.players.some((q) => q.handle.toLowerCase() === p.handle.toLowerCase())) return no(`Someone in ${code} already goes by ${p.handle}.`);
    this.enterRoom(p, room);
    this.refreshLobbyRooms();
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
    room.checkpoint = undefined;
    this.toRoom(room, { kind: 'notice', text: `Story: ${STORIES[m].title} — ${STORIES[m].pitch}`, tone: 'info' });
    this.pushSafehouseHud(room);
    this.refreshLobbyRooms();
  }

  /** Start a story from a saved chapter: opens a safehouse the crew can join. */
  resume(sessionId: string, cp: unknown) {
    const p = this.players.get(sessionId);
    if (!p || p.state !== 'lobby') return p?.feed({ kind: 'tip', text: 'Leave your current safehouse first.' });
    if (!Game.validCheckpoint(cp)) return p.feed({ kind: 'notice', text: 'That save could not be read. Start a new story instead.', tone: 'bad' });
    const room: Room = { code: this.newCode(), host: p, players: [], story: cp.story, checkpoint: cp };
    this.rooms.set(room.code, room);
    this.enterRoom(p, room);
    const others = cp.crew.filter((h) => h.toLowerCase() !== p.handle.toLowerCase());
    p.feed({ kind: 'tip', text: `Resuming ${STORIES[cp.story].title} at chapter ${cp.chapter}. Your safehouse code is ${room.code}${others.length ? `: send it to ${others.join(', ')}` : ''}, then begin.` });
    this.refreshLobbyRooms();
  }

  private startTutorial(p: Player) {
    const room: Room = { code: this.newCode(), host: p, players: [], story: 'tutorial', practice: true };
    this.rooms.set(room.code, room);
    room.players.push(p);
    p.room = room;
    p.state = 'room';
    this.launch(room);
  }

  private startSolo(p: Player, roleName?: string, difficultyName?: string, storyName?: string) {
    const role = (['rogue', 'mage', 'cleric'] as ClassId[]).find((x) => x === roleName);
    const difficulty = (['easy', 'medium', 'hard'] as Difficulty[]).find((x) => x === difficultyName);
    const story = SOLO_STORIES.find((x) => x === storyName);
    if (!role || !difficulty || !story) return p.feed({ kind: 'tip', text: 'Choose a role, difficulty, and story for your side quest.' });
    const room: Room = { code: this.newCode(), host: p, players: [], story, solo: { role, difficulty } };
    this.rooms.set(room.code, room);
    p.room = room;
    p.state = 'room';
    room.players.push(p);
    const botNames: Record<ClassId, string[]> = { rogue: ['roughmat', 'bumpyball'], mage: ['glossykey', 'smoothrock'], cleric: ['fuzzyhat', 'softmug'] };
    for (const botRole of (['rogue', 'mage', 'cleric'] as ClassId[]).filter((x) => x !== role)) {
      const id = `bot-${room.code}-${botRole}`;
      const bot = new Player(new BotSession(id, botRole, DIFFICULTY[difficulty].bot, () => room.game));
      bot.handle = botNames[botRole].find((name) => name !== p.handle) ?? botNames[botRole][0]!;
      bot.avatar = botRole === 'rogue' ? 2 : botRole === 'mage' ? 3 : 4;
      bot.state = 'room';
      bot.room = room;
      bot.bot = true;
      room.players.push(bot);
    }
    this.launch(room);
    this.refreshLobbyRooms();
  }

  private startGame(p: Player, room: Room) {
    if (room.host !== p) return p.feed({ kind: 'tip', text: `Only the host (${room.host.handle}) can begin.` });
    if (room.players.length < this.minPlayers) return p.feed({ kind: 'tip', text: `You need at least ${this.minPlayers} Joes. Share the code: ${room.code}` });
    this.launch(room);
  }

  private launch(room: Room) {
    const checkpoint = room.checkpoint;
    room.checkpoint = undefined;
    const classes = room.solo
      ? Object.fromEntries(room.players.map((p) => [p.id, [p.bot ? (p.session as BotSession).role : room.solo!.role]])) as Record<string, ClassId[]>
      : undefined;
    room.game = new Game(room.players, {
      judge: this.opts.judge,
      story: room.story,
      code: room.code,
      ...(checkpoint ? { checkpoint } : {}),
      ...(this.opts.narrator ? { narrator: this.opts.narrator } : {}),
      ...(this.opts.roundMs !== undefined ? { roundMs: this.opts.roundMs } : {}),
      ...(this.opts.voteMs !== undefined ? { voteMs: this.opts.voteMs } : {}),
      ...(classes ? { classes } : {}),
      inventory: Object.fromEntries(room.players.map((p) => [p.id, p.inventory])),
      ...(room.solo ? { difficulty: DIFFICULTY[room.solo.difficulty].foe } : {}),
      onEnd: () => {
        room.game = undefined;
        for (const q of room.players) q.setPrompt(`${c.magenta(q.handle)}@${c.yellow(room.code)}> `);
        setTimeout(() => {
          if (room.game) return;
          if (room.practice || room.solo) {
            for (const q of [...room.players]) this.leaveRoom(q);
            return;
          }
          this.toRoom(room, { kind: 'tip', text: `Back in the safehouse. ${room.host.handle} can begin another story.` });
          this.pushSafehouseHud(room);
          this.refreshLobbyRooms();
        }, this.opts.returnMs ?? 12_000);
      },
    });
    this.refreshLobbyRooms();
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
      if (!p.bot) this.pushStreetHud(p);
    }
    this.refreshLobbyRooms();
  }

  private toRoom(room: Room, item: FeedItem) {
    for (const q of room.players) q.feed(item);
  }
}
