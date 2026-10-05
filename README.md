# LAST LIGHT

A story adventure for one player with allies, or a co-op crew of 2-4, played in the browser.

Every screen in Neo-Avalon flickers at midnight with the same dream: an eye, opening. Beneath the city an ancient AI wyrm is waking, and your crew, a handful of small spirits of the net, are the last light. The central campaign is a ten-chapter expedition designed for 60–70 minutes: the crew explores castles, harvests relics, talks, chooses, cracks locks and faces monsters that learn from earlier encounters.

## Starting out

The game gives each **Joe** a persistent texture-name and avatar, with one reroll. Choose **single Joe** to pick a role, difficulty, and story; two bot allies fill the other roles. Choose **multiplayer** to create a crew, join by code, or enter any listed crew with an open seat. Training teaches relic loadouts, crew roles, locks, and conversations.

The menu also has the **controls**, your **past adventures** (story, ending, stars, points) and **achievements**.

## Journeys

The host picks one in the safehouse. Each has its own meter that the crew shares as its life; if it reaches 100% the story ends badly.

- **The Last Pilgrimage** (adventure, *corruption*, about 60–70 minutes). Carry ECHO’s unfinished seal through ten chapters: the Hall of Names, drowned market, Castle Ashenwake, Moonkennel, Glass Cathedral and the Inverted Keep. Learn why ECHO casts two shadows, then face Noctyra—the Eclipse Sovereign—in a two-stage finale.
- **The Heart of the Wyrm** (heist, *heat*). Break into a tower vault for the wyrm's heart. Disguise or vents, past the guards or through them, and in the vault you can talk to the wyrm itself. Win it over and the ending changes completely.
- **Four Nights** (survival, *dread*). Hold a camp for four nights. Days are for choices (scavenge, fortify, find survivors, seal the shrine); nights are for fighting. A little harder than the others.
- **The Warden’s Omen** (daily quest, about 10 minutes). Follow one of three changing omens with two bot allies, hunt an evolved beast, open a manual glyph lock, and harvest a relic. Consecutive daily wins build a visible streak.

Choices along the way leave marks. They give the crew boons ("Kitsune ally: Strike +3", "Oracle's sight", "+1 Ward per chapter"), raise or lower the meter, open or close later branches, and decide which of each story's endings you reach.

## How it plays

There are four kinds of scenes, and every one needs the whole crew:

- **Choices.** Everyone votes by clicking a card. The majority wins; ties are broken by fate.
- **Fights.** Before an encounter, each Joe chooses one owned relic for every role they carry. When all loadouts are locked, combat is automatic: the Mage reads the threat, the Rogue finds an opening, and the Cleric protects or restores the crew. The engine always uses the efficient tactic; relic quality determines damage, protection, how quickly the fight ends, and how much of the shared meter survives.
- **Locks.** The Mage sees the glyph sequence and only the Rogue can press glyphs. Three misses and the lock goes wrong, which usually means a fight.
- **Parleys.** Talk an NPC (or the wyrm) round to your side, in your own words, in a few lines. With an OpenAI key an LLM judges what you say against the character's nature; the server caps what any single line can do, and attempts to manipulate the judge are scored down.

With two Joes, one carries both Mage and Cleric. There is no combat button-mashing: player attention stays on the story, exploration, collection, and deciding which relics to trust.

## Controls

Story interactions keep short keys; combat does not require controls:

| key | action |
| --- | --- |
| Arrow keys / Enter | move through menus / select |
| 1-5 | vote · show or press glyphs |
| T | talk to someone you're winning over |
| Enter / Esc | chat with your crew / stop typing |

On a phone the game only runs in landscape (portrait shows a "turn your phone" screen, and the page asks for fullscreen and a landscape lock where the browser allows it). The actions become a pad of round keys beside the screen, with the same letters. The log slides in from the right with a small keyboard of its own, so typing never brings up the phone's keyboard over the game.

## Score, stars and achievements

The **Warden** watches each automatic round and scores how well every role and relic answered the threat. Points float up over the Joes and remain competitive inside a cooperative crew:

- a Ward against a real attack (+15), a Hex that breaks a charge (+15), a Bolt through a shell (+12), a Strike or Fury on a hexed monster (+10/+14), a Mend after a wail (+10);
- the Mage reading the threat correctly and the crew executing a coordinated counter;
- right glyphs, well-chosen words in a conversation, killing blows and every monster brought down;
- and losses for a wrong glyph, poor preparation, or words that enrage.

When a story ends you get **0-3 stars** (a win, plus how much of the meter you kept clear), a team score, each player's points and highlights, and the Warden's pick for MVP. **Checkpoints** are saved at the start of every chapter from chapter 2 on, so a crew can pick a story back up from the menu. Sixteen **achievements** reward things like three clean Wards in one story, winning without a wrong glyph, or never being caught flat-footed.

Progress (identity, checkpoint, past adventures, achievements, role mastery, daily streak, and inventory) is kept in your browser for now. Joe identities come from five texture families: soft and fuzzy, wet and sticky, hard and rough, smooth and shiny, or dry and crumbly. Time reveals starter relics after two minutes; uncommon through mythic equipment also requires completed quests or direct dungeon harvesting. Harvested relics can be equipped later in the same expedition. Each Joe chooses a loadout before battle. Every successful main quest leaves a unique story artifact in the Safehouse Vault.

## The game console

Almost everything you need to read appears on the game screen itself. Neutral scene-setting is visually separate from character dialogue. ECHO—the last survivor of an earlier crew that fought the wyrm—speaks only in his own voice and guides this crew to finish what his could not. Click each short message when you have read it, or use **skip briefing** on repeat runs. Notices pop up and fade, crew messages appear as bubbles with the sender's avatar, and a tip banner explains your role.

## What it looks and sounds like

- **Joes** are procedural pixel-art creatures grown from their assigned identity, with class gear: a hood, a crowned staff, a halo.
- **Monsters** are neon, line-drawn horrors of the net. Early creatures return as evolved threats: Crowned Gloamfang, Vespercoil Ossuary, the Mireborn Abyss and the six-winged Glass Seraph. Noctyra is the final two-stage boss.
- **Fights** are choreographed automatically with flanking, casting steps, protective advances, recoil, hit-stop, shockwave rings, spark streaks, branching lightning, wards, camera punch, and outlined damage numbers.
- **Music** is synthesized live and changes with the scene: eerie drones on the home screen, uneasy motifs for locks and parleys, driving fights, and heavier themes for the wyrm, night, victory and defeat.
- **Fights are seen from behind the crew**: the monster looms at the top of the screen, the crew stands along the bottom, and attacks fly up the screen while the monster lunges down at you (and the camera).
- **Phones** play in landscape with an on-screen pad; see Controls.

## Running it

```bash
npm install
npm run dev            # builds the client and starts the server on http://localhost:3000
```

Open the page and choose single player for a full story with two allies. For multiplayer, create a crew in one browser and join its open room or enter its code from another.

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
src/server/game/story.ts     campaigns, daily quest and training as graphs of chapters, choices and endings
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
- **Player marketplace.** Rare inventory finds can be listed and traded once accounts provide safe ownership and transactions.
- **Rejoin after a dropped connection**, picking up your seat in a running story.
- **More stories and monsters**, and harder variants of the three stories for crews with three stars.
- **Seasonal quest rotations** once there is a server-side profile to synchronize them across devices.
