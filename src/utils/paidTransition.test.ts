/**
 * "Mark as Paid" used to flip the Job stage and write nothing to the
 * invoice, so a tradie could end up with a job reading Paid while the
 * invoice still owed money — no payment in the ledger, no receipt sent,
 * and their own records claiming they'd been paid for work they hadn't.
 *
 * These pin when the tap becomes "record the payment" instead, and just as
 * importantly when it must stay a plain flip: blocking the cash job with no
 * invoice would break a common, legitimate case.
 */
import { describe, it, expect } from 'vitest';

import { resolvePaidTransition } from './paidTransition';

function invoice(over: Record<string, any> = {}): any {
  return {
    id: over.id ?? 'inv1',
    type: 'invoice',
    stage: 'invoice_sent',
    total: 1000,
    paidTotal: 0,
    ...over,
  };
}

function quote(over: Record<string, any> = {}): any {
  return {
    id: over.id ?? 'q1',
    type: 'quote',
    stage: 'quote_sent',
    total: 1000,
    paidTotal: 0,
    ...over,
  };
}

describe('resolvePaidTransition', () => {
  it('REGRESSION: routes to record payment when an invoice still owes money', () => {
    const result = resolvePaidTransition({ stage: 'completed' }, [
      invoice({ id: 'inv-006', total: 2598.84, paidTotal: 0 }),
    ]);

    expect(result).toEqual({
      kind: 'record_payment',
      invoiceId: 'inv-006',
      balanceDue: 2598.84,
    });
  });

  it('routes on a part-paid invoice, carrying only the remaining balance', () => {
    const result = resolvePaidTransition({ stage: 'completed' }, [
      invoice({ total: 1000, paidTotal: 400, stage: 'partially_paid' }),
    ]);

    expect(result).toEqual({
      kind: 'record_payment',
      invoiceId: 'inv1',
      balanceDue: 600,
    });
  });

  it('flips when the invoice is settled', () => {
    expect(
      resolvePaidTransition({ stage: 'completed' }, [
        invoice({ total: 1000, paidTotal: 1000, stage: 'paid' }),
      ]),
    ).toEqual({ kind: 'flip' });
  });

  it('flips when the balance is within half a cent, matching derivePaymentState', () => {
    expect(
      resolvePaidTransition({ stage: 'completed' }, [
        invoice({ total: 1000, paidTotal: 999.999 }),
      ]),
    ).toEqual({ kind: 'flip' });
  });

  it('flips when the invoice is overpaid', () => {
    expect(
      resolvePaidTransition({ stage: 'completed' }, [
        invoice({ total: 1000, paidTotal: 1200 }),
      ]),
    ).toEqual({ kind: 'flip' });
  });

  // A cash job with no paperwork is real and common — the guard must not
  // strand it.
  it('flips on a job with no documents at all', () => {
    expect(resolvePaidTransition({ stage: 'completed' }, [])).toEqual({ kind: 'flip' });
  });

  it('flips on a quote-only job — a quote is not money owed on an invoice', () => {
    expect(
      resolvePaidTransition({ stage: 'completed' }, [quote()]),
    ).toEqual({ kind: 'flip' });
  });

  it('flips on a quote carrying a deposit but no invoice', () => {
    expect(
      resolvePaidTransition({ stage: 'accepted' }, [
        quote({ depositAmount: 500, depositPaid: 500, paidTotal: 500 }),
      ]),
    ).toEqual({ kind: 'flip' });
  });

  it('ignores a cancelled invoice, however much it appears to owe', () => {
    expect(
      resolvePaidTransition({ stage: 'completed' }, [
        invoice({ stage: 'cancelled', total: 5000, paidTotal: 0 }),
      ]),
    ).toEqual({ kind: 'flip' });
  });

  // `closed → paid` is the unarchive edge, not a payment moment.
  it('flips when unarchiving a closed job, even with an invoice owing', () => {
    expect(
      resolvePaidTransition({ stage: 'closed' }, [
        invoice({ total: 1000, paidTotal: 0 }),
      ]),
    ).toEqual({ kind: 'flip' });
  });

  it('picks the invoice owing the most when several are outstanding', () => {
    const result = resolvePaidTransition({ stage: 'completed' }, [
      invoice({ id: 'small', total: 300, paidTotal: 0 }),
      invoice({ id: 'big', total: 4000, paidTotal: 500 }),
      invoice({ id: 'settled', total: 900, paidTotal: 900 }),
    ]);

    expect(result).toMatchObject({ kind: 'record_payment', invoiceId: 'big', balanceDue: 3500 });
  });

  it('breaks an equal-balance tie the same way regardless of argument order', () => {
    const a = invoice({ id: 'aaa', total: 1000, paidTotal: 0 });
    const b = invoice({ id: 'bbb', total: 1000, paidTotal: 0 });

    expect(resolvePaidTransition({ stage: 'completed' }, [a, b])).toMatchObject({
      invoiceId: 'aaa',
    });
    expect(resolvePaidTransition({ stage: 'completed' }, [b, a])).toMatchObject({
      invoiceId: 'aaa',
    });
  });

  it('tolerates junk totals without routing to a NaN balance', () => {
    expect(
      resolvePaidTransition({ stage: 'completed' }, [
        invoice({ total: 'abc' as any, paidTotal: undefined }),
      ]),
    ).toEqual({ kind: 'flip' });
  });
});
