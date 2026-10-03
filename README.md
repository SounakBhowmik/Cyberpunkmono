# LAST LIGHT

A co-op descent for 2-4 players, played in the browser.

Beneath the neon city of Neo-Avalon, something ancient is waking: the Devourer, an AI wyrm. When it wakes, every mind in the city goes dark. Your crew is a handful of small mythical spirits of the net, and you are the last light. Descend through the haunted net, fight what lives there, and seal the Devourer at the bottom before corruption takes the city.

## How it plays

One meter matters: **corruption**. It's the crew's shared life. If it reaches 100%, the city falls.

Every horror **shows its next move** above its head before you act, so every choice has a reason:

| you see | do this |
| --- | --- |
| an attack (`RAKE 21`) | the **Guardian** Wards it: blocked completely |
| a charge (`CHARGING LUNGE`) | the **Mystic** Hexes it: interrupted. Otherwise a huge hit lands next round |
| a shell (`CARAPACE`) | strikes do half; the Mystic's **Bolt** pierces |
| a wail (`WHISPER 15`) | can't be blocked; the Guardian **Mends** afterwards |

Three classes, two buttons each:

- **Striker**: Strike (8 damage, double on an exposed foe) or Fury (16 damage, but it corrupts the crew).
- **Mystic**: Hex (exposes the foe so Strike hits ×2, and interrupts charges) or Bolt (pierces shells).
- **Guardian**: Ward (blocks this round's attack) or Mend (cleanses corruption).

Everyone picks at the same time; the round resolves when the whole crew is ready. With two players one person is Mystic and Guardian and acts twice. Between fights the crew **votes on the way down**: a horror (each one you beat puts a seal on the Devourer, making the final fight easier), a dread lair (harder, more seals and a relic), a shrine (rest), or a relic cache. Relics are simple passives like "Strike deals +3".

At the bottom waits the Devourer, one of five wyrm breeds, each with a temperament ("craves worship", "loves procedure", "holds grudges"...). Anyone can spend their turn **speaking to it** instead of attacking. With an OpenAI key, an LLM plays the wyrm and judges how well you played to its nature; good words wound it, insults enrage it. The server caps what a single speech can do, so no clever line skips the fight.

The balance simulator (`npm run balance`) plays hundreds of games with bot crews: a crew that reads intents wins about 95% of the time, finishing tense at around 45% corruption, while a crew that mashes random buttons wins about 26%. Strategy is the game.

## What it looks and sounds like

- **Players** are procedural pixel-art mythical creatures (kitsune, griffin, naga, oni, phoenix, wisp, tengu), grown from your handle, with class gear on top: a blade, a rune orb, a shield. `reroll` grows a new one.
- **Horrors** are original, horror-film inspired: the Crimson Face, the Hollow Bride, the Husk Stalker, the Many-Elbowed. They flicker, glitch, and lunge at the camera.
- **Fights** move: heroes dash in and slash, bolts arc across the screen, wards dome over the crew, and corruption creeps in from the screen's edges as veins.
- **Sound** is synthesized live: effects with random variation so nothing repeats exactly, and generative music that drifts from a calm descent theme to a heartbeat in fights and an uneasy theme for the Devourer. A toggle mutes it and remembers.
- **Phones** work: the layout stacks, buttons are thumb-sized, touch devices get a real input box.

## Running it

```bash
npm install
npm run dev            # builds the client and starts the server on http://localhost:3000
```

Open the page in two browser tabs (or on two devices), pick names, create a safehouse in one and join with its code in the other, then begin the descent.

Optional environment variables (see `.env.example`):

- `OPENAI_API_KEY`: turns on the LLM wyrm and narrator. Without it, scripted versions are used.
- `OPENAI_MODEL`: defaults to `gpt-4o-mini`. Any chat-completions model with JSON mode works.
- `ALLOW_SOLO=1`: lets one player start alone with all three classes, for development.
- `PORT`: defaults to 3000.

Production: `npm run build && npm start`.

## Layout

```
src/server/index.ts          HTTP + WebSocket server, static files
src/server/hub.ts            lobby, names, safehouse codes, host/start/leave, avatar rerolls
src/server/ai.ts             thin OpenAI wrapper shared by the wyrm and the narrator
src/server/game/game.ts      the descent: route votes, fights, rounds, seals, relics, the end
src/server/game/content.ts   every number and name: classes, moves, horrors, relics, rooms
src/server/game/breeds.ts    the five wyrm breeds and how they like to be spoken to
src/server/game/parley.ts    judging speeches to the Devourer (LLM or scripted, server-capped)
src/server/game/narrator.ts  a line of narration at the moments that matter
src/client/main.ts           terminal, buttons, HUD, message handling
src/client/scene.ts          the animated canvas: city, descent, horrors, the Devourer, effects
src/client/avatar.ts         procedural pixel-art mythical creatures
src/client/sound.ts          synthesized effects and generative music
test/                        game rules, combos, voting, speech, lobby
scripts/balance.mts          bot crews that prove strategy matters
```

```bash
npm test           # node:test via tsx
npm run typecheck
npm run balance
```
