/**
 * The analyse ledger — the request id's second home, outside the memory of
 * the process that minted it.
 */
import { describe, it, expect } from 'vitest';
import {
  ANALYSE_LEDGER_KEY,
  RESUME_WINDOW_MS,
  listUnsettledAnalyses,
  recordAnalyseSent,
  recordAnalyseSettled,
} from '../analyseLedger';
import type { LedgerStorage } from '../pricingRunLedger';

function memoryStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const storage: LedgerStorage = {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
  return { storage, raw: () => store.get(ANALYSE_LEDGER_KEY) ?? null };
}

const NOW = 1_788_778_288_262; // 7 Sep 2026 10:51:28Z — when the incident's draft was minted.

describe('analyse ledger', () => {
  it('remembers a request until it is settled', async () => {
    const { storage } = memoryStorage();
    await recordAnalyseSent({ requestId: 'req-1', quoteId: 'q1', sentAt: NOW }, storage);
    expect(await listUnsettledAnalyses(NOW + 1_000, storage)).toEqual([
      { requestId: 'req-1', quoteId: 'q1', sentAt: NOW },
    ]);

    await recordAnalyseSettled('req-1', storage);
    expect(await listUnsettledAnalyses(NOW + 1_000, storage)).toEqual([]);
  });

  it('settling an unknown id is a no-op that does not touch storage', async () => {
    const { storage, raw } = memoryStorage();
    await recordAnalyseSettled('never-sent', storage);
    expect(raw()).toBeNull();
  });

  it('prunes entries older than the parked result itself would survive', async () => {
    const { storage } = memoryStorage();
    await recordAnalyseSent({ requestId: 'old', quoteId: 'q1', sentAt: NOW - RESUME_WINDOW_MS - 1 }, storage);
    await recordAnalyseSent({ requestId: 'fresh', quoteId: 'q2', sentAt: NOW - 60_000 }, storage);

    const listed = await listUnsettledAnalyses(NOW, storage);
    expect(listed.map((e) => e.requestId)).toEqual(['fresh']);
    // Pruned for good, not just filtered from this read.
    expect(await listUnsettledAnalyses(NOW, storage)).toHaveLength(1);
  });

  it('orders by when the request was sent, oldest first', async () => {
    const { storage } = memoryStorage();
    await recordAnalyseSent({ requestId: 'b', quoteId: 'q', sentAt: NOW - 1_000 }, storage);
    await recordAnalyseSent({ requestId: 'a', quoteId: 'q', sentAt: NOW - 5_000 }, storage);
    expect((await listUnsettledAnalyses(NOW, storage)).map((e) => e.requestId)).toEqual(['a', 'b']);
  });

  it('survives a corrupt ledger rather than throwing on launch', async () => {
    const { storage } = memoryStorage({ [ANALYSE_LEDGER_KEY]: '{not json' });
    expect(await listUnsettledAnalyses(NOW, storage)).toEqual([]);
    await recordAnalyseSent({ requestId: 'req-1', quoteId: 'q1', sentAt: NOW }, storage);
    expect(await listUnsettledAnalyses(NOW, storage)).toHaveLength(1);
  });

  it('ignores an entry with a sentAt in the future or unreadable', async () => {
    const { storage } = memoryStorage({
      [ANALYSE_LEDGER_KEY]: JSON.stringify({
        future: { requestId: 'future', quoteId: 'q', sentAt: NOW + 60_000 },
        junk: { requestId: 'junk', quoteId: 'q', sentAt: 'yesterday' },
      }),
    });
    expect(await listUnsettledAnalyses(NOW, storage)).toEqual([]);
  });
});
