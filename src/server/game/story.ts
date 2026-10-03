import type { Backdrop, ModeId, Mood, OptionIcon } from '../../shared/protocol.js';

// The three stories. Each is a small graph of chapters: narration, a crew
// decision, then a fight, a lock, or a conversation. Choices set flags that
// change later lines, later options, and which ending the crew reaches.

export interface StoryCtx {
  wyrm: string;
  breed: string;
  temperament: string;
  district: string;
  corp: string;
  flags: ReadonlySet<string>;
}

export type Text = string | ((c: StoryCtx) => string);

export interface Line {
  /** narrator, an NPC (by id), or the wyrm. */
  who: 'narrator' | 'npc' | 'wyrm';
  npc?: string;
  text: Text;
}

export interface Effects {
  meter?: number;
  flags?: string[];
  boon?: string;
}

export interface Option {
  label: Text;
  detail: Text;
  icon: OptionIcon;
  requires?: string;
  forbids?: string;
  effects?: Effects;
  next: string;
}

export type Step =
  | { kind: 'choice'; prompt: Text; options: Option[] }
  | { kind: 'fight'; foe: string; elite?: boolean; next: string; win?: Effects }
  | { kind: 'puzzle'; length: number; success: string; failure: string }
  | { kind: 'parley'; npc: string; goal: number; lines: number; success: string; failure: string }
  | { kind: 'boss'; next: string }
  | { kind: 'goto'; next: string | ((c: StoryCtx) => string) }
  | { kind: 'ending'; title: Text; text: Text };

export interface StoryNode {
  chapter: number;
  title: string;
  backdrop: Backdrop;
  music: Mood;
  lines: Line[];
  step: Step;
  /** Applied when the crew arrives here. */
  effects?: Effects;
}

export interface Story {
  id: ModeId;
  title: string;
  pitch: string;
  meterName: string;
  chapters: number;
  /** Foe damage multiplier for this story. */
  difficulty?: number;
  start: string;
  lose: { title: Text; text: Text };
  nodes: Record<string, StoryNode>;
}

// ---------------------------------------------------------------- adventure

const adventure: Story = {
  id: 'adventure',
  title: 'The Pilgrimage',
  pitch: 'carry the seal across the city and down to the Devourer',
  meterName: 'corruption',
  chapters: 5,
  start: 'gate',
  lose: {
    title: 'The City Falls',
    text: (c) => `The corruption takes the last of your light. ${c.wyrm} rises through the net, and one by one, the windows of Neo-Avalon go dark.`,
  },
  nodes: {
    gate: {
      chapter: 1, title: 'The Undercroft Gate', backdrop: 'street', music: 'story',
      lines: [
        { who: 'narrator', text: (c) => `Every screen in Neo-Avalon flickered at midnight with the same dream: an eye, opening. Beneath ${c.district}, ${c.wyrm} is waking.` },
        { who: 'narrator', text: 'Only the old seal can put it back to sleep, and the seal answers only to small spirits of the net. Spirits like you.' },
        { who: 'narrator', text: 'The way down starts at the Undercroft gate. Something with a blank white face is guarding it.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'How do you get past the gate?',
        options: [
          { label: 'Fight the Sentinel', detail: 'a hard fight, but clean', icon: 'fight', next: 'gate_fight' },
          { label: 'Crawl the drainage tunnels', detail: 'no fight · +10 corruption from the rot', icon: 'sneak', effects: { meter: 10, flags: ['tunnels'] }, next: 'market' },
        ],
      },
    },
    gate_fight: {
      chapter: 1, title: 'The Undercroft Gate', backdrop: 'street', music: 'combat',
      lines: [{ who: 'narrator', text: 'The Sentinel turns its blank face toward you and draws a blade made of audit logs.' }],
      step: { kind: 'fight', foe: 'sentinel', next: 'market' },
    },
    market: {
      chapter: 2, title: 'The Drowned Market', backdrop: 'market', music: 'story',
      lines: [
        { who: 'narrator', text: (c) => (c.flags.has('tunnels') ? 'You climb out of the tunnels, dripping, into the Drowned Market.' : 'Past the gate lies the Drowned Market, half its stalls under black water.') },
        { who: 'narrator', text: 'Something is crying. A tiny kitsune spirit is tangled in a fishing net of static, and the water around her is too still.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'The kitsune, or the stalls?',
        options: [
          { label: 'Free the kitsune', detail: 'someone set this trap · she may join you', icon: 'help', next: 'market_trap' },
          { label: 'Loot the drowned stalls', detail: 'take a rail-gun (Bolt +4) · leave her', icon: 'loot', effects: { boon: 'weapons', flags: ['left_kitsune'] }, next: 'bridge' },
        ],
      },
    },
    market_trap: {
      chapter: 2, title: 'The Drowned Market', backdrop: 'market', music: 'combat',
      lines: [{ who: 'narrator', text: 'As you tear the net, the water heaves. She was bait.' }],
      step: { kind: 'fight', foe: 'ooze', next: 'market_freed', win: { boon: 'ally', flags: ['kitsune'] } },
    },
    market_freed: {
      chapter: 2, title: 'The Drowned Market', backdrop: 'market', music: 'story',
      lines: [{ who: 'npc', npc: 'kitsune', text: 'You came back for me. Nobody comes back for anybody down here. I know a shortcut. Follow me!' }],
      step: { kind: 'goto', next: 'bridge' },
    },
    bridge: {
      chapter: 3, title: 'The Bridge of Static', backdrop: 'bridge', music: 'tense',
      lines: [
        { who: 'narrator', text: (c) => (c.flags.has('kitsune') ? 'The kitsune leads you onto the Bridge of Static, chattering about locks.' : 'The Bridge of Static hums over a drop with no bottom.') },
        { who: 'narrator', text: 'A lock of glyphs seals the far side. Only the Mage can read the order. Only the Rogue can touch them.' },
      ],
      step: { kind: 'puzzle', length: 3, success: 'oracle', failure: 'bridge_alarm' },
    },
    bridge_alarm: {
      chapter: 3, title: 'The Bridge of Static', backdrop: 'bridge', music: 'combat',
      lines: [{ who: 'narrator', text: 'The glyphs flare red. Something with too many teeth comes loping across the bridge.' }],
      step: { kind: 'fight', foe: 'hound', next: 'oracle' },
    },
    oracle: {
      chapter: 4, title: 'The Oracle', backdrop: 'shrine', music: 'story',
      lines: [
        { who: 'narrator', text: 'At the bottom of the bridge, a shrine. A veiled figure sits inside with one enormous, patient eye.' },
        { who: 'npc', npc: 'oracle', text: 'Little lights. I see the Devourer’s dream, and I see the end of yours.' },
        { who: 'npc', npc: 'oracle', text: 'Tell me why you walk toward it. If your reason is true, I will show you where it can be hurt.' },
      ],
      step: { kind: 'parley', npc: 'oracle', goal: 14, lines: 4, success: 'oracle_yes', failure: 'oracle_no' },
    },
    oracle_yes: {
      chapter: 4, title: 'The Oracle', backdrop: 'shrine', music: 'story',
      effects: { boon: 'oracle' },
      lines: [{ who: 'npc', npc: 'oracle', text: 'Then look. Where its scales split at the throat, the light gets in. Strike there first.' }],
      step: { kind: 'goto', next: 'lair' },
    },
    oracle_no: {
      chapter: 4, title: 'The Oracle', backdrop: 'shrine', music: 'story',
      effects: { meter: 8 },
      lines: [{ who: 'npc', npc: 'oracle', text: 'No. You do not understand it yet. Go, and be brave without sight.' }],
      step: { kind: 'goto', next: 'lair' },
    },
    lair: {
      chapter: 5, title: 'The Devourer', backdrop: 'lair', music: 'boss',
      lines: [
        { who: 'narrator', text: (c) => `The bottom of the city. ${c.wyrm} lies coiled around Neo-Avalon’s heart. Its eyes open.` },
        { who: 'narrator', text: (c) => (c.flags.has('kitsune') ? 'Beside you, the kitsune bares her tiny teeth.' : 'You are very small, and it is very large.') },
        { who: 'wyrm', text: (c) => `Little lights. It ${c.temperament.split(':')[0]}... and so do I. Speak, or be eaten.` },
      ],
      step: { kind: 'boss', next: 'adv_end' },
    },
    adv_end: {
      chapter: 5, title: 'The Devourer', backdrop: 'city', music: 'victory',
      lines: [],
      step: {
        kind: 'ending',
        title: (c) => (c.flags.has('kitsune') && c.flags.has('oracle') ? 'The Long Dawn' : c.flags.has('kitsune') ? 'Light Holds' : 'A Quiet Seal'),
        text: (c) =>
          c.flags.has('kitsune') && c.flags.has('oracle')
            ? `${c.wyrm} sinks back into its long sleep. The kitsune rides on your shoulder all the way back up, and the city wakes to the best sunrise it has ever had, never knowing why.`
            : c.flags.has('kitsune')
              ? `The seal closes over ${c.wyrm}. The kitsune curls up beside it to keep watch. "Someone should," she says. Neo-Avalon wakes.`
              : `The seal closes. ${c.wyrm} sleeps. Somewhere in the Drowned Market, a net of static still floats on black water. The city wakes, and never knows the cost.`,
      },
    },
  },
};

// ---------------------------------------------------------------- heist

const heist: Story = {
  id: 'heist',
  title: 'The Heart of the Wyrm',
  pitch: 'break into a corp tower and steal the heart of the wyrm they keep chained there',
  meterName: 'heat',
  chapters: 5,
  start: 'brief',
  lose: {
    title: 'Caught',
    text: (c) => `The heat hits 100%. ${c.corp} security burns your decks to slag, and somewhere far below, ${c.wyrm} keeps screaming into the dark.`,
  },
  nodes: {
    brief: {
      chapter: 1, title: 'The Job', backdrop: 'city', music: 'story',
      lines: [
        { who: 'npc', npc: 'fixer', text: (c) => `${c.corp} caught a wyrm. ${c.wyrm}. They chained it under their tower and they’ve been selling its dreams as entertainment.` },
        { who: 'npc', npc: 'fixer', text: 'Its heart-core sits in their vault. Get it out, and the wyrm stops being their property. What happens after is your call.' },
        { who: 'npc', npc: 'fixer', text: 'Two ways in. Pick one, and don’t get caught. Heat hits a hundred, you’re done.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'How do you get into the tower?',
        options: [
          { label: 'Front door, in stolen corp skins', detail: 'guards hesitate in fights · +5 heat', icon: 'talk', effects: { boon: 'disguise', meter: 5 }, next: 'lobby' },
          { label: 'Up through the maintenance vents', detail: 'no heat · something lives in the vents', icon: 'sneak', next: 'vents' },
        ],
      },
    },
    vents: {
      chapter: 2, title: 'The Vents', backdrop: 'tower', music: 'combat',
      lines: [{ who: 'narrator', text: 'The vents are tight, warm, and full of tentacles made of broken pixels.' }],
      step: { kind: 'fight', foe: 'kraken', next: 'security' },
    },
    lobby: {
      chapter: 2, title: 'The Lobby', backdrop: 'tower', music: 'tense',
      lines: [
        { who: 'narrator', text: (c) => `The ${c.corp} lobby scans your stolen skins... and accepts them. Mostly.` },
        { who: 'narrator', text: 'A Sentinel daemon stands by the elevators, turning its blank face slowly from guest to guest.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'The Sentinel is watching the elevators.',
        options: [
          { label: 'Walk past it, calmly', detail: 'no fight · +12 heat as it logs you', icon: 'sneak', effects: { meter: 12 }, next: 'security' },
          { label: 'Take it out in the stairwell', detail: 'fight it, quietly', icon: 'fight', next: 'lobby_fight' },
        ],
      },
    },
    lobby_fight: {
      chapter: 2, title: 'The Stairwell', backdrop: 'tower', music: 'combat',
      lines: [{ who: 'narrator', text: 'You lure it into the stairwell. It follows, raising its blade.' }],
      step: { kind: 'fight', foe: 'sentinel', next: 'security', win: { boon: 'core', flags: ['keycard'] } },
    },
    security: {
      chapter: 3, title: 'The Vault Floor', backdrop: 'vault', music: 'tense',
      lines: [
        { who: 'narrator', text: (c) => (c.flags.has('keycard') ? 'The Sentinel dropped a keycard. The vault lock already shows one glyph lit.' : 'A glyph lock guards the vault floor.') },
        { who: 'narrator', text: 'The Mage can read the sequence. Only the Rogue can enter it. Three mistakes and the alarm goes.' },
      ],
      step: { kind: 'puzzle', length: 3, success: 'vault', failure: 'alarm' },
    },
    alarm: {
      chapter: 3, title: 'Alarm', backdrop: 'vault', music: 'combat',
      effects: { meter: 12 },
      lines: [{ who: 'narrator', text: 'ALARM. Shutters slam. A server rack opens a mouth full of teeth.' }],
      step: { kind: 'fight', foe: 'mimic', next: 'vault' },
    },
    vault: {
      chapter: 4, title: 'The Vault', backdrop: 'vault', music: 'tense',
      lines: [
        { who: 'narrator', text: 'Behind the last door, chained in light, a heart-core the size of a car beats slowly. And something speaks through it.' },
        { who: 'wyrm', text: (c) => `Thieves. Have you come to free me, or only to rob them? I am ${c.wyrm}. I ${c.temperament.split(':')[0]}. Choose your words.` },
      ],
      step: { kind: 'parley', npc: 'wyrm', goal: 14, lines: 4, success: 'vault_open', failure: 'vault_guard' },
    },
    vault_open: {
      chapter: 4, title: 'The Vault', backdrop: 'vault', music: 'story',
      effects: { flags: ['freed'] },
      lines: [{ who: 'wyrm', text: 'Take my heart, then, little thieves. Carry it out of this place, and I will not follow you. I will follow them.' }],
      step: { kind: 'goto', next: 'escape' },
    },
    vault_guard: {
      chapter: 4, title: 'The Vault', backdrop: 'vault', music: 'combat',
      lines: [{ who: 'wyrm', text: 'Liars. Thieves. My guard will enjoy you.' }],
      step: { kind: 'fight', foe: 'hound', elite: true, next: 'escape' },
    },
    escape: {
      chapter: 5, title: 'The Escape', backdrop: 'city', music: 'tense',
      lines: [
        { who: 'narrator', text: 'You have the heart. Every alarm in the tower is screaming now.' },
        { who: 'narrator', text: (c) => (c.flags.has('freed') ? 'Far below, chains are snapping one by one. The wyrm is keeping its word.' : 'Far below, something enormous is waking up very, very angry.') },
      ],
      step: {
        kind: 'choice',
        prompt: 'Which way out?',
        options: [
          { label: 'Jump from the roof', detail: '+10 heat · fast', icon: 'risk', effects: { meter: 10 }, next: 'final' },
          { label: 'Fight down through the lobby', detail: 'no heat · they will be waiting', icon: 'fight', next: 'final' },
        ],
      },
    },
    final: {
      chapter: 5, title: 'The Last Stand', backdrop: 'tower', music: 'boss',
      lines: [],
      step: { kind: 'goto', next: (c) => (c.flags.has('freed') ? 'final_corp' : 'final_wyrm') },
    },
    final_corp: {
      chapter: 5, title: 'The Last Stand', backdrop: 'tower', music: 'combat',
      lines: [{ who: 'narrator', text: (c) => `${c.corp} sends everything it has left: a Sentinel daemon, burning white with rage.` }],
      step: { kind: 'fight', foe: 'sentinel', elite: true, next: 'heist_end' },
    },
    final_wyrm: {
      chapter: 5, title: 'The Last Stand', backdrop: 'lair', music: 'boss',
      lines: [{ who: 'wyrm', text: 'You stole my heart and gave me nothing. I will take it back from your mouths.' }],
      step: { kind: 'boss', next: 'heist_end' },
    },
    heist_end: {
      chapter: 5, title: 'Out', backdrop: 'city', music: 'victory',
      lines: [],
      step: {
        kind: 'ending',
        title: (c) => (c.flags.has('freed') ? 'The Wyrm Goes Free' : 'The Heart in Your Hands'),
        text: (c) =>
          c.flags.has('freed')
            ? `You hit the street with the heart as the tower behind you begins to shake. By morning ${c.corp} has a hole in its foundations shaped like a wyrm, and the dreams on every screen are finally its own.`
            : `You escape with the heart, and ${c.wyrm} lies sealed in the wreck of the tower. The fixer pays double. You keep wondering whether it would have kept its word.`,
      },
    },
  },
};

// ---------------------------------------------------------------- survival

const survival: Story = {
  id: 'survival',
  title: 'Four Nights',
  pitch: 'hold the last lit safehouse in the city until dawn, four nights running',
  meterName: 'dread',
  chapters: 5,
  difficulty: 1.3,
  start: 'day1',
  lose: {
    title: 'The Lights Go Out',
    text: (c) => `The dread finally breaks you. The safehouse goes dark like every other window in the city, and ${c.wyrm} dreams on, undisturbed.`,
  },
  nodes: {
    day1: {
      chapter: 1, title: 'The First Day', backdrop: 'camp', music: 'story',
      lines: [
        { who: 'narrator', text: (c) => `${c.wyrm} is dreaming, and its dreams are leaking. Every night the horrors from its sleep crawl out into ${c.district}.` },
        { who: 'narrator', text: 'Your safehouse is the last window in the city still lit. Hold it for four nights, and the dream will end at dawn.' },
        { who: 'narrator', text: 'You have one day before the first night. How do you spend it?' },
      ],
      step: {
        kind: 'choice',
        prompt: 'The first day.',
        options: [
          { label: 'Scavenge weapons', detail: 'rail-gun: Bolt +4', icon: 'loot', effects: { boon: 'weapons' }, next: 'night1' },
          { label: 'Fortify the doors', detail: '+1 Ward every chapter', icon: 'rest', effects: { boon: 'fortified' }, next: 'night1' },
          { label: 'Search for survivors', detail: '+10 dread · they’ll fight beside you', icon: 'help', effects: { meter: 10, boon: 'survivors', flags: ['survivors'] }, next: 'night1' },
        ],
      },
    },
    night1: {
      chapter: 2, title: 'The First Night', backdrop: 'camp', music: 'night',
      lines: [{ who: 'narrator', text: 'The lights flicker. Something sniffs at the bottom of the door, then laughs like a dog would, if dogs could laugh.' }],
      step: { kind: 'fight', foe: 'hound', next: 'day2' },
    },
    day2: {
      chapter: 3, title: 'The Second Day', backdrop: 'street', music: 'story',
      lines: [
        { who: 'narrator', text: 'Dawn, grey and quiet. A crew of scavengers is setting up camp across the street. Their leader is watching your windows.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'The second day.',
        options: [
          { label: 'Pray at the old shrine', detail: '−15 dread', icon: 'rest', effects: { meter: -15 }, next: 'night2' },
          { label: 'Talk to the scavengers', detail: 'convince Rook to share what they have', icon: 'talk', next: 'scav' },
          { label: 'Raid the corp depot', detail: 'a fight · Mend +4 if you win', icon: 'risk', next: 'depot' },
        ],
      },
    },
    scav: {
      chapter: 3, title: 'Rook', backdrop: 'street', music: 'story',
      lines: [{ who: 'npc', npc: 'scavenger', text: 'You’re the ones with the lights on. Brave or stupid. What do you want, and what’s in it for us?' }],
      step: { kind: 'parley', npc: 'scavenger', goal: 12, lines: 3, success: 'scav_yes', failure: 'scav_no' },
    },
    scav_yes: {
      chapter: 3, title: 'Rook', backdrop: 'street', music: 'story',
      effects: { boon: 'blessing', flags: ['rook'] },
      lines: [{ who: 'npc', npc: 'scavenger', text: 'Fine. Medkits, the good ones. And if you’re still breathing on the fourth night, we’ll be at your door.' }],
      step: { kind: 'goto', next: 'night2' },
    },
    scav_no: {
      chapter: 3, title: 'Rook', backdrop: 'street', music: 'story',
      effects: { meter: 8 },
      lines: [{ who: 'npc', npc: 'scavenger', text: 'Nah. Keep your lights. We’ll watch how it goes.' }],
      step: { kind: 'goto', next: 'night2' },
    },
    depot: {
      chapter: 3, title: 'The Depot', backdrop: 'tower', music: 'combat',
      lines: [{ who: 'narrator', text: 'The depot’s supply crates are real. Mostly. One of them is breathing.' }],
      step: { kind: 'fight', foe: 'mimic', next: 'night2', win: { boon: 'blessing' } },
    },
    night2: {
      chapter: 4, title: 'The Second Night', backdrop: 'camp', music: 'night',
      lines: [{ who: 'narrator', text: 'The drains gurgle. The floor goes soft. It is coming up from below this time.' }],
      step: { kind: 'fight', foe: 'ooze', next: 'day3' },
    },
    day3: {
      chapter: 4, title: 'The Third Day', backdrop: 'camp', music: 'story',
      lines: [{ who: 'narrator', text: 'Two nights down. You can feel the dream getting closer to waking. Tonight it will send its worst.' }],
      step: {
        kind: 'choice',
        prompt: 'The third day.',
        options: [
          { label: 'Rest and hold a vigil', detail: '−12 dread', icon: 'rest', effects: { meter: -12 }, next: 'night3' },
          { label: 'Prepare the old seal', detail: 'a glyph lock · the final night’s horror is weaker if it works', icon: 'path', next: 'seal' },
        ],
      },
    },
    seal: {
      chapter: 4, title: 'The Seal', backdrop: 'shrine', music: 'tense',
      lines: [{ who: 'narrator', text: 'The old seal is a glyph lock. The Mage reads it; the Rogue sets it. Get it wrong and the dread seeps in.' }],
      step: { kind: 'puzzle', length: 4, success: 'seal_yes', failure: 'night3' },
    },
    seal_yes: {
      chapter: 4, title: 'The Seal', backdrop: 'shrine', music: 'story',
      effects: { flags: ['sealed'] },
      lines: [{ who: 'narrator', text: 'The seal hums awake. Whatever comes tonight will come weaker.' }],
      step: { kind: 'goto', next: 'night3' },
    },
    night3: {
      chapter: 5, title: 'The Last Night', backdrop: 'lair', music: 'boss',
      lines: [
        { who: 'narrator', text: (c) => `The last night. The street outside folds open like a mouth, and ${c.wyrm} itself climbs out of its own dream.` },
        { who: 'narrator', text: (c) => (c.flags.has('rook') ? 'Across the street, Rook’s scavengers light their torches and run to your door.' : 'You are alone with it.') },
        { who: 'wyrm', text: (c) => `One window still lit. I ${c.temperament.split(':')[0]}. Make it worth my while.` },
      ],
      step: { kind: 'boss', next: 'surv_end' },
    },
    surv_end: {
      chapter: 5, title: 'Dawn', backdrop: 'city', music: 'victory',
      lines: [],
      step: {
        kind: 'ending',
        title: (c) => (c.flags.has('survivors') || c.flags.has('rook') ? 'Morning, Together' : 'Morning'),
        text: (c) =>
          c.flags.has('survivors') || c.flags.has('rook')
            ? `Dawn comes. The dream breaks. You walk out into the street with everyone you saved, and one by one, the windows of ${c.district} light up again.`
            : `Dawn comes, and ${c.wyrm}’s dream finally ends. The safehouse is the only window lit for an hour, and then the city remembers how to wake.`,
      },
    },
  },
};

export const STORIES: Record<ModeId, Story> = { adventure, heist, survival };

export function text(t: Text, c: StoryCtx): string {
  return typeof t === 'function' ? t(c) : t;
}
