import { describe, it, expect } from 'vitest';
import { reviewQuoteMaterials, isFlaggedRow, buildPresendWarning } from './quoteReview';
import type { Material } from '../types';

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
