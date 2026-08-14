import { describe, it, expect } from 'vitest';
import { needsPriceFetch } from './priceFetchGate';

describe('needsPriceFetch — pricing pipeline gate', () => {
  it('never re-fetches a priced row, locked or not', () => {
    // Regression (Hayden, July 2026): a saved personal rate selected into a
    // quote carried manualPriceOverride=true and the old inverted gate
    // re-fetched and overwrote it. Priced rows are now always protected.
    expect(needsPriceFetch({ price: 45.5 })).toBe(false);
  });

  it('fetches unpriced rows', () => {
    expect(needsPriceFetch({ price: 0 })).toBe(true);
  });

  it('fetches rows zeroed for re-pricing (resetFlaggedRowsForReprice path)', () => {
    expect(needsPriceFetch({ price: 0 })).toBe(true);
  });

  it('treats negative/NaN prices as unpriced', () => {
    expect(needsPriceFetch({ price: -1 })).toBe(true);
    expect(needsPriceFetch({ price: NaN })).toBe(true);
  });

  it('never fetches a price for a work item, even at $0', () => {
    // A "General preparation — included" scope line is legitimately $0. Without
    // this guard it looks exactly like an unpriced material and gets shipped to
    // the supplier search, which overwrites the tradie's title and price.
    expect(needsPriceFetch({ price: 0, kind: 'work' })).toBe(false);
    expect(needsPriceFetch({ price: 22750, kind: 'work' })).toBe(false);
  });
});
