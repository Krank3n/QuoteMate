/**
 * `paidAmount` on the legacy invoice row means "total paid on this invoice".
 * Legacy recordPayment accumulates into it, and invoiceLinkAmountDue computes
 * `total − paidAmount` from it to price a Square pay link.
 *
 * The projection used to report `paid?.amount` — the FIRST balance-or-manual
 * payment — so every invoice with more than one payment under-reported what
 * had been collected, and a pay link would have charged the customer for
 * money they had already handed over.
 */
import { describe, it, expect } from 'vitest';

import { documentRecordToInvoiceRecord } from './adapter';

function invoiceRecord(payments: any[], paidTotal: number): any {
  return {
    id: 'doc1',
    type: 'invoice',
    stage: 'partially_paid',
    number: 'INV-006',
    total: 1000,
    paidTotal,
    balanceDue: Math.max(0, 1000 - paidTotal),
    payments,
    materials: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    job: { name: 'A job' },
  };
}

describe('documentRecordToInvoiceRecord — paidAmount', () => {
  it('REGRESSION: reports the whole ledger, not just the first payment', () => {
    const record = invoiceRecord(
      [
        { id: 'p1', kind: 'manual', amount: 400, paidAt: 1, method: 'cash' },
        { id: 'p2', kind: 'manual', amount: 560, paidAt: 2, method: 'bank' },
      ],
      960,
    );

    expect(documentRecordToInvoiceRecord(record).paidAmount).toBe(960);
  });

  it('matches the single payment when there is only one', () => {
    const record = invoiceRecord(
      [{ id: 'p1', kind: 'manual', amount: 400, paidAt: 1, method: 'cash' }],
      400,
    );

    expect(documentRecordToInvoiceRecord(record).paidAmount).toBe(400);
  });

  it('counts a deposit carried over from the quote', () => {
    const record = invoiceRecord(
      [
        { id: 'd1', kind: 'deposit', amount: 250, paidAt: 1, method: 'square' },
        { id: 'p1', kind: 'manual', amount: 500, paidAt: 2, method: 'bank' },
      ],
      750,
    );

    expect(documentRecordToInvoiceRecord(record).paidAmount).toBe(750);
  });

  it('reports nothing collected as 0', () => {
    expect(documentRecordToInvoiceRecord(invoiceRecord([], 0)).paidAmount).toBe(0);
  });
});
