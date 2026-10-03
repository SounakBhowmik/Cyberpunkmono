// Messages exchanged over the WebSocket. The server owns all game state and
// sends finished text; the client is a terminal with a line editor, a dice
// animator and a HUD bar.

export interface RollView {
  sides: number;
  natural: number;
  /** Finished, colored result line shown once the die stops tumbling. */
  text: string;
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

export type ServerMessage =
  | { type: 'out'; text: string }
  | { type: 'prompt'; text: string }
  | { type: 'clear' }
  | { type: 'roll'; roll: RollView }
  | { type: 'hud'; hud: HudState };

export type ClientMessage = { type: 'line'; text: string };

export const MAX_LINE_LENGTH = 300;
