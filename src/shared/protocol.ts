// Messages exchanged over the WebSocket. The server owns all game state and
// sends finished text; the client is a dumb terminal with a line editor.

export type ServerMessage =
  | { type: 'out'; text: string }
  | { type: 'prompt'; text: string }
  | { type: 'clear' };

export type ClientMessage = { type: 'line'; text: string };

export const MAX_LINE_LENGTH = 300;
