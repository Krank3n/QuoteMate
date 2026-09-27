import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { geminiLiteText, claudeLiteText } from './liteJsonResponse';

describe('geminiLiteText', () => {
  it('returns the answer text', () => {
    const data = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"results":[]}' }] } }] };
    expect(geminiLiteText(data)).toBe('{"results":[]}');
  });

  it('names the output cap instead of handing cut-off JSON to the parser', () => {
    // The shape a 36-item reconcile batch came back with at an 8000 cap:
    // 7597 tokens of thinking, then 399 tokens of truncated JSON.
    const data = {
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"results":[{"id":"m0","deci' }] } }],
      usageMetadata: { thoughtsTokenCount: 7597, candidatesTokenCount: 399 },
    };
    expect(() => geminiLiteText(data)).toThrow(/output cap \(thinking 7597 \+ answer 399/);
  });

  it('skips thought-summary parts', () => {
    const data = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'weighing packs…', thought: true }, { text: '{"results":[]}' }] } }],
    };
    expect(geminiLiteText(data)).toBe('{"results":[]}');
  });

  it('throws on an empty response', () => {
    expect(() => geminiLiteText({ candidates: [{ finishReason: 'SAFETY' }] })).toThrow(/No content.*SAFETY/);
    expect(() => geminiLiteText({})).toThrow(/No content/);
  });
});

describe('claudeLiteText', () => {
  it('reads the text block that follows a thinking block', () => {
    // Sonnet 5 runs adaptive thinking by default, so block 0 is thinking.
    const data = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'the 100-pack covers 60 nails…' },
        { type: 'text', text: '{"results":[{"id":"m0","decision":"apply"}]}' },
      ],
    };
    expect(claudeLiteText(data)).toBe('{"results":[{"id":"m0","decision":"apply"}]}');
  });

  it('names the output cap', () => {
    const data = { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] };
    expect(() => claudeLiteText(data)).toThrow(/output cap/);
  });

  it('treats a refusal as a failure', () => {
    expect(() => claudeLiteText({ stop_reason: 'refusal', content: [] })).toThrow(/refused/);
  });

  it('throws when only thinking came back', () => {
    expect(() => claudeLiteText({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'x' }] })).toThrow(
      /No content/,
    );
  });
});

describe('lite-tier request wiring (index.ts)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const fn = (name: string): string => {
    const start = source.indexOf(`async function ${name}`);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('\n}\n', start)).replace(/^\s*\/\/.*$/gm, '');
  };

  it('both providers go through the checked readers', () => {
    expect(fn('callGeminiLiteJson')).toContain('geminiLiteText(data)');
    expect(fn('callClaudeLiteJson')).toContain('claudeLiteText(data)');
    expect(fn('callClaudeLiteJson')).not.toMatch(/content\?\.\[0\]|content\[0\]/);
  });

  it('gives Gemini room to think AND answer', () => {
    // 3.7 Flash spends its thinking out of maxOutputTokens: 8000 truncated a
    // 36-item batch; 32000 finished it with ~23k to spare.
    const cap = Number(fn('callGeminiLiteJson').match(/maxOutputTokens:\s*(\d+)/)?.[1]);
    expect(cap).toBeGreaterThanOrEqual(32000);
  });

  it('lets the Claude fallback finish inside the HTTP reconcile endpoint', () => {
    // A failed Gemini attempt (~25 s) plus Sonnet 5 on a 36-item batch (~99 s)
    // overran the old 120 s limit, so the fallback timed out as well.
    const m = source.match(/export const reconcilePricedMaterials = functions\.runWith\(\{ timeoutSeconds: (\d+) \}\)/);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(300);
  });
});
