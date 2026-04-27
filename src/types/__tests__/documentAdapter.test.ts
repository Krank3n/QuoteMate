import {
  deriveStage,
  documentToInvoice,
  documentToQuote,
  invoiceToDocument,
  quoteToDocument,
} from '../documentAdapter';
import type { Invoice, Quote } from '../index';
import type { DocumentStage } from '../document';

const NOW = new Date('2026-04-01T10:00:00.000Z');

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    quoteNumber: 'Q-001',
    createdAt: NOW,
    updatedAt: NOW,
    customerName: 'Davo',
    customerEmail: 'davo@example.com',
    customerPhone: '0400000000',
    jobAddress: '12 Test St',
    job: { id: 'job-1', name: 'Fence', description: 'Colorbond fence', template: 'fence' },
    materials: [
      { id: 'm1', name: 'Post', quantity: 4, unit: 'each', price: 30, totalPrice: 120, manualPriceOverride: false },
    ],
    laborRate: 85,
    laborHours: 8,
    laborUnit: 'hours',
    laborTotal: 680,
    materialsSubtotal: 120,
    markup: 20,
    laborMarkup: 20,
    markupAmount: 160,
    subtotal: 800,
    gst: 96,
    total: 1056,
    status: 'sent',
    notes: 'Round to nearest dollar',
    showMarkup: false,
    requireDeposit: true,
    depositPercentage: 20,
    depositAmount: 211.2,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    invoiceNumber: 'IN-001',
    createdAt: NOW,
    updatedAt: NOW,
    issueDate: NOW,
    dueDate: new Date('2026-04-15T10:00:00.000Z'),
    customerName: 'Davo',
    customerEmail: 'davo@example.com',
    customerPhone: '0400000000',
    jobAddress: '12 Test St',
    job: { id: 'job-1', name: 'Fence', description: 'Colorbond fence', template: 'fence' },
    materials: [
      { id: 'm1', name: 'Post', quantity: 4, unit: 'each', price: 30, totalPrice: 120, manualPriceOverride: false },
    ],
    laborRate: 85,
    laborHours: 8,
    laborUnit: 'hours',
    laborTotal: 680,
    materialsSubtotal: 120,
    markup: 20,
    laborMarkup: 20,
    markupAmount: 160,
    subtotal: 800,
    gst: 96,
    total: 1056,
    status: 'sent',
    paymentTerms: 'net_14',
    ...overrides,
  };
}

describe('deriveStage', () => {
  describe('quote-side', () => {
    const cases: Array<[Quote['status'], DocumentStage]> = [
      ['draft', 'draft'],
      ['sent', 'quote_sent'],
      ['accepted', 'quote_accepted'],
      ['rejected', 'quote_rejected'],
      ['completed', 'quote_accepted'],
      ['cancelled', 'cancelled'],
    ];
    it.each(cases)('maps quote status %s to %s', (status, expected) => {
      expect(deriveStage(makeQuote({ status }), 'quote')).toBe(expected);
    });

    it('treats legacy paid/partial quote statuses as quote_accepted', () => {
      expect(deriveStage(makeQuote({ status: 'paid' as any }), 'quote')).toBe('quote_accepted');
      expect(deriveStage(makeQuote({ status: 'partial' as any }), 'quote')).toBe('quote_accepted');
    });

    it('treats legacy overdue quote status as quote_sent', () => {
      expect(deriveStage(makeQuote({ status: 'overdue' as any }), 'quote')).toBe('quote_sent');
    });
  });

  describe('invoice-side', () => {
    const cases: Array<[Invoice['status'], DocumentStage]> = [
      ['draft', 'draft'],
      ['sent', 'invoice_sent'],
      ['paid', 'paid'],
      ['partial', 'partially_paid'],
      ['overdue', 'invoice_sent'],
      ['cancelled', 'cancelled'],
    ];
    it.each(cases)('maps invoice status %s to %s', (status, expected) => {
      expect(deriveStage(makeInvoice({ status }), 'invoice')).toBe(expected);
    });

    it('flips status:sent invoice to paid when paidTotal covers total', () => {
      expect(
        deriveStage(makeInvoice({ status: 'sent', paidTotal: 1056, total: 1056 }), 'invoice'),
      ).toBe('paid');
    });

    it('flips status:sent invoice to partially_paid on positive partial payment', () => {
      expect(
        deriveStage(makeInvoice({ status: 'sent', paidTotal: 200, total: 1056 }), 'invoice'),
      ).toBe('partially_paid');
    });
  });
});

describe('quoteToDocument round-trip', () => {
  it('preserves shared customer + job + totals fields', () => {
    const quote = makeQuote();
    const doc = quoteToDocument(quote);
    const restored = documentToQuote(doc);

    expect(restored.id).toBe(quote.id);
    expect(restored.quoteNumber).toBe(quote.quoteNumber);
    expect(restored.customerName).toBe(quote.customerName);
    expect(restored.customerEmail).toBe(quote.customerEmail);
    expect(restored.jobAddress).toBe(quote.jobAddress);
    expect(restored.job).toEqual(quote.job);
    expect(restored.materials).toEqual(quote.materials);
    expect(restored.laborRate).toBe(quote.laborRate);
    expect(restored.laborHours).toBe(quote.laborHours);
    expect(restored.laborTotal).toBe(quote.laborTotal);
    expect(restored.subtotal).toBe(quote.subtotal);
    expect(restored.gst).toBe(quote.gst);
    expect(restored.total).toBe(quote.total);
    expect(restored.markup).toBe(quote.markup);
    expect(restored.laborMarkup).toBe(quote.laborMarkup);
    expect(restored.notes).toBe(quote.notes);
    expect(restored.requireDeposit).toBe(quote.requireDeposit);
    expect(restored.depositPercentage).toBe(quote.depositPercentage);
    expect(restored.depositAmount).toBe(quote.depositAmount);
  });

  it('round-trips status sent → quote_sent → sent', () => {
    const quote = makeQuote({ status: 'sent' });
    expect(documentToQuote(quoteToDocument(quote)).status).toBe('sent');
  });

  it('round-trips invoice back-reference', () => {
    const quote = makeQuote({
      invoiceId: 'invoice-99',
      invoicedAt: new Date('2026-04-02T00:00:00Z'),
    });
    const restored = documentToQuote(quoteToDocument(quote));
    expect(restored.invoiceId).toBe('invoice-99');
    expect(restored.invoicedAt?.toISOString()).toBe('2026-04-02T00:00:00.000Z');
  });

  it('captures depositPaid as a payments[] entry and restores it', () => {
    const quote = makeQuote({
      depositPaid: 200,
      depositPaidAt: new Date('2026-04-02T12:00:00Z'),
      depositSquarePaymentId: 'sq-pay-1',
    });
    const doc = quoteToDocument(quote);
    expect(doc.payments).toHaveLength(1);
    expect(doc.payments[0]).toMatchObject({
      kind: 'deposit',
      amount: 200,
      method: 'square',
      squarePaymentId: 'sq-pay-1',
    });
    expect(doc.paidTotal).toBe(200);
    expect(doc.balanceDue).toBe(quote.total - 200);

    const restored = documentToQuote(doc);
    expect(restored.depositPaid).toBe(200);
    expect(restored.depositSquarePaymentId).toBe('sq-pay-1');
  });
});

describe('invoiceToDocument round-trip', () => {
  it('preserves shared fields and invoice-only optionals', () => {
    const invoice = makeInvoice({
      paymentTerms: 'net_30',
      xeroInvoiceId: 'xero-1',
      sourceQuoteId: 'quote-99',
    });
    const restored = documentToInvoice(invoiceToDocument(invoice));
    expect(restored.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(restored.customerName).toBe(invoice.customerName);
    expect(restored.paymentTerms).toBe('net_30');
    expect(restored.xeroInvoiceId).toBe('xero-1');
    expect(restored.sourceQuoteId).toBe('quote-99');
    expect(restored.dueDate.toISOString()).toBe(invoice.dueDate.toISOString());
  });

  it('represents depositCredit as a deposit payment and restores it', () => {
    const invoice = makeInvoice({
      depositCredit: 300,
      depositCreditFromQuoteId: 'quote-99',
      sourceQuoteId: 'quote-99',
    });
    const doc = invoiceToDocument(invoice);
    expect(doc.payments).toContainEqual(
      expect.objectContaining({ kind: 'deposit', amount: 300 }),
    );
    const restored = documentToInvoice(doc);
    expect(restored.depositCredit).toBe(300);
    expect(restored.depositCreditFromQuoteId).toBe('quote-99');
  });

  it('represents square balance payment as a balance entry', () => {
    const invoice = makeInvoice({
      status: 'paid',
      paidAmount: 1056,
      paidDate: NOW,
      squarePaymentId: 'sq-99',
      squarePaidAt: NOW,
    });
    const doc = invoiceToDocument(invoice);
    expect(doc.payments).toContainEqual(
      expect.objectContaining({ kind: 'balance', amount: 1056, squarePaymentId: 'sq-99' }),
    );
    expect(doc.stage).toBe('paid');
    expect(doc.paidTotal).toBe(1056);
    expect(doc.balanceDue).toBe(0);
  });

  it('represents manual recordPayment as a manual entry', () => {
    const invoice = makeInvoice({
      status: 'partial',
      paidAmount: 500,
      paidDate: NOW,
      paymentMethod: 'cash',
      paymentNotes: 'Cash on Friday',
    });
    const doc = invoiceToDocument(invoice);
    expect(doc.payments).toContainEqual(
      expect.objectContaining({ kind: 'manual', amount: 500, method: 'cash' }),
    );
    expect(doc.stage).toBe('partially_paid');
    const restored = documentToInvoice(doc);
    expect(restored.paymentMethod).toBe('cash');
    expect(restored.paymentNotes).toBe('Cash on Friday');
  });
});

describe('cross-type drop behaviour', () => {
  it('drops invoice-only fields when going document → quote', () => {
    const invoice = makeInvoice({ paymentTerms: 'net_30', xeroInvoiceId: 'xero-1' });
    const doc = invoiceToDocument(invoice);
    const asQuote = documentToQuote(doc);
    expect((asQuote as any).paymentTerms).toBeUndefined();
    expect((asQuote as any).xeroInvoiceId).toBeUndefined();
  });

  it('drops quote-only fields when going document → invoice', () => {
    const quote = makeQuote({ acceptanceToken: 'tok', aiEmailBody: 'hi' });
    const doc = quoteToDocument(quote);
    const asInvoice = documentToInvoice(doc);
    expect((asInvoice as any).acceptanceToken).toBeUndefined();
    expect((asInvoice as any).aiEmailBody).toBeUndefined();
  });
});
