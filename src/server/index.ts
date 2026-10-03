import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_LINE_LENGTH, type ClientMessage, type ActionButton, type FeedItem, type Fx, type HudState, type SceneState, type ServerMessage } from '../shared/protocol.js';
import { createAi } from './ai.js';
import { createJudge } from './game/parley.js';
import { createNarrator } from './game/narrator.js';
import { Hub, type Session } from './hub.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ai = createAi();
const judge = createJudge(ai);
const narrator = createNarrator(ai);
const hub = new Hub({ judge, narrator, minPlayers: process.env.ALLOW_SOLO === '1' ? 1 : 2 });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

class WsSession implements Session {
  readonly id = randomUUID();
  constructor(private readonly ws: WebSocket) {}

  private push(msg: ServerMessage) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }
  send(text: string) {
    this.push({ type: 'out', text });
  }
  setPrompt(text: string) {
    this.push({ type: 'prompt', text });
  }
  hud(hud: HudState) {
    this.push({ type: 'hud', hud });
  }
  scene(scene: SceneState, actions: ActionButton[]) {
    this.push({ type: 'scene', scene, actions });
  }
  fx(fx: Fx) {
    this.push({ type: 'fx', fx });
  }
  feed(item: FeedItem) {
    this.push({ type: 'feed', item });
  }
  clear() {
    this.push({ type: 'clear' });
  }
  close() {
    this.ws.close();
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws: WebSocket) => {
  const session = new WsSession(ws);
  hub.connect(session);

  // Simple token bucket so one client can't flood the room (or the OpenAI bill).
  let tokens = 8;
  const refill = setInterval(() => (tokens = Math.min(8, tokens + 2)), 1000);

  ws.on('message', (data) => {
    if (tokens <= 0) return session.send('\x1b[2m(slow down, your deck is overheating)\x1b[0m');
    tokens--;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg?.type !== 'line' || typeof msg.text !== 'string') return;
    // Strip control characters so players can't inject ANSI into each other's terminals.
    const text = msg.text.slice(0, MAX_LINE_LENGTH).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    hub.handleLine(session.id, text);
  });

  ws.on('close', () => {
    clearInterval(refill);
    hub.disconnect(session.id);
  });
});

server.listen(PORT, () => {
  console.log(`LAST LIGHT listening on http://localhost:${PORT}  (wyrm: ${judge.label}, narrator: ${narrator.label})`);
});
