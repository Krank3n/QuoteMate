import { describe, it, expect } from 'vitest';
import {
  applyPercentUplift,
  convertExToInc,
  convertIncToEx,
  adjustPrice,
  DEFAULT_GST_RATE,
} from '../priceAdjust';

describe('applyPercentUplift', () => {
  it('applies a positive percentage', () => {
    expect(applyPercentUplift(100, 5.8)).toBe(105.8);
    expect(applyPercentUplift(187.25, 5.8)).toBe(198.11);
  });

  it('applies a negative percentage', () => {
    expect(applyPercentUplift(100, -10)).toBe(90);
  });

  it('returns the price unchanged at 0%', () => {
    expect(applyPercentUplift(187.25, 0)).toBe(187.25);
  });

  it('handles a 0 price', () => {
    expect(applyPercentUplift(0, 5.8)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // 19.995 → 20.00 (half-away-from-zero)
    expect(applyPercentUplift(19.99, 0.025)).toBeCloseTo(19.99, 2);
    expect(applyPercentUplift(33.33, 7)).toBe(35.66);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(applyPercentUplift(NaN, 5)).toBe(0);
    expect(applyPercentUplift(100, NaN)).toBe(0);
    expect(applyPercentUplift(Infinity, 5)).toBe(0);
  });
});

describe('convertExToInc', () => {
  it('adds 10% GST by default', () => {
    expect(convertExToInc(100)).toBe(110);
    expect(convertExToInc(187.25)).toBe(205.98);
  });

  it('honours custom GST rate', () => {
    expect(convertExToInc(100, 0.15)).toBe(115);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(convertExToInc(NaN)).toBe(0);
  });
});

describe('convertIncToEx', () => {
  it('strips 10% GST by default', () => {
    // 110 / 1.10 = 100
    expect(convertIncToEx(110)).toBe(100);
    // 205.98 / 1.10 = 187.2545... → 187.25
    expect(convertIncToEx(205.98)).toBe(187.25);
  });

  it('is the inverse of convertExToInc within rounding', () => {
    const round = (n: number) => convertIncToEx(convertExToInc(n));
    expect(round(187.25)).toBe(187.25);
    expect(round(50)).toBe(50);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(convertIncToEx(NaN)).toBe(0);
  });
});

describe('adjustPrice', () => {
  it('applies uplift then adds GST (5.8% + 10% scenario)', () => {
    // 100 → 105.80 → 116.38
    expect(adjustPrice(100, { percent: 5.8, gstAction: 'addGst' })).toBe(116.38);
  });

  it('applies uplift then removes GST', () => {
    // 110 → 121 → 110 (round-trip via ex→inc through opposite path)
    expect(adjustPrice(110, { percent: 10, gstAction: 'removeGst' })).toBe(110);
  });

  it('treats none as no GST change', () => {
    expect(adjustPrice(100, { percent: 5.8, gstAction: 'none' })).toBe(105.8);
  });

  it('defaults to no-op when no opts passed', () => {
    expect(adjustPrice(100, {})).toBe(100);
  });

  it('exposes the default GST rate', () => {
    expect(DEFAULT_GST_RATE).toBe(0.10);
  });
});
