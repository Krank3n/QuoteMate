// Gemini-wire ↔ Claude Messages adapter for assistantChat.
//
// The Mate client speaks Gemini generateContent shapes (contents / parts /
// functionDeclarations) and echoes model turns back verbatim. Rather than
// shipping an app release to change the model, this adapter translates that
// wire format to the Claude Messages API and back, so swapping the brain is a
// server deploy and reverting is a constant flip.
//
// The one stateful subtlety is thinking blocks. Claude's tool loop requires
// the assistant turn that contained tool_use to be echoed back with its
// thinking blocks intact. The client already round-trips an opaque
// `thoughtSignature` field on parts (Gemini's equivalent), so we serialize
// Claude's thinking blocks into that same field on the first returned part and
// re-inflate them when the turn comes back. The client never knows.
//
// The other subtlety is tool_result pairing. Gemini functionResponse parts
// carry no id — the client pushes results in the same order as the calls — so
// tool_use ids are re-paired positionally against the previous assistant turn
// (falling back to name matching if the counts ever disagree).
//
// Pure module: no fetch, no env, no Firestore — everything unit-testable.

export interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; id?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; id?: string; response?: unknown };
  inlineData?: { mimeType?: string; data?: string };
  thoughtSignature?: string;
  [k: string]: unknown;
}

export interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

interface ClaudeContentBlock {
  type: string;
  [k: string]: unknown;
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContentBlock[];
}

const THOUGHT_PREFIX = 'claude:';

function encodeThinking(blocks: ClaudeContentBlock[]): string {
  return THOUGHT_PREFIX + Buffer.from(JSON.stringify(blocks), 'utf8').toString('base64');
}

function decodeThinking(signature: string | undefined): ClaudeContentBlock[] {
  if (!signature || !signature.startsWith(THOUGHT_PREFIX)) return [];
  try {
    const parsed = JSON.parse(
      Buffer.from(signature.slice(THOUGHT_PREFIX.length), 'base64').toString('utf8'),
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A mangled signature must not sink the turn — the thinking context is
    // lost but the conversation still works.
    return [];
  }
}

/** Gemini functionDeclarations already use lowercase JSON-schema, so this is
 *  a field rename plus a guard for declarations with no parameters. */
export function geminiToolsToClaudeTools(
  tools: Array<{ functionDeclarations?: Array<Record<string, unknown>> }> | undefined,
): Array<Record<string, unknown>> {
  const decls = (tools || []).flatMap((t) => t.functionDeclarations || []);
  return decls.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters || { type: 'object', properties: {} },
  }));
}

/**
 * Translate the client's Gemini contents into Claude messages.
 *
 * tool_use ids: an assistant turn's functionCall parts keep whatever id the
 * model minted (rides through the client verbatim). The user turn that
 * follows pairs its functionResponse parts back to those ids by position.
 */
export function geminiContentsToClaudeMessages(contents: GeminiContent[]): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];
  let lastToolUseIds: Array<{ id: string; name: string }> = [];

  for (const c of contents) {
    const role: 'user' | 'assistant' = c.role === 'model' ? 'assistant' : 'user';
    const blocks: ClaudeContentBlock[] = [];
    const parts = c.parts || [];

    if (role === 'assistant') {
      // Re-inflate any thinking blocks we smuggled out on this turn. They
      // must come first, exactly as Claude emitted them.
      blocks.push(...decodeThinking(parts[0]?.thoughtSignature as string | undefined));
      const toolUses: Array<{ id: string; name: string }> = [];
      for (const p of parts) {
        if (typeof p.text === 'string' && p.text.length) {
          blocks.push({ type: 'text', text: p.text });
        } else if (p.functionCall) {
          const id = String(p.functionCall.id || `call_${toolUses.length}_${p.functionCall.name}`);
          const name = String(p.functionCall.name || '');
          toolUses.push({ id, name });
          blocks.push({ type: 'tool_use', id, name, input: p.functionCall.args || {} });
        }
      }
      if (toolUses.length) lastToolUseIds = toolUses;
    } else {
      let responseIndex = 0;
      for (const p of parts) {
        if (p.functionResponse) {
          // No id on the wire — pair positionally with the previous model
          // turn's tool_use blocks, falling back to name matching.
          const byPosition = lastToolUseIds[responseIndex];
          const byName = lastToolUseIds.find((t) => t.name === p.functionResponse?.name);
          const id =
            String(p.functionResponse.id || '') ||
            byPosition?.id ||
            byName?.id ||
            `call_${responseIndex}_${p.functionResponse.name}`;
          responseIndex += 1;
          blocks.push({
            type: 'tool_result',
            tool_use_id: id,
            content: JSON.stringify(p.functionResponse.response ?? {}),
          });
        } else if (p.inlineData?.data) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: p.inlineData.mimeType || 'image/jpeg',
              data: p.inlineData.data,
            },
          });
        } else if (typeof p.text === 'string' && p.text.length) {
          blocks.push({ type: 'text', text: p.text });
        }
      }
    }

    if (blocks.length) messages.push({ role, content: blocks });
  }
  return messages;
}

/**
 * Translate a Claude reply's content blocks into Gemini-shaped parts the
 * client already knows how to render and echo. Thinking blocks are serialized
 * onto the first part's thoughtSignature so the client round-trips them.
 */
export function claudeContentToGeminiParts(
  content: ClaudeContentBlock[],
  stopReason?: string | null,
): GeminiPart[] {
  const thinking = content.filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
  const parts: GeminiPart[] = [];
  for (const b of content) {
    if (b.type === 'text' && typeof b.text === 'string' && b.text.length) {
      // Claude often splits a reply into several text blocks (around tool
      // calls, or just paragraphs). The client concatenates text parts with
      // NO separator — "for now?Drafted Priya's fence" reached a real screen
      // — so coalesce them here with a paragraph break instead.
      const prev = parts[parts.length - 1];
      if (prev && typeof prev.text === 'string' && !prev.functionCall) {
        prev.text = `${prev.text}\n\n${b.text}`;
      } else {
        parts.push({ text: b.text });
      }
    } else if (b.type === 'tool_use') {
      parts.push({
        functionCall: {
          name: String(b.name || ''),
          id: String(b.id || ''),
          args: (b.input as Record<string, unknown>) || {},
        },
      });
    }
  }
  // A refusal with no visible content would otherwise render the client's
  // "empty reply" error — give the tradie a plain sentence instead.
  if (!parts.length && stopReason === 'refusal') {
    parts.push({ text: "Can't help with that one, sorry." });
  }
  if (thinking.length && parts.length) {
    parts[0].thoughtSignature = encodeThinking(thinking);
  }
  return parts;
}

/** Map Claude usage onto the Gemini usageMetadata shape recordChatUsage reads.
 *  promptTokenCount is the TOTAL prompt (Gemini convention) so the cost
 *  arithmetic subtracts the cached share, and cache writes are broken out
 *  because Claude bills them at a premium over plain input. */
export function claudeUsageToGeminiUsage(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
} | undefined): {
  promptTokenCount: number;
  candidatesTokenCount: number;
  cachedContentTokenCount: number;
  cacheWriteTokenCount: number;
} {
  const input = u?.input_tokens || 0;
  const cacheRead = u?.cache_read_input_tokens || 0;
  const cacheWrite = u?.cache_creation_input_tokens || 0;
  return {
    promptTokenCount: input + cacheRead + cacheWrite,
    candidatesTokenCount: u?.output_tokens || 0,
    cachedContentTokenCount: cacheRead,
    cacheWriteTokenCount: cacheWrite,
  };
}

/**
 * Assemble the full Claude request body from the client's Gemini-shaped post.
 * Two cache breakpoints: the system prompt (covers tools + system — the
 * stable prefix), and the last message block (so the up-to-8 tool hops of a
 * single turn re-read the growing history at the cached rate).
 */
export function buildClaudeRequest(args: {
  model: string;
  maxTokens: number;
  contents: GeminiContent[];
  systemInstruction?: { parts?: Array<{ text?: string }> };
  tools?: Array<{ functionDeclarations?: Array<Record<string, unknown>> }>;
}): Record<string, unknown> {
  const messages = geminiContentsToClaudeMessages(args.contents);
  const last = messages[messages.length - 1];
  const lastBlock = last?.content[last.content.length - 1];
  if (lastBlock && ['text', 'tool_result', 'image'].includes(lastBlock.type)) {
    lastBlock.cache_control = { type: 'ephemeral' };
  }

  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens,
    messages,
  };
  const systemText = (args.systemInstruction?.parts || [])
    .map((p) => p.text || '')
    .join('\n')
    .trim();
  if (systemText) {
    body.system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
  }
  const tools = geminiToolsToClaudeTools(args.tools);
  if (tools.length) body.tools = tools;
  return body;
}
