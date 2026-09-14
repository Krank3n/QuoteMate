import { describe, it, expect } from 'vitest';
import { paidInFullAtMs } from './paidInFull';

const T1 = 1_757_000_000_000;
const T2 = T1 + 86_400_000;

describe('paidInFullAtMs', () => {
  it('prefers the ledger stamp on a paid doc', () => {
    expect(paidInFullAtMs({ stage: 'paid', paidInFullAt: T2, payments: [{ paidAt: T1 }], updatedAt: T1 })).toBe(T2);
  });

  it('falls back to the latest payment when the stamp is missing (legacy-rebuilt docs)', () => {
    expect(paidInFullAtMs({ stage: 'paid', payments: [{ paidAt: T1 }, { paidAt: T2 }], updatedAt: T1 })).toBe(T2);
  });

  it('falls back to updatedAt when there are no dated payments', () => {
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
