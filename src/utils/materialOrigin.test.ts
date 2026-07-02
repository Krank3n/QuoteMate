import { describe, it, expect } from 'vitest';
import { withOrigin } from './materialOrigin';

describe('withOrigin — stamp only when absent', () => {
  it('stamps-when-absent', () => {
    const m = { id: '1', price: 0 };
    const out = withOrigin(m, 'recommended');
    expect(out.origin).toBe('recommended');
  });

  it('preserves-existing', () => {
    const m = { id: '1', price: 0, origin: 'manual' as const };
    const out = withOrigin(m, 'recommended');
    expect(out.origin).toBe('manual');
    // Already stamped → same reference back, no needless copy.
    expect(out).toBe(m);
  });

  it("recommended row keeps origin after pipeline-style {...m} spread + price/pricingSource mutation", () => {
    // Mirrors fetchPricesForQuote: each row is copied via {...m}, then price
    // and pricingSource are reassigned in place while pricing resolves. The
    // origin marker must survive both so recommended lines stay attributable.
    const recommended = withOrigin(
      { id: 'r1', name: 'Merbau decking', price: 0, pricingSource: undefined as string | undefined },
      'recommended',
    );
    const copy = { ...recommended };
    copy.price = 7.5;
    copy.pricingSource = 'scraper';
    expect(copy.origin).toBe('recommended');
  });
});
