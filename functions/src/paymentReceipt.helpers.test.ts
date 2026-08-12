import { describe, it, expect } from 'vitest';
import {
  invoiceLinkAmountDue,
  isPaymentAlreadyApplied,
  applySquarePaymentToInvoice,
  evaluatePaymentReceipt,
  evaluateDocumentPaymentReceipt,
  documentPaymentMethodToLegacy,
  shouldSendInvoicePaidPush,
  claimsReceipt,
  paymentMethodLabel,
  formatAud,
  buildPaymentReceiptContentHtml,
} from './paymentReceipt.helpers';

describe('invoiceLinkAmountDue — pay link charges the balance, not the total', () => {
  it('charges the full total when nothing has been paid', () => {
    expect(invoiceLinkAmountDue({ total: 1000 })).toBe(1000);
    expect(invoiceLinkAmountDue({ total: 1000, paidAmount: 0 })).toBe(1000);
  });
  it('charges only the remaining balance after a part payment (regression: link used to charge full total)', () => {
    expect(invoiceLinkAmountDue({ total: 1000, paidAmount: 400 })).toBe(600);
  });
  it('returns 0 for a fully paid or overpaid invoice so no link is minted', () => {
    expect(invoiceLinkAmountDue({ total: 1000, paidAmount: 1000 })).toBe(0);
    expect(invoiceLinkAmountDue({ total: 1000, paidAmount: 1200 })).toBe(0);
  });
  it('tolerates missing/garbage fields', () => {
    expect(invoiceLinkAmountDue({})).toBe(0);
    expect(invoiceLinkAmountDue({ total: 'abc' as any, paidAmount: undefined })).toBe(0);
  });
});

describe('isPaymentAlreadyApplied — webhook redelivery dedupe', () => {
  it('matches the legacy single squarePaymentId field', () => {
    expect(isPaymentAlreadyApplied({ squarePaymentId: 'p1' }, 'p1')).toBe(true);
  });
  it('matches any id in the accumulated squarePaymentIds array (regression: older payment redelivered after a newer one overwrote squarePaymentId)', () => {
    expect(isPaymentAlreadyApplied({ squarePaymentId: 'p2', squarePaymentIds: ['p1', 'p2'] }, 'p1')).toBe(true);
  });
  it('lets a genuinely new payment through', () => {
    expect(isPaymentAlreadyApplied({ squarePaymentId: 'p1', squarePaymentIds: ['p1'] }, 'p2')).toBe(false);
    expect(isPaymentAlreadyApplied({}, 'p1')).toBe(false);
  });
});

describe('applySquarePaymentToInvoice — additive accumulation (regression: Math.max discarded prior part payments)', () => {
  it('stacks a Square payment on top of an existing manual part payment', () => {
    const r = applySquarePaymentToInvoice({ total: 1000, existingPaidAmount: 400, paymentDollars: 600 });
    expect(r.newPaidAmount).toBe(1000);
    expect(r.newStatus).toBe('paid');
    expect(r.balanceDue).toBe(0);
  });
  it('a second partial payment accumulates instead of replacing the first', () => {
    const r = applySquarePaymentToInvoice({ total: 1000, existingPaidAmount: 300, paymentDollars: 200 });
    expect(r.newPaidAmount).toBe(500);
    expect(r.newStatus).toBe('partial');
    expect(r.balanceDue).toBe(500);
  });
  it('caps a surcharged payment (balance + card fee) at the remaining balance so the invoice never reads overpaid', () => {
    const r = applySquarePaymentToInvoice({ total: 1000, existingPaidAmount: 400, paymentDollars: 611.4 });
    expect(r.paidAgainstInvoice).toBe(600);
    expect(r.newPaidAmount).toBe(1000);
    expect(r.newStatus).toBe('paid');
  });
  it('treats within-half-a-cent as paid in full (float-safe status)', () => {
    const r = applySquarePaymentToInvoice({ total: 100.1, existingPaidAmount: 33.37, paymentDollars: 66.73 });
    expect(r.newStatus).toBe('paid');
    expect(r.balanceDue).toBe(0);
  });
  it('ignores a negative payment amount', () => {
    const r = applySquarePaymentToInvoice({ total: 1000, existingPaidAmount: 400, paymentDollars: -50 });
    expect(r.newPaidAmount).toBe(400);
    expect(r.newStatus).toBe('partial');
  });
});

describe('evaluatePaymentReceipt — when an invoice update earns the customer a receipt', () => {
  const base = {
    status: 'sent',
    customerEmail: 'james@bribiecabinets.com.au',
    total: 1000,
    paidAmount: 0,
  };

  it('fires on a part payment with the received delta, not the total', () => {
    const r = evaluatePaymentReceipt(base, { ...base, status: 'partial', paidAmount: 400, paymentMethod: 'bank_transfer' });
    expect(r).not.toBeNull();
    expect(r!.amountReceived).toBe(400);
    expect(r!.isFullyPaid).toBe(false);
    expect(r!.balanceDue).toBe(600);
    expect(r!.paymentMethod).toBe('bank_transfer');
  });
  it('fires on the balance payment and flags paid in full', () => {
    const before = { ...base, status: 'partial', paidAmount: 400 };
    const r = evaluatePaymentReceipt(before, { ...before, status: 'paid', paidAmount: 1000 });
    expect(r!.amountReceived).toBe(600);
    expect(r!.isFullyPaid).toBe(true);
    expect(r!.balanceDue).toBe(0);
  });
  it('skips when the customer has no email address', () => {
    const noEmail = { ...base, customerEmail: '' };
    expect(evaluatePaymentReceipt(noEmail, { ...noEmail, status: 'paid', paidAmount: 1000 })).toBeNull();
    const { customerEmail: _omit, ...missing } = base;
    expect(evaluatePaymentReceipt(missing, { ...missing, status: 'paid', paidAmount: 1000 })).toBeNull();
  });
  it('skips draft and cancelled invoices — the customer never received the invoice', () => {
    const draft = { ...base, status: 'draft' };
    expect(evaluatePaymentReceipt(draft, { ...draft, status: 'paid', paidAmount: 1000 })).toBeNull();
    const cancelled = { ...base, status: 'cancelled' };
    expect(evaluatePaymentReceipt(cancelled, { ...cancelled, paidAmount: 1000 })).toBeNull();
  });
  it('skips a resync with no paidAmount change (no duplicate receipts)', () => {
    const paid = { ...base, status: 'paid', paidAmount: 1000 };
    expect(evaluatePaymentReceipt(paid, { ...paid })).toBeNull();
  });
  it('skips a payment correction that lowers paidAmount', () => {
    const partial = { ...base, status: 'partial', paidAmount: 400 };
    expect(evaluatePaymentReceipt(partial, { ...partial, paidAmount: 200 })).toBeNull();
  });
  it('skips a zero-total invoice', () => {
    const zero = { ...base, total: 0 };
    expect(evaluatePaymentReceipt(zero, { ...zero, paidAmount: 100 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unified `documents` shape — the collection modern invoices actually live in
// ---------------------------------------------------------------------------

/**
 * A document-collection invoice mid-life: sent to the customer, nothing paid.
 * Shaped like a real `users/{uid}/documents/{docId}` record — `paidTotal` /
 * `stage` / `number` / `payments[]`, not the legacy `paidAmount` / `status` /
 * `invoiceNumber`.
 */
const PAID_AT = 1_760_000_000_000; // fixed ms epoch — keeps assertions stable
const docBase = {
  type: 'invoice',
  stage: 'invoice_sent',
  number: 'IN-0042',
  customerName: 'Sarah',
  customerEmail: 'sarah@bribiecabinets.com.au',
  total: 1000,
  paidTotal: 0,
  balanceDue: 1000,
  payments: [] as any[],
};

const manualPayment = (id: string, amount: number, method = 'bank') => ({
  id, kind: 'manual', amount, paidAt: PAID_AT, method,
});

describe('evaluateDocumentPaymentReceipt — receipts for document-collection invoices', () => {
  it('REGRESSION: a payment on a document-only invoice (no legacy row) earns a receipt', () => {
    // Before the documents trigger existed this produced nothing at all —
    // convertDocumentToInvoice writes no legacy row, so the legacy trigger
    // never saw the payment and the customer got silence.
    const after = {
      ...docBase,
      stage: 'partially_paid',
      paidTotal: 400,
      balanceDue: 600,
      payments: [manualPayment('pay-1', 400)],
    };
    const r = evaluateDocumentPaymentReceipt(docBase, after);
    expect(r).not.toBeNull();
    expect(r!.customerEmail).toBe('sarah@bribiecabinets.com.au');
    expect(r!.amountReceived).toBe(400);
    expect(r!.isFullyPaid).toBe(false);
    expect(r!.balanceDue).toBe(600);
    expect(r!.paymentMethod).toBe('bank_transfer');
    expect(r!.invoiceNumber).toBe('IN-0042');
    expect(r!.paidAtMs).toBe(PAID_AT);
    expect(r!.receiptedPaidCents).toBe(40000);
  });

  it('a part payment reports the balance still owing and is not "paid in full"', () => {
    const after = {
      ...docBase, stage: 'partially_paid', paidTotal: 250.5, balanceDue: 749.5,
      payments: [manualPayment('pay-1', 250.5, 'cash')],
    };
    const r = evaluateDocumentPaymentReceipt(docBase, after);
    expect(r!.amountReceived).toBe(250.5);
    expect(r!.balanceDue).toBe(749.5);
    expect(r!.isFullyPaid).toBe(false);
    expect(r!.paymentMethod).toBe('cash');
  });

  it('the final payment closing the balance flags paid in full and charges only the delta', () => {
    const before = {
      ...docBase, stage: 'partially_paid', paidTotal: 400, balanceDue: 600,
      payments: [manualPayment('pay-1', 400)],
      receiptSentPaidCents: 40000,
    };
    const after = {
      ...before, stage: 'paid', paidTotal: 1000, balanceDue: 0,
      payments: [manualPayment('pay-1', 400), manualPayment('pay-2', 600, 'square')],
      paidInFullAt: PAID_AT,
    };
    const r = evaluateDocumentPaymentReceipt(before, after);
    expect(r!.amountReceived).toBe(600);
    expect(r!.isFullyPaid).toBe(true);
    expect(r!.balanceDue).toBe(0);
    expect(r!.paymentMethod).toBe('card'); // 'square' → the legacy label 'Card'
    expect(r!.receiptedPaidCents).toBe(100000);
  });

  it('NO-OP: a resync write that does not increase paidTotal sends nothing', () => {
    const paid = {
      ...docBase, stage: 'paid', paidTotal: 1000, balanceDue: 0,
      payments: [manualPayment('pay-1', 1000)],
    };
    expect(evaluateDocumentPaymentReceipt(paid, { ...paid })).toBeNull();
    // ...including a write that only touches unrelated fields.
    expect(evaluateDocumentPaymentReceipt(paid, { ...paid, jobId: 'job-9' })).toBeNull();
  });

  it('REDELIVERY: an at-least-once replay of the paying event does not re-send', () => {
    // Firestore triggers are at-least-once. The second delivery carries the
    // same before/after, but the mark stamped by the first has landed.
    const after = {
      ...docBase, stage: 'paid', paidTotal: 1000, balanceDue: 0,
      payments: [manualPayment('pay-1', 1000)],
      receiptSentPaidCents: 100000,
    };
    expect(evaluateDocumentPaymentReceipt(docBase, after)).toBeNull();
  });

  it('the trigger stamping its own mark does not loop back into another receipt', () => {
    const paid = {
      ...docBase, stage: 'paid', paidTotal: 1000, balanceDue: 0,
      payments: [manualPayment('pay-1', 1000)],
    };
    // before = pre-stamp, after = post-stamp; paidTotal never moved.
    expect(evaluateDocumentPaymentReceipt(paid, { ...paid, receiptSentPaidCents: 100000 })).toBeNull();
  });

  it('still fires when the mirror rebuilds payments with its own synthetic ids', () => {
    // The legacy→documents mirror derives payments as `manual-{invoiceId}` —
    // a STABLE id across part payments. Keying off ids alone would miss the
    // second payment, so the money (paidTotal) is what decides.
    const before = {
      ...docBase, stage: 'partially_paid', paidTotal: 400, balanceDue: 600,
      payments: [{ id: 'manual-inv1', kind: 'manual', amount: 400, paidAt: PAID_AT, method: 'bank' }],
      receiptSentPaidCents: 40000,
    };
    const after = {
      ...before, stage: 'paid', paidTotal: 1000, balanceDue: 0,
      payments: [{ id: 'manual-inv1', kind: 'manual', amount: 1000, paidAt: PAID_AT, method: 'bank' }],
    };
    const r = evaluateDocumentPaymentReceipt(before, after);
    expect(r!.amountReceived).toBe(600);
    expect(r!.isFullyPaid).toBe(true);
  });

  it('skips a payment correction that lowers paidTotal', () => {
    const before = {
      ...docBase, stage: 'partially_paid', paidTotal: 400,
      payments: [manualPayment('pay-1', 400)],
    };
    expect(evaluateDocumentPaymentReceipt(before, { ...before, paidTotal: 200 })).toBeNull();
  });

  it('skips quote documents — only invoices produce receipts', () => {
    const before = { ...docBase, type: 'quote', stage: 'quote_sent' };
    const after = { ...before, paidTotal: 400, payments: [manualPayment('pay-1', 400)] };
    expect(evaluateDocumentPaymentReceipt(before, after)).toBeNull();
  });

  it.each(['draft', 'quote_sent', 'quote_accepted', 'quote_rejected', 'cancelled'])(
    'skips stage %s — the customer was never sent this invoice',
    (stage) => {
      const before = { ...docBase, stage };
      const after = {
        ...before, stage: 'paid', paidTotal: 1000, payments: [manualPayment('pay-1', 1000)],
      };
      expect(evaluateDocumentPaymentReceipt(before, after)).toBeNull();
    },
  );

  it('skips when the customer has no email address', () => {
    const before = { ...docBase, customerEmail: '   ' };
    const after = { ...before, stage: 'paid', paidTotal: 1000, payments: [manualPayment('p', 1000)] };
    expect(evaluateDocumentPaymentReceipt(before, after)).toBeNull();
  });

  it('skips a zero-total invoice', () => {
    const before = { ...docBase, total: 0 };
    const after = { ...before, paidTotal: 100, payments: [manualPayment('p', 100)] };
    expect(evaluateDocumentPaymentReceipt(before, after)).toBeNull();
  });

  it('tolerates a missing payments array (mirror projections without a ledger)', () => {
    const { payments: _drop, ...noLedger } = docBase;
    const after = { ...noLedger, stage: 'paid', paidTotal: 1000, balanceDue: 0 };
    const r = evaluateDocumentPaymentReceipt(noLedger, after);
    expect(r!.amountReceived).toBe(1000);
    expect(r!.paymentMethod).toBeUndefined();
    expect(typeof r!.paidAtMs).toBe('number');
  });
});

describe('documentPaymentMethodToLegacy — unified method vocabulary → receipt labels', () => {
  it('maps the unified methods onto the labels the receipt email speaks', () => {
    expect(documentPaymentMethodToLegacy('square')).toBe('card');
    expect(documentPaymentMethodToLegacy('bank')).toBe('bank_transfer');
    expect(documentPaymentMethodToLegacy('cash')).toBe('cash');
  });
  it('hides the row for other/unknown/missing methods', () => {
    expect(documentPaymentMethodToLegacy('other')).toBeUndefined();
    expect(documentPaymentMethodToLegacy(undefined)).toBeUndefined();
  });
  it('round-trips through paymentMethodLabel to a human label', () => {
    expect(paymentMethodLabel(documentPaymentMethodToLegacy('square'))).toBe('Card');
    expect(paymentMethodLabel(documentPaymentMethodToLegacy('bank'))).toBe('Bank transfer');
  });
});

describe('claimsReceipt — the transactional high-water claim', () => {
  it('claims when this payment advances the mark', () => {
    expect(claimsReceipt(0, 40000)).toBe(true);
    expect(claimsReceipt(40000, 100000)).toBe(true);
    expect(claimsReceipt(undefined, 100)).toBe(true);
  });
  it('refuses when the mark already covers this total (redelivery / concurrent retry)', () => {
    expect(claimsReceipt(100000, 100000)).toBe(false);
    expect(claimsReceipt(100000, 40000)).toBe(false);
  });
});

describe('shouldSendInvoicePaidPush — tradie push on the stage → paid edge', () => {
  it('fires when an invoice document becomes paid', () => {
    expect(shouldSendInvoicePaidPush(
      { ...docBase, stage: 'partially_paid' },
      { ...docBase, stage: 'paid' },
    )).toBe(true);
  });
  it('does not re-fire on later writes to an already-paid invoice', () => {
    expect(shouldSendInvoicePaidPush(
      { ...docBase, stage: 'paid' },
      { ...docBase, stage: 'paid', paidInFullAt: PAID_AT },
    )).toBe(false);
  });
  it('ignores part payments and quotes', () => {
    expect(shouldSendInvoicePaidPush(docBase, { ...docBase, stage: 'partially_paid' })).toBe(false);
    expect(shouldSendInvoicePaidPush(
      { ...docBase, type: 'quote', stage: 'quote_sent' },
      { ...docBase, type: 'quote', stage: 'paid' },
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Single delivery across both collections
// ---------------------------------------------------------------------------

type SimulatedWrite =
  | { collection: 'documents'; before: Record<string, any>; after: Record<string, any> }
  | { collection: 'invoices'; before: Record<string, any>; after: Record<string, any> };

/**
 * Replays a sequence of Firestore writes through the same composition the two
 * triggers use in index.ts:
 *   - onDocumentPaymentReceived: evaluate → claim the high-water mark → send;
 *   - onInvoicePaymentReceived:  evaluate → send ONLY if the invoice has no
 *     unified mirror document (otherwise the documents trigger owns it).
 * Returns the receipts that would actually reach the customer's inbox.
 */
function replayThroughTriggers(
  writes: SimulatedWrite[],
  hasMirrorDocument: boolean,
): number[] {
  const sent: number[] = [];
  let mark = 0; // receiptSentPaidCents as persisted on the document

  for (const write of writes) {
    if (write.collection === 'documents') {
      const receipt = evaluateDocumentPaymentReceipt(
        write.before,
        { ...write.after, receiptSentPaidCents: mark },
      );
      if (!receipt) continue;
      if (!claimsReceipt(mark, receipt.receiptedPaidCents)) continue;
      mark = receipt.receiptedPaidCents;
      sent.push(receipt.amountReceived);
    } else {
      const receipt = evaluatePaymentReceipt(write.before, write.after);
      if (!receipt) continue;
      if (hasMirrorDocument) continue; // legacyInvoiceHasMirror() → defer
      sent.push(receipt.amountReceived);
    }
  }
  return sent;
}

describe('exactly one receipt per payment across the documents + invoices collections', () => {
  // What recordDocumentPayment produces for a DUAL-WRITTEN invoice: the
  // document ledger, then the legacy mirror row, then the legacy→documents
  // mirror trigger re-projecting the same money with its own payment ids.
  const dualWriteSequence: SimulatedWrite[] = [
    {
      collection: 'documents',
      before: docBase,
      after: {
        ...docBase, stage: 'partially_paid', paidTotal: 400, balanceDue: 600,
        payments: [manualPayment('pay-1', 400)],
      },
    },
    {
      collection: 'invoices',
      before: { status: 'sent', customerEmail: docBase.customerEmail, total: 1000, paidAmount: 0 },
      after: {
        status: 'partial', customerEmail: docBase.customerEmail, total: 1000,
        paidAmount: 400, paymentMethod: 'bank_transfer',
      },
    },
    {
      collection: 'documents',
      before: {
        ...docBase, stage: 'partially_paid', paidTotal: 400, balanceDue: 600,
        payments: [manualPayment('pay-1', 400)],
      },
      after: {
        ...docBase, stage: 'partially_paid', paidTotal: 400, balanceDue: 600,
        payments: [{ id: 'manual-inv1', kind: 'manual', amount: 400, paidAt: PAID_AT, method: 'bank' }],
      },
    },
  ];

  it('DOUBLE-SEND: an invoice with BOTH a document and a legacy row sends exactly ONE receipt', () => {
    expect(replayThroughTriggers(dualWriteSequence, true)).toEqual([400]);
  });

  it('proves the deferral is load-bearing: without it the same payment sends TWO receipts', () => {
    // This is the failure mode the ownership rule exists to prevent — two
    // receipts to a real customer is worse than the missing-receipt bug.
    expect(replayThroughTriggers(dualWriteSequence, false)).toHaveLength(2);
  });

  it('a document-only invoice (no legacy row, so no legacy write at all) still gets its one receipt', () => {
    expect(replayThroughTriggers([dualWriteSequence[0]], true)).toEqual([400]);
  });

  it('a legacy-only invoice with no mirror keeps its receipt via the legacy fallback', () => {
    expect(replayThroughTriggers([dualWriteSequence[1]], false)).toEqual([400]);
  });

  it('two part payments then the balance produce three receipts, one per payment', () => {
    const step = (paidBefore: number, paidAfter: number, ids: string[]): SimulatedWrite => ({
      collection: 'documents',
      before: {
        ...docBase,
        stage: paidBefore > 0 ? 'partially_paid' : 'invoice_sent',
        paidTotal: paidBefore,
        payments: ids.slice(0, -1).map((id, i) => manualPayment(id, [300, 300][i] ?? 0)),
      },
      after: {
        ...docBase,
        stage: paidAfter >= 1000 ? 'paid' : 'partially_paid',
        paidTotal: paidAfter,
        payments: ids.map((id, i) => manualPayment(id, [300, 300, 400][i])),
      },
    });
    const sent = replayThroughTriggers([
      step(0, 300, ['p1']),
      step(300, 600, ['p1', 'p2']),
      step(600, 1000, ['p1', 'p2', 'p3']),
    ], true);
    expect(sent).toEqual([300, 300, 400]);
  });
});

describe('paymentMethodLabel', () => {
  it('maps stored methods to human labels', () => {
    expect(paymentMethodLabel('card')).toBe('Card');
    expect(paymentMethodLabel('bank_transfer')).toBe('Bank transfer');
    expect(paymentMethodLabel('cash')).toBe('Cash');
    expect(paymentMethodLabel('cheque')).toBe('Cheque');
  });
  it('hides the row for other/unknown/missing methods', () => {
    expect(paymentMethodLabel('other')).toBeUndefined();
    expect(paymentMethodLabel(undefined)).toBeUndefined();
    expect(paymentMethodLabel('square')).toBeUndefined();
  });
});

describe('formatAud', () => {
  it('formats with two decimals and thousands separators', () => {
    expect(formatAud(1234.5)).toBe('$1,234.50');
    expect(formatAud(600)).toBe('$600.00');
  });
});

describe('buildPaymentReceiptContentHtml — customer-facing receipt body', () => {
  const partial = {
    customerName: 'Sarah',
    businessName: 'Bribie Island Cabinetmakers',
    invoiceNumber: 'INV-0042',
    jobName: 'Kitchen renovation',
    amountReceived: 400,
    isFullyPaid: false,
    balanceDue: 600,
    paymentMethod: 'bank_transfer',
    paidDateText: '2 July 2026',
  };

  it('shows the amount received, invoice number, job and date', () => {
    const html = buildPaymentReceiptContentHtml(partial);
    expect(html).toContain('$400.00');
    expect(html).toContain('INV-0042');
    expect(html).toContain('Kitchen renovation');
    expect(html).toContain('2 July 2026');
    expect(html).toContain('Bank transfer');
  });
  it('shows the remaining balance on a part payment', () => {
    const html = buildPaymentReceiptContentHtml(partial);
    expect(html).toContain('Remaining balance');
    expect(html).toContain('$600.00');
    expect(html).not.toContain('paid in full');
  });
  it('shows paid in full (and no balance line) when the invoice is settled', () => {
    const html = buildPaymentReceiptContentHtml({ ...partial, isFullyPaid: true, balanceDue: 0, amountReceived: 600 });
    expect(html).toContain('paid in full');
    expect(html).not.toContain('Remaining balance');
  });
  it('signs off as the business — no app branding in the body', () => {
    const html = buildPaymentReceiptContentHtml(partial);
    expect(html).toContain('Bribie Island Cabinetmakers');
    expect(html).not.toContain('QuoteMate');
  });
  it('escapes HTML in customer-supplied fields', () => {
    const html = buildPaymentReceiptContentHtml({ ...partial, customerName: '<script>alert(1)</script>', jobName: 'A & B <deck>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &lt;deck&gt;');
  });
  it('omits the method row for unknown methods and greets politely without a name', () => {
    const html = buildPaymentReceiptContentHtml({ ...partial, paymentMethod: 'other', customerName: undefined });
    expect(html).not.toContain('Payment method');
    expect(html).toContain('Hi there');
  });
});
