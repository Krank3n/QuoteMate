import { describe, it, expect } from 'vitest';
import { isProviderDeadError, stripThoughtSignatures } from './assistantChat';

/**
 * Mate must degrade, not die. An out-of-credit ANTHROPIC_API_KEY has twice
 * left assistantChat 502ing every turn because the provider resolver checks
 * key PRESENCE, not validity, and there was no fallback. The fallback fires
 * only on provider-dead errors: a generic 400 is OUR bug and must stay loud —
 * falling back on it would mask real request defects behind a silent quality
 * downgrade.
 */
describe('isProviderDeadError', () => {
  it('treats the billing 400 that took Mate down as provider-dead', () => {
    expect(isProviderDeadError(400, '{"error":{"message":"Your credit balance is too low"}}')).toBe(true);
  });

  it('treats auth, quota, overload and 5xx as provider-dead', () => {
    for (const s of [401, 403, 429, 500, 529, 503]) expect(isProviderDeadError(s, '')).toBe(true);
  });

  it('keeps request-shaped 400s loud — never fall back on our own bugs', () => {
    expect(isProviderDeadError(400, '{"error":{"message":"messages: text content blocks must be non-empty"}}')).toBe(false);
    expect(isProviderDeadError(400, 'max_tokens: invalid')).toBe(false);
  });
});

describe('stripThoughtSignatures', () => {
  it('sheds Claude thinking blobs so Gemini accepts the replayed turn', () => {
    const contents = [
      { role: 'model', parts: [
        { functionCall: { name: 'search' }, thoughtSignature: 'claude-blob' },
        { text: 'hi' },
      ] },
      { role: 'user', parts: [{ text: 'yes' }] },
    ];
    const out: any = stripThoughtSignatures(contents);
    expect(out[0].parts[0].thoughtSignature).toBeUndefined();
    expect(out[0].parts[0].functionCall).toEqual({ name: 'search' });
    expect(out[0].parts[1].text).toBe('hi');
    expect(out[1]).toEqual(contents[1]);
  });

  it('tolerates malformed content entries', () => {
    expect(stripThoughtSignatures([null as any, { role: 'user' } as any])).toHaveLength(2);
  });
});
