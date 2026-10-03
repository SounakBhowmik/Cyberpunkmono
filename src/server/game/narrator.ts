import type { Ai } from '../ai.js';

// An AI game master's aside: one line at each new chapter, reacting to what
// the crew just chose. The story itself is authored; without an API key the
// narrator stays quiet rather than repeating it.

export type NarrationEvent = { kind: 'chapter'; story: string; chapter: string; lastChoice?: string; meterName: string; meter: number };

export interface Narrator {
  readonly label: string;
  narrate(event: NarrationEvent): Promise<string | null>;
}

export class SilentNarrator implements Narrator {
  readonly label = 'none';
  async narrate(): Promise<string | null> {
    return null;
  }
}

const SYSTEM = [
  'You are the game master of LAST LIGHT, a co-op cyberpunk-fantasy story: small mythical spirits journey beneath the neon city of Neo-Avalon to stop a waking AI wyrm, the Devourer.',
  'Given the chapter the crew is entering and the choice they just made, add ONE short aside as a game master would: wry, ominous or warm, under 30 words, second person plural.',
  'React to their choice if there was one. Do not repeat the chapter title. No markdown, no emoji, no game advice.',
].join('\n');

export class AiNarrator implements Narrator {
  constructor(private readonly ai: Ai) {}

  get label() {
    return this.ai.label;
  }

  async narrate(e: NarrationEvent): Promise<string | null> {
    try {
      const text = await this.ai.complete(SYSTEM, [{ role: 'user', content: JSON.stringify(e) }], { maxTokens: 80, timeoutMs: 6000 });
      return text.replace(/\s+/g, ' ').slice(0, 240);
    } catch (err) {
      console.warn(`[narrator] skipped: ${(err as Error).message}`);
      return null;
    }
  }
}

export function createNarrator(ai: Ai | null): Narrator {
  return ai ? new AiNarrator(ai) : new SilentNarrator();
}
