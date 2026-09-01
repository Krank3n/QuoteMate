/**
 * Claude client for the bake-off arms and the scoring oracles.
 *
 * Structured outputs (output_config.format) rather than "return ONLY JSON"
 * prompting: the existing replay scripts carry a hand-written brace-balancing
 * parser to survive models that append commentary, and a measurement harness
 * should not have a parser that can itself fail and skew a run.
 */

import Anthropic from '@anthropic-ai/sdk';

export const QUOTING_MODEL = 'claude-opus-5';

let client: Anthropic | null = null;
function get(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY (source functions/.env)');
    client = new Anthropic({ maxRetries: 4 });
  }
  return client;
}

export interface AskOptions {
  system?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  model?: string;
  /** Cache the system prompt — the oracles reuse one big system prompt. */
  cacheSystem?: boolean;
}

/**
 * One structured-JSON request. Streams so large `max_tokens` cannot trip the
 * SDK's HTTP timeout on the long material lists real quotes produce.
 */
export async function askJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
  opts: AskOptions = {},
): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
  const c = get();
  const stream = c.messages.stream({
    model: opts.model || QUOTING_MODEL,
    max_tokens: opts.maxTokens ?? 32000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: opts.effort ?? 'high',
      format: { type: 'json_schema', schema },
    },
    ...(opts.system
      ? {
          system: opts.cacheSystem
            ? [{ type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }]
            : opts.system,
        }
      : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude refused: ${msg.stop_details?.explanation || 'no explanation'}`);
  }
  // Adaptive thinking tokens count against max_tokens, so a long material list
  // at high effort can run the budget out mid-JSON. Surface that explicitly —
  // it used to present as "structured output was not valid JSON", which reads
  // like a schema problem and sent the harness chasing the wrong bug.
  if (msg.stop_reason === 'max_tokens') {
    throw new Error(`Truncated at max_tokens (${msg.usage.output_tokens} out) — raise maxTokens or lower effort`);
  }
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new Error(`Claude returned no text (stop_reason=${msg.stop_reason})`);
  let value: T;
  try {
    value = JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Structured output was not valid JSON: ${text.slice(0, 200)}`);
  }
  return {
    value,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}
