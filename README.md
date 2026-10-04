# LAST LIGHT

A co-op story for 2-4 players, played in the browser.

Every screen in Neo-Avalon flickers at midnight with the same dream: an eye, opening. Beneath the city an ancient AI wyrm is waking, and your crew, a handful of small spirits of the net, are the last light. Each game is a short journey of five chapters: the crew talks, chooses, fights, cracks locks and, at the end, faces the wyrm.

## Starting out

The game opens on a menu: type a callsign, then **continue** a saved story, start a **new story** (you get a safehouse code to send your crew), **join a crew** with its code, or play the **training**. Training is solo and has no timer: a practice construct shows every kind of monster move in order while an old spirit tells you which key answers it, then walks you through a glyph lock and a conversation. Real stories need a crew of at least two.

The menu also has the **controls**, your **past adventures** (story, ending, stars, points) and **achievements**.

## Three stories

The host picks one in the safehouse. Each has its own meter that the crew shares as its life; if it reaches 100% the story ends badly.

- **The Pilgrimage** (adventure, *corruption*). Walk down through the Undercroft, the night market, the Bridge of Static and the Oracle's shrine to seal the wyrm in its lair.
- **The Heart of the Wyrm** (heist, *heat*). Break into a tower vault for the wyrm's heart. Disguise or vents, past the guards or through them, and in the vault you can talk to the wyrm itself. Win it over and the ending changes completely.
- **Four Nights** (survival, *dread*). Hold a camp for four nights. Days are for choices (scavenge, fortify, find survivors, seal the shrine); nights are for fighting. A little harder than the others.

Choices along the way leave marks. They give the crew boons ("Kitsune ally: Strike +3", "Oracle's sight", "+1 Ward per chapter"), raise or lower the meter, open or close later branches, and decide which of each story's endings you reach.

## How it plays

There are four kinds of scenes, and every one needs the whole crew:

- **Choices.** Everyone votes by clicking a card. The majority wins; ties are broken by fate.
- **Fights.** Three roles with two buttons each. Only the **Mage** can see what the monster will do next, and gets free one-tap call-outs ("it will ATTACK: Ward!", "it's CHARGING: I'll Hex!") that pop up on everyone's screen. The **Rogue** deals damage (Strike, or Fury at a cost). The **Cleric** has only a couple of **Wards** per chapter, so they need to listen to the Mage, plus Mend. Everyone picks at once. A **timer** (15 seconds, 20 against the wyrm) ticks under the monster's health bar. When it runs out the monster moves whether you're ready or not, and anyone still undecided leaves the crew **flat-footed**: extra damage for each of them, and the monster's hit lands harder. If everyone chooses early, the round plays out straight away.
- **Locks.** The Mage sees the glyph sequence and only the Rogue can press glyphs. Three misses and the lock goes wrong, which usually means a fight.
- **Parleys.** Talk an NPC (or the wyrm) round to your side, in your own words, in a few lines. With an OpenAI key an LLM judges what you say against the character's nature; the server caps what any single line can do, and attempts to manipulate the judge are scored down.

With two players, one person is both Mage and Cleric. A crew that reads the Mage's calls wins most of the time; a crew mashing random buttons almost never does. The balance simulator (`npm run balance`) shows this with bot crews: smart crews win roughly 87-99%, "human-ish" crews 74-87%, and random crews 8-22%, depending on story and crew size.

## Controls

Every action has a key, shown on its button, and it's the same key on every device:

| key | action |
| --- | --- |
| A / S | Rogue: Strike / Fury |
| D / F | Cleric: Ward / Mend |
| Q / W | Mage: Hex / Bolt |
| 1-5 | Mage: call out the monster's move · vote · press glyphs |
| T | talk to someone you're winning over |
| Enter / Esc | chat with your crew / stop typing |

On a phone the game only runs in landscape (portrait shows a "turn your phone" screen, and the page asks for fullscreen and a landscape lock where the browser allows it). The actions become a pad of round keys beside the screen, with the same letters. The log slides in from the right with a small keyboard of its own, so typing never brings up the phone's keyboard over the game.

## Score, stars and achievements

The **Warden** watches every round and scores each player on how well they answered the threat. Points float up over your avatar as you earn them and show next to your name in the HUD, so a crew can compete as well as cooperate:

- a Ward against a real attack (+15), a Hex that breaks a charge (+15), a Bolt through a shell (+12), a Strike or Fury on a hexed monster (+10/+14), a Mend after a wail (+10);
- the Mage's first call-out each round, if it was right (+8); choosing in the first third of the timer (+5);
- right glyphs, well-chosen words in a conversation, killing blows and every monster brought down;
- and losses for a wasted Ward, a wrong glyph, words that enrage, or being caught flat-footed (−10).

When a story ends you get **0-3 stars** (a win, plus how much of the meter you kept clear), a team score, each player's points and highlights, and the Warden's pick for MVP. **Checkpoints** are saved at the start of every chapter from chapter 2 on, so a crew can pick a story back up from the menu. Sixteen **achievements** reward things like three clean Wards in one story, winning without a wrong glyph, or never being caught flat-footed.

Progress (callsign, checkpoint, past adventures, achievements) is kept in your browser for now. A global ranking needs accounts, so it's on the list below.

## The game console

Almost everything you need to read appears on the game screen itself. Story lines play in a dialogue box with a portrait and a typewriter (click to skip), notices pop up and fade, crew messages appear as bubbles with the sender's avatar, and a tip banner explains your role. The input bar is for talking to your crew; it also accepts commands. The full text log lives behind the **log** button for anyone who wants it.

## What it looks and sounds like

- **Players** are procedural pixel-art creatures grown from your handle, with class gear: a hood, a crowned staff, a halo. `reroll` grows a new one.
- **Monsters** are neon, line-drawn horrors of the net (a hound, an ooze, a sentinel, a kraken, a mimic), and the wyrm comes in five breeds with different temperaments.
- **Fights** have weight: hit-stop, shockwave rings, spark streaks, branching lightning, a hex-pane ward, camera punch and outlined damage numbers.
- **Music** is synthesized live and changes with the scene: calm for story, uneasy for locks and parleys, driving for fights, heavier for the wyrm, and its own themes for night, victory and defeat. Each track is cut cleanly when the scene changes. Sound effects vary slightly on each play.
- **Fights are seen from behind the crew**: the monster looms at the top of the screen, the crew stands along the bottom, and attacks fly up the screen while the monster lunges down at you (and the camera).
- **Phones** play in landscape with an on-screen pad; see Controls.

## Running it

```bash
npm install
npm run dev            # builds the client and starts the server on http://localhost:3000
```

Open the page in two browser tabs (or on two devices), start a new story in one and join with its code in the other, pick a story, then begin. To try it alone, play the training.

Optional environment variables (see `.env.example`):

- `OPENAI_API_KEY`: turns on the LLM judge for parleys and the narrator's asides. Without it, scripted versions are used.
- `OPENAI_MODEL`: defaults to `gpt-4o-mini`. Any chat-completions model with JSON mode works.
- `PORT`: defaults to 3000.

Production: `npm run build && npm start`.

## Layout

```
src/server/index.ts          HTTP + WebSocket server, static files
src/server/hub.ts            lobby, safehouse codes, story choice, host/start/leave, chat
src/server/ai.ts             thin OpenAI wrapper shared by the judge and the narrator
src/server/game/story.ts     the three stories and the training, as small graphs of chapters, choices and endings
src/server/game/game.ts      the engine: votes, timed fights, locks, parleys, boons, the Warden's scoring, checkpoints, endings
src/server/game/content.ts   every number and name: roles, moves, monsters, boons, timers, Warden points
src/server/game/breeds.ts    the five wyrm breeds and how they like to be spoken to
src/server/game/parley.ts    judging what players say (LLM or scripted, server-capped)
src/server/game/narrator.ts  an optional one-line aside at each new chapter
src/client/main.ts           menu, buttons and hotkeys, the phone pad and drawer, HUD, results, message handling
src/client/keys.ts           one key per action, shared by the keyboard and the phone pad
src/client/minikeys.ts       the small on-screen keyboard in the phone drawer
src/client/progress.ts       callsign, checkpoint, past adventures and achievements (kept in the browser)
src/client/console.ts        the on-screen console: dialogue, notices, crew bubbles, tips
src/client/scene.ts          the animated canvas: places, choices, fights, locks, parleys
src/client/avatar.ts         procedural pixel-art player creatures
src/client/monsters.ts       the neon monsters
src/client/portraits.ts      story characters for the dialogue box and parleys
src/client/sound.ts          synthesized effects and per-scene music
test/                        story graphs, roles, locks, parleys, lobby, timers, scoring, checkpoints, training
scripts/balance.mts          bot crews that show strategy matters
```

```bash
npm test           # node:test via tsx
npm run typecheck
npm run balance
```

## Future features

- **Accounts and a global ranking.** Players sign up, their points and stars are stored on the server, and a leaderboard ranks every player (and crew) in the database. Until then, progress lives in each browser.
- **Rejoin after a dropped connection**, picking up your seat in a running story.
- **More stories and monsters**, and harder variants of the three stories for crews with three stars.
- **Seasonal achievements and daily challenges** once there is a server-side profile to keep them in.
