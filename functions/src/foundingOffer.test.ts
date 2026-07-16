import { describe, expect, it } from 'vitest';
import { FOUNDING_CAP, NEXT_PRICE_AUD, foundingOfferStatus } from './foundingOffer';

describe('founding offer constants', () => {
  it('cap is 100 founding members', () => {
    expect(FOUNDING_CAP).toBe(100);
  });

  it('NEXT_PRICE mirrors the app anchor (src/config/pricingConfig.ts REGULAR_PRICE_AUD)', () => {
    // The struck-through anchor IS the committed post-cap price — if either
    // side moves, the promise breaks. Update both together.
    expect(NEXT_PRICE_AUD).toEqual({ monthly: 99, yearly: 658 });
  });
});

describe('foundingOfferStatus', () => {
  it('reports real spots left while under the cap', () => {
    expect(foundingOfferStatus(0)).toEqual({ taken: 0, cap: 100, spotsLeft: 100, capActive: true });
    expect(foundingOfferStatus(3)).toEqual({ taken: 3, cap: 100, spotsLeft: 97, capActive: true });
    expect(foundingOfferStatus(99)).toEqual({ taken: 99, cap: 100, spotsLeft: 1, capActive: true });
  });

  it('deactivates exactly at the cap — all founding framing must disappear', () => {
    expect(foundingOfferStatus(100)).toEqual({ taken: 100, cap: 100, spotsLeft: 0, capActive: false });
  });

  it('never goes negative past the cap', () => {
    expect(foundingOfferStatus(150)).toEqual({ taken: 150, cap: 100, spotsLeft: 0, capActive: false });
  });

  it('treats garbage input as zero taken rather than faking scarcity', () => {
    expect(foundingOfferStatus(-5).taken).toBe(0);
    expect(foundingOfferStatus(NaN as any).taken).toBe(0);
    expect(foundingOfferStatus(-5).capActive).toBe(true);
  });
});
