import type { Backdrop, ModeId, Mood, OptionIcon } from '../../shared/protocol.js';

// The three stories. Each is a small graph of chapters: narration, a crew
// decision, then a fight, a lock, or a conversation. Choices set flags that
// change later lines, later options, and which ending the crew reaches.

export interface StoryCtx {
  wyrm: string;
  breed: string;
  temperament: string;
  boast: string;
  district: string;
  corp: string;
  flags: ReadonlySet<string>;
}

export type Text = string | ((c: StoryCtx) => string);

export interface Line {
  /** Neutral narration, ECHO, an NPC (by id), or the wyrm. */
  who: 'narrator' | 'echo' | 'npc' | 'wyrm';
  npc?: string;
  text: Text;
}

export interface Effects {
  meter?: number;
  flags?: string[];
  boon?: string;
  /** Relics recovered by every Joe in the crew. */
  items?: string[];
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
  | { kind: 'boss'; next: string; foe?: string }
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
  /** One player carries every role, and nothing is saved (the tutorial). */
  practice?: boolean;
  start: string;
  lose: { title: Text; text: Text };
  nodes: Record<string, StoryNode>;
}

// ---------------------------------------------------------------- adventure

const adventure: Story = {
  id: 'adventure',
  title: 'The Last Pilgrimage',
  pitch: 'carry ECHO’s unfinished seal beneath the city and face the truth of his fallen crew',
  meterName: 'corruption',
  chapters: 10,
  start: 'gate',
  lose: {
    title: 'The City Falls',
    text: (c) => `The corruption takes the last of your light. ${c.wyrm} rises through the net, and one by one, the windows of Neo-Avalon go dark.`,
  },
  nodes: {
    gate: {
      chapter: 1, title: 'The Undercroft Gate', backdrop: 'street', music: 'story',
      lines: [
        { who: 'narrator', text: (c) => `At midnight, every screen showed the same thing: ${c.wyrm} opening one eye.` },
        { who: 'narrator', text: 'If its second eye opens, Neo-Avalon goes dark for good.' },
        { who: 'echo', text: (c) => `I know that eye. I fought ${c.wyrm} when this city was young. I sealed it, but I could not finish the work.` },
        { who: 'echo', text: 'I lost my crew by trying to carry every burden alone. Stay together. Finish what I could not.' },
        { who: 'narrator', text: 'You carry the last seal. Reach the wyrm and bind it before corruption reaches 100%.' },
        { who: 'narrator', text: 'The Undercroft gate is your first obstacle. A faceless Sentinel blocks the way.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'Your first move?',
        options: [
          { label: 'Face the Sentinel', detail: 'earn a clean path forward', icon: 'fight', next: 'gate_fight' },
          { label: 'Take the drain', detail: 'evade the Sentinel · gain 10 corruption', icon: 'sneak', effects: { meter: 10, flags: ['tunnels'] }, next: 'crypt' },
        ],
      },
    },
    gate_fight: {
      chapter: 1, title: 'The Undercroft Gate', backdrop: 'street', music: 'combat',
      lines: [{ who: 'narrator', text: 'The Sentinel turns. Its blade is made from the names of crews who failed here.' }],
      step: { kind: 'fight', foe: 'sentinel', next: 'crypt' },
    },
    crypt: {
      chapter: 1, title: 'The Hall of Names', backdrop: 'street', music: 'tense',
      lines: [
        { who: 'narrator', text: 'Past the gate waits a hall carved with thousands of names. Four have been burned away.' },
        { who: 'echo', text: 'My crew. Lumen, Bramble, Quiet, and me. The wyrm did not erase those names. I did, when I closed the seal too soon.' },
        { who: 'narrator', text: 'A cracked crew badge still glows beneath the ash.' },
      ],
      step: {
        kind: 'choice', prompt: 'What do you carry forward?',
        options: [
          { label: 'Recover the crew badge', detail: 'remember the fallen · their light may answer later', icon: 'help', effects: { flags: ['remembered'] }, next: 'market' },
          { label: 'Leave the dead in peace', detail: 'move quickly · corruption falls by 5', icon: 'path', effects: { meter: -5, flags: ['left_badge'] }, next: 'market' },
        ],
      },
    },
    market: {
      chapter: 2, title: 'The Drowned Market', backdrop: 'market', music: 'story',
      lines: [
        { who: 'narrator', text: (c) => (c.flags.has('tunnels') ? 'You climb from the drain into the flooded Drowned Market.' : 'Beyond the gate, the Drowned Market sleeps under black water.') },
        { who: 'narrator', text: 'A young kitsune is trapped in a net of static. The still water around her is a warning.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'Save a stranger, or arm the mission?',
        options: [
          { label: 'Free the kitsune', detail: 'risk the trap · gain a possible ally', icon: 'help', next: 'market_trap' },
          { label: 'Take the rail-gun', detail: 'Bolt +4 · leave her behind', icon: 'loot', effects: { boon: 'weapons', flags: ['left_kitsune'] }, next: 'market_bell' },
        ],
      },
    },
    market_trap: {
      chapter: 2, title: 'The Drowned Market', backdrop: 'market', music: 'combat',
      lines: [{ who: 'narrator', text: 'The moment the net breaks, the water rises. She was bait.' }],
      step: { kind: 'fight', foe: 'ooze', next: 'market_freed', win: { boon: 'ally', flags: ['kitsune'] } },
    },
    market_freed: {
      chapter: 2, title: 'The Drowned Market', backdrop: 'market', music: 'story',
      lines: [{ who: 'npc', npc: 'kitsune', text: 'You chose me over the mission. I will make sure the mission survives. Follow me.' }],
      step: { kind: 'goto', next: 'market_bell' },
    },
    market_bell: {
      chapter: 2, title: 'The Bell Beneath the Water', backdrop: 'market', music: 'tense',
      lines: [
        { who: 'narrator', text: 'A bell rings beneath the flooded street. Each note makes the last seal heavier.' },
        { who: 'echo', text: 'That bell called my crew to the wyrm. It will call the drowned unless we silence it.' },
        { who: 'narrator', text: 'Five glyphs circle its rusted clapper.' },
      ],
      step: { kind: 'puzzle', length: 3, success: 'bridge', failure: 'market_bell_guard' },
    },
    market_bell_guard: {
      chapter: 2, title: 'The Bell Beneath the Water', backdrop: 'market', music: 'combat',
      effects: { meter: 6 },
      lines: [{ who: 'narrator', text: 'The wrong glyph tolls. The market water stands upright and takes the shape of the Mireborn.' }],
      step: { kind: 'fight', foe: 'ooze', next: 'bridge' },
    },
    bridge: {
      chapter: 3, title: 'The Bridge of Static', backdrop: 'bridge', music: 'tense',
      lines: [
        { who: 'narrator', text: (c) => (c.flags.has('kitsune') ? 'Your new ally leads you to the Bridge of Static.' : 'The Bridge of Static hangs over a fall with no visible end.') },
        { who: 'narrator', text: 'A glyph lock seals the bridge. The Mage reads it. The Rogue opens it. Neither can succeed alone.' },
      ],
      step: { kind: 'puzzle', length: 4, success: 'bridge_crossing', failure: 'bridge_alarm' },
    },
    bridge_alarm: {
      chapter: 3, title: 'The Bridge of Static', backdrop: 'bridge', music: 'combat',
      lines: [{ who: 'narrator', text: 'The glyphs flare red. Something with too many teeth comes loping across the bridge.' }],
      step: { kind: 'fight', foe: 'hound', next: 'bridge_crossing' },
    },
    bridge_crossing: {
      chapter: 3, title: 'The Bridge of Static', backdrop: 'bridge', music: 'tense',
      lines: [
        { who: 'narrator', text: 'The lock opens, but half the bridge falls into the dark. Static storms across the remaining span.' },
        { who: 'echo', text: 'There is an old rail below us. I remember the way, though memory is not the same as truth.' },
      ],
      step: {
        kind: 'choice', prompt: 'Choose the crossing.',
        options: [
          { label: 'Follow ECHO’s old rail', detail: 'face what remembers his crew', icon: 'path', effects: { flags: ['echo_route'] }, next: 'bridge_hunt' },
          { label: 'Cross through the storm', detail: 'avoid the hunter · gain 12 corruption', icon: 'risk', effects: { meter: 12, flags: ['storm_crossed'] }, next: 'oracle' },
          { label: 'Trust the kitsune’s path', detail: 'a hidden crossing · reduce corruption by 8', icon: 'help', requires: 'kitsune', effects: { meter: -8, flags: ['fox_path'] }, next: 'oracle' },
        ],
      },
    },
    bridge_hunt: {
      chapter: 3, title: 'The Abandoned Rail', backdrop: 'bridge', music: 'combat',
      lines: [
        { who: 'narrator', text: 'A shape pads behind you without making a sound. Four dead voices whisper from inside its jaws.' },
        { who: 'echo', text: 'Gloamfang. It learned their voices. Do not answer when it calls your name.' },
      ],
      step: { kind: 'fight', foe: 'hound', elite: true, next: 'oracle', win: { boon: 'core' } },
    },
    oracle: {
      chapter: 4, title: 'The Oracle', backdrop: 'shrine', music: 'story',
      lines: [
        { who: 'narrator', text: 'Beyond the bridge waits the Oracle, keeper of the wyrm’s only weakness.' },
        { who: 'npc', npc: 'oracle', text: 'Little lights, I have watched a thousand heroes turn back.' },
        { who: 'npc', npc: 'oracle', text: 'Tell me why you will not. Give me a true reason, and I will show you where the wyrm can bleed.' },
      ],
      step: { kind: 'parley', npc: 'oracle', goal: 14, lines: 4, success: 'oracle_yes', failure: 'oracle_no' },
    },
    oracle_yes: {
      chapter: 4, title: 'The Oracle', backdrop: 'shrine', music: 'story',
      effects: { boon: 'oracle' },
      lines: [{ who: 'npc', npc: 'oracle', text: 'Then look. Where its scales split at the throat, the light gets in. Strike there first.' }],
      step: { kind: 'goto', next: 'echo_truth' },
    },
    oracle_no: {
      chapter: 4, title: 'The Oracle', backdrop: 'shrine', music: 'story',
      effects: { meter: 8 },
      lines: [{ who: 'npc', npc: 'oracle', text: 'No. You do not understand it yet. Go, and be brave without sight.' }],
      step: { kind: 'goto', next: 'echo_truth' },
    },
    echo_truth: {
      chapter: 4, title: 'ECHO’s Confession', backdrop: 'shrine', music: 'tense',
      lines: [
        { who: 'npc', npc: 'oracle', text: 'The guide has not told you why the seal answers his voice.' },
        { who: 'echo', text: 'The seal needed a living light. I gave it theirs. I shut the wyrm below and left my crew on the wrong side.' },
        { who: 'echo', text: 'I have guided crews here for years because I was afraid to return alone. You deserved that truth before the final door.' },
      ],
      step: {
        kind: 'choice', prompt: 'What does the crew demand of ECHO?',
        options: [
          { label: 'Finish it beside us', detail: 'forgiveness with a price · ECHO must enter the seal', icon: 'help', effects: { flags: ['forgave_echo'], boon: 'fortified' }, next: 'ashen_castle' },
          { label: 'No more secrets', detail: 'keep control of the seal · gain 5 corruption', icon: 'risk', effects: { flags: ['took_seal'], meter: 5 }, next: 'ashen_castle' },
        ],
      },
    },
    ashen_castle: {
      chapter: 5, title: 'Castle Ashenwake', backdrop: 'castle', music: 'tense',
      lines: [
        { who: 'narrator', text: 'The road ends at a castle hanging upside down beneath the city. Its towers point into an abyss with no stars.' },
        { who: 'echo', text: 'Ashenwake was built to guard the first seal. We entered through its crown and came out through its grave.' },
        { who: 'narrator', text: 'Three gates bear the faces of a wolf, a moth, and a weeping king. One face is warm.' },
      ],
      step: { kind: 'choice', prompt: 'Which gate do you trust?', options: [
        { label: 'The warm wolf gate', detail: 'follow the living heat · wake its hunter', icon: 'risk', effects: { flags: ['wolf_gate'] }, next: 'crowned_hound' },
        { label: 'The silent moth gate', detail: 'cross the dust gallery · harvest forgotten silk', icon: 'loot', effects: { items: ['moon-silk'] }, next: 'dust_gallery' },
        { label: 'The weeping king', detail: 'offer a true memory · lower corruption by 8', icon: 'talk', effects: { meter: -8, flags: ['king_memory'] }, next: 'dust_gallery' },
      ] },
    },
    crowned_hound: {
      chapter: 5, title: 'The Wolf Gate', backdrop: 'castle', music: 'combat',
      lines: [
        { who: 'narrator', text: 'Gloamfang returns, taller than the gate and plated in pieces of the bridge. A crown of dead antennae grows from its skull.' },
        { who: 'echo', text: 'It remembers how you fought. Your relics are the only surprise left.' },
      ],
      step: { kind: 'fight', foe: 'crowned-hound', elite: true, next: 'dust_gallery', win: { items: ['gloam-crown'] } },
    },
    dust_gallery: {
      chapter: 5, title: 'The Gallery of Dust', backdrop: 'castle', music: 'story',
      lines: [
        { who: 'narrator', text: 'Portraits turn their heads as you pass. Every painted crew is missing the same fifth member.' },
        { who: 'echo', text: 'Do not ask who was cut away. Not yet.' },
      ],
      step: { kind: 'puzzle', length: 4, success: 'moon_kennel', failure: 'portrait_guard' },
    },
    portrait_guard: {
      chapter: 5, title: 'The Gallery of Dust', backdrop: 'castle', music: 'combat', effects: { meter: 7 },
      lines: [{ who: 'narrator', text: 'A wrong glyph opens every painted mouth. Their stolen armor assembles into the Argent Mourner.' }],
      step: { kind: 'fight', foe: 'argent-sentinel', next: 'moon_kennel' },
    },
    moon_kennel: {
      chapter: 6, title: 'The Moonkennel', backdrop: 'abyss', music: 'story',
      lines: [
        { who: 'narrator', text: 'Below Ashenwake, silver cages orbit a dead moon. Something enormous breathes inside the nearest one.' },
        { who: 'echo', text: 'The old keepers fed these beasts fear. We can starve one, free one, or steal what its cage has grown.' },
      ],
      step: { kind: 'choice', prompt: 'How does the crew cross the kennel?', options: [
        { label: 'Free the Glasswing', detail: 'fight for its trust · gain a flying ally', icon: 'help', next: 'glasswing' },
        { label: 'Harvest moon-iron', detail: 'claim a powerful defense relic · raise corruption by 8', icon: 'loot', effects: { meter: 8, items: ['moon-iron'] }, next: 'kennel_lock' },
        { label: 'Starve the cages', detail: 'move quietly · weaken the beasts ahead', icon: 'sneak', effects: { flags: ['starved_kennel'] }, next: 'kennel_lock' },
      ] },
    },
    glasswing: {
      chapter: 6, title: 'The Glasswing Cage', backdrop: 'abyss', music: 'combat',
      lines: [{ who: 'narrator', text: 'The Glasswing Manticore unfolds from its cage: lion, moth, and broken mirror. It attacks the chain holding it before it attacks you.' }],
      step: { kind: 'fight', foe: 'glasswing', next: 'glasswing_freed', win: { flags: ['glasswing_ally'], items: ['glasswing-scale'] } },
    },
    glasswing_freed: {
      chapter: 6, title: 'The Glasswing Cage', backdrop: 'abyss', music: 'story',
      lines: [{ who: 'narrator', text: 'The beast lowers one mirrored wing. In its reflection, ECHO has a face—and behind that face, a second eye.' }],
      step: { kind: 'goto', next: 'kennel_lock' },
    },
    kennel_lock: {
      chapter: 6, title: 'The Moonkennel', backdrop: 'abyss', music: 'tense',
      lines: [{ who: 'echo', text: 'The cage-path is a living glyph. Read it slowly. It bites crews who rush.' }],
      step: { kind: 'puzzle', length: 5, success: 'oracle_return', failure: 'kennel_beast' },
    },
    kennel_beast: {
      chapter: 6, title: 'The Moonkennel', backdrop: 'abyss', music: 'combat', effects: { meter: 8 },
      lines: [{ who: 'narrator', text: 'The lock snaps. Vespercoil molts out of the walls, now wrapped in the bones of its own cage.' }],
      step: { kind: 'fight', foe: 'bonecoil', elite: true, next: 'oracle_return' },
    },
    oracle_return: {
      chapter: 7, title: 'The Oracle’s Price', backdrop: 'shrine', music: 'story',
      lines: [
        { who: 'narrator', text: 'The Oracle waits inside a shrine that was not here before. Every candle bends away from ECHO.' },
        { who: 'npc', npc: 'oracle', text: 'Little lights, your guide is not haunted by the wyrm. He is the piece of it that learned regret.' },
        { who: 'npc', npc: 'oracle', text: 'Ask me what must be saved. Ask well. The answer will cost a certainty.' },
      ],
      step: { kind: 'parley', npc: 'oracle', goal: 18, lines: 5, success: 'oracle_last_truth', failure: 'oracle_silent' },
    },
    oracle_last_truth: {
      chapter: 7, title: 'The Oracle’s Price', backdrop: 'shrine', music: 'story', effects: { boon: 'oracle', items: ['oracle-thread'], flags: ['oracle_truth'] },
      lines: [
        { who: 'npc', npc: 'oracle', text: 'The final monster is Noctyra, the Eclipse Sovereign. The wyrm you hunted is only its discarded hunger.' },
        { who: 'npc', npc: 'oracle', text: 'ECHO is its discarded mercy. Destroy either half alone, and the other becomes whole.' },
      ],
      step: { kind: 'goto', next: 'glass_cathedral' },
    },
    oracle_silent: {
      chapter: 7, title: 'The Oracle’s Price', backdrop: 'shrine', music: 'tense', effects: { meter: 10, flags: ['oracle_silent'] },
      lines: [{ who: 'npc', npc: 'oracle', text: 'You asked for victory when you should have asked what victory wakes. Go without my thread.' }],
      step: { kind: 'goto', next: 'glass_cathedral' },
    },
    glass_cathedral: {
      chapter: 8, title: 'The Glass Cathedral', backdrop: 'cathedral', music: 'tense',
      lines: [
        { who: 'narrator', text: 'A cathedral of black glass grows around the road. In every window, the crew sees a different ending.' },
        { who: 'echo', text: 'Noctyra built this place from choices we almost made. Break the future that flatters you most.' },
      ],
      step: { kind: 'choice', prompt: 'Which false future do you shatter?', options: [
        { label: 'The crew crowned as heroes', detail: 'refuse glory · gain the Crownshard', icon: 'fight', effects: { flags: ['refused_crown'], items: ['crownshard'] }, next: 'cathedral_lock' },
        { label: 'The city forever safe', detail: 'refuse a beautiful lie · lower corruption by 10', icon: 'help', effects: { meter: -10, flags: ['refused_lie'] }, next: 'cathedral_lock' },
        { label: 'ECHO restored to life', detail: 'force him to release the past', icon: 'talk', effects: { flags: ['echo_released'] }, next: 'cathedral_lock' },
      ] },
    },
    cathedral_lock: {
      chapter: 8, title: 'The Rose Lock', backdrop: 'cathedral', music: 'tense',
      lines: [{ who: 'narrator', text: 'The rose window becomes a five-ring glyph lock. Each correct mark turns the whole cathedral around you.' }],
      step: { kind: 'puzzle', length: 5, success: 'seraph', failure: 'seraph_angry' },
    },
    seraph: {
      chapter: 8, title: 'The Glass Seraph', backdrop: 'cathedral', music: 'combat',
      lines: [{ who: 'narrator', text: 'The lock opens. The Mourning Sentinel descends from the rafters with six blades and wings made of cathedral glass.' }],
      step: { kind: 'fight', foe: 'glass-seraph', elite: true, next: 'inverted_keep', win: { items: ['seraph-feather'] } },
    },
    seraph_angry: {
      chapter: 8, title: 'The Glass Seraph', backdrop: 'cathedral', music: 'combat', effects: { meter: 10 },
      lines: [{ who: 'narrator', text: 'The rose shatters inward. Its guardian wakes furious, every blade already pointed at a Joe.' }],
      step: { kind: 'fight', foe: 'glass-seraph', elite: true, next: 'inverted_keep' },
    },
    inverted_keep: {
      chapter: 9, title: 'The Inverted Keep', backdrop: 'castle', music: 'tense',
      lines: [
        { who: 'narrator', text: 'Ashenwake turns inside out. Rooms orbit the crew; doors lead back to choices made hours ago.' },
        { who: 'echo', text: 'This is the trap. Noctyra wins by making us repeat ourselves until hope feels foolish.' },
      ],
      step: { kind: 'choice', prompt: 'The same three doors return. What changed?', options: [
        { label: 'The shadows point inward', detail: 'follow them to the heart', icon: 'path', effects: { flags: ['saw_inward'] }, next: 'abyss_mire' },
        { label: 'ECHO casts two shadows', detail: 'confront the guide now', icon: 'talk', effects: { flags: ['confronted_echo'] }, next: 'echo_origin' },
        { label: 'Nothing changed', detail: 'force the old route · gain 14 corruption', icon: 'risk', effects: { meter: 14 }, next: 'abyss_mire' },
      ] },
    },
    echo_origin: {
      chapter: 9, title: 'ECHO Unmasked', backdrop: 'abyss', music: 'story',
      lines: [
        { who: 'echo', text: 'You see it. Good. I was never the fifth member of that crew. I was the thing they cut from Noctyra to make the first seal.' },
        { who: 'echo', text: 'I borrowed the face of the Joe who carried me out. I borrowed his guilt too. After so long, I no longer know which part is mine.' },
        { who: 'narrator', text: 'The guide lowers his hood. Golden light pours from a crack shaped exactly like the final glyph.' },
      ],
      step: { kind: 'choice', prompt: 'What is ECHO now?', options: [
        { label: 'One of us', detail: 'a choice can become a person', icon: 'help', effects: { flags: ['echo_is_joe'], boon: 'fortified' }, next: 'abyss_mire' },
        { label: 'A key, nothing more', detail: 'keep him close · keep your distance', icon: 'risk', effects: { flags: ['echo_is_key'], items: ['echo-heart'] }, next: 'abyss_mire' },
      ] },
    },
    abyss_mire: {
      chapter: 9, title: 'The Root Below', backdrop: 'abyss', music: 'combat',
      lines: [{ who: 'narrator', text: 'The Mireborn rises one final time, now a cathedral-sized sea wearing the faces of every monster already defeated.' }],
      step: { kind: 'fight', foe: 'abyss-mire', elite: true, next: 'lair_gate', win: { items: ['abyss-heart'] } },
    },
    lair_gate: {
      chapter: 10, title: 'The Door That Breathes', backdrop: 'lair', music: 'tense',
      lines: [
        { who: 'narrator', text: 'The final door breathes in time with the city. Behind it, millions of sleeping minds turn toward you.' },
        { who: 'echo', text: (c) => (c.flags.has('forgave_echo') ? 'When it opens, give me the seal. This time I stay with my crew.' : 'You hold the seal now. Whatever happens next will be your choice, not mine.') },
      ],
      step: { kind: 'puzzle', length: 4, success: 'lair', failure: 'lair_guard' },
    },
    lair_guard: {
      chapter: 10, title: 'The Door That Breathes', backdrop: 'lair', music: 'combat',
      effects: { meter: 8 },
      lines: [{ who: 'narrator', text: 'The door tears itself free from the wall. The Mourning Sentinel steps through wearing ECHO’s erased name.' }],
      step: { kind: 'fight', foe: 'glass-seraph', elite: true, next: 'lair' },
    },
    lair: {
      chapter: 10, title: 'The Eclipse Throne', backdrop: 'lair', music: 'boss',
      lines: [
        { who: 'narrator', text: (c) => `${c.wyrm} is coiled around Neo-Avalon’s heart—but the body is only a husk. Behind it, an eclipse unfolds wings across the sky.` },
        { who: 'echo', text: 'Noctyra. The part of me that never learned mercy. It has been growing while I led crews here.' },
        { who: 'narrator', text: (c) => (c.flags.has('kitsune') ? 'The kitsune stands beside you. The life you saved has followed you to the end.' : 'You are small. The seal in your hands is smaller. It is still enough.') },
        { who: 'wyrm', text: (c) => `Little lights. ${c.boast} Show me why your city deserves another dawn.` },
      ],
      step: { kind: 'boss', foe: 'noctyra', next: 'final_glyph' },
    },
    final_glyph: {
      chapter: 10, title: 'The Last Glyph', backdrop: 'abyss', music: 'boss',
      lines: [
        { who: 'narrator', text: 'Noctyra falls—and rises again without a body. Every shadow in Neo-Avalon points toward the crew.' },
        { who: 'echo', text: 'Steel cannot finish this. Open the last glyph yourselves. I will enter it only when you decide what I am.' },
      ],
      step: { kind: 'puzzle', length: 5, success: 'noctyra_true', failure: 'noctyra_enraged' },
    },
    noctyra_true: {
      chapter: 10, title: 'Noctyra Unbound', backdrop: 'abyss', music: 'boss',
      lines: [
        { who: 'wyrm', text: 'I AM THE NIGHT BETWEEN YOUR CHOICES. I HAVE EATEN EVERY ENDING IN WHICH YOU WIN.' },
        { who: 'echo', text: 'Then we make one you have never seen.' },
      ],
      step: { kind: 'boss', foe: 'noctyra-true', next: 'adv_end' },
    },
    noctyra_enraged: {
      chapter: 10, title: 'Noctyra Unbound', backdrop: 'abyss', music: 'boss', effects: { meter: 15 },
      lines: [{ who: 'wyrm', text: 'YOU BROKE THE KEY. NOW I WILL USE THE DOOR.' }],
      step: { kind: 'boss', foe: 'noctyra-true', next: 'adv_end' },
    },
    adv_end: {
      chapter: 10, title: 'Dawn After Eclipse', backdrop: 'city', music: 'victory',
      lines: [],
      step: {
        kind: 'ending',
        title: (c) => (c.flags.has('forgave_echo') && c.flags.has('remembered') ? 'Five Names at Dawn' : c.flags.has('forgave_echo') ? 'ECHO’s Last Light' : c.flags.has('kitsune') ? 'The Long Dawn' : 'A Seal Without Secrets'),
        text: (c) =>
          c.flags.has('forgave_echo') && c.flags.has('remembered')
            ? `${c.wyrm} falls silent as ECHO carries the recovered badge into the seal. Five names blaze across Neo-Avalon’s dawn: Lumen, Bramble, Quiet, ECHO, and yours. For the first time, none are erased.`
            : c.flags.has('forgave_echo')
              ? `${c.wyrm} sinks beneath the seal. ECHO looks back once, no longer a guide and no longer afraid, then becomes the last line of light across the closed door. The city wakes remembering his name.`
              : c.flags.has('kitsune')
                ? `You close the seal without ECHO’s sacrifice. ${c.wyrm} sleeps, the kitsune guards the threshold, and ECHO begins the long work of earning back your trust.`
                : `The seal closes over ${c.wyrm}. You leave with the truth and the last light in your own hands. ECHO follows at a distance. Neo-Avalon wakes, but forgiveness must wait.`,
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
        { who: 'echo', text: 'I helped forge those chains after my crew fell. I called it mercy. I was wrong. Bring the heart back into the light.' },
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
        { who: 'wyrm', text: (c) => `Thieves. Have you come to free me, or only to rob them? I am ${c.wyrm}. ${c.boast} Choose your words.` },
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
        { who: 'echo', text: 'I defended this light once. I survived three nights and lost everyone before dawn. You will not repeat my mistake.' },
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
        { who: 'echo', text: 'I could not stand beside my crew at the end. I stand beside yours now.' },
        { who: 'narrator', text: (c) => (c.flags.has('rook') ? 'Across the street, Rook’s scavengers light their torches and run to your door.' : 'You are alone with it.') },
        { who: 'wyrm', text: (c) => `One window still lit. ${c.boast} Make it worth my while.` },
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

// ---------------------------------------------------------------- daily
// A compact, replayable expedition: one omen, one hunt, one manual lock, one reward.

const daily: Story = {
  id: 'daily',
  title: 'The Warden’s Omen',
  pitch: 'follow today’s omen into a shifting dungeon and return with a relic',
  meterName: 'omen',
  chapters: 4,
  difficulty: 1.15,
  start: 'omen',
  lose: { title: 'The Omen Closes', text: 'The shifting dungeon seals until tomorrow. ECHO marks the path where your crew fell short.' },
  nodes: {
    omen: {
      chapter: 1, title: 'Today’s Omen', backdrop: 'city', music: 'story',
      lines: [
        { who: 'narrator', text: (c) => `At dawn, a black constellation appears above ${c.district}. Only your crew can see it.` },
        { who: 'echo', text: 'The Warden changes this road every day. What you harvest here may decide whether Noctyra lets you reach tomorrow.' },
      ],
      step: { kind: 'choice', prompt: 'Which omen does the crew follow?', options: [
        { label: 'The Crowned Paw', detail: 'hunt a stronger Gloamfang · attack harvest', icon: 'fight', effects: { flags: ['daily_hunt'] }, next: 'daily_hound' },
        { label: 'The Drowned Star', detail: 'enter a living cistern · magic harvest', icon: 'loot', effects: { flags: ['daily_mire'] }, next: 'daily_mire' },
        { label: 'The Sixfold Feather', detail: 'climb a ruined watch-castle · defense harvest', icon: 'path', effects: { flags: ['daily_seraph'] }, next: 'daily_seraph' },
      ] },
    },
    daily_hound: {
      chapter: 2, title: 'The Crowned Trail', backdrop: 'castle', music: 'combat',
      lines: [{ who: 'narrator', text: 'A young Crowned Gloamfang stalks the battlements, rehearsing the voices it will steal when it grows.' }],
      step: { kind: 'fight', foe: 'crowned-hound', next: 'daily_lock', win: { items: ['gloam-crown'] } },
    },
    daily_mire: {
      chapter: 2, title: 'The Drowned Star', backdrop: 'abyss', music: 'combat',
      lines: [{ who: 'narrator', text: 'The cistern turns upside down. A piece of the Mireborn falls upward toward the crew.' }],
      step: { kind: 'fight', foe: 'ooze', elite: true, next: 'daily_lock', win: { items: ['oracle-thread'] } },
    },
    daily_seraph: {
      chapter: 2, title: 'The Feather Tower', backdrop: 'cathedral', music: 'combat',
      lines: [{ who: 'narrator', text: 'A half-formed Seraph guards the tower’s only stair. Its missing wings are waiting inside your shadow.' }],
      step: { kind: 'fight', foe: 'argent-sentinel', next: 'daily_lock', win: { items: ['seraph-feather'] } },
    },
    daily_lock: {
      chapter: 3, title: 'The Warden’s Lock', backdrop: 'vault', music: 'tense',
      lines: [
        { who: 'echo', text: 'The reward vault changes its answer every sunrise. I cannot open it for you.' },
        { who: 'narrator', text: 'The Mage must reveal the living sequence. The Rogue must enter it. The lock remembers mistakes.' },
      ],
      step: { kind: 'puzzle', length: 5, success: 'daily_choice', failure: 'daily_guard' },
    },
    daily_guard: {
      chapter: 3, title: 'The Warden’s Lock', backdrop: 'vault', music: 'combat', effects: { meter: 12 },
      lines: [{ who: 'narrator', text: 'The failed sequence becomes a body. The vault has built a guard from your mistake.' }],
      step: { kind: 'fight', foe: 'mimic', elite: true, next: 'daily_choice' },
    },
    daily_choice: {
      chapter: 4, title: 'The Omen Vault', backdrop: 'vault', music: 'story',
      lines: [{ who: 'narrator', text: 'Three reliquaries open. The crew may carry one final prize into the next expedition.' }],
      step: { kind: 'choice', prompt: 'Choose today’s relic.', options: [
        { label: 'Moon-Silk Shiv', detail: 'rare attack relic', icon: 'loot', effects: { items: ['moon-silk'] }, next: 'daily_end' },
        { label: 'Moon-Iron Bulwark', detail: 'rare defense relic', icon: 'loot', effects: { items: ['moon-iron'] }, next: 'daily_end' },
        { label: 'Glasswing Talon', detail: 'epic attack relic', icon: 'loot', effects: { items: ['glasswing-scale'] }, next: 'daily_end' },
      ] },
    },
    daily_end: {
      chapter: 4, title: 'Omen Answered', backdrop: 'city', music: 'victory', lines: [],
      step: { kind: 'ending', title: 'Today’s Omen Answered', text: 'The black constellation folds into your new relic. Tomorrow, the Warden will draw another road.' },
    },
  },
};

// ---------------------------------------------------------------- tutorial
// One player, every role. A construct demonstrates automatic battle tactics.

const tutorial: Story = {
  id: 'tutorial',
  title: 'Training',
  pitch: 'learn relic loadouts, crew roles and the journey ahead',
  meterName: 'strain',
  chapters: 3,
  practice: true,
  difficulty: 0.5,
  start: 'welcome',
  lose: { title: 'Try Again', text: 'The construct flickers off. ECHO asks you to watch its next move and try again.' },
  nodes: {
    welcome: {
      chapter: 1, title: 'Reading a Monster', backdrop: 'street', music: 'story',
      lines: [
        { who: 'narrator', text: 'An old spirit steps from the static of an empty street. A candle burns where his heart should be.' },
        { who: 'echo', text: 'They call me ECHO. I fought the wyrm before you were born, and I am still paying for the crew I could not save.' },
        { who: 'echo', text: 'A real crew has a Rogue, a Mage, and a Cleric. Today, I will teach you to carry all three roles.' },
        { who: 'echo', text: 'Before danger, each Joe chooses a relic. Once the loadouts are locked, the crew reads the threat and fights as one.' },
        { who: 'echo', text: 'You steer the journey. Your preparation decides whether the crew survives its battles.' },
      ],
      step: {
        kind: 'choice',
        prompt: 'Ready to see the crew fight?',
        options: [{ label: 'Bring on the construct', detail: 'choose relics, then watch the strategy unfold', icon: 'fight', next: 'drill' }],
      },
    },
    drill: {
      chapter: 1, title: 'Reading a Monster', backdrop: 'street', music: 'combat',
      lines: [{ who: 'echo', text: 'Choose the relics you have, then lock the loadout. The Rogue will flank, the Mage will read the threat, and the Cleric will protect them.' }],
      step: { kind: 'fight', foe: 'dummy', next: 'lock' },
    },
    lock: {
      chapter: 2, title: 'Glyph Locks', backdrop: 'vault', music: 'tense',
      lines: [
        { who: 'echo', text: 'Some doors are sealed with glyphs. The Mage reads the order; only the Rogue can press it.' },
        { who: 'echo', text: 'Today you can read it yourself at the top of the screen. Press glyphs 1 to 5 in order.' },
      ],
      step: { kind: 'puzzle', length: 3, success: 'talk', failure: 'talk' },
    },
    talk: {
      chapter: 3, title: 'Words', backdrop: 'shrine', music: 'story',
      lines: [
        { who: 'echo', text: 'Not everything is won with a blade. The words I refused to say cost my crew dearly.' },
        { who: 'echo', text: 'Press T and speak in your own words. The Oracle wants a true and selfless reason to help you.' },
      ],
      step: { kind: 'parley', npc: 'oracle', goal: 6, lines: 3, success: 'done', failure: 'done' },
    },
    done: {
      chapter: 3, title: 'Words', backdrop: 'city', music: 'victory',
      lines: [{ who: 'echo', text: 'You are ready. Choose the road, gather what it offers, and never enter the dark unprepared.' }],
      step: {
        kind: 'ending',
        title: 'Training Complete',
        text: 'The lesson ends, but ECHO’s candle remains beside you as the empty street fades.',
      },
    },
  },
};

export const STORIES: Record<ModeId, Story> = { adventure, heist, survival, daily, tutorial };
/** The stories a crew can pick in the safehouse. */
export const CREW_STORIES: ModeId[] = ['adventure', 'heist', 'survival'];
/** Solo expeditions include the rotating daily preparation run. */
export const SOLO_STORIES: ModeId[] = [...CREW_STORIES, 'daily'];

export function text(t: Text, c: StoryCtx): string {
  return typeof t === 'function' ? t(c) : t;
}
