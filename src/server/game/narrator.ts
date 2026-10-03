import type { Ai } from '../ai.js';

// The dungeon master: a line or two of narration at the moments that matter.

export type NarrationEvent =
  | { kind: 'start'; wyrmName: string; breedTitle: string; district: string }
  | { kind: 'slay'; foe: string }
  | { kind: 'end'; win: boolean; wyrmName: string };

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
        return `Rain hisses on the neon of ${e.district}. Far below the streets, ${e.wyrmName}, a ${e.breedTitle}, stirs in its sleep, and every screen in the city flickers. You descend.`;
      case 'slay':
        return pick([
          `The ${e.foe.replace(/^The /, '')} comes apart in a shower of dead pixels. Somewhere below, the Devourer flinches.`,
          `It shrieks once in corrupted audio and is gone. One more seal burns into the dark.`,
          `What is left of it drips through the floor as harmless static. The way down is open.`,
        ]);
      case 'end':
        return e.win
          ? `The seals close. ${e.wyrmName} sinks back into its long sleep, and above you a whole city wakes up, never knowing how close it came.`
          : `The last light goes out. ${e.wyrmName} rises through the net, and one by one, the windows of Neo-Avalon go dark.`;
    }
  }
}

const SYSTEM = [
  'You narrate LAST LIGHT, a cyberpunk-fantasy horror game: a crew of small mythical spirits descends through the haunted net beneath the neon city of Neo-Avalon to seal the Devourer, an ancient AI wyrm whose waking would darken every mind in the city.',
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
