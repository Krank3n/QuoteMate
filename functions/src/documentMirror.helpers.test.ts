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

  it('an echo cannot take payments off the ledger — removals go through the ledger first', () => {
    // Every writer that removes a payment (Record Payment's Remove, the
    // un-pay path) empties the unified ledger BEFORE mirroring, so by the
    // time this echo arrives the stored ledger is already empty and the
    // early return takes it. A legacy record that reads lower than the
    // ledger is a stale write, not a removal.
    const cleared = { paidTotal: 0, payments: [] };
    expect(preserveLedger({ payments: ledger }, cleared).payments).toEqual(ledger);
    expect(preserveLedger({ payments: [] }, cleared)).toEqual(cleared);
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

/**
 * App builds from before Oct 2026 (the OTA tree 432b266 on 1.55–1.58) keep
 * writing the legacy record their own way until every phone updates — and the
 * server mirror is already the new one. These echoes reproduce exactly what
 * those builds' documentRecordToInvoiceRecord / documentRecordToQuoteRecord
 * write (invoice: depositCredit = Σ kind 'deposit', paidAmount = paidTotal;
 * quote: depositPaid = the FIRST deposit), then run the live projection and
 * preserveLedger over them. Verified against the real 432b266 adapter.
 */
describe('preserveLedger against older app builds', () => {
  const now = 1_790_000_000_000;
  const deposit = { id: 'dep-1', kind: 'deposit', amount: 300, paidAt: now - 1000, method: 'bank' };
  const invoice = (over: any = {}) => ({
    id: 'q-coastal', type: 'invoice', stage: 'partially_paid', number: 'INV-1', total: 960,
    paidTotal: 300, balanceDue: 660, payments: [deposit], createdAt: now - 5000, updatedAt: now,
    job: { name: 'Slab' }, materials: [], legacyQuoteId: 'q-coastal', ...over,
  });
  const quote = (over: any = {}) => ({
    id: 'q-coastal', type: 'quote', stage: 'quote_accepted', number: 'QU-1', total: 960,
    paidTotal: 300, balanceDue: 660, depositPaid: 300, depositAmount: 300, requireDeposit: true,
    payments: [deposit], createdAt: now - 5000, updatedAt: now, job: { name: 'Slab' }, materials: [], ...over,
  });
  const sum = (ps: any[]) => ps.reduce((a, p) => a + p.amount, 0);

  /** What an older build writes to invoices/{id} for this document. */
  function olderInvoiceEcho(doc: any) {
    const legacy: any = { ...documentRecordToInvoiceRecord(doc) };
    const deposits = sum(doc.payments.filter((p: any) => p.kind === 'deposit'));
    if (deposits > 0) legacy.depositCredit = deposits; else delete legacy.depositCredit;
    legacy.paidAmount = doc.paidTotal;
    return preserveLedger(doc, invoiceRecordToDocumentRecord(legacy, doc.id) as any);
  }
  /** What an older build writes to quotes/{id}: only the first deposit. */
  function olderQuoteEcho(doc: any) {
    const legacy: any = { ...documentRecordToQuoteRecord(doc) };
    legacy.depositPaid = doc.payments.find((p: any) => p.kind === 'deposit')?.amount ?? 0;
    return preserveLedger(doc, quoteRecordToDocumentRecord(legacy, doc.id) as any);
  }

  it('REGRESSION: a converted invoice with a $300 deposit keeps $300 paid, $660 owing (was doubled to $600 paid)', () => {
    const out = olderInvoiceEcho(invoice());
    expect(out.payments).toEqual([deposit]);
    expect(out.paidTotal).toBe(300);
    expect(out.balanceDue).toBe(660);
    expect(out.stage).toBe('partially_paid');
  });

  it('keeps a deposit plus a later payment', () => {
    const later = { id: 'm-1', kind: 'manual', amount: 200, paidAt: now, method: 'cash' };
    const out = olderInvoiceEcho(invoice({ payments: [deposit, later], paidTotal: 500, balanceDue: 460 }));
    expect(out.payments).toEqual([deposit, later]);
    expect(out.paidTotal).toBe(500);
    expect(out.balanceDue).toBe(460);
  });

  it('never reads a doubled echo as paid in full', () => {
    const big = { ...deposit, amount: 500 };
    const out = olderInvoiceEcho(invoice({ payments: [big], paidTotal: 500, balanceDue: 460 }));
    expect(out.stage).toBe('partially_paid');
    expect(out.balanceDue).toBe(460);
  });

  it('an older netted invoice (total already less the deposit) still owes what it owed', () => {
    const credit = { id: 'deposit-credit-q-old', kind: 'deposit', amount: 300, paidAt: now - 9000, method: 'square' };
    const paid = { id: 'm-1', kind: 'manual', amount: 360, paidAt: now, method: 'bank' };
    const out = olderInvoiceEcho(invoice({ total: 660, payments: [credit, paid], paidTotal: 660, balanceDue: 300 }));
    expect(out.payments).toEqual([credit, paid]);
    expect(out.balanceDue).toBe(300);
    expect(out.stage).toBe('partially_paid');
  });

  it('REGRESSION: a quote with two deposits keeps both (older builds report only the first)', () => {
    const square = { id: 'deposit-sq-1', kind: 'deposit', amount: 200, paidAt: now, method: 'square', squarePaymentId: 'sq-1' };
    const first = { ...deposit, amount: 100 };
    const out = olderQuoteEcho(quote({ payments: [first, square] }));
    expect(out.payments).toEqual([first, square]);
    expect(out.depositPaid).toBe(300);
    expect(out.paidTotal).toBe(300);
  });

  it('a quote with a deposit and a full-amount payment keeps both', () => {
    const full = { id: 'full-sq-1', kind: 'balance', amount: 660, paidAt: now, method: 'square', squarePaymentId: 'sq-1' };
    const out = olderQuoteEcho(quote({ payments: [deposit, full], paidTotal: 960, balanceDue: 0 }));
    expect(out.payments).toEqual([deposit, full]);
    expect(out.paidTotal).toBe(960);
    expect(out.depositPaid).toBe(300);
  });

  it('REGRESSION: a stale older-build write does not wipe a payment it just recorded', () => {
    // Seen on the simulator with a 1.58 build: deposit $291.72 + $100 cash +
    // $50 bank on the ledger, then a legacy write still reading $391.72 paid
    // (from before the $50) with the deposit as a credit. Taking that echo
    // replaced all three entries with "credit 291.72 + manual 391.72".
    const cash = { id: 'm-1', kind: 'manual', amount: 100, paidAt: now, method: 'cash' };
    const bank = { id: 'm-2', kind: 'manual', amount: 50, paidAt: now + 1, method: 'bank' };
    const dep = { ...deposit, amount: 291.72 };
    const doc = invoice({ total: 972.4, payments: [dep, cash, bank], paidTotal: 441.72, balanceDue: 530.68 });
    const legacy: any = { ...documentRecordToInvoiceRecord(doc), depositCredit: 291.72, paidAmount: 391.72 };
    const out = preserveLedger(doc, invoiceRecordToDocumentRecord(legacy, doc.id) as any);
    expect(out.payments).toEqual([dep, cash, bank]);
    expect(out.paidTotal).toBe(441.72);
    expect(out.balanceDue).toBe(530.68);
    expect(out.stage).toBe('partially_paid');
  });

  it('still takes an invoice echo with genuinely new money (a legacy-only write)', () => {
    const doc = invoice();
    const legacy: any = { ...documentRecordToInvoiceRecord(doc), paidAmount: 800 };
    delete legacy.depositCredit;
    const out = preserveLedger(doc, invoiceRecordToDocumentRecord(legacy, doc.id) as any);
    expect(out.paidTotal).toBe(800);
    expect(out.payments.map((p: any) => p.amount)).toEqual([800]);
  });
});
