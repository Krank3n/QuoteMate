import { describe, expect, it, vi } from 'vitest';
import {
  fetchPricesForQuote,
  generateMaterialsForQuote,
  holdStatedHours,
  LAST_RESORT_GUESS_PREFIX,
  type PipelineDeps,
} from './pipeline';
import { recalculateQuoteTotals } from './documentTotals';
import type { Material, PricingQuote, ScraperProduct } from './types';

/**
 * The pipeline through its dependency seam. These are the contracts the phone
 * binding (src/services/materialsPipeline.ts) and the server binding
 * (functions/src/index.ts serverPipelineDeps) both have to honour, so they are
 * exercised here once rather than on each side.
 */

function material(overrides: Partial<Material>): Material {
  return {
    id: overrides.id ?? 'm1',
    name: 'Decking screws',
    searchTerm: 'decking screws',
    quantity: 200,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...overrides,
  };
}

function quote(materials: Material[]): PricingQuote {
  return {
    id: 'q1',
    job: { id: 'j1', name: 'Deck', description: 'Build a 20 m² deck' },
    materials,
    sections: [],
    laborHours: 0,
    pricesIncludeGst: true,
    gstRegistered: true,
  };
}

function bunnings(name: string, price: number, itemNumber = '1'): ScraperProduct {
  return {
    productName: name,
    price,
    priceIncGst: price,
    unit: 'each',
    itemNumber,
    stockLevel: 'in-stock',
    productUrl: `https://bunnings.example/${itemNumber}`,
    confidence: 'high',
  };
}

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    analyzeJobDescription: async () => ({ materials: [], estimatedHours: 8, jobSummary: '' }),
    reconcilePricedMaterials: async () => [],
    estimateMaterialPrice: async () => ({ price: null }),
    searchBunningsCandidates: async () => [],
    batchSearchBunnings: async (searches) => searches.map((s) => ({ searchTerm: s.searchTerm, success: true, results: [] })),
    searchReeceCandidates: async () => [],
    isReeceConnected: async () => false,
    loadSupplierGroups: async () => [],
    loadFavorites: async () => ({}),
    loadPersonalRates: async () => [],
    loadTemplates: async () => [],
    ...overrides,
  };
}

describe('fetchPricesForQuote through PipelineDeps', () => {
  it('prices from the supplier book first, reading the book once for the whole run', async () => {
    const loadFavorites = vi.fn(async () => ({
      merbau: {
        productName: 'Merbau decking 90x19',
        store: 'Timber Yard',
        price: 8.5,
        unit: 'm' as const,
        isPersonalRate: true,
        keywords: ['merbau', 'decking'],
      },
    }));
    const loadTemplates = vi.fn(async () => []);
    const d = deps({
      loadFavorites,
      loadTemplates,
      loadSupplierGroups: async () => [
        { id: 'g1', name: 'Timber Yard', sortOrder: 0, createdAt: '', updatedAt: '' },
      ],
    });
    const rows = [
      material({ id: 'a', name: 'Merbau decking 90x19', searchTerm: 'merbau decking 90x19', quantity: 60, unit: 'm' }),
      material({ id: 'b', name: 'Merbau decking 90x19', searchTerm: 'merbau decking 90x19', quantity: 12, unit: 'm' }),
    ];
    const result = await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: false });

    const priced = result.updatedQuote.materials;
    expect(priced.every((m) => m.pricingSource === 'manual' && m.price === 8.5)).toBe(true);
    expect(result.fetchedCount).toBe(2);
    expect(loadFavorites).toHaveBeenCalledTimes(1);
    expect(loadTemplates).toHaveBeenCalledTimes(1);
  });

  it('prices a Bunnings hit through the batch fetcher and hands the gated candidates to reconcile', async () => {
    const reconcile = vi.fn(async (items: Array<{ id: string }>) =>
      items.map((i) => ({ id: i.id, decision: 'apply' as const, chosenIndex: 0, purchaseCount: 1, purchaseUnit: 'pack', confidence: 'high' as const })),
    );
    const d = deps({
      batchSearchBunnings: async (searches) =>
        searches.map((s) => ({
          searchTerm: s.searchTerm,
          success: true,
          results: [bunnings('Zenith 10g x 50mm Decking Screws 500 Pack', 42.5, '500')],
        })),
      reconcilePricedMaterials: reconcile,
    });
    const events: string[] = [];
    const result = await fetchPricesForQuote(
      d,
      { quote: quote([material({})]), businessSettings: null, reeceConnected: false },
      { onEvent: (e) => events.push(e.kind) },
    );
    const row = result.updatedQuote.materials[0];
    expect(row.pricingSource).toBe('scraper');
    expect(row.bunningsItemNumber).toBe('500');
    expect(row.price).toBe(42.5);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0][0]).toMatchObject({ id: 'm1', requirement: 200 });
    expect(events).toContain('batch-chunk');
    expect(events).toContain('reconcile-start');
    expect(events[events.length - 1]).toBe('complete');
  });

  it('splits reconcile into server-sized batches of 50', async () => {
    const reconcile = vi.fn(async () => []);
    const rows = Array.from({ length: 60 }, (_, i) =>
      material({ id: `m${i}`, name: `Decking screws ${i}`, searchTerm: `decking screws ${i}` }),
    );
    const d = deps({
      batchSearchBunnings: async (searches) =>
        searches.map((s) => ({
          searchTerm: s.searchTerm,
          success: true,
          results: [bunnings(`Zenith Decking Screws ${s.searchTerm.split(' ').pop()} 500 Pack`, 42.5)],
        })),
      reconcilePricedMaterials: reconcile,
    });
    await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: false });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls[0][0]).toHaveLength(50);
    expect(reconcile.mock.calls[1][0]).toHaveLength(10);
  });

  it('falls through to the estimator, then to a bounded placeholder, when no supplier has it', async () => {
    const estimate = vi.fn(async (term: string) =>
      term === 'ducted air conditioner 14kw' ? { price: 7500, productName: 'Ducted inverter 14kW', packSize: 1, packUnit: 'each' } : { price: null },
    );
    const d = deps({ estimateMaterialPrice: estimate });
    const rows = [
      material({ id: 'ac', name: 'Ducted air conditioner 14kW', searchTerm: 'ducted air conditioner 14kw', quantity: 1 }),
      material({ id: 'mystery', name: 'Zorbified flangewidget', searchTerm: 'zorbified flangewidget', quantity: 3 }),
    ];
    const result = await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: false });
    const [ac, mystery] = result.updatedQuote.materials;
    expect(ac.pricingSource).toBe('ai');
    expect(ac.price).toBe(7500);
    // Nothing could price the widget: a placeholder for ONE purchase, never
    // multiplied by the requirement, and flagged for the tradie.
    expect(mystery.description?.startsWith(LAST_RESORT_GUESS_PREFIX)).toBe(true);
    expect(mystery.quantity).toBe(1);
    expect(mystery.priceConfidence).toBe('low');
    // No row leaves a completed run at $0.
    expect(result.updatedQuote.materials.every((m) => m.price > 0)).toBe(true);
  });

  it('reports the run outcome through the telemetry seam without letting it fail the run', async () => {
    const report = vi.fn(() => {
      throw new Error('telemetry down');
    });
    const d = deps({
      reportPriceFetchUsage: report,
      estimateMaterialPrice: async () => ({ price: 19.9, productName: 'Decking screws 500 pack', packSize: 500, packUnit: 'each' }),
    });
    const rows = [material({ id: 'a' }), material({ id: 'b', price: 5, totalPrice: 5 })];
    const result = await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: false });
    expect(result.fetchedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ fetched: 1, skipped: 1 }));
  });
});

describe('generateMaterialsForQuote through PipelineDeps', () => {
  it('drafts rows and sections from the analysis and prices saved-rate matches off the book', async () => {
    const analyze = vi.fn(async () => ({
      materials: [
        { name: 'Merbau decking', searchTerm: '', quantity: 60, unit: 'm', section: 'Deck', sectionMultiplier: 1, savedRateName: 'Merbau decking 90x19' },
        { name: 'Decking screws', searchTerm: 'decking screws', quantity: 200, unit: 'each', section: 'Deck', sectionMultiplier: 1, sectionLaborHours: 6 },
      ],
      estimatedHours: 6,
      jobSummary: '',
    }));
    const d = deps({
      analyzeJobDescription: analyze,
      loadFavorites: async () => ({
        merbau: { productName: 'Merbau decking 90x19', store: 'Timber Yard', price: 8.5, unit: 'm' as const, isPersonalRate: true },
      }),
      loadPersonalRates: async () => [
        { productName: 'Merbau decking 90x19', store: 'Timber Yard', price: 8.5, unit: 'm' as const, isPersonalRate: true },
      ],
    });
    const result = await generateMaterialsForQuote(d, {
      quote: quote([]),
      businessSettings: { defaultLaborRate: 95 },
      isPro: false,
      templates: [],
    });
    expect(result.generatedMaterialCount).toBe(2);
    const [merbau, screws] = result.updatedQuote.materials;
    expect(merbau.pricingSource).toBe('manual');
    expect(merbau.price).toBe(8.5);
    expect(screws.price).toBe(0);
    expect(result.updatedQuote.sections?.map((s) => s.name)).toEqual(['Deck']);
    expect(result.updatedQuote.sections?.[0].laborRate).toBe(95);
    expect(result.updatedQuote.laborHours).toBe(6);
    // The request carried the tradie's saved rates for the prompt.
    expect(analyze.mock.calls[0][0].userSavedRates).toHaveLength(1);
  });
});

/**
 * A tradie who says "40 hours" gets a 40-hour quote.
 *
 * The analyse used to take the model's own estimate over the hours seeded on
 * the quote, so a labour-only job stated at 40 h came back at 32 h with four
 * sections summing to 31.5 h — and the price moved with them. The engine's
 * split stands; the total is the tradie's.
 */
describe('generateMaterialsForQuote — stated hours are held', () => {
  // Four sections whose hours × multiplier sum to 31.5 h, under a 32 h estimate.
  const fourSections = () => ({
    materials: [
      { name: 'Rough-in labour', searchTerm: '', quantity: 1, unit: 'each', section: 'Rough-in', sectionMultiplier: 3, sectionLaborHours: 2.5 },
      { name: 'Fit-off labour', searchTerm: '', quantity: 1, unit: 'each', section: 'Fit-off', sectionMultiplier: 3, sectionLaborHours: 6 },
      { name: 'Testing', searchTerm: '', quantity: 1, unit: 'each', section: 'Testing', sectionMultiplier: 1, sectionLaborHours: 3 },
      { name: 'Clean-up', searchTerm: '', quantity: 1, unit: 'each', section: 'Clean-up', sectionMultiplier: 2, sectionLaborHours: 1.5 },
    ],
    estimatedHours: 32,
    jobSummary: '',
  });
  const sectionSum = (q: PricingQuote) =>
    (q.sections ?? []).reduce((sum, s) => sum + s.laborHours * s.multiplier, 0);
  const rated = (q: PricingQuote) => ({ ...q, laborRate: 90, markup: 0, laborMarkup: 0 });

  it('stated 40 h over a 31.5 h split → 40 h on the quote and labour billed at 40 × rate', async () => {
    const analyze = vi.fn(fourSections);
    const result = await generateMaterialsForQuote(deps({ analyzeJobDescription: analyze }), {
      quote: { ...quote([]), laborHours: 40 },
      businessSettings: { defaultLaborRate: 90 },
      isPro: false,
      templates: [],
      statedHours: 40,
    });
    const out = result.updatedQuote;
    expect(sectionSum(out)).toBeCloseTo(31.5, 5);
    expect(out.laborHours).toBe(40);
    expect(out.laborExtraHours).toBeCloseTo(8.5, 5);
    expect(out.job.estimatedHours).toBe(40);
    expect(recalculateQuoteTotals(rated(out)).laborTotal).toBeCloseTo(40 * 90, 5);
    expect(result.estimatedHours).toBe(40);
    // The model was told the number too, as a hard target for its split.
    expect(analyze.mock.calls[0][0]).toMatchObject({ targetHours: 40 });
  });

  it('stated hours BELOW the split ride as a negative adjustment, so the total still holds', async () => {
    const result = await generateMaterialsForQuote(deps({ analyzeJobDescription: async () => fourSections() }), {
      quote: { ...quote([]), laborHours: 20 },
      businessSettings: { defaultLaborRate: 90 },
      isPro: false,
      templates: [],
      statedHours: 20,
    });
    const out = result.updatedQuote;
    expect(out.laborHours).toBe(20);
    expect(out.laborExtraHours).toBeCloseTo(-11.5, 5);
    expect(recalculateQuoteTotals(rated(out)).laborTotal).toBeCloseTo(20 * 90, 5);
  });

  it("no stated hours → the engine's estimate stands, nothing is pinned and the model gets no target", async () => {
    const analyze = vi.fn(fourSections);
    const result = await generateMaterialsForQuote(deps({ analyzeJobDescription: analyze }), {
      quote: quote([]),
      businessSettings: { defaultLaborRate: 90 },
      isPro: false,
      templates: [],
    });
    const out = result.updatedQuote;
    expect(out.laborHours).toBe(32);
    expect('laborExtraHours' in out).toBe(false);
    expect(out.job.estimatedHours).toBe(32);
    expect(recalculateQuoteTotals(rated(out)).laborTotal).toBeCloseTo(31.5 * 90, 5);
    expect('targetHours' in analyze.mock.calls[0][0]).toBe(false);
  });

  it('a zero or nonsense figure is not a stated total — it changes nothing', async () => {
    for (const statedHours of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const analyze = vi.fn(fourSections);
      const result = await generateMaterialsForQuote(deps({ analyzeJobDescription: analyze }), {
        quote: quote([]),
        businessSettings: { defaultLaborRate: 90 },
        isPro: false,
        templates: [],
        statedHours,
      });
      expect(result.updatedQuote.laborHours).toBe(32);
      expect('laborExtraHours' in result.updatedQuote).toBe(false);
      expect('targetHours' in analyze.mock.calls[0][0]).toBe(false);
    }
  });

  it('holds the stated total over an existing list too, where the analyse would have ADDED its estimate', async () => {
    const existing = material({ id: 'mine', name: 'Skip bin', section: 'Site', manualPriceOverride: true, price: 250, totalPrice: 250 });
    const result = await generateMaterialsForQuote(deps({ analyzeJobDescription: async () => fourSections() }), {
      quote: {
        ...quote([existing]),
        laborHours: 12,
        sections: [{ id: 's0', name: 'Site', multiplier: 1, laborHours: 1, laborHoursTotal: 1, laborRate: 90, laborUnit: 'hours', laborTotal: 90, sortOrder: 0 }],
      },
      businessSettings: { defaultLaborRate: 90 },
      isPro: false,
      templates: [],
      statedHours: 12,
    });
    const out = result.updatedQuote;
    // Without the hold this would have been 12 + 32 = 44 h.
    expect(out.laborHours).toBe(12);
    expect(out.laborExtraHours).toBeCloseTo(12 - 32.5, 5);
    expect(recalculateQuoteTotals(rated(out)).laborTotal).toBeCloseTo(12 * 90, 5);
  });

  it('holdStatedHours without sections just sets the hours — the top-level figure IS the labour there', () => {
    const out = holdStatedHours({ ...quote([]), laborHours: 3 }, 40);
    expect(out.laborHours).toBe(40);
    expect('laborExtraHours' in out).toBe(false);
    expect(recalculateQuoteTotals(rated(out)).laborTotal).toBeCloseTo(40 * 90, 5);
  });
});
