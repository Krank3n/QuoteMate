import { describe, expect, it, vi } from 'vitest';
import {
  fetchPricesForQuote,
  generateMaterialsForQuote,
  holdStatedHours,
  LAST_RESORT_GUESS_PREFIX,
  type PipelineDeps,
} from './pipeline';
import { recalculateQuoteTotals } from './documentTotals';
import type { Material, PricingQuote, QuoteSection, ScraperProduct } from './types';
import { normaliseSectionDescriptions } from './llmMaterials';

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

  it('never forces a refused Reece hit onto a row — the row falls through to the estimate', async () => {
    // Laidlaw Plumbing, 29 Sep 2026: every Reece hit for "bedding sand bulk"
    // was refused by the ranker, candidates[0] was applied anyway, and
    // 3,440 kg of sand went out at $120.37 each as a "Bazooka End Cap".
    const searchReeceCandidates = vi.fn(async () => [
      { price: 120.37, productName: 'Bazooka End Cap 150mm Black', itemNumber: '8028003', store: 'Reece Plumbing', unitOfMeasure: 'EA' },
    ]);
    const d = deps({
      searchReeceCandidates,
      estimateMaterialPrice: async () => ({ price: 0.06, productName: 'Bulk bedding sand', packSize: 1, packUnit: 'kg' }),
    });
    const rows = [
      material({ id: 'sand', name: 'Pipe bedding sand', searchTerm: 'bedding sand bulk', quantity: 3440, unit: 'kg' }),
    ];
    const result = await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: true });
    const [sand] = result.updatedQuote.materials;
    expect(searchReeceCandidates).toHaveBeenCalledWith('bedding sand bulk');
    expect(sand.reeceItemNumber).toBeUndefined();
    expect(sand.name).not.toContain('Bazooka');
    expect(sand.pricingSource).toBe('ai');
    expect(sand.totalPrice).toBeLessThan(1000);
  });

  it('applies Reece pack sizes even when reconcile never reaches the row', async () => {
    // 29 Sep: the server run timed out mid-reconcile and every unreached Reece
    // row kept requirement × pack price — 100 bags of clips for 100 clips.
    const d = deps({
      searchReeceCandidates: async () => [
        { price: 23.05, productName: 'Sharkbite PEX Pipe Clip 16mm (100)', itemNumber: '1544266', store: 'Reece Plumbing', unitOfMeasure: 'BAG' },
      ],
      reconcilePricedMaterials: async () => {
        throw new Error('deadline');
      },
    });
    const rows = [material({ id: 'c', name: 'PEX pipe clip 16mm', searchTerm: 'PEX pipe clip 16mm', quantity: 100, unit: 'each' })];
    const result = await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: true });
    const [clips] = result.updatedQuote.materials;
    expect(clips.reeceItemNumber).toBe('1544266');
    expect(clips.quantity).toBe(1);
    expect(clips.totalPrice).toBe(23.05);
  });

  it('still prices a Reece hit the ranker accepts', async () => {
    const d = deps({
      searchReeceCandidates: async () => [
        { price: 38.21, productName: 'Dura LF Mini Ball Valve F&F Tested 15mm', itemNumber: '111', store: 'Reece Plumbing', unitOfMeasure: 'EA' },
      ],
    });
    const rows = [
      material({ id: 'v', name: 'Mini isolating valve 15mm', searchTerm: 'mini ball valve 15mm', quantity: 9, unit: 'each' }),
    ];
    const result = await fetchPricesForQuote(d, { quote: quote(rows), businessSettings: null, reeceConnected: true });
    const [valve] = result.updatedQuote.materials;
    expect(valve.reeceItemNumber).toBe('111');
    expect(valve.pricingSource).toBe('api');
    expect(valve.price).toBe(38.21);
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

/**
 * A written scope (the tradie's own numbered items) gets each NEW section a
 * short customer-facing description from the analysis. Anything that isn't a
 * written scope, and any section the tradie already has, is left alone.
 */
describe('generateMaterialsForQuote — section scope descriptions', () => {
  const writtenScope = [
    '1. Remove kitchen cupboards, benchtop and splashback, and take the rubbish away.',
    '2. Frame the new walk-in robe with 90x45 pine studs and a cavity slider opening.',
    '3. Demolish the ensuite back to the frame — plumbing disconnection by others.',
  ].join('\n');
  const scopeQuote = (): PricingQuote => ({
    ...quote([]),
    job: { id: 'j1', name: 'Reno', description: writtenScope },
  });
  const analysis = (sectionDescriptions?: Record<string, string>) => ({
    materials: [
      { name: 'Skip bin', searchTerm: 'skip bin', quantity: 1, unit: 'each', section: 'Demolition', sectionMultiplier: 1, sectionLaborHours: 6 },
      { name: '90x45 pine', searchTerm: '90x45 pine', quantity: 12, unit: 'each', section: 'WIR Framing', sectionMultiplier: 1, sectionLaborHours: 8 },
    ],
    estimatedHours: 14,
    jobSummary: '',
    ...(sectionDescriptions ? { sectionDescriptions } : {}),
  });
  const run = (q: PricingQuote, sectionDescriptions?: Record<string, string>) =>
    generateMaterialsForQuote(deps({ analyzeJobDescription: async () => analysis(sectionDescriptions) }), {
      quote: q,
      businessSettings: { defaultLaborRate: 90 },
      isPro: false,
      templates: [],
    });
  const byName = (q: PricingQuote, name: string) => q.sections?.find((s) => s.name === name);

  it('a written scope puts each new section its description', async () => {
    const result = await run(scopeQuote(), {
      Demolition: 'Remove kitchen cupboards, benchtop and splashback.\nDemolish the ensuite back to the frame.',
      'WIR Framing': 'Frame the new walk-in robe with a cavity slider opening.',
    });
    expect(byName(result.updatedQuote, 'Demolition')?.description).toBe(
      'Remove kitchen cupboards, benchtop and splashback.\nDemolish the ensuite back to the frame.',
    );
    expect(byName(result.updatedQuote, 'WIR Framing')?.description).toBe(
      'Frame the new walk-in robe with a cavity slider opening.',
    );
    expect(byName(result.updatedQuote, 'Demolition')?.descriptionSource).toBe('generated');
    expect(byName(result.updatedQuote, 'WIR Framing')?.descriptionSource).toBe('generated');
  });

  const keptDemolition = (over: Partial<QuoteSection> = {}): QuoteSection => ({
    id: 's-existing', name: 'Demolition', multiplier: 1, laborHours: 4, laborHoursTotal: 4,
    laborRate: 90, laborUnit: 'hours', laborTotal: 360, sortOrder: 0, ...over,
  });

  it('a regenerate fills a kept section whose description was emptied, stamped generated, money untouched', async () => {
    const result = await run({ ...scopeQuote(), sections: [keptDemolition()] }, { Demolition: 'Remove the cupboards.' });
    const demos = (result.updatedQuote.sections ?? []).filter((s) => s.name === 'Demolition');
    expect(demos).toEqual([{ ...keptDemolition(), description: 'Remove the cupboards.', descriptionSource: 'generated' }]);
  });

  it('never overwrites an existing generated description either', async () => {
    const existing = keptDemolition({ description: 'Earlier run text.', descriptionSource: 'generated' });
    const result = await run({ ...scopeQuote(), sections: [existing] }, { Demolition: 'Model text.' });
    expect((result.updatedQuote.sections ?? []).filter((s) => s.name === 'Demolition')).toEqual([existing]);
  });

  it('a section named "constructor" gets its own description, not an inherited property', async () => {
    const analyze = async () => ({
      materials: [
        { name: 'Skip bin', searchTerm: 'skip bin', quantity: 1, unit: 'each', section: 'constructor', sectionMultiplier: 1, sectionLaborHours: 2 },
        { name: 'Pine', searchTerm: 'pine', quantity: 1, unit: 'each', section: 'toString', sectionMultiplier: 1, sectionLaborHours: 2 },
      ],
      estimatedHours: 4,
      jobSummary: '',
      sectionDescriptions: normaliseSectionDescriptions([{ section: 'constructor', description: 'Builder works.' }]),
    });
    const result = await generateMaterialsForQuote(deps({ analyzeJobDescription: analyze }), {
      quote: scopeQuote(), businessSettings: { defaultLaborRate: 90 }, isPro: false, templates: [],
    });
    expect(byName(result.updatedQuote, 'constructor')?.description).toBe('Builder works.');
    expect('description' in byName(result.updatedQuote, 'toString')!).toBe(false);
  });

  it('matches a section name case-insensitively when the exact string differs', async () => {
    const result = await run(scopeQuote(), { ' wir framing ': 'Frame the new walk-in robe.' });
    expect(byName(result.updatedQuote, 'WIR Framing')?.description).toBe('Frame the new walk-in robe.');
  });

  it('a job that is not a written scope gets no descriptions, even if the analysis carried some', async () => {
    const result = await run(quote([]), { Demolition: 'Remove the cupboards.' });
    for (const s of result.updatedQuote.sections ?? []) expect('description' in s).toBe(false);
  });

  it("never overwrites an existing section's description", async () => {
    const existing = {
      id: 's-existing', name: 'Demolition', multiplier: 1, laborHours: 4, laborHoursTotal: 4,
      laborRate: 90, laborUnit: 'hours' as const, laborTotal: 360, sortOrder: 0,
      description: 'My own words for the demo.',
    };
    const result = await run({ ...scopeQuote(), sections: [existing] }, { Demolition: 'Model text.' });
    const demos = (result.updatedQuote.sections ?? []).filter((s) => s.name === 'Demolition');
    expect(demos).toEqual([existing]);
  });

  it('ignores a description for a section name the materials never used', async () => {
    const result = await run(scopeQuote(), { Plastering: 'Sheet and set the new walls.' });
    for (const s of result.updatedQuote.sections ?? []) expect('description' in s).toBe(false);
  });

  it('no descriptions → sections have exactly the shape they always had', async () => {
    const result = await run(scopeQuote());
    expect(result.updatedQuote.sections).toEqual([
      {
        id: expect.any(String), name: 'Demolition', multiplier: 1, laborHours: 6, laborHoursTotal: 6,
        laborRate: 90, laborUnit: 'hours', laborTotal: 540, sortOrder: 0,
      },
      {
        id: expect.any(String), name: 'WIR Framing', multiplier: 1, laborHours: 8, laborHoursTotal: 8,
        laborRate: 90, laborUnit: 'hours', laborTotal: 720, sortOrder: 1,
      },
    ]);
  });
});
