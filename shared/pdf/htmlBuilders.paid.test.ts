/**
 * The PAID stamp on a settled invoice.
 *
 * A tradie asked for it in so many words: once a payment is recorded, the
 * invoice should say PAID and when. The stamp rides the same diagonal
 * overlay as the gated DRAFT watermark, in the paid-in-full green. Its
 * trigger is the pre-formatted `paidDate` — the call sites only set that at
 * stage 'paid', so the builder never re-derives "paid" from arithmetic (a
 * converted-with-deposit invoice can carry the deposit on its ledger and the
 * subtraction lies).
 */

import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml, buildInvoicePdfHtml } from './htmlBuilders';
import type { QuotePdfData, InvoicePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };
const squareLink = 'https://square.link/u/demo';

function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'A Customer',
    quoteDate: '10 July 2026',
    job: { name: 'Fence', description: 'New fence' },
    materials: [{ name: 'Palings', quantity: 1, unit: 'each', price: 100, totalPrice: 100 }],
    materialsSubtotal: 100,
    laborTotal: 0,
    subtotal: 100,
    markup: 0,
    markupAmount: 0,
    gst: 10,
    total: 110,
    ...over,
  };
}

function invoiceData(over: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    ...quoteData(),
    invoiceNumber: 'INV-001',
    issueDate: '10 July 2026',
    dueDate: '24 July 2026',
    ...over,
  };
}

const stampText = (html: string) => html.match(/pdf-watermark-text">([^<]*)</)?.[1];
const stampSub = (html: string) => html.match(/pdf-watermark-sub">([^<]*)</)?.[1];

describe('PAID stamp', () => {
  it('stamps a settled invoice with PAID and the date the money landed', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ paidAmount: 110, paidDate: '14 September 2026' }),
      business,
    );
    expect(stampText(html)).toBe('PAID');
    expect(stampSub(html)).toBe('Paid 14 September 2026');
  });

  it('uses the paid-in-full green, not the gate watermark red', () => {
    const html = buildInvoicePdfHtml(invoiceData({ paidAmount: 110, paidDate: '14 September 2026' }), business);
    expect(html).toContain('rgba(5, 150, 105, 0.18)');
    expect(html).not.toContain('rgba(220, 38, 38');
  });

  it('leaves the totals on the page beside the stamp', () => {
    const html = buildInvoicePdfHtml(invoiceData({ paidAmount: 110, paidDate: '14 September 2026' }), business);
    expect(html).toContain('Amount Paid');
    expect(html).toContain('$110.00');
  });

  it('drops the live Pay Now link once the invoice is paid', () => {
    const paid = buildInvoicePdfHtml(
      invoiceData({ paidAmount: 110, paidDate: '14 September 2026', plan: 'pro', squarePaymentLinkUrl: squareLink, paymentMethods: { showOnDocuments: true } as any }),
      business,
    );
    expect(paid).not.toContain(squareLink);
    const owing = buildInvoicePdfHtml(
      invoiceData({ paidAmount: 50, plan: 'pro', squarePaymentLinkUrl: squareLink, paymentMethods: { showOnDocuments: true } as any }),
      business,
    );
    expect(owing).toContain(squareLink);
  });

  it('replaces the payment box with a paid-in-full note — a settled invoice never asks to be paid', () => {
    const paid = buildInvoicePdfHtml(
      invoiceData({
        paidAmount: 110,
        paidDate: '14 September 2026',
        plan: 'pro',
        paymentMethods: { showOnDocuments: true, bankTransfer: { enabled: true, accountName: 'Test Trades', bsb: '123-456', accountNumber: '12345678' } } as any,
      }),
      business,
    );
    expect(paid).toContain('Paid in full');
    expect(paid).toContain('Payment received 14 September 2026');
    expect(paid).not.toContain('Payment Information');
    expect(paid).not.toContain('Due Date:');
    expect(paid).not.toContain('with your payment');
    expect(paid).not.toContain('123-456');
  });

  it('does not stamp an unpaid or part-paid invoice — money alone is not the trigger', () => {
    expect(buildInvoicePdfHtml(invoiceData(), business)).not.toContain('pdf-watermark');
    expect(buildInvoicePdfHtml(invoiceData({ paidAmount: 50 }), business)).not.toContain('pdf-watermark');
    // Even a paidAmount equal to the total: the stage decides, via paidDate.
    expect(buildInvoicePdfHtml(invoiceData({ paidAmount: 110 }), business)).not.toContain('pdf-watermark');
  });

  it('never stamps a quote', () => {
    const html = buildQuotePdfHtml(quoteData(), business);
    expect(html).not.toContain('pdf-watermark');
  });

  it('escapes the date text like any other customer-visible string', () => {
    const html = buildInvoicePdfHtml(invoiceData({ paidAmount: 110, paidDate: '<b>x</b>' }), business);
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('gate watermark after the stamp landed', () => {
  it('still renders DRAFT with the gate text on an unpaid invoice', () => {
    const html = buildInvoicePdfHtml(invoiceData(), business, { watermark: 'UPGRADE TO SEND' });
    expect(stampText(html)).toBe('DRAFT');
    expect(stampSub(html)).toBe('UPGRADE TO SEND');
    expect(html).toContain('rgba(220, 38, 38, 0.18)');
  });

  it('still renders DRAFT with the gate text on a quote', () => {
    const html = buildQuotePdfHtml(quoteData(), business, { watermark: 'UPGRADE TO SEND' });
    expect(stampText(html)).toBe('DRAFT');
    expect(stampSub(html)).toBe('UPGRADE TO SEND');
  });

  it('renders one overlay, the stamp, if both are ever asked for', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ paidAmount: 110, paidDate: '14 September 2026' }),
      business,
      { watermark: 'UPGRADE TO SEND' },
    );
    expect(html.split('class="pdf-watermark"').length - 1).toBe(1);
    expect(stampText(html)).toBe('PAID');
  });
});
