/**
 * Regression: reconcile must not die on big quotes.
 *
 * The server rejects >50 items with a 400. The client sent the whole list, and
 * materialsPipeline treats reconcile as best-effort inside a catch — so a quote
 * with 51+ priceable rows silently lost the ENTIRE reconcile pass: no pack-size
 * correction, no over-buy clamp, no category gate. It surfaced on a real
 * 114-material carpentry quote (QU-178377), where 0 of 81 items reconciled and
 * the arm still reported a confident $28,654.
 *
 * These are the big-ticket quotes — the one quote already over the cap carried
 * 3% of all materials value in a 338-quote corpus — and a more complete
 * materials generator pushes more of them across the line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const fetchMock = vi.fn();

async function importFresh() {
  vi.resetModules();
  const mod = await import('./llmService');
  const { auth } = await import('../config/firebase');
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: vi.fn(async () => 'test-token') };
  return mod;
}

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `Material ${i}` })) as any[];

/** Echo back a result per item, so batches are traceable to their request. */
function respondPerItem() {
  fetchMock.mockImplementation(async (_url: string, init: any) => {
    const sent = JSON.parse(init.body).items;
    return { ok: true, json: async () => ({ results: sent.map((i: any) => ({ id: i.id, purchaseCount: 1 })) }) };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('reconcilePricedMaterials batching', () => {
  it('sends 50 or fewer items per request', async () => {
    respondPerItem();
    const { reconcilePricedMaterials, RECONCILE_MAX_ITEMS_PER_REQUEST } = await importFresh();

    await reconcilePricedMaterials(items(81), {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body).items.length).toBeLessThanOrEqual(RECONCILE_MAX_ITEMS_PER_REQUEST);
    }
  });

  it('returns a result for every item, across batches, with no loss or duplication', async () => {
    respondPerItem();
    const { reconcilePricedMaterials } = await importFresh();

    const results = await reconcilePricedMaterials(items(114), {});

    expect(results).toHaveLength(114);
    expect(new Set(results.map((r: any) => r.id)).size).toBe(114);
    expect(results[0].id).toBe('m0');
    expect(results[113].id).toBe('m113');
  });

  it('still sends exactly one request at the cap', async () => {
    respondPerItem();
    const { reconcilePricedMaterials } = await importFresh();

    await reconcilePricedMaterials(items(50), {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes job context to every batch', async () => {
    respondPerItem();
    const { reconcilePricedMaterials } = await importFresh();

    await reconcilePricedMaterials(items(60), { jobName: 'Shed', jobDescription: '9x6 steel garage' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body);
      expect(body.jobName).toBe('Shed');
      expect(body.jobDescription).toBe('9x6 steel garage');
    }
  });

  it('propagates a failing batch rather than returning a partial list', async () => {
    // Half-reconciled is worse than not reconciled: the caller's catch keeps
    // pre-reconcile prices for every row, which is at least self-consistent.
    let call = 0;
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      const sent = JSON.parse(init.body).items;
      if (++call === 2) return { ok: false, json: async () => ({ error: 'boom' }) };
      return { ok: true, json: async () => ({ results: sent.map((i: any) => ({ id: i.id })) }) };
    });
    const { reconcilePricedMaterials } = await importFresh();

    await expect(reconcilePricedMaterials(items(60), {})).rejects.toThrow('boom');
  });

  it('makes no request for an empty list', async () => {
    const { reconcilePricedMaterials } = await importFresh();
    expect(await reconcilePricedMaterials([], {})).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
