import { describe, expect, it } from 'vitest';
import { listUnsettledRuns, recordRunSettled, recordRunStarted, RESUME_WINDOW_MS } from './pricingRunLedger';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe('pricing run ledger', () => {
  it('remembers a run until it settles', async () => {
    const storage = memoryStorage();
    const now = Date.UTC(2026, 8, 3, 2, 0, 0);
    await recordRunStarted({ runId: 'r1', quoteId: 'q1', jobName: 'Deck', createdAt: new Date(now).toISOString() }, storage);
    expect(await listUnsettledRuns(now + 1000, storage)).toEqual([
      { runId: 'r1', quoteId: 'q1', jobName: 'Deck', createdAt: new Date(now).toISOString() },
    ]);
    await recordRunSettled('r1', storage);
    expect(await listUnsettledRuns(now + 2000, storage)).toEqual([]);
  });

  it('drops runs older than the resume window and keeps the rest, oldest first', async () => {
    const storage = memoryStorage();
    const now = Date.UTC(2026, 8, 3, 2, 0, 0);
    await recordRunStarted({ runId: 'old', quoteId: 'q0', createdAt: new Date(now - RESUME_WINDOW_MS - 1).toISOString() }, storage);
    await recordRunStarted({ runId: 'later', quoteId: 'q2', createdAt: new Date(now - 1000).toISOString() }, storage);
    await recordRunStarted({ runId: 'earlier', quoteId: 'q1', createdAt: new Date(now - 60_000).toISOString() }, storage);
    expect((await listUnsettledRuns(now, storage)).map((e) => e.runId)).toEqual(['earlier', 'later']);
    // The prune is persisted, not just filtered on read.
    expect(JSON.parse(storage.dump()['@quotemate:pricing_runs_in_flight'])).not.toHaveProperty('old');
  });

  it('survives corrupt storage', async () => {
    const storage = memoryStorage();
    await storage.setItem('@quotemate:pricing_runs_in_flight', '{not json');
    expect(await listUnsettledRuns(Date.now(), storage)).toEqual([]);
    await recordRunSettled('nope', storage);
  });
});
