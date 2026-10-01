import { describe, it, expect } from 'vitest';
import { depositOwed } from '../nextBestAction';

describe('depositOwed', () => {
  const quote = (over: Record<string, unknown> = {}) => ({
    type: 'quote', depositAmount: 300, depositPaid: 0, paidTotal: 0, ...over,
  });

  it('is owed until a deposit is paid', () => {
    expect(depositOwed(quote())).toBe(true);
    expect(depositOwed(quote({ depositPaid: 100, paidTotal: 100 }))).toBe(true);
    expect(depositOwed(quote({ depositPaid: 300, paidTotal: 300 }))).toBe(false);
  });

  it('is not owed once the customer paid the full amount (a full payment is not recorded as a deposit)', () => {
    expect(depositOwed(quote({ depositPaid: 0, paidTotal: 960 }))).toBe(false);
  });

  it('only applies to quotes asking for a deposit', () => {
    expect(depositOwed(quote({ type: 'invoice' }))).toBe(false);
    expect(depositOwed(quote({ depositAmount: 0 }))).toBe(false);
    expect(depositOwed(null)).toBe(false);
  });
});
