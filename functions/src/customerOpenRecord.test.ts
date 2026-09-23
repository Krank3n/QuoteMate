/**
 * recordEmailOpenOnQuote — the shared "stamp an email open" flow used by the
 * Brevo webhook (and shaped like the pixel handler). Pinned: a first open
 * writes the first-open stamp with its send-to-open delay, a later open
 * bumps only the last-open fields, a repeat inside the throttle is a no-op,
 * a missing quote writes nothing, and the mirror hook runs after each write.
 */
import { describe, expect, it, vi } from 'vitest';

import { EMAIL_OPEN_WRITE_THROTTLE_MS } from './emailOpenPixel';
import { recordEmailOpenOnQuote, type RecordEmailOpenDeps } from './customerOpenRecord';

const T = 1_760_000_000_000;
const ref = { userId: 'u1', quoteId: 'q1' };

function deps(quote: { hasFirstOpen: boolean; lastOpenedAtMs: number | null; sentAtMs: number | null } | null) {
  const writes: any[] = [];
  const after = vi.fn(async () => {});
  const d: RecordEmailOpenDeps<string, string> = {
    readQuote: async () => quote,
    writeStamp: async (_r, stamp) => { writes.push(stamp); },
    afterWrite: after,
    serverTimestamp: (ms) => `ts:${ms}`,
    increment: 'inc',
  };
  return { d, writes, after };
}

describe('recordEmailOpenOnQuote', () => {
  it('stamps a first open with the send-to-open delay and runs the mirror hook', async () => {
    const { d, writes, after } = deps({ hasFirstOpen: false, lastOpenedAtMs: null, sentAtMs: T - 90_000 });
    await expect(recordEmailOpenOnQuote(d, ref, T)).resolves.toEqual({ written: true });
    expect(writes).toEqual([{ emailFirstOpenedAt: `ts:${T}`, emailFirstOpenAfterMs: 90_000, emailLastOpenedAt: `ts:${T}`, emailOpenCount: 'inc' }]);
    expect(after).toHaveBeenCalledWith(ref);
  });

  it('a later open moves only the last-open fields', async () => {
    const { d, writes } = deps({ hasFirstOpen: true, lastOpenedAtMs: T - 3_600_000, sentAtMs: T - 7_200_000 });
    await recordEmailOpenOnQuote(d, ref, T);
    expect(writes).toEqual([{ emailLastOpenedAt: `ts:${T}`, emailOpenCount: 'inc' }]);
  });

  it('is a no-op inside the write throttle', async () => {
    const { d, writes, after } = deps({ hasFirstOpen: true, lastOpenedAtMs: T - EMAIL_OPEN_WRITE_THROTTLE_MS + 1, sentAtMs: T - 7_200_000 });
    await expect(recordEmailOpenOnQuote(d, ref, T)).resolves.toEqual({ written: false, reason: 'throttled' });
    expect(writes).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('writes nothing for a quote that no longer exists', async () => {
    const { d, writes } = deps(null);
    await expect(recordEmailOpenOnQuote(d, ref, T)).resolves.toEqual({ written: false, reason: 'no-quote' });
    expect(writes).toEqual([]);
  });
});
