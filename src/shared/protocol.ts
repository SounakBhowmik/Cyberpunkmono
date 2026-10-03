// Messages exchanged over the WebSocket. The server owns all game state and
// sends finished text; the client is a terminal with a line editor, a dice
// animator and a HUD bar.

export interface RollView {
  sides: number;
  natural: number;
  /** Finished, colored result line shown once the die stops tumbling. */
  text: string;
  outcome?: 'crit' | 'success' | 'fail' | 'fumble';
  /** Short caption under the big die, e.g. "neo · picks the lock". */
  caption?: string;
}

export interface HudMember {
  handle: string;
  /** Class names, e.g. ["rogue"] or ["mage", "cleric"]. */
  classes: string[];
  you: boolean;
  host?: boolean;
  /** In combat: has this player locked in an action for the round? */
  ready?: boolean;
}

export type WyrmColor = 'red' | 'blue' | 'green' | 'black' | 'white';

export type HudState =
  | { mode: 'street'; handle?: string }
  | { mode: 'safehouse'; code: string; party: HudMember[] }
  | {
      mode: 'delve';
      code: string;
      corp: string;
      district: string;
      wyrm: { name: string; title: string; color: WyrmColor };
      trace: number;
      party: HudMember[];
      deck: { name: string; charges: number }[];
      location: string;
      encounter?: { name: string; hp: number; maxHp: number; round: number };
      lastRoll?: string;
    };

export interface SceneRoom {
  id: string;
  label: string;
  /** Grid position: column = distance from the gateway. */
  x: number;
  y: number;
  links: string[];
  kind: 'gateway' | 'room' | 'gate' | 'vault';
  /** How much this player knows about the room. */
  known: 'hidden' | 'seen' | 'visited' | 'full';
  locked: boolean;
  port?: number;
  intel?: boolean;
  program?: boolean;
  /** Monster id lairing here, if this player knows about it. */
  lair?: string;
}

export interface SceneState {
  view: 'explore' | 'combat' | 'parley' | 'vault';
  rooms: SceneRoom[];
  runnerAt: string;
  patrolAt?: string;
  ghosted?: boolean;
  party: HudMember[];
  wyrm: { name: string; title: string; color: WyrmColor };
  combat?: { monster: string; name: string; hp: number; maxHp: number; round: number };
  parley?: { suspicion: number; said?: string; reply?: string; sealed: boolean };
}

export interface ActionButton {
  label: string;
  /** Sent as a line, or (with input) placed in the editor for the player to finish. */
  cmd: string;
  input?: boolean;
  hint?: string;
  tone?: 'go' | 'risk' | 'fight' | 'magic' | 'talk' | 'info';
  disabled?: boolean;
}

export type Fx =
  | { kind: 'intro'; corp: string; district: string; wyrm: string; title: string; color: WyrmColor }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'unlock'; node: string }
  | { kind: 'alarm' }
  | { kind: 'hurt'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'strike'; amount: number; by: string }
  | { kind: 'slay' }
  | { kind: 'loot'; name: string }
  | { kind: 'end'; win: boolean };

export type ServerMessage =
  | { type: 'out'; text: string }
  | { type: 'prompt'; text: string }
  | { type: 'clear' }
  | { type: 'roll'; roll: RollView }
  | { type: 'hud'; hud: HudState }
  | { type: 'scene'; scene: SceneState; actions: ActionButton[] }
  | { type: 'fx'; fx: Fx };

export type ClientMessage = { type: 'line'; text: string };

export const MAX_LINE_LENGTH = 300;
