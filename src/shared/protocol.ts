// Messages exchanged over the WebSocket. The server owns all game state; the
// client draws the scene, the HUD and the buttons, and plays effects.

export type ClassId = 'striker' | 'mystic' | 'guardian';
export type WyrmColor = 'red' | 'blue' | 'green' | 'black' | 'white';

export interface HudMember {
  handle: string;
  /** Reroll count: the avatar is generated from handle + this number. */
  avatar: number;
  classes: ClassId[];
  you: boolean;
  host?: boolean;
  /** In combat: has this player used every action they have this round? */
  ready?: boolean;
}

export interface WyrmInfo {
  name: string;
  title: string;
  color: WyrmColor;
  /** How to talk to it, e.g. "craves worship". */
  temperament: string;
}

export type HudState =
  | { mode: 'street'; handle?: string; avatar?: number }
  | { mode: 'safehouse'; code: string; party: HudMember[] }
  | {
      mode: 'delve';
      code: string;
      wyrm: WyrmInfo;
      corruption: number;
      floor: number;
      floors: number;
      seals: number;
      party: HudMember[];
      relics: { name: string; desc: string }[];
    };

/** What a foe will do when the round resolves. Always visible to players. */
export type IntentKind = 'attack' | 'charge' | 'heavy' | 'shell' | 'wail';

export interface Intent {
  kind: IntentKind;
  amount: number;
  /** e.g. "CLAW 8" */
  label: string;
  /** e.g. "a Ward blocks it" */
  hint: string;
}

export interface Foe {
  /** Sprite id. */
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  intent: Intent;
  exposed?: boolean;
  elite?: boolean;
  boss?: boolean;
}

export type RouteKind = 'fight' | 'elite' | 'shrine' | 'cache' | 'boss';

export interface RouteOption {
  id: string;
  kind: RouteKind;
  label: string;
  detail: string;
  /** Handles of players who voted for this option. */
  votes: string[];
  /** For fights: the sprite id of the horror waiting there. */
  foe?: string;
}

export interface SceneState {
  view: 'route' | 'combat' | 'boss';
  floor: number;
  floors: number;
  corruption: number;
  seals: number;
  party: HudMember[];
  wyrm: WyrmInfo;
  /** The kinds of rooms already passed, for drawing the descent. */
  path: RouteKind[];
  options?: RouteOption[];
  foe?: Foe;
  round?: number;
  parley?: { said?: string; saidBy?: string; reply?: string; mood?: 'calmer' | 'angrier' | 'same' };
}

export interface ActionButton {
  label: string;
  /** Sent as a line, or (with input) placed in the editor for the player to finish. */
  cmd: string;
  input?: boolean;
  hint?: string;
  tone?: 'go' | 'risk' | 'fight' | 'magic' | 'talk' | 'info';
  disabled?: boolean;
  /** Buttons are grouped under their class name in the action bar. */
  group?: string;
}

export type Move = 'strike' | 'fury' | 'hex' | 'bolt' | 'ward' | 'mend' | 'speak';

export type Fx =
  | { kind: 'intro'; wyrm: WyrmInfo }
  | { kind: 'enter'; room: RouteKind }
  | { kind: 'act'; by: string; cls: ClassId; move: Move; amount?: number }
  | { kind: 'foe'; move: IntentKind; amount: number; blocked: boolean }
  | { kind: 'stun' }
  | { kind: 'heal'; amount: number }
  | { kind: 'slay'; boss?: boolean }
  | { kind: 'relic'; name: string }
  | { kind: 'vote'; by: string }
  | { kind: 'end'; win: boolean };

export type ServerMessage =
  | { type: 'out'; text: string }
  | { type: 'prompt'; text: string }
  | { type: 'clear' }
  | { type: 'hud'; hud: HudState }
  | { type: 'scene'; scene: SceneState; actions: ActionButton[] }
  | { type: 'fx'; fx: Fx };

export type ClientMessage = { type: 'line'; text: string };

export const MAX_LINE_LENGTH = 300;
