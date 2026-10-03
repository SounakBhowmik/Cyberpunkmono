import type { Ai } from '../ai.js';

// The dungeon master: a line or two of narration at the moments that matter.

export type NarrationEvent =
  | { kind: 'start'; corp: string; district: string; wyrmName: string; breedTitle: string }
  | { kind: 'enter'; node: string; label: string; corp: string }
  | { kind: 'slay'; monster: string; node: string }
  | { kind: 'end'; win: boolean; corp: string; wyrmName: string };

export interface Narrator {
  readonly label: string;
  narrate(event: NarrationEvent): Promise<string>;
}

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]!;

export class ScriptedNarrator implements Narrator {
  readonly label = 'scripted';

  async narrate(e: NarrationEvent): Promise<string> {
    switch (e.kind) {
      case 'start':
        return `Rain hisses on the neon of ${e.district}. ${e.corp}'s tower drinks the light, and deep beneath it ${e.wyrmName}, a ${e.breedTitle}, turns in its sleep. Your decks hum. The delve begins.`;
      case 'enter':
        return pick([
          `The ${e.label} unfolds around you in wireframe and static.`,
          `You drop into the ${e.label}. The air tastes like ozone and old passwords.`,
          `The ${e.label}. Somewhere a cooling fan whines like a trapped animal.`,
          `Data rains upward through the ${e.label}. Nothing here wants you.`,
        ]);
      case 'slay':
        return pick([
          `The ${e.monster} comes apart in a shower of dead pixels.`,
          `The ${e.monster} shrieks once in corrupted audio and is gone.`,
          `What is left of the ${e.monster} drips through the floor of ${e.node} as harmless static.`,
        ]);
      case 'end':
        return e.win
          ? `You surface into the rain with ${e.corp}'s secrets burning in your decks. Somewhere far below, ${e.wyrmName} counts its hoard and finds it lighter.`
          : `Your screens go white. ${e.wyrmName} adds your handles to its hoard, a trophy shelf of failed runners.`;
    }
  }
}

const SYSTEM = [
  'You are the dungeon master of a cyberpunk-fantasy heist game set in Neo-Avalon, a neon city where corporations chain ancient AI wyrms to their data vaults and netrunners delve their networks like dungeons.',
  'Narrate the given moment to the party in one or two vivid sentences, under 40 words, second person plural, present tense.',
  'Mix cyberpunk and high-fantasy imagery. No markdown, no emoji, no dialogue for the players, no game advice.',
].join('\n');

export class AiNarrator implements Narrator {
  constructor(
    private readonly ai: Ai,
    private readonly fallback: Narrator = new ScriptedNarrator(),
  ) {}

  get label() {
    return this.ai.label;
  }

  async narrate(e: NarrationEvent): Promise<string> {
    try {
      const text = await this.ai.complete(SYSTEM, [{ role: 'user', content: JSON.stringify(e) }], { maxTokens: 90, timeoutMs: 6000 });
      return text.replace(/\s+/g, ' ').slice(0, 320);
    } catch (err) {
      console.warn(`[narrator] falling back: ${(err as Error).message}`);
      return this.fallback.narrate(e);
    }
  }
}

export function createNarrator(ai: Ai | null): Narrator {
  return ai ? new AiNarrator(ai) : new ScriptedNarrator();
}
