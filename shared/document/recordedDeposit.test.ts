import { describe, it, expect } from 'vitest';
import { recordedDepositTotal } from './recordedDeposit';

describe('recordedDepositTotal', () => {
  it('sums only the payments marked as the deposit', () => {
    expect(
      recordedDepositTotal([
        { kind: 'manual', amount: 3000, isDeposit: true },
        { kind: 'manual', amount: 500 },
        { kind: 'manual', amount: 250, isDeposit: false },
      ]),
    ).toBe(3000);
  });

  it('ignores a Square quote deposit, which has its own credit row', () => {
    expect(
      recordedDepositTotal([{ kind: 'deposit', amount: 400, isDeposit: true }]),
    ).toBe(0);
  });

  it('cent-rounds the sum', () => {
    expect(
      recordedDepositTotal([
        { kind: 'manual', amount: 0.1, isDeposit: true },
        { kind: 'manual', amount: 0.2, isDeposit: true },
      ]),
    ).toBe(0.3);
  });

  it('is zero with no payments', () => {
    expect(recordedDepositTotal(undefined)).toBe(0);
    expect(recordedDepositTotal([])).toBe(0);
  });
});
