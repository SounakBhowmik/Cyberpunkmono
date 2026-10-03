# ICEBREAKER

A co-op cyberpunk dungeon delve for 2-4 players, played in a shared terminal in the browser.

In Neo-Avalon the corporations keep their secrets the old way: in vaults, guarded by ancient AI wyrms chained beneath their towers. Your crew delves a corp's network like a dungeon. Rooms are nodes, ICE programs are the monsters, and the vault is a dragon's hoard. Pull `payload.dat` out before the trace meter hits 100%.

Nobody sees the whole picture, so you win by talking to each other:

- **Runner (rogue)** is jacked in, sees only the room they're standing in, picks locks, loots programs and parleys with the wyrm.
- **Operator (mage)** holds the stolen schematic: every room, the ports that open locked nodes, where the intel is and where the ICE lairs. In a fight they hurl bolts and analyze weak points.
- **Sentry (cleric)** watches the trace and the hunting patrol, and heals: `spoof` scrubs trace. In a fight they raise shields.

With two players one person plays mage and cleric; with four, two share the mage's schematic. Roles pass to someone else if a player drops.

## The wyrms

Each vault is guarded by one of five chromatic wyrm breeds, and each wants to be handled differently. A **Red** wyrm is proud and wants worship. A **Blue** wyrm is a bureaucrat that won't open without the maintenance ticket being cited. A **Green** wyrm lies, loves deals and whispers privately to crew members to turn them on each other. A **Black** wyrm bears grudges and barely calms down. A **White** wyrm is lazy and can be bored into letting you through.

You can open the vault with a 6-digit code whose fragments are scattered across the network, or you can talk your way past the wyrm using intel found in files (the sysadmin's name, an open maintenance ticket, the sysadmin's cat). With an OpenAI API key, the wyrm is an LLM playing its breed's personality and tracking its own suspicion. The server enforces the real rules either way: access needs at least two genuine pieces of intel (and the ticket, for Blue), so jailbreaking the model doesn't skip the puzzle.

## Dice, fights and loot

Risky actions roll a d20 that tumbles in everyone's terminal. Picking a lock is d20 + 4 against the node's DC; a natural 20 opens it silently and a natural 1 sets off the alarm and pulls the patrol. Walking into the patrol is a stealth check.

Two rooms per network are ICE lairs. Entering one starts a turn-based fight: every player picks one action per round (strike, flee, bolt, analyze, shield, cast a program or wait), it resolves when everyone's locked in or after 30 seconds, and the monster hits back with trace. Slain ICE drops a program.

Programs are the party's spells, with limited charges: `ghost.exe` hides the runner from the patrol, `babel.dll` reveals the wyrm's weakness, `icepick.exe` shatters a lock, `nova.exe` blasts ICE in a fight, `mend.sys` scrubs trace. The runner `take`s them from rooms and anyone can `cast` them.

With an API key, an LLM dungeon master narrates the opening, quiet rooms, kills and the ending in a line or two. Without one, a scripted narrator does it.

## Running it

```bash
npm install
npm run dev            # builds the client and starts the server on http://localhost:3000
```

Open the page in two browser tabs (or on two machines), pick handles, `create` a safehouse in one and `join <code>` in the other, then `start`.

Optional environment variables (see `.env.example`):

- `OPENAI_API_KEY`: turns on the LLM wyrm and dungeon master. Without it, scripted versions are used, which is enough to play and test.
- `OPENAI_MODEL`: defaults to `gpt-4o-mini`. Any chat-completions model with JSON mode works.
- `ALLOW_SOLO=1`: lets one player start a delve with all three roles, for development.
- `PORT`: defaults to 3000.

Production: `npm run build && npm start`.

## Layout

```
src/server/index.ts          HTTP + WebSocket server, static files
src/server/hub.ts            lobby, handles, safehouse codes, host/start/leave
src/server/ai.ts             thin OpenAI wrapper shared by the wyrm and the DM
src/server/game/world.ts     seeded network generation: rooms, locks, intel, lairs, programs
src/server/game/game.ts      roles, commands, trace, patrol, parley, deck, HUD
src/server/game/combat.ts    turn-based ICE encounters
src/server/game/breeds.ts    the five wyrm breeds: personalities and rules
src/server/game/bestiary.ts  ICE monsters and programs
src/server/game/dice.ts      d20 checks with crits and fumbles
src/server/game/ice.ts       the wyrm's brain: LLM, scripted fallback, intel verification
src/server/game/narrator.ts  the dungeon master
src/client/main.ts           xterm.js terminal, line editor, dice animation, HUD
test/                        world invariants, full delves, combat, breeds, programs
scripts/balance.mts          simulates 400 delves with a bot crew to tune difficulty
```

The server owns all state and sends finished text, so the browser is just a terminal plus a HUD. The `Session` interface in `hub.ts` is transport-agnostic, which leaves room for an SSH front door later.

```bash
npm test           # node:test via tsx
npm run typecheck
npm run balance    # win rate and trace distribution for a competent bot crew
```
