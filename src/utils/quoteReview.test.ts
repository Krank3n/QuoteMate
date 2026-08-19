import { describe, it, expect } from 'vitest';
import { reviewQuoteMaterials, isFlaggedRow, buildPresendWarning, detectAnchorLaunderedIssues } from './quoteReview';
import type { Material, QuoteSection } from '../types';

// Minimal Material factory — only the fields the classifier reads matter; the
// rest get harmless defaults so a test row is a valid Material.
function mat(overrides: Partial<Material>): Material {
  return {
    id: 'm1',
    name: 'Thing',
    quantity: 1,
    unit: 'each',
    price: 10,
    totalPrice: 10,
    manualPriceOverride: false,
    ...overrides,
  };
}

// Minimal QuoteSection factory — the detector reads name/multiplier/laborHours.
function sec(overrides: Partial<QuoteSection>): QuoteSection {
  return {
    id: 's1',
    name: 'Section',
    multiplier: 1,
    laborHours: 1,
    laborRate: 85,
    laborUnit: 'hours',
    laborTotal: 85,
    sortOrder: 0,
    ...overrides,
  };
}

// The exact QU-178425 quote: a 165 m² tile-to-Colorbond re-roof mis-classed as
// a per-m² section (multiplier 165, 0.5 h/m²), so Round-1 emitted "1 per m²"
// for every material and × 165 laundered the roof area onto each line.
function roofFixture(): { materials: Material[]; sections: QuoteSection[] } {
  const sections = [
    sec({ id: 'roof', name: 'Roof Replacement', multiplier: 165, laborHours: 0.5 }),
    sec({ id: 'site', name: 'Site Setup & Waste', multiplier: 1, laborHours: 7.5 }),
  ];
  const base = { section: 'Roof Replacement', priceConfidence: 'low' as const };
  const materials: Material[] = [
    mat({ id: 'r1', name: 'Colorbond Corrugated Roofing Sheets 0.48mm BMT', quantity: 165, unit: 'm', requiredQty: 165, requiredUnit: 'm', templateBaseQuantity: 1, price: 42, pricingSource: 'scraper', ...base }),
    mat({ id: 'r2', name: 'Anticon Roofing Blanket', quantity: 9, unit: 'each', requiredQty: 165, requiredUnit: 'm²', templateBaseQuantity: 1, price: 89.9, pricingSource: 'scraper', ...base }),
    mat({ id: 'r3', name: 'Metal Roof Battens 40mm', quantity: 28, unit: 'each', requiredQty: 165, requiredUnit: 'm', templateBaseQuantity: 1, price: 18.5, pricingSource: 'scraper', ...base }),
    mat({ id: 'r4', name: 'Roofing Screws (Timber Fixing)', quantity: 495, unit: 'each', templateBaseQuantity: 3, price: 0.07, pricingSource: 'ai', ...base }),
    mat({ id: 'r5', name: 'Batten Screws', quantity: 165, unit: 'each', templateBaseQuantity: 1, price: 0.07, pricingSource: 'ai', ...base }),
    mat({ id: 'r6', name: 'Colorbond Ridge Capping', quantity: 55, unit: 'each', requiredQty: 165, requiredUnit: 'm', templateBaseQuantity: 1, price: 38.9, pricingSource: 'scraper', ...base }),
    mat({ id: 'r7', name: 'Roof and Gutter Silicone Sealant', quantity: 165, unit: 'each', requiredQty: 165, requiredUnit: 'each', templateBaseQuantity: 1, price: 17.5, pricingSource: 'scraper', ...base }),
  ];
  return { materials, sections };
}

describe('reviewQuoteMaterials', () => {
  it('flags a rejected/unmatched row (price 0) as unpriced', () => {
    const review = reviewQuoteMaterials([
      mat({ id: 'a', name: 'Merbau Decking Oil', price: 0, totalPrice: 0, priceConfidence: 'low', description: 'Product mismatch — verify before sending' }),
    ]);
    expect(review.counts).toMatchObject({ unpriced: 1, estimated: 0, lowConfidence: 0, total: 1 });
    expect(review.issues[0].kind).toBe('unpriced');
    // Carries the row's own reason when present.
    expect(review.issues[0].detail).toBe('Product mismatch — verify before sending');
  });

  it('flags an AI estimate (low confidence + ai source) as estimated', () => {
    const review = reviewQuoteMaterials([
      mat({ id: 'b', name: 'Decking Screws', price: 150, totalPrice: 150, priceConfidence: 'low', pricingSource: 'ai', description: 'Estimated — verify with supplier' }),
    ]);
    expect(review.counts).toMatchObject({ unpriced: 0, estimated: 1, lowConfidence: 0, total: 1 });
    expect(review.issues[0].kind).toBe('estimated');
  });

  it('flags a low-confidence non-AI row separately', () => {
    const review = reviewQuoteMaterials([
      mat({ id: 'c', name: 'Bracket', price: 5, totalPrice: 5, priceConfidence: 'low', pricingSource: 'scraper' }),
    ]);
    expect(review.counts.lowConfidence).toBe(1);
    expect(review.issues[0].kind).toBe('low_confidence');
    // Falls back to the default detail when the row has no description.
    expect(review.issues[0].detail).toMatch(/low-confidence/i);
  });

  it('does not flag confident, real-priced rows', () => {
    const review = reviewQuoteMaterials([
      mat({ id: 'd', price: 12, priceConfidence: 'high', pricingSource: 'scraper' }),
      mat({ id: 'e', price: 8, priceConfidence: 'medium', pricingSource: 'api' }),
    ]);
    expect(review.counts.total).toBe(0);
    expect(review.summary).toMatch(/all good/i);
  });

  it('never flags a manual override, even at price 0 or low confidence', () => {
    const review = reviewQuoteMaterials([
      mat({ id: 'f', price: 0, totalPrice: 0, manualPriceOverride: true }),
      mat({ id: 'g', price: 99, priceConfidence: 'low', manualPriceOverride: true }),
    ]);
    expect(review.counts.total).toBe(0);
  });

  it('does not flag a $0 work item as unpriced', () => {
    // A lump-sum scope line at $0 ("General preparation — included") is the
    // tradie's own number, not a pricing miss. Flagging it would let
    // propose_reprice zero and re-fetch the line.
    const review = reviewQuoteMaterials([
      mat({ id: 'w', name: 'General Preparation', kind: 'work', price: 0, totalPrice: 0 }),
    ]);
    expect(review.counts.total).toBe(0);
    expect(isFlaggedRow(mat({ kind: 'work', price: 0, totalPrice: 0 }))).toBe(false);
  });

  it('summarises a mixed quote with counts and a couple of names', () => {
    const review = reviewQuoteMaterials([
      mat({ id: 'a', name: 'Merbau Decking Oil', price: 0, totalPrice: 0, priceConfidence: 'low' }),
      mat({ id: 'b', name: 'Decking Screws', price: 150, priceConfidence: 'low', pricingSource: 'ai' }),
      mat({ id: 'd', name: 'Good Board', price: 12, priceConfidence: 'high' }),
    ]);
    expect(review.counts.total).toBe(2);
    expect(review.summary).toContain('2 rows need a look');
    expect(review.summary).toContain('1 with no price');
    expect(review.summary).toContain('1 estimated');
    expect(review.summary).toContain('Merbau Decking Oil');
    expect(review.summary).toContain('Decking Screws');
  });

  it('caps named rows at three with a "+N more" tail', () => {
    const review = reviewQuoteMaterials(
      Array.from({ length: 5 }, (_, i) => mat({ id: `x${i}`, name: `Row ${i}`, price: 0, totalPrice: 0, priceConfidence: 'low' })),
    );
    expect(review.counts.unpriced).toBe(5);
    expect(review.summary).toContain('+2 more');
  });

  it('handles empty / missing materials', () => {
    expect(reviewQuoteMaterials([]).counts.total).toBe(0);
    expect(reviewQuoteMaterials(undefined).summary).toMatch(/all good/i);
  });
});

describe('isFlaggedRow', () => {
  it('matches the classifier — flags unpriced, estimated and low-confidence rows', () => {
    expect(isFlaggedRow(mat({ price: 0, totalPrice: 0 }))).toBe(true);
    expect(isFlaggedRow(mat({ price: 150, priceConfidence: 'low', pricingSource: 'ai' }))).toBe(true);
    expect(isFlaggedRow(mat({ price: 5, priceConfidence: 'low' }))).toBe(true);
  });

  it('leaves confident rows and manual overrides alone', () => {
    expect(isFlaggedRow(mat({ price: 12, priceConfidence: 'high' }))).toBe(false);
    expect(isFlaggedRow(mat({ price: 0, totalPrice: 0, manualPriceOverride: true }))).toBe(false);
  });
});

describe('buildPresendWarning', () => {
  const mk = (over: Partial<Material> = {}): Material => ({
    id: 'm1', name: 'Custom Cabinetry Supply', quantity: 1, unit: 'each',
    price: 0, totalPrice: 0, manualPriceOverride: false, priceConfidence: 'low',
    ...over,
  });

  it('returns null when nothing is unpriced — estimates alone never gate the send', () => {
    const estimated = mk({ id: 'e1', price: 45, totalPrice: 45, pricingSource: 'ai' });
    expect(buildPresendWarning(reviewQuoteMaterials([estimated]))).toBeNull();
    expect(buildPresendWarning(reviewQuoteMaterials([]))).toBeNull();
  });

  it('warns with the $0 rows named and the doc label', () => {
    const w = buildPresendWarning(reviewQuoteMaterials([mk()]), 'quote');
    expect(w?.title).toBe('Some prices need a look');
    expect(w?.message).toContain("1 item has no price and will show as $0 on the customer's quote");
    expect(w?.message).toContain('• Custom Cabinetry Supply');
  });

  it('caps the named rows at three and counts the rest', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((n, i) => mk({ id: `m${i}`, name: n }));
    const w = buildPresendWarning(reviewQuoteMaterials(rows));
    expect(w?.message).toContain('5 items have no price');
    expect(w?.message).toContain('• C');
    expect(w?.message).not.toContain('• D');
    expect(w?.message).toContain('(+2 more)');
  });

  it('mentions estimates only alongside unpriced rows', () => {
    const w = buildPresendWarning(reviewQuoteMaterials([
      mk(),
      mk({ id: 'e1', name: 'Paint', price: 45, totalPrice: 45, pricingSource: 'ai' }),
    ]), 'invoice');
    expect(w?.message).toContain("customer's invoice");
    expect(w?.message).toContain('1 more is an estimate');
  });

  it('never warns about manual overrides — the tradie priced those on purpose', () => {
    const manual = mk({ manualPriceOverride: true });
    expect(buildPresendWarning(reviewQuoteMaterials([manual]))).toBeNull();
  });
});

describe('buildPresendWarning — hidden materials and labour-only quotes', () => {
  const zero = (name = 'Custom Cabinetry Supply'): Material => ({
    id: 'z1', name, quantity: 1, unit: 'each',
    price: 0, totalPrice: 0, manualPriceOverride: false, priceConfidence: 'low',
  });

  it('never gates a labour-only document (no materials)', () => {
    expect(buildPresendWarning(reviewQuoteMaterials([]))).toBeNull();
    expect(buildPresendWarning(reviewQuoteMaterials(undefined))).toBeNull();
  });

  it('still gates when material costs are hidden, with total-focused wording', () => {
    const w = buildPresendWarning(reviewQuoteMaterials([zero()]), 'quote', {
      materialsShownToCustomer: false,
    });
    expect(w?.message).toContain("isn't counted in the quote total");
    expect(w?.message).not.toContain('$0 on the customer');
  });

  it('uses the visible wording by default', () => {
    const w = buildPresendWarning(reviewQuoteMaterials([zero()]));
    expect(w?.message).toContain("will show as $0 on the customer's quote");
  });
});

describe('detectAnchorLaunderedIssues — QU-178425 (165 m² re-roof)', () => {
  it('flags every anchor-showing line in the laundered roof section', () => {
    const { materials, sections } = roofFixture();
    const issues = detectAnchorLaunderedIssues(materials, sections);
    // All seven roof lines carry the laundered area, one way or another
    // (quantity === 165, requiredQty === 165, or 495 = 3 × 165).
    expect(issues.map((i) => i.materialId).sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    expect(issues.every((i) => i.kind === 'inflated_quantity')).toBe(true);
    // The detail names the area anchor and the section.
    expect(issues[0].detail).toContain('165');
    expect(issues[0].detail).toContain('Roof Replacement');
  });

  it('is a no-op when sections are not supplied (back-compat)', () => {
    const { materials } = roofFixture();
    expect(detectAnchorLaunderedIssues(materials, undefined)).toEqual([]);
    // Without sections the rows still surface — but as their pricing verdict
    // (low-confidence / estimated), NOT as inflated_quantity.
    const review = reviewQuoteMaterials(materials);
    expect(review.counts.inflatedQuantity).toBe(0);
    expect(review.counts.total).toBe(7);
  });

  it('reviewQuoteMaterials surfaces the launder and dedupes it against the pricing verdict', () => {
    const { materials, sections } = roofFixture();
    const review = reviewQuoteMaterials(materials, sections);
    // Every row is also low-confidence/ai-priced, but inflated_quantity wins the
    // dedupe so nothing is listed twice.
    expect(review.counts.inflatedQuantity).toBe(7);
    expect(review.counts.estimated).toBe(0);
    expect(review.counts.lowConfidence).toBe(0);
    expect(review.counts.total).toBe(7);
    expect(review.summary).toContain('7 with an inflated quantity');
  });

  it('gates the send with the silicone/sheet blow-out named and quantified', () => {
    const { materials, sections } = roofFixture();
    const w = buildPresendWarning(reviewQuoteMaterials(materials, sections), 'quote');
    expect(w).not.toBeNull();
    expect(w?.title).toBe('Some quantities need a look');
    expect(w?.message).toContain('• Colorbond Corrugated Roofing Sheets 0.48mm BMT (165 m)');
    expect(w?.message).toContain('(+4 more)');
  });
});

describe('detectAnchorLaunderedIssues — does not fire on genuine sections', () => {
  it('leaves a real per-m² paver patio alone (materials carry real densities)', () => {
    const sections = [sec({ id: 'pave', name: 'Paver Patio', multiplier: 25, laborHours: 0.5 })];
    const materials = [
      mat({ id: 'p1', name: 'Concrete Pavers 400x400', quantity: 172, unit: 'each', templateBaseQuantity: 6, section: 'Paver Patio', priceConfidence: 'high' }),
      mat({ id: 'p2', name: 'Crusher Dust', quantity: 4000, unit: 'kg', templateBaseQuantity: 160, section: 'Paver Patio', priceConfidence: 'high' }),
      mat({ id: 'p3', name: 'Bedding Sand', quantity: 1275, unit: 'kg', templateBaseQuantity: 68, section: 'Paver Patio', priceConfidence: 'high' }),
    ];
    expect(detectAnchorLaunderedIssues(materials, sections)).toEqual([]);
  });

  it('leaves a discrete fence-bay section alone (per-unit labour >= 1 h)', () => {
    const sections = [sec({ id: 'fence', name: 'Colorbond Fence Bay', multiplier: 9, laborHours: 1.5 })];
    const materials = [
      mat({ id: 'f1', name: 'Steel Fence Post', quantity: 18, unit: 'each', templateBaseQuantity: 2, section: 'Colorbond Fence Bay' }),
      mat({ id: 'f2', name: 'Colorbond Fence Sheet', quantity: 27, unit: 'each', templateBaseQuantity: 3, section: 'Colorbond Fence Bay' }),
      mat({ id: 'f3', name: 'Post Cap', quantity: 9, unit: 'each', templateBaseQuantity: 1, section: 'Colorbond Fence Bay' }),
    ];
    expect(detectAnchorLaunderedIssues(materials, sections)).toEqual([]);
  });

  it('does not fire on a small area (< 20 m²) — reserved for area-scale blow-ups', () => {
    const sections = [sec({ id: 'tile', name: 'Bathroom Tiling', multiplier: 10, laborHours: 0.5 })];
    const materials = [
      mat({ id: 't1', name: 'Wall Tiles', quantity: 10, unit: 'each', templateBaseQuantity: 1, section: 'Bathroom Tiling' }),
      mat({ id: 't2', name: 'Tile Adhesive', quantity: 10, unit: 'each', templateBaseQuantity: 1, section: 'Bathroom Tiling' }),
      mat({ id: 't3', name: 'Grout', quantity: 10, unit: 'each', templateBaseQuantity: 1, section: 'Bathroom Tiling' }),
    ];
    expect(detectAnchorLaunderedIssues(materials, sections)).toEqual([]);
  });
});

describe('weak product match (QU-178711)', () => {
  const towelBar = (over: Partial<Material> = {}): Material =>
    ({
      id: 'w1',
      name: 'N12 Starter Bars 600mm',
      quantity: 30,
      unit: 'each',
      price: 85,
      totalPrice: 2550,
      manualPriceOverride: false,
      pricingSource: 'scraper',
      priceConfidence: 'low',
      weakProductMatch: true,
      description: 'Not sure this is the right product — check it against your supplier before sending',
      ...over,
    }) as Material;

  it('reports a weak match as its own kind, not a generic low-confidence row', () => {
    const review = reviewQuoteMaterials([towelBar()]);
    expect(review.counts.weakMatch).toBe(1);
    expect(review.counts.lowConfidence).toBe(0);
    expect(review.issues[0].kind).toBe('weak_match');
    expect(review.summary).toContain('possibly the wrong product');
  });

  it('marks the row for re-pricing', () => {
    expect(isFlaggedRow(towelBar())).toBe(true);
  });

  it("never flags a row the tradie priced themselves", () => {
    expect(isFlaggedRow(towelBar({ manualPriceOverride: true }))).toBe(false);
  });

  it('gates the send on its own, with the line and its money', () => {
    // A plain estimate deliberately does NOT gate the send. A weak match does:
    // it is a real supplier price for what may be a different product.
    const warning = buildPresendWarning(reviewQuoteMaterials([towelBar()]));
    expect(warning).not.toBeNull();
    expect(warning!.message).toContain("doesn't look like a match");
    expect(warning!.message).toContain('N12 Starter Bars 600mm (30 × $85.00)');
  });

  it('still lets a clean quote through', () => {
    const clean = towelBar({ weakProductMatch: undefined, priceConfidence: 'high', description: undefined });
    expect(buildPresendWarning(reviewQuoteMaterials([clean]))).toBeNull();
  });
});
