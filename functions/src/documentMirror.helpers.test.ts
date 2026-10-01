import { describe, it, expect } from 'vitest';
import { preserveFirstSend, preserveLedger } from './documentMirror';
import {
  documentRecordToInvoiceRecord,
  documentRecordToQuoteRecord,
  invoiceRecordToDocumentRecord,
  quoteRecordToDocumentRecord,
} from './shared/document/adapter';

describe('preserveFirstSend', () => {
  it('drops sentAt+sendMethod when existing.sentAt set', () => {
    const existing = { sentAt: 100, sendMethod: 'email' };
    const toWrite = { sentAt: 200, sendMethod: 'sms', stage: 'quote_sent', total: 500 };
    const result = preserveFirstSend(existing, toWrite);

    expect(result.sentAt).toBeUndefined();
    expect(result.sendMethod).toBeUndefined();
    // Everything else survives untouched.
    expect(result.stage).toBe('quote_sent');
    expect(result.total).toBe(500);
  });

  it('passes through when existing has none / existing null', () => {
    const toWrite = { sentAt: 200, sendMethod: 'sms', stage: 'quote_sent' };

    // Existing mirror without a sentAt yet — the first send should record.
    expect(preserveFirstSend({ stage: 'draft' }, toWrite)).toEqual(toWrite);
    // No existing mirror at all.
    expect(preserveFirstSend(null, toWrite)).toEqual(toWrite);
    expect(preserveFirstSend(undefined, toWrite)).toEqual(toWrite);
  });
});

describe('preserveLedger', () => {
  const ledger = [
    { id: 'p1', kind: 'manual', amount: 100, method: 'cash', paidAt: 1 },
    { id: 'p2', kind: 'manual', amount: 50, method: 'bank', paidAt: 2, isDeposit: true },
  ];
  // What invoiceRecordToDocumentRecord rebuilds from the legacy record after
  // a unified save: one entry carrying the summed paidAmount.
  const echo = {
    paidTotal: 150,
    payments: [{ id: 'manual-inv-1', kind: 'manual', amount: 150, method: 'cash', paidAt: 2 }],
    stage: 'partially_paid',
  };

  it('keeps the stored ledger when the legacy echo carries the same money', () => {
    const result = preserveLedger({ payments: ledger }, echo);
    expect(result.payments).toEqual(ledger);
    // Only the ledger is swapped; the rest of the projection still lands.
    expect(result.stage).toBe('partially_paid');
    expect(result.paidTotal).toBe(150);
  });

  it('tolerates float noise in the sums', () => {
    const stored = [
      { id: 'a', amount: 0.1 },
      { id: 'b', amount: 0.2 },
    ];
    const result = preserveLedger({ payments: stored }, { payments: [{ id: 'm', amount: 0.3 }] });
    expect(result.payments).toEqual(stored);
  });

  it('takes the projection when an older client changed the money', () => {
    const changed = { ...echo, paidTotal: 400, payments: [{ id: 'manual-inv-1', amount: 400 }] };
    expect(preserveLedger({ payments: ledger }, changed)).toEqual(changed);
  });

  it('takes the projection when every payment was removed through the legacy record', () => {
    const cleared = { paidTotal: 0, payments: [] };
    expect(preserveLedger({ payments: ledger }, cleared)).toEqual(cleared);
  });

  it('passes through when nothing is stored yet', () => {
    expect(preserveLedger({ payments: [] }, echo)).toEqual(echo);
    expect(preserveLedger({}, echo)).toEqual(echo);
    expect(preserveLedger(null, echo)).toEqual(echo);
  });
});

// The full echo: a unified save mirrors the document onto its legacy record
// (documentRecordTo*Record), and onQuoteWritten / onInvoiceWritten project that
// record straight back (*RecordToDocumentRecord) through preserveLedger. The
// stored ledger must come out exactly as it went in — one deposit entry, its
// own id and method — or every save would rewrite the payment history.
describe('mirror round trip keeps a deposit ledger', () => {
  function echo(doc: any): any {
    const legacy = doc.type === 'invoice'
      ? documentRecordToInvoiceRecord(doc)
      : documentRecordToQuoteRecord(doc);
    const projected = doc.type === 'invoice'
      ? invoiceRecordToDocumentRecord(legacy, doc.id)
      : quoteRecordToDocumentRecord(legacy, doc.id);
    return preserveLedger(doc, projected);
  }

  const base = {
    id: 'q-coastal',
    number: 'INV-12',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    job: { name: 'Coastal Concreting slab' },
    materials: [],
    total: 960,
    legacyQuoteId: 'q-coastal',
  };

  for (const method of ['square', 'bank', 'cash'] as const) {
    it(`an invoice converted with a ${method} deposit: one entry, same method, $660 still owing`, () => {
      const deposit = {
        id: `deposit-${method}-1`,
        kind: 'deposit',
        amount: 300,
        paidAt: 1_700_000_000_000,
        method,
        ...(method === 'square' ? { squarePaymentId: 'sq-1' } : {}),
      };
      const doc = { ...base, type: 'invoice', stage: 'draft', payments: [deposit], paidTotal: 300, balanceDue: 660 };

      const out = echo(doc);

      expect(out.payments).toEqual([deposit]);
      expect(out.paidTotal).toBe(300);
      expect(out.balanceDue).toBe(660);
      expect(out.total).toBe(960);
    });
  }

  it('REGRESSION: the converted invoice no longer reports its deposit twice to the legacy record', () => {
    const doc = {
      ...base, type: 'invoice', stage: 'draft',
      payments: [{ id: 'deposit-sq-1', kind: 'deposit', amount: 300, paidAt: 1, method: 'square', squarePaymentId: 'sq-1' }],
      paidTotal: 300,
    };
    const legacy = documentRecordToInvoiceRecord(doc);
    expect(legacy.depositCredit).toBeUndefined();
    expect(legacy.paidAmount).toBe(300);
    expect(legacy.total).toBe(960);
  });

  it('a deposit recorded by hand on a quote keeps its method through the quote mirror', () => {
    const deposit = { id: 'dep-bank-1', kind: 'deposit', amount: 300, paidAt: 1_700_000_000_000, method: 'bank', notes: 'Ref SAM300' };
    const doc = {
      ...base, number: 'QU-21', type: 'quote', stage: 'quote_accepted',
      requireDeposit: true, depositAmount: 300, depositPaid: 300,
      payments: [deposit], paidTotal: 300, balanceDue: 660,
    };

    const legacy = documentRecordToQuoteRecord(doc);
    expect(legacy.depositPaid).toBe(300);
    expect(legacy.depositSquarePaymentId).toBeUndefined();

    const out = echo(doc);
    expect(out.payments).toEqual([deposit]);
    expect(out.stage).toBe('quote_accepted');
  });

  it('a hand-recorded deposit topped up through Square: both entries survive the quote mirror', () => {
    const payments = [
      { id: 'dep-bank-1', kind: 'deposit', amount: 100, paidAt: 1, method: 'bank' },
      { id: 'deposit-sq-2', kind: 'deposit', amount: 200, paidAt: 2, method: 'square', squarePaymentId: 'sq-2' },
    ];
    const doc = {
      ...base, number: 'QU-21', type: 'quote', stage: 'quote_accepted',
      depositPaid: 300, payments, paidTotal: 300,
    };

    const legacy = documentRecordToQuoteRecord(doc);
    // Every deposit, not the first one found.
    expect(legacy.depositPaid).toBe(300);
    expect(legacy.depositSquarePaymentId).toBe('sq-2');
    expect(echo(doc).payments).toEqual(payments);
  });

  it('a legacy-minted invoice (netted total, deposit-credit entry) round-trips unchanged', () => {
    const credit = { id: 'deposit-credit-q-9', kind: 'deposit', amount: 300, paidAt: 1, method: 'square', notes: 'Carried over from source quote' };
    const doc = { ...base, type: 'invoice', stage: 'invoice_sent', total: 660, payments: [credit], paidTotal: 300 };

    const legacy = documentRecordToInvoiceRecord(doc);
    // Exactly the legacy shape it was minted with: credit beside a total that
    // is already the balance, nothing else paid.
    expect(legacy.depositCredit).toBe(300);
    expect(legacy.total).toBe(660);
    expect(legacy.paidAmount).toBe(0);
    expect(echo(doc).payments).toEqual([credit]);
  });
});
