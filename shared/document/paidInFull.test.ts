import { describe, it, expect } from 'vitest';
import { paidInFullAtMs } from './paidInFull';

const T1 = 1_757_000_000_000;
const T2 = T1 + 86_400_000;

describe('paidInFullAtMs', () => {
  it('dates the settlement by the payment that closed the balance, not the ledger stamp', () => {
    // INV-017 live: paid on the 13th, un-paid (the stamp survived the merge
    // write), paid again on the 15th — the stamp read "Paid 13 September".
    expect(paidInFullAtMs({ stage: 'paid', paidInFullAt: T1, payments: [{ paidAt: T2 }], updatedAt: T2 })).toBe(T2);
  });

  it('uses the latest of several payments', () => {
    expect(paidInFullAtMs({ stage: 'paid', payments: [{ paidAt: T2 }, { paidAt: T1 }], updatedAt: T1 })).toBe(T2);
  });

  it('honours a backdated closing payment over a stamp written today', () => {
    expect(paidInFullAtMs({ stage: 'paid', paidInFullAt: T2, payments: [{ paidAt: T1 }], updatedAt: T2 })).toBe(T1);
  });

  it('falls back to the ledger stamp when no payment carries a date', () => {
    expect(paidInFullAtMs({ stage: 'paid', paidInFullAt: T1, payments: [{ paidAt: undefined }], updatedAt: T2 })).toBe(T1);
  });

  it('falls back to updatedAt when there is neither', () => {
    expect(paidInFullAtMs({ stage: 'paid', payments: [], updatedAt: T1 })).toBe(T1);
  });

  it('is undefined for anything not at stage paid, even when the money adds up', () => {
    expect(paidInFullAtMs({ stage: 'partially_paid', paidInFullAt: T1, payments: [{ paidAt: T1 }] })).toBeUndefined();
    expect(paidInFullAtMs({ stage: 'invoice_sent', payments: [{ paidAt: T1 }] })).toBeUndefined();
    expect(paidInFullAtMs({ stage: 'cancelled', paidInFullAt: T1 })).toBeUndefined();
  });

  it('ignores junk timestamps', () => {
    expect(paidInFullAtMs({ stage: 'paid', paidInFullAt: 0, payments: [{ paidAt: NaN }], updatedAt: undefined })).toBeUndefined();
  });
});
