import OpenAI from 'openai';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Thin wrapper over the OpenAI SDK so game code never touches it directly. */
export class Ai {
  private readonly client: OpenAI;

  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  get label() {
    return `openai:${this.model}`;
  }

  async complete(system: string, messages: ChatMessage[], opts: CallOptions & { json?: boolean }): Promise<string> {
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
        temperature: opts.temperature ?? 0.9,
        max_tokens: opts.maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      },
      { timeout: opts.timeoutMs ?? 10_000, maxRetries: 1 },
    );
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('empty completion');
    return text;
  }
}

export function createAi(env: NodeJS.ProcessEnv = process.env): Ai | null {
  const key = env.OPENAI_API_KEY?.trim();
  return key ? new Ai(key, env.OPENAI_MODEL?.trim() || 'gpt-4o-mini') : null;
}
