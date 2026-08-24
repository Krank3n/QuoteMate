// The two ways this adapter can silently break Mate: a tool_result paired to
// the wrong tool_use id (Claude 400s and the turn dies), and thinking blocks
// lost between hops (Claude 400s the continuation). Both get round-trip
// coverage here, alongside the plain shape translations.

import { describe, it, expect } from 'vitest';
import {
  buildClaudeRequest,
  claudeContentToGeminiParts,
  claudeUsageToGeminiUsage,
  geminiContentsToClaudeMessages,
  geminiToolsToClaudeTools,
} from './claudeChatAdapter';

describe('geminiToolsToClaudeTools', () => {
  it('renames parameters to input_schema and keeps the schema verbatim', () => {
    const out = geminiToolsToClaudeTools([
      {
        functionDeclarations: [
          {
            name: 'find_customer',
            description: 'Search contacts.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        name: 'find_customer',
        description: 'Search contacts.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);
  });

  it('gives a declaration with no parameters an empty object schema', () => {
    const out = geminiToolsToClaudeTools([
      { functionDeclarations: [{ name: 'get_business_defaults', description: 'Rates.' }] },
    ]);
    expect(out[0].input_schema).toEqual({ type: 'object', properties: {} });
  });
});

describe('geminiContentsToClaudeMessages', () => {
  it('maps roles and text: user stays user, model becomes assistant', () => {
    const out = geminiContentsToClaudeMessages([
      { role: 'user', parts: [{ text: 'quote a fence' }] },
      { role: 'model', parts: [{ text: 'righto' }] },
    ]);
    expect(out).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'quote a fence' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'righto' }] },
    ]);
  });

  it('pairs positional functionResponses back to the previous turn tool_use ids', () => {
    const out = geminiContentsToClaudeMessages([
      { role: 'user', parts: [{ text: 'fence for Marcus, and check my rates' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'find_customer', id: 'toolu_A', args: { query: 'Marcus' } } },
          { functionCall: { name: 'get_business_defaults', id: 'toolu_B', args: {} } },
        ],
      },
      {
        role: 'user',
        parts: [
          // The client sends NO id on responses — order is the contract.
          { functionResponse: { name: 'find_customer', response: { matches: [] } } },
          { functionResponse: { name: 'get_business_defaults', response: { laborRate: 85 } } },
        ],
      },
    ]);
    const results = out[2].content;
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_A' });
    expect(results[1]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_B' });
    expect(JSON.parse(results[1].content as string)).toEqual({ laborRate: 85 });
  });

  it('falls back to name matching when response order disagrees with call order', () => {
    const out = geminiContentsToClaudeMessages([
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'a', id: 'toolu_A', args: {} } },
          { functionCall: { name: 'b', id: 'toolu_B', args: {} } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'b', response: {} } },
          { functionResponse: { name: 'a', response: {} } },
        ],
      },
    ]);
    // Positional pairing wins by design (the client preserves order); this
    // pins that the fallback only fires when position is exhausted.
    const results = out[1].content;
    expect(results.map((r) => r.tool_use_id)).toEqual(['toolu_A', 'toolu_B']);
  });

  it('round-trips thinking blocks through the thoughtSignature field', () => {
    const claudeReply = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'text', text: 'Looking that up.' },
      { type: 'tool_use', id: 'toolu_1', name: 'find_customer', input: { query: 'Dee' } },
    ];
    const parts = claudeContentToGeminiParts(claudeReply);
    // The client echoes these parts verbatim on the next hop.
    const messages = geminiContentsToClaudeMessages([{ role: 'model', parts }]);
    expect(messages[0].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-abc' });
    expect(messages[0].content[1]).toEqual({ type: 'text', text: 'Looking that up.' });
    expect(messages[0].content[2]).toMatchObject({ type: 'tool_use', id: 'toolu_1' });
  });

  it('survives a mangled thoughtSignature instead of sinking the turn', () => {
    const messages = geminiContentsToClaudeMessages([
      { role: 'model', parts: [{ text: 'hi', thoughtSignature: 'claude:%%%not-base64%%%' }] },
    ]);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('translates inline photos into Claude image blocks', () => {
    const out = geminiContentsToClaudeMessages([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
          { text: 'quote this bathroom' },
        ],
      },
    ]);
    expect(out[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(out[0].content[1]).toEqual({ type: 'text', text: 'quote this bathroom' });
  });

  it('drops empty-part messages rather than sending Claude an empty content array', () => {
    expect(geminiContentsToClaudeMessages([{ role: 'user', parts: [{ text: '' }] }])).toEqual([]);
  });
});

describe('claudeContentToGeminiParts', () => {
  it('maps text and tool_use blocks to Gemini-shaped parts', () => {
    const parts = claudeContentToGeminiParts([
      { type: 'text', text: 'On it.' },
      { type: 'tool_use', id: 'toolu_9', name: 'get_quote', input: { quoteId: 'q1' } },
    ]);
    expect(parts).toEqual([
      { text: 'On it.' },
      { functionCall: { name: 'get_quote', id: 'toolu_9', args: { quoteId: 'q1' } } },
    ]);
  });

  it('gives a bare refusal a plain sentence instead of an empty reply', () => {
    const parts = claudeContentToGeminiParts([], 'refusal');
    expect(parts).toEqual([{ text: "Can't help with that one, sorry." }]);
  });

  it('returns no parts for a genuinely empty non-refusal reply', () => {
    expect(claudeContentToGeminiParts([], 'end_turn')).toEqual([]);
  });
});

describe('claudeUsageToGeminiUsage', () => {
  it('reports the TOTAL prompt and breaks out cache reads and writes', () => {
    expect(
      claudeUsageToGeminiUsage({
        input_tokens: 1000,
        output_tokens: 300,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 500,
      }),
    ).toEqual({
      promptTokenCount: 9500,
      candidatesTokenCount: 300,
      cachedContentTokenCount: 8000,
      cacheWriteTokenCount: 500,
    });
  });

  it('treats missing usage as zeros', () => {
    expect(claudeUsageToGeminiUsage(undefined)).toEqual({
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      cachedContentTokenCount: 0,
      cacheWriteTokenCount: 0,
    });
  });
});

describe('buildClaudeRequest', () => {
  it('assembles system, tools, messages and both cache breakpoints', () => {
    const body = buildClaudeRequest({
      model: 'claude-sonnet-5',
      maxTokens: 8192,
      contents: [
        { role: 'user', parts: [{ text: 'quote a deck' }] },
        { role: 'model', parts: [{ text: 'how big?' }] },
        { role: 'user', parts: [{ text: '6 by 4' }] },
      ],
      systemInstruction: { parts: [{ text: 'You are Mate.' }] },
      tools: [{ functionDeclarations: [{ name: 't', description: 'd' }] }],
    });
    expect(body.model).toBe('claude-sonnet-5');
    expect((body.system as any[])[0]).toMatchObject({
      text: 'You are Mate.',
      cache_control: { type: 'ephemeral' },
    });
    expect((body.tools as any[])[0].name).toBe('t');
    const messages = body.messages as any[];
    // Breakpoint on the LAST block of the LAST message — each tool hop then
    // re-reads the whole growing history at the cached rate.
    expect(messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(messages[0].content[0].cache_control).toBeUndefined();
  });

  it('omits system and tools when the client sent none', () => {
    const body = buildClaudeRequest({
      model: 'claude-sonnet-5',
      maxTokens: 8192,
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    expect(body.system).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });
});
