# ICEBREAKER

A co-op cyberpunk heist for 2-4 players, played in a shared terminal in the browser.

Your crew has one job: get into a corp's black vault and pull `payload.dat`. The catch is that nobody can see the whole picture. The **runner** is jacked into the network but only sees the node they're standing in. The **operator** holds the stolen schematics (map, the ports that open locked nodes, where the intel is) but can't touch the network. The **sentry** watches the trace meter and the roaming ICE patrol, and can spoof the tracers to buy time. You win by talking to each other.

The vault itself is guarded by an AI (the Warden). You can crack it with a 6-digit code whose fragments are scattered around the network, or you can try talking your way in over its maintenance channel. With an OpenAI API key, the Warden is an LLM with a paranoid, vain, secretly lonely personality that tracks how suspicious it is of you. Insider knowledge you dug out of the network (the sysadmin's name, an open maintenance ticket, the sysadmin's cat) lowers its guard. Clumsy prompt-injection attempts raise it. If the Warden gets talked into "granting access" without the crew having found the real intel, the game's verification layer still refuses, so jailbreaking the model doesn't skip the puzzle.

## Running it

```bash
npm install
npm run dev            # builds the client and starts the server on http://localhost:3000
```

Open the page in two browser tabs (or two machines), pick handles, `create` a room in one and `join <code>` in the other, then `start`.

Optional environment variables (see `.env.example`):

- `OPENAI_API_KEY`: turns on the LLM Warden. Without it a scripted Warden is used, which is enough to play and test.
- `OPENAI_MODEL`: defaults to `gpt-4o-mini`. Any chat-completions model with JSON mode works.
- `ALLOW_SOLO=1`: lets one player start a heist with all three roles, for development.
- `PORT`: defaults to 3000.

Production: `npm run build && npm start`.

## Layout

```
src/server/index.ts        HTTP + WebSocket server, static files
src/server/hub.ts          lobby, handles, room codes, host/start/leave
src/server/game/world.ts   seeded network generation (nodes, locks, intel, passcode)
src/server/game/game.ts    roles, commands, trace, ICE patrol, Warden conversation
src/server/game/ice.ts     the Warden: OpenAI brain, scripted fallback, intel verification
src/client/main.ts         xterm.js terminal with a line editor that survives incoming chat
test/                      world invariants and full-heist game tests
```

The server owns all state and sends finished text, so the browser is just a terminal. The `Session` interface in `hub.ts` is transport-agnostic, which leaves room for an SSH front door later.

```bash
npm test          # node:test via tsx
npm run typecheck
```
