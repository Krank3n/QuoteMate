/**
 * Manual payments are typed by a human and will sometimes be wrong. Square
 * payments mirror a real transaction that exists in Square's records and the
 * customer's bank — editing one locally would make QuoteMate the thing that
 * lies about the money.
 */
import { describe, it, expect } from 'vitest';

import { isEditablePayment, maxAmountForEdit } from './editablePayment';

describe('isEditablePayment', () => {
  it('allows the manual methods a tradie typed in', () => {
    expect(isEditablePayment({ id: 'p', amount: 100, paidAt: 1, method: 'bank' } as any)).toBe(true);
    expect(isEditablePayment({ id: 'p', amount: 100, paidAt: 1, method: 'cash' } as any)).toBe(true);
    expect(isEditablePayment({ id: 'p', amount: 100, paidAt: 1, method: 'other' } as any)).toBe(true);
    expect(isEditablePayment({ id: 'p', amount: 100, paidAt: 1 } as any)).toBe(true);
  });

  it('refuses anything carrying a Square transaction id', () => {
    expect(
      isEditablePayment({ id: 'p', amount: 100, paidAt: 1, squarePaymentId: 'sq_1' } as any),
    ).toBe(false);
  });

  // The legacy projection maps a hand-typed CARD payment to method 'square'
  // (adapter.ts:280). Keying off the method locked a tradie out of fixing a
  // payment they had entered themselves — found on a real overpaid invoice
  // (INV-006, manual/square, no transaction id).
  it('allows a card payment the tradie typed, despite the square method label', () => {
    expect(
      isEditablePayment({ id: 'p', kind: 'manual', amount: 240, paidAt: 1, method: 'square' } as any),
    ).toBe(true);
  });

  it('still refuses it once a real transaction id is attached', () => {
    expect(
      isEditablePayment({
        id: 'p',
        kind: 'balance',
        amount: 240,
        paidAt: 1,
        method: 'square',
        squarePaymentId: 'sq_1',
      } as any),
    ).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(isEditablePayment(undefined)).toBe(false);
    expect(isEditablePayment(null)).toBe(false);
  });
});

describe('maxAmountForEdit', () => {
  // The append-time cap is `total − paidTotal`, but paidTotal already
  // includes the payment being edited — so an unchanged entry would cap at
  // zero and the tradie couldn't even re-save it.
  it('excludes the payment being edited from the balance', () => {
    expect(maxAmountForEdit({ total: 1000, paidTotal: 1000 }, { amount: 1000 })).toBe(1000);
  });

  it('leaves room only for what the others have not covered', () => {
    expect(maxAmountForEdit({ total: 1000, paidTotal: 700 }, { amount: 300 })).toBe(600);
  });

  it('lets an inflated payment be corrected downward on an overpaid invoice', () => {
    // The exact shape of the doubling bug: total 960, ledger 1920.
    expect(maxAmountForEdit({ total: 960, paidTotal: 1920 }, { amount: 1920 })).toBe(960);
  });

  it('never returns a negative ceiling', () => {
    expect(maxAmountForEdit({ total: 100, paidTotal: 500 }, { amount: 50 })).toBe(0);
  });

  it('tolerates junk amounts', () => {
    expect(maxAmountForEdit({ total: 'abc', paidTotal: undefined }, { amount: NaN as any })).toBe(0);
  });
});
