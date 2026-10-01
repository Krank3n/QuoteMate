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

  it('a deposit carried over by the unified convert is paid money, not a netted credit', () => {
    const record = invoiceRecord(
      [{ id: 'dep-bank-1', kind: 'deposit', amount: 300, paidAt: 1, method: 'bank' }],
      300,
    );
    const invoice = documentRecordToInvoiceRecord(record);

    expect(invoice.paidAmount).toBe(300);
    expect(invoice.depositCredit).toBeUndefined();
    // The deposit's real method, not 'other' — it is the only payment.
    expect(invoice.paymentMethod).toBe('bank_transfer');
  });

  it('two deposits both count', () => {
    const record = invoiceRecord(
      [
        { id: 'dep-bank-1', kind: 'deposit', amount: 100, paidAt: 1, method: 'bank' },
        { id: 'deposit-sq-2', kind: 'deposit', amount: 200, paidAt: 2, method: 'square', squarePaymentId: 'sq-2' },
      ],
      300,
    );
    expect(documentRecordToInvoiceRecord(record).paidAmount).toBe(300);
  });

  it('a legacy netted credit stays a credit and out of paidAmount', () => {
    const record = invoiceRecord(
      [
        { id: 'deposit-credit-q-1', kind: 'deposit', amount: 250, paidAt: 1, method: 'square' },
        { id: 'p1', kind: 'manual', amount: 500, paidAt: 2, method: 'bank' },
      ],
      750,
    );
    const invoice = documentRecordToInvoiceRecord(record);

    expect(invoice.depositCredit).toBe(250);
    expect(invoice.paidAmount).toBe(500);
  });

  it('reports nothing collected as 0', () => {
    expect(documentRecordToInvoiceRecord(invoiceRecord([], 0)).paidAmount).toBe(0);
  });
});

describe('documentRecordToInvoiceRecord — a document with no payments ledger', () => {
  // A quote that has never taken a payment carries no `payments` array. Until
  // 13 Sep 2026 the adapter threw on it, which the client's Create Invoice
  // path swallowed by minting a legacy invoice with no jobId — and the server
  // then materialised a ghost Job for it.
  it('REGRESSION: converts without a payments array, reporting nothing paid', () => {
    const record = invoiceRecord([], 0);
    delete record.payments;
    const invoice = documentRecordToInvoiceRecord(record);
    expect(invoice.paidAmount ?? 0).toBe(0);
    expect(invoice.depositCredit ?? 0).toBe(0);
  });
});

describe('documentRecordToInvoiceRecord — paymentCount', () => {
  it('stamps how many ledger entries make up the paid total', () => {
    const record = invoiceRecord(
      [
        { id: 'p1', kind: 'manual', amount: 400, paidAt: 1, method: 'cash' },
        { id: 'p2', kind: 'manual', amount: 560, paidAt: 2, method: 'bank' },
      ],
      960,
    );
    expect(documentRecordToInvoiceRecord(record).paymentCount).toBe(2);
  });

  it('is zero with no payments', () => {
    expect(documentRecordToInvoiceRecord(invoiceRecord([], 0)).paymentCount).toBe(0);
  });
});
