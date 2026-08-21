/**
 * Layout de-duplication on the customer's document.
 *
 * Three separate ways the same fact used to print twice: the hardcoded
 * "valid for 30 days" line next to starter T&Cs whose first bullet says the
 * same thing; the invoice's "Payment Information" box restating the amount
 * due that the summary and the payment-methods box already carry; and the
 * accredited badge's licence number repeated as text directly under artwork
 * that has the number baked in.
 */

import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml, buildInvoicePdfHtml } from './htmlBuilders';
import type { QuotePdfData, InvoicePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };

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

describe('quote validity line', () => {
  it('renders once when the quote has no terms', () => {
    const html = buildQuotePdfHtml(quoteData(), business);
    expect(html.split('valid for 30 days').length - 1).toBe(1);
  });

  it('yields to the terms when terms are present — the tradie’s terms are the authority', () => {
    // The starter terms open with their own validity bullet; a hardcoded
    // 30 days alongside custom terms saying 14 would contradict them.
    const html = buildQuotePdfHtml(
      quoteData({ terms: '- This quote is valid for 14 days.\n- Deposit locks in your booking.' }),
      business,
    );
    expect(html).toContain('valid for 14 days');
    expect(html).not.toContain('valid for 30 days');
  });
});

describe('invoice payment box', () => {
  const methods = {
    showOnDocuments: true,
    bankAccount: { enabled: true, accountName: 'Test Trades', bsb: '062-000', accountNumber: '1234' },
  };

  it('merges amount due and due date into the payment-methods box when methods render', () => {
    const html = buildInvoicePdfHtml(invoiceData({ paymentMethods: methods }), business);
    expect(html).not.toContain('Payment Information');
    expect(html).toContain('<h3>Payment</h3>');
    const box = html.slice(html.indexOf('payment-methods-section'));
    expect(box).toContain('Amount Due:');
    expect(box).toContain('24 July 2026');
    expect(box).toContain('Bank Transfer');
  });

  it('keeps the standalone Payment Information box when there are no methods to show', () => {
    const html = buildInvoicePdfHtml(invoiceData(), business);
    expect(html).toContain('Payment Information');
    expect(html).toContain('Amount Due:');
    // The class name alone would match the stylesheet — check the markup.
    expect(html).not.toContain('class="payment-methods-section"');
  });

  it('titles the quote payment box "Payment Methods" — no amount due to merge', () => {
    const html = buildQuotePdfHtml(quoteData({ paymentMethods: methods }), business);
    expect(html).toContain('<h3>Payment Methods</h3>');
  });
});

describe('invoice credits', () => {
  it('renders deposit credit and amount paid with the credit-row class, not an inline colour', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ depositCredit: 30, paidAmount: 20, total: 80 }),
      business,
    );
    expect(html).toContain('class="summary-row credit-row"');
    expect(html).not.toContain('#28a745');
  });
});

describe('accredited badge copy', () => {
  const badge = {
    label: 'ARC Authorisation',
    number: 'AU 065871',
    logoHtml: '<img src="arc.png" class="credential-logo" />',
  };

  it('always prints the licence number, even under badge artwork', () => {
    // label, number and the uploaded logo are independent fields — nothing
    // guarantees the artwork carries the number, and a licence number
    // appearing NOWHERE on the document is far worse than appearing twice.
    for (const template of ['accredited', 'professional'] as const) {
      const html = buildInvoicePdfHtml(invoiceData(), {
        ...business,
        credentials: [badge],
        pdfTemplate: template,
      });
      expect(html).toContain('AU 065871');
    }
  });

  it('keeps label and number for a text-only credential in the showcase', () => {
    const html = buildInvoicePdfHtml(invoiceData(), {
      ...business,
      credentials: [{ label: 'NSW Plumbing Licence', number: 'L123456' }],
      pdfTemplate: 'accredited',
    });
    expect(html).toContain('NSW Plumbing Licence');
    expect(html).toContain('L123456');
  });
});
