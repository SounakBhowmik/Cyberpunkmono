// Messages exchanged over the WebSocket. The server owns all game state; the
// client draws the scene, shows story and messages on the game console, plays
// music and effects, and keeps a small terminal for typed commands.

export type ClassId = 'rogue' | 'mage' | 'cleric';
export type ModeId = 'adventure' | 'heist' | 'survival';
export type WyrmColor = 'red' | 'blue' | 'green' | 'black' | 'white';
export type Mood = 'lobby' | 'story' | 'tense' | 'combat' | 'boss' | 'night' | 'victory' | 'defeat';
export type Backdrop = 'city' | 'street' | 'market' | 'bridge' | 'shrine' | 'tower' | 'vault' | 'lair' | 'camp';
export type Glyph = 'moon' | 'eye' | 'serpent' | 'crown' | 'key';
export type OptionIcon = 'fight' | 'sneak' | 'talk' | 'help' | 'rest' | 'loot' | 'risk' | 'path';

export interface HudMember {
  handle: string;
  /** Reroll count: the avatar is generated from handle + this number. */
  avatar: number;
  classes: ClassId[];
  you: boolean;
  host?: boolean;
  /** In a fight: has this player used every action they have this round? */
  ready?: boolean;
}

export interface WyrmInfo {
  name: string;
  title: string;
  color: WyrmColor;
  /** How to talk to it, e.g. "craves worship". */
  temperament: string;
}

export interface Meter {
  /** "corruption", "heat" or "dread", depending on the mode. */
  name: string;
  value: number;
}

export type HudState =
  | { mode: 'street'; handle?: string; avatar?: number }
  | { mode: 'safehouse'; code: string; party: HudMember[]; story: ModeId }
  | {
      mode: 'delve';
      code: string;
      story: ModeId;
      chapter: string;
      meter: Meter;
      wyrm: WyrmInfo;
      party: HudMember[];
      boons: { name: string; desc: string }[];
      wards: number;
    };

export type IntentKind = 'attack' | 'charge' | 'heavy' | 'shell' | 'wail';

export interface Intent {
  kind: IntentKind;
  amount: number;
  label: string;
  hint: string;
}

export interface Foe {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  /** Only the Mage sees this, until they call it out. */
  intent?: Intent;
  /** What the Mage called out this round, visible to everyone. */
  called?: { by: string; label: string };
  exposed?: boolean;
  elite?: boolean;
  boss?: boolean;
}

export interface ChoiceOption {
  id: string;
  label: string;
  detail: string;
  icon: OptionIcon;
  votes: string[];
}

export interface SceneState {
  view: 'story' | 'puzzle' | 'parley' | 'combat' | 'boss' | 'end';
  story: ModeId;
  chapter: { index: number; total: number; title: string };
  backdrop: Backdrop;
  music: Mood;
  meter: Meter;
  party: HudMember[];
  wyrm: WyrmInfo;
  choice?: { prompt: string; options: ChoiceOption[] };
  puzzle?: { length: number; progress: number; misses: number; maxMisses: number; sequence?: Glyph[] };
  parley?: { npc: string; name: string; said?: string; saidBy?: string; reply?: string; progress: number; goal: number; linesLeft: number };
  foe?: Foe;
  round?: number;
  wards?: number;
  ending?: { title: string; text: string; win: boolean };
}

export interface ActionButton {
  label: string;
  /** Sent as a line, or (with input) placed in the editor for the player to finish. */
  cmd: string;
  input?: boolean;
  hint?: string;
  tone?: 'go' | 'risk' | 'fight' | 'magic' | 'talk' | 'info';
  disabled?: boolean;
  /** Buttons are grouped under a small heading in the action bar. */
  group?: string;
}

export type Portrait = { type: 'narrator' } | { type: 'npc'; id: string } | { type: 'player'; handle: string; avatar: number; classes: ClassId[] };

/** Things that appear on the game console rather than in the terminal. */
export type FeedItem =
  | { kind: 'story'; speaker: string; text: string; portrait: Portrait }
  | { kind: 'notice'; text: string; tone?: 'good' | 'bad' | 'info' }
  | { kind: 'chat'; from: Pick<HudMember, 'handle' | 'avatar' | 'classes'>; text: string }
  | { kind: 'tip'; text: string };

export type Move = 'strike' | 'fury' | 'hex' | 'bolt' | 'ward' | 'mend' | 'speak';

export type Fx =
  | { kind: 'title'; title: string; subtitle: string }
  | { kind: 'act'; by: string; cls: ClassId; move: Move; amount?: number }
  | { kind: 'foe'; move: IntentKind; amount: number; blocked: boolean }
  | { kind: 'stun' }
  | { kind: 'heal'; amount: number }
  | { kind: 'hurt'; amount: number }
  | { kind: 'slay'; boss?: boolean }
  | { kind: 'glyph'; ok: boolean; glyph: Glyph }
  | { kind: 'boon'; name: string }
  | { kind: 'vote'; by: string }
  | { kind: 'end'; win: boolean };

export type ServerMessage =
  | { type: 'out'; text: string }
  | { type: 'prompt'; text: string }
  | { type: 'clear' }
  | { type: 'hud'; hud: HudState }
  | { type: 'scene'; scene: SceneState; actions: ActionButton[] }
  | { type: 'feed'; item: FeedItem }
  | { type: 'fx'; fx: Fx };

export type ClientMessage = { type: 'line'; text: string };

export const MAX_LINE_LENGTH = 300;
