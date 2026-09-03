import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RUNS_PER_WINDOW,
  ProgressWriter,
  formatAud,
  quotePatch,
  runPricingRun,
  scrubNonFinite,
  shouldNotify,
  type PricingRunRecord,
  type PricingRunStore,
  type StoredQuote,
} from './pricingRun';
import type { PipelineDeps } from './shared/pricing/pipeline';

/**
 * The run is exercised end to end against an in-memory store and stubbed
 * pipeline dependencies. The pipeline itself (shared/pricing/pipeline.ts) has
 * its own suites; these cover what THIS module adds — claiming, persistence,
 * the parked-draft failure path, the rate ceiling, and when a push goes out.
 */

function quote(overrides: Partial<StoredQuote> = {}): StoredQuote {
  return {
    id: 'q1',
    jobId: 'job1',
    job: { id: 'j1', name: 'Deck rebuild', description: 'Rebuild a 20 m² deck' },
    materials: [],
    sections: [],
    laborRate: 90,
    laborHours: 0,
    markup: 10,
    pricesIncludeGst: true,
    gstRegistered: true,
    ...overrides,
  };
}

function run(overrides: Partial<PricingRunRecord> = {}): PricingRunRecord {
  return {
    quoteId: 'q1',
    kind: 'draft',
    options: { stripLabour: false, labourOnly: false },
    status: 'queued',
    foreground: true,
    // The fake clock starts at 1,000,000 ms; a fresh stamp means "watching".
    foregroundAt: new Date(1_000_000).toISOString(),
    createdAt: '2026-09-03T02:00:00.000Z',
    ...overrides,
  };
}

interface FakeStore extends PricingRunStore {
  record: PricingRunRecord | null;
  quotes: Record<string, StoredQuote>;
  runUpdates: Record<string, unknown>[];
  quoteWrites: Array<{ quoteId: string; patch: Record<string, unknown> }>;
  pushes: Array<{ event: string; vars: Record<string, string>; data: Record<string, string> }>;
  recentRuns: number;
  plan: 'trial' | 'free' | 'pro';
}

function fakeStore(record: PricingRunRecord | null, quotes: Record<string, StoredQuote>): FakeStore {
  let now = 1_000_000;
  const store: FakeStore = {
    record,
    quotes,
    runUpdates: [],
    quoteWrites: [],
    pushes: [],
    recentRuns: 1,
    plan: 'trial',
    now: () => (now += 50),
    claim: async () => {
      if (!store.record || store.record.status !== 'queued') return null;
      store.record = { ...store.record, status: 'running' };
      return store.record;
    },
    update: async (patch) => {
      store.runUpdates.push(patch);
      store.record = { ...(store.record as PricingRunRecord), ...(patch as Partial<PricingRunRecord>) };
    },
    read: async () => store.record,
    runsStartedSince: async () => store.recentRuns,
    loadQuote: async (quoteId) => store.quotes[quoteId] ?? null,
    saveQuote: async (quoteId, patch) => {
      store.quoteWrites.push({ quoteId, patch });
      store.quotes[quoteId] = { ...store.quotes[quoteId], ...(patch as Partial<StoredQuote>) } as StoredQuote;
    },
    loadBusinessSettings: async () => ({ defaultLaborRate: 90 }),
    loadPlan: async () => store.plan,
    notify: async (event, vars, data) => {
      store.pushes.push({ event, vars, data });
    },
  };
  return store;
}

/** A pipeline that drafts one screw line and prices it off a Bunnings hit. */
function fakeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    analyzeJobDescription: async () => ({
      materials: [
        { name: 'Decking screws', searchTerm: 'decking screws', quantity: 200, unit: 'each', section: 'Deck' },
      ],
      estimatedHours: 6,
      jobSummary: '',
    }),
    reconcilePricedMaterials: async () => [],
    estimateMaterialPrice: async () => ({ price: null }),
    searchBunningsCandidates: async () => [],
    batchSearchBunnings: async (searches) =>
      searches.map((s) => ({
        searchTerm: s.searchTerm,
        success: true,
        results: [
          {
            productName: 'Zenith 10g x 50mm Decking Screws 500 Pack',
            price: 42.5,
            priceIncGst: 42.5,
            unit: 'pack',
            itemNumber: '1234',
            stockLevel: 'in-stock' as const,
            productUrl: 'https://bunnings.example/1234',
            confidence: 'high' as const,
          },
        ],
      })),
    searchReeceCandidates: async () => [],
    isReeceConnected: async () => false,
    loadSupplierGroups: async () => [],
    loadFavorites: async () => ({}),
    loadPersonalRates: async () => [],
    loadTemplates: async () => [],
    ...overrides,
  };
}

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('runPricingRun', () => {
  it('claims the run, prices the quote and writes it back with totals and the wizard step', async () => {
    const store = fakeStore(run(), { q1: quote() });
    const outcome = await runPricingRun({ store, deps: fakeDeps(), log: silent });

    expect(outcome).toBe('done');
    // The analysed rows land before pricing, the priced rows after.
    expect(store.quoteWrites).toHaveLength(2);
    const final = store.quoteWrites[1].patch as StoredQuote;
    expect(final.draftStep).toBe('JobPreview');
    expect(final.materials).toHaveLength(1);
    expect(final.materials[0].price).toBeGreaterThan(0);
    expect(final.materials[0].pricingSource).toBe('scraper');
    expect(final.total).toBeGreaterThan(0);
    expect(final.job.estimatedHours).toBe(6);
    expect(typeof final.updatedAt).toBe('string');

    expect(store.record?.status).toBe('done');
    expect(store.record?.result).toMatchObject({ generatedMaterialCount: 1, fetchedCount: 1, failedCount: 0 });
    expect(store.record?.progress).toMatchObject({ phase: 'done', done: true });
    expect(store.record?.progress?.summary).toBe('1 priced');
  });

  it('does nothing when the run is not queued — a redelivered event must not price twice', async () => {
    const store = fakeStore(run({ status: 'running' }), { q1: quote() });
    const deps = fakeDeps({ analyzeJobDescription: vi.fn() as unknown as PipelineDeps['analyzeJobDescription'] });
    expect(await runPricingRun({ store, deps, log: silent })).toBe('skipped');
    expect(deps.analyzeJobDescription).not.toHaveBeenCalled();
    expect(store.quoteWrites).toHaveLength(0);
  });

  it('pushes only when the phone had gone to the background', async () => {
    const watching = fakeStore(run({ foreground: true }), { q1: quote() });
    await runPricingRun({ store: watching, deps: fakeDeps(), log: silent });
    expect(watching.pushes).toHaveLength(0);

    const away = fakeStore(run({ foreground: false }), { q1: quote() });
    await runPricingRun({ store: away, deps: fakeDeps(), log: silent });
    expect(away.pushes).toHaveLength(1);
    expect(away.pushes[0]).toMatchObject({
      event: 'quote_priced',
      vars: { job: 'Deck rebuild', count: '1 item' },
      data: { quoteId: 'q1', jobId: 'job1' },
    });
    expect(away.pushes[0].vars.amount).toMatch(/^\$\d/);
  });

  it('pushes when the phone has gone quiet even if its "away" write never landed', async () => {
    const quiet = fakeStore(run({ foreground: true, foregroundAt: new Date(1_000_000 - 60_000).toISOString() }), { q1: quote() });
    await runPricingRun({ store: quiet, deps: fakeDeps(), log: silent });
    expect(quiet.pushes).toHaveLength(1);
  });

  it('parks a failed run on the Fetch Prices step and tells a backgrounded tradie about the snag', async () => {
    const store = fakeStore(run({ foreground: false }), { q1: quote() });
    const deps = fakeDeps({
      analyzeJobDescription: async () => {
        throw new Error('Both LLM providers failed');
      },
    });
    expect(await runPricingRun({ store, deps, log: silent })).toBe('failed');
    expect(store.record?.status).toBe('failed');
    expect(store.record?.error).toBe('Both LLM providers failed');
    expect(store.record?.progress).toMatchObject({ phase: 'failed', done: true });
    expect(store.quotes.q1.draftStep).toBe('MaterialsList');
    expect(store.pushes[0]?.event).toBe('quote_pricing_snag');
  });

  it('refuses to price when the user has flooded the queue', async () => {
    const store = fakeStore(run(), { q1: quote() });
    store.recentRuns = MAX_RUNS_PER_WINDOW + 1;
    const deps = fakeDeps({ analyzeJobDescription: vi.fn() as unknown as PipelineDeps['analyzeJobDescription'] });
    expect(await runPricingRun({ store, deps, log: silent })).toBe('failed');
    expect(deps.analyzeJobDescription).not.toHaveBeenCalled();
    expect(store.record?.error).toMatch(/Too many pricing runs/);
  });

  it('refuses the free plan and decides photo vision from the server-side plan, not the document', async () => {
    const gated = fakeStore(run(), { q1: quote() });
    gated.plan = 'free';
    const analyze = vi.fn();
    expect(await runPricingRun({ store: gated, deps: fakeDeps({ analyzeJobDescription: analyze as never }), log: silent })).toBe('failed');
    expect(analyze).not.toHaveBeenCalled();
    expect(gated.record?.error).toMatch(/free plan/);

    const pro = fakeStore(run(), { q1: quote({ photos: [{ storageUrl: 'https://storage.example/plan.jpg', isPlan: true }] }) });
    pro.plan = 'pro';
    const seen = vi.fn(async (req: { photoUrls?: string[] }) => {
      seen.mock.lastCall;
      return { materials: [], estimatedHours: 2, jobSummary: '' };
    });
    await runPricingRun({ store: pro, deps: fakeDeps({ analyzeJobDescription: seen as never }), log: silent });
    expect(seen.mock.calls[0][0].photoUrls).toEqual(['https://storage.example/plan.jpg']);
  });

  it('stops without touching the quote once the phone has taken the run back', async () => {
    const store = fakeStore(run(), { q1: quote() });
    const deps = fakeDeps({
      analyzeJobDescription: async () => {
        // The phone cancelled while the analyse call was in flight.
        store.record = { ...(store.record as PricingRunRecord), status: 'cancelled' };
        return { materials: [{ name: 'Screws', searchTerm: 'screws', quantity: 1, unit: 'each' }], estimatedHours: 1, jobSummary: '' };
      },
    });
    expect(await runPricingRun({ store, deps, log: silent })).toBe('cancelled');
    expect(store.quoteWrites).toHaveLength(0);
    expect(store.record?.status).toBe('cancelled');
  });

  it('carries the real total on a labour-only push', async () => {
    const store = fakeStore(run({ foreground: false, options: { stripLabour: false, labourOnly: true } }), { q1: quote() });
    await runPricingRun({ store, deps: fakeDeps(), log: silent });
    // 6 h × $90 + 10% markup, whole dollars.
    expect(store.pushes[0]?.vars.amount).toBe('$594');
  });

  it('fails cleanly when the quote was deleted before the run started', async () => {
    const store = fakeStore(run(), {});
    expect(await runPricingRun({ store, deps: fakeDeps(), log: silent })).toBe('failed');
    expect(store.record?.error).toMatch(/Quote not found/);
    // Nothing to park — the quote is gone — but the run record still says why.
    expect(store.record?.status).toBe('failed');
  });

  it('labour-only keeps the hours and sections and skips pricing entirely', async () => {
    const store = fakeStore(run({ options: { stripLabour: false, labourOnly: true } }), { q1: quote() });
    const batch = vi.fn();
    const deps = fakeDeps({ batchSearchBunnings: batch as unknown as PipelineDeps['batchSearchBunnings'] });
    expect(await runPricingRun({ store, deps, log: silent })).toBe('done');
    expect(batch).not.toHaveBeenCalled();
    const final = store.quoteWrites[0].patch as StoredQuote;
    expect(final.materials).toHaveLength(0);
    expect(final.laborHours).toBe(6);
    expect(final.draftStep).toBe('JobPreview');
    expect(store.record?.progress?.summary).toMatch(/Labour only/);
  });

  it('strips the analysed labour when rate lines already charge for it', async () => {
    const store = fakeStore(run({ options: { stripLabour: true, labourOnly: false } }), { q1: quote() });
    expect(await runPricingRun({ store, deps: fakeDeps(), log: silent })).toBe('done');
    const final = store.quoteWrites[1].patch as StoredQuote;
    expect(final.laborHours).toBe(0);
    expect(final.sections?.every((s) => s.pricing === 'lumpSum' && s.laborTotal === 0)).toBe(true);
  });
});

describe('ProgressWriter', () => {
  it('coalesces rapid events and always carries the merged state', async () => {
    let now = 0;
    const writes: Record<string, unknown>[] = [];
    const writer = new ProgressWriter(
      { update: async (patch) => { writes.push(patch); }, now: () => now },
      { phase: 'preflight', status: 'Getting ready…', done: false },
      500,
    );
    now = 1000;
    writer.report({ phase: 'pricing', status: 'Pricing 12 items…' });
    now = 1100;
    writer.report({ detail: 'Just priced screws' }); // inside the interval — held
    now = 1200;
    writer.report({ detail: 'Just priced nails' }); // still held
    await writer.finish({ phase: 'done', done: true, summary: '12 priced' }, { status: 'done' });

    expect(writes).toHaveLength(2);
    expect(writes[0].progress).toMatchObject({ phase: 'pricing', status: 'Pricing 12 items…' });
    // The final write carries the headline from the first event AND the last detail.
    expect(writes[1].progress).toMatchObject({
      phase: 'done',
      status: 'Pricing 12 items…',
      detail: 'Just priced nails',
      summary: '12 priced',
      done: true,
    });
    expect(writes[1].status).toBe('done');
  });

  it('still lands the last state of a burst when nothing follows it', async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const writes: Record<string, unknown>[] = [];
      const writer = new ProgressWriter(
        { update: async (patch) => { writes.push(patch); }, now: () => now },
        { phase: 'pricing', status: 'Pricing…', done: false },
        500,
      );
      now = 1000;
      writer.report({ detail: 'Just priced screws' }); // written
      now = 1100;
      writer.report({ status: 'Sorting pack sizes and quantities…' }); // held
      await vi.advanceTimersByTimeAsync(450);
      expect(writes).toHaveLength(2);
      expect(writes[1].progress).toMatchObject({ status: 'Sorting pack sizes and quantities…' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('helpers', () => {
  it('quotePatch recomputes totals, keeps only what the run owns, and never writes undefined or NaN', () => {
    const patch = quotePatch(
      quote({
        materials: [
          { id: 'm1', name: 'Screws', quantity: 2, unit: 'pack', price: 10, totalPrice: 20, manualPriceOverride: false, brand: undefined },
        ],
        sections: [
          { id: 's1', name: 'Deck', multiplier: 1, laborHours: Number.NaN, laborHoursTotal: 4, laborRate: 90, laborUnit: 'hours', laborTotal: 360, sortOrder: 0 },
        ],
        laborHours: 4,
        draftStep: 'JobPreview',
      }),
      Date.UTC(2026, 8, 3),
    );
    expect(patch.materialsSubtotal).toBe(20);
    expect(patch.laborTotal).toBe(360);
    expect(patch.total).toBeGreaterThan(380);
    expect(patch.draftStep).toBe('JobPreview');
    expect(patch.updatedAt).toBe('2026-09-03T00:00:00.000Z');
    expect('customerName' in patch).toBe(false);
    expect(JSON.stringify(patch)).not.toContain('undefined');
    const section = (patch.sections as Array<{ laborHours: number }>)[0];
    expect(Number.isFinite(section.laborHours)).toBe(true);
  });

  it('shouldNotify: away flag, stale or missing stamp → push; fresh stamp → no push; no record → no push', () => {
    const now = Date.UTC(2026, 8, 3, 2, 0, 0);
    const fresh = new Date(now - 10_000).toISOString();
    const stale = new Date(now - 60_000).toISOString();
    expect(shouldNotify(run({ foreground: false, foregroundAt: fresh }), now)).toBe(true);
    expect(shouldNotify(run({ foreground: true, foregroundAt: fresh }), now)).toBe(false);
    expect(shouldNotify(run({ foreground: true, foregroundAt: stale }), now)).toBe(true);
    expect(shouldNotify(run({ foreground: true, foregroundAt: undefined }), now)).toBe(true);
    expect(shouldNotify(null, now)).toBe(false);
  });

  it('formats push money as whole Australian dollars', () => {
    expect(formatAud(4123.4)).toBe('$4,123');
    expect(formatAud(Number.NaN)).toBe('$0');
  });

  it('scrubNonFinite recurses through arrays', () => {
    expect(scrubNonFinite({ a: [Number.POSITIVE_INFINITY, 2], b: { c: Number.NaN } })).toEqual({ a: [0, 2], b: { c: 0 } });
  });
});
