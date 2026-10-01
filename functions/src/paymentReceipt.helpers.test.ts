import { describe, it, expect } from 'vitest';
import {
  invoiceLinkAmountDue,
  isPaymentAlreadyApplied,
  applySquarePaymentToInvoice,
  evaluatePaymentReceipt,
  paymentMethodLabel,
  formatAud,
  buildPaymentReceiptContentHtml,
  receiptIsForDeposit,
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
  it('caps an overpayment (a pre-retirement surcharged link: balance + card fee) at the remaining balance so the invoice never reads overpaid', () => {
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

describe('receiptIsForDeposit', () => {
  it('is true when the newest entry is the deposit and matches the money received', () => {
    const payments = [
      { kind: 'manual', amount: 500 },
      { kind: 'manual', amount: 3000, isDeposit: true },
    ];
    expect(receiptIsForDeposit(payments, 3000)).toBe(true);
  });

  it('is false when the amount received is not the deposit entry', () => {
    // A Square payment of $1,000 lands after a $3,000 recorded deposit: the
    // newest manual entry is the deposit, but this receipt is not about it.
    expect(receiptIsForDeposit([{ kind: 'manual', amount: 3000, isDeposit: true }], 1000)).toBe(false);
  });

  it('is false for an ordinary payment, a Square quote deposit, or no ledger', () => {
    expect(receiptIsForDeposit([{ kind: 'manual', amount: 200 }], 200)).toBe(false);
    expect(receiptIsForDeposit([{ kind: 'deposit', amount: 200, isDeposit: true }], 200)).toBe(false);
    expect(receiptIsForDeposit(undefined, 200)).toBe(false);
    expect(receiptIsForDeposit([], 200)).toBe(false);
  });
});

describe('buildPaymentReceiptContentHtml — deposit wording', () => {
  const base = {
    customerName: 'Sam',
    businessName: 'Coastal Concreting',
    invoiceNumber: 'INV-001',
    amountReceived: 3000,
    isFullyPaid: false,
    balanceDue: 6850.40,
    paidDateText: '29 September 2026',
  };

  it('calls a deposit a deposit', () => {
    const html = buildPaymentReceiptContentHtml({ ...base, isDeposit: true });
    expect(html).toContain('>Deposit received</h1>');
    expect(html).toContain('Thanks for your deposit');
    expect(html).toContain('$3,000.00');
    expect(html).toContain('$6,850.40');
    expect(html).not.toContain('Payment received');
  });

  it('keeps the payment wording otherwise', () => {
    const html = buildPaymentReceiptContentHtml(base);
    expect(html).toContain('>Payment received</h1>');
    expect(html).toContain('Thanks for your payment');
    expect(html).not.toContain('Deposit received');
  });
});

describe('evaluatePaymentReceipt — edits are not payments', () => {
  const sent = { status: 'sent', customerEmail: 'sam@example.com', total: 9850.40 };

  it('sends nothing when a payment is corrected upwards', () => {
    // $300 typo fixed to $3,000: paid total rises, ledger still has one entry.
    const before = { ...sent, paidAmount: 300, paymentCount: 1 };
    const after = { ...sent, status: 'partial', paidAmount: 3000, paymentCount: 1 };
    expect(evaluatePaymentReceipt(before, after)).toBeNull();
  });

  it('still sends for a new payment recorded by hand', () => {
    const before = { ...sent, paidAmount: 3000, paymentCount: 1 };
    const after = { ...sent, status: 'partial', paidAmount: 5000, paymentCount: 2 };
    expect(evaluatePaymentReceipt(before, after)).toMatchObject({ amountReceived: 2000 });
  });

  it('still sends for a Square payment, which lands without touching the count', () => {
    const before = { ...sent, paidAmount: 3000, paymentCount: 1 };
    const after = { ...sent, status: 'partial', paidAmount: 5000, paymentCount: 1, squarePaymentId: 'sq_1' };
    expect(evaluatePaymentReceipt(before, after)).toMatchObject({ amountReceived: 2000 });
  });

  it('keeps the old behaviour for invoices written by builds without the count', () => {
    const before = { ...sent, paidAmount: 300 };
    const after = { ...sent, status: 'partial', paidAmount: 3000 };
    expect(evaluatePaymentReceipt(before, after)).toMatchObject({ amountReceived: 2700 });
  });
});
