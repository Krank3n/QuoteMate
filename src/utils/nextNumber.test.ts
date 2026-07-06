import { describe, it, expect } from 'vitest';
import { parseRefNumber, reconcileNextNumber, resolveNextQuoteNumber } from './nextNumber';

describe('parseRefNumber', () => {
  it('extracts the numeric suffix case-insensitively', () => {
    expect(parseRefNumber('QU-178296', 'QU')).toBe(178296);
    expect(parseRefNumber('qu-7', 'QU')).toBe(7);
  });

  it('rejects non-matching values', () => {
    expect(parseRefNumber('INV-12', 'QU')).toBeNull();
    expect(parseRefNumber(undefined, 'QU')).toBeNull();
  });
});

describe('reconcileNextNumber', () => {
  it('derives max+1 from items and respects a cache that is ahead', () => {
    const items = [{ ref: 'QU-10' }, { ref: 'QU-42' }];
    expect(reconcileNextNumber({ items, field: i => i.ref, prefix: 'QU', cached: 1 })).toBe(43);
    expect(reconcileNextNumber({ items, field: i => i.ref, prefix: 'QU', cached: 99 })).toBe(99);
  });
});

describe('resolveNextQuoteNumber — incident cloud floor vs local counter', () => {
  it('a restored cloud floor beats a fresh local counter', () => {
    expect(resolveNextQuoteNumber(1, 178297)).toBe(178297);
  });

  it('a device further ahead than the floor keeps its own counter', () => {
    expect(resolveNextQuoteNumber(178400, 178297)).toBe(178400);
  });

  it('ignores null/undefined/NaN/zero/negative candidates and floors fractions', () => {
    expect(resolveNextQuoteNumber(null, undefined, NaN, 0, -5, 12.9)).toBe(12);
  });

  it('returns null when nothing valid is offered', () => {
    expect(resolveNextQuoteNumber(null, undefined, 0)).toBeNull();
  });
});
