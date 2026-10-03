# LAST LIGHT

A co-op story for 2-4 players, played in the browser.

Every screen in Neo-Avalon flickers at midnight with the same dream: an eye, opening. Beneath the city an ancient AI wyrm is waking, and your crew, a handful of small spirits of the net, are the last light. Each game is a short journey of five chapters: the crew talks, chooses, fights, cracks locks and, at the end, faces the wyrm.

## Three stories

The host picks one in the safehouse. Each has its own meter that the crew shares as its life; if it reaches 100% the story ends badly.

- **The Pilgrimage** (adventure, *corruption*). Walk down through the Undercroft, the night market, the Bridge of Static and the Oracle's shrine to seal the wyrm in its lair.
- **The Heart of the Wyrm** (heist, *heat*). Break into a tower vault for the wyrm's heart. Disguise or vents, past the guards or through them, and in the vault you can talk to the wyrm itself. Win it over and the ending changes completely.
- **Four Nights** (survival, *dread*). Hold a camp for four nights. Days are for choices (scavenge, fortify, find survivors, seal the shrine); nights are for fighting. A little harder than the others.

Choices along the way leave marks. They give the crew boons ("Kitsune ally: Strike +3", "Oracle's sight", "+1 Ward per chapter"), raise or lower the meter, open or close later branches, and decide which of each story's endings you reach.

## How it plays

There are four kinds of scenes, and every one needs the whole crew:

- **Choices.** Everyone votes by clicking a card. The majority wins; ties are broken by fate.
- **Fights.** Three roles with two buttons each. Only the **Mage** can see what the monster will do next, and gets free one-tap call-outs ("it will ATTACK: Ward!", "it's CHARGING: I'll Hex!") that pop up on everyone's screen. The **Rogue** deals damage (Strike, or Fury at a cost). The **Cleric** has only a couple of **Wards** per chapter, so they need to listen to the Mage, plus Mend. Everyone picks at once and the round resolves when the crew is ready.
- **Locks.** The Mage sees the glyph sequence and only the Rogue can press glyphs. Three misses and the lock goes wrong, which usually means a fight.
- **Parleys.** Talk an NPC (or the wyrm) round to your side, in your own words, in a few lines. With an OpenAI key an LLM judges what you say against the character's nature; the server caps what any single line can do, and attempts to manipulate the judge are scored down.

With two players, one person is both Mage and Cleric. A crew that reads the Mage's calls wins most of the time; a crew mashing random buttons almost never does. The balance simulator (`npm run balance`) shows this with bot crews: smart crews win roughly 87-99%, "human-ish" crews 74-87%, and random crews 8-22%, depending on story and crew size.

## The game console

Almost everything you need to read appears on the game screen itself. Story lines play in a dialogue box with a portrait and a typewriter (click to skip), notices pop up and fade, crew messages appear as bubbles with the sender's avatar, and a tip banner explains your role. The input bar is for talking to your crew; it also accepts commands. The full text log lives behind the **log** button for anyone who wants it.

## What it looks and sounds like

- **Players** are procedural pixel-art creatures grown from your handle, with class gear: a hood, a crowned staff, a halo. `reroll` grows a new one.
- **Monsters** are neon, line-drawn horrors of the net (a hound, an ooze, a sentinel, a kraken, a mimic), and the wyrm comes in five breeds with different temperaments.
- **Fights** have weight: hit-stop, shockwave rings, spark streaks, branching lightning, a hex-pane ward, camera punch and outlined damage numbers.
- **Music** is synthesized live and changes with the scene: calm for story, uneasy for locks and parleys, driving for fights, heavier for the wyrm, and its own themes for night, victory and defeat. Each track is cut cleanly when the scene changes. Sound effects vary slightly on each play.
- **Phones** work: the layout stacks and buttons are thumb-sized.

## Running it

```bash
npm install
npm run dev            # builds the client and starts the server on http://localhost:3000
```

Open the page in two browser tabs (or on two devices), create a safehouse in one and join with its code in the other, pick a story, then begin.

Optional environment variables (see `.env.example`):

- `OPENAI_API_KEY`: turns on the LLM judge for parleys and the narrator's asides. Without it, scripted versions are used.
- `OPENAI_MODEL`: defaults to `gpt-4o-mini`. Any chat-completions model with JSON mode works.
- `ALLOW_SOLO=1`: lets one player start alone with all three roles, for development.
- `PORT`: defaults to 3000.

Production: `npm run build && npm start`.

## Layout

```
src/server/index.ts          HTTP + WebSocket server, static files
src/server/hub.ts            lobby, safehouse codes, story choice, host/start/leave, chat
src/server/ai.ts             thin OpenAI wrapper shared by the judge and the narrator
src/server/game/story.ts     the three stories as small graphs of chapters, choices and endings
src/server/game/game.ts      the engine: votes, fights, locks, parleys, boons, endings
src/server/game/content.ts   every number and name: roles, moves, monsters, boons
src/server/game/breeds.ts    the five wyrm breeds and how they like to be spoken to
src/server/game/parley.ts    judging what players say (LLM or scripted, server-capped)
src/server/game/narrator.ts  an optional one-line aside at each new chapter
src/client/main.ts           buttons, HUD, input bar, message handling
src/client/console.ts        the on-screen console: dialogue, notices, crew bubbles, tips
src/client/scene.ts          the animated canvas: places, choices, fights, locks, parleys
src/client/avatar.ts         procedural pixel-art player creatures
src/client/monsters.ts       the neon monsters
src/client/portraits.ts      story characters for the dialogue box and parleys
src/client/sound.ts          synthesized effects and per-scene music
test/                        story graphs, roles, locks, parleys, lobby
scripts/balance.mts          bot crews that show strategy matters
```

```bash
npm test           # node:test via tsx
npm run typecheck
npm run balance
```
