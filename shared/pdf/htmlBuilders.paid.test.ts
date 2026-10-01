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
import { invoicePdfPaymentFields } from '../document/recordedDeposit';

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

const stampText = (html: string) => html.match(/paid-stamp-text">([^<]*)</)?.[1];
const stampSub = (html: string) => html.match(/paid-stamp-sub">([^<]*)</)?.[1];
const wmText = (html: string) => html.match(/pdf-watermark-text">([^<]*)</)?.[1];
const wmSub = (html: string) => html.match(/pdf-watermark-sub">([^<]*)</)?.[1];

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

  it('anchors the stamp to the totals box, not the page — a 3-page invoice stamped page 2 while the totals sat on page 3', () => {
    const html = buildInvoicePdfHtml(invoiceData({ paidAmount: 110, paidDate: '14 September 2026' }), business);
    const anchor = html.match(/<div class="paid-stamp-anchor">([\s\S]*?)<div class="paid-stamp">/)?.[1] ?? '';
    expect(anchor).toContain('Amount Paid');
    expect(anchor).toContain('$110.00');
    expect(html).toContain('break-inside: avoid');
    expect(html).not.toContain('position: fixed');
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
    // The note lives inside the unbreakable group with the totals — it was
    // the sole content of page 3 on a real three-page invoice — and the
    // stamp overlays only the totals box, not the note.
    const target = paid.match(/<div class="paid-stamp-target">([\s\S]*?)<div class="payment-box">/)?.[1] ?? '';
    expect(target).toContain('BALANCE DUE');
    expect(target).toContain('paid-stamp-text');
    expect(target).not.toContain('Paid in full');
    const anchorHtml = paid.slice(paid.indexOf('<div class="paid-stamp-anchor">'));
    expect(anchorHtml.indexOf('Paid in full')).toBeGreaterThan(anchorHtml.indexOf('</div>')); // after the target closes
    expect(paid.split('Paid in full').length - 1).toBe(1);
    expect(paid).not.toContain('Payment Information');
    expect(paid).not.toContain('Due Date:');
    expect(paid).not.toContain('with your payment');
    expect(paid).not.toContain('123-456');
  });

  it('does not stamp an unpaid or part-paid invoice — money alone is not the trigger', () => {
    expect(buildInvoicePdfHtml(invoiceData(), business)).not.toContain('paid-stamp');
    expect(buildInvoicePdfHtml(invoiceData({ paidAmount: 50 }), business)).not.toContain('paid-stamp');
    // Even a paidAmount equal to the total: the stage decides, via paidDate.
    expect(buildInvoicePdfHtml(invoiceData({ paidAmount: 110 }), business)).not.toContain('paid-stamp');
  });

  it('never stamps a quote', () => {
    const html = buildQuotePdfHtml(quoteData(), business);
    expect(html).not.toContain('paid-stamp');
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
    expect(wmText(html)).toBe('DRAFT');
    expect(wmSub(html)).toBe('UPGRADE TO SEND');
    expect(html).toContain('rgba(220, 38, 38, 0.18)');
  });

  it('still renders DRAFT with the gate text on a quote', () => {
    const html = buildQuotePdfHtml(quoteData(), business, { watermark: 'UPGRADE TO SEND' });
    expect(wmText(html)).toBe('DRAFT');
    expect(wmSub(html)).toBe('UPGRADE TO SEND');
  });

  it('renders one overlay, the stamp, if both are ever asked for', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ paidAmount: 110, paidDate: '14 September 2026' }),
      business,
      { watermark: 'UPGRADE TO SEND' },
    );
    expect(html).not.toContain('pdf-watermark');
    expect(html.split('class="paid-stamp"').length - 1).toBe(1);
    expect(stampText(html)).toBe('PAID');
  });
});

describe('paid rows — deposit label', () => {
  const rows = (html: string) =>
    [...html.matchAll(/summary-row credit-row">\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
  const balance = (html: string) =>
    html.match(/summary-row balance-due">\s*<span>BALANCE DUE<\/span>\s*<span>([^<]*)</)?.[1];

  it('shows a payment marked as the deposit as "Deposit paid"', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ total: 9850.40, paidAmount: 3000, paidDepositAmount: 3000 }),
      business,
    );
    expect(rows(html)).toEqual(['Deposit paid -$3,000.00']);
    expect(balance(html)).toBe('$6,850.40');
  });

  it('splits a deposit and a later payment into two rows that sum to the paid total', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ total: 9850.40, paidAmount: 5000, paidDepositAmount: 3000 }),
      business,
    );
    expect(rows(html)).toEqual(['Deposit paid -$3,000.00', 'Amount Paid -$2,000.00']);
    expect(balance(html)).toBe('$4,850.40');
  });

  it('keeps the single "Amount Paid" row when nothing is marked as the deposit', () => {
    const html = buildInvoicePdfHtml(invoiceData({ total: 110, paidAmount: 50 }), business);
    expect(rows(html)).toEqual(['Amount Paid -$50.00']);
  });

  it('never shows more deposit than was paid', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ total: 110, paidAmount: 50, paidDepositAmount: 80 }),
      business,
    );
    expect(rows(html)).toEqual(['Deposit paid -$50.00']);
  });
});

// The invoice a quote with a deposit converts into, through the same helper
// both PDF paths use (invoicePdfPaymentFields). The converted invoice keeps
// its full total, so the deposit prints under it as a paid row — never the
// legacy "Deposit already paid" credit as well.
describe('invoice converted from a quote with a deposit', () => {
  const rows = (html: string) =>
    [...html.matchAll(/summary-row credit-row">\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
  const grandTotal = (html: string) =>
    html.match(/summary-row grand-total">\s*<span>([^<]*)<\/span>\s*<span>([^<]*)</)?.slice(1).join(' ');
  const balance = (html: string) =>
    html.match(/summary-row balance-due">\s*<span>BALANCE DUE<\/span>\s*<span>([^<]*)</)?.[1];
  const money = { subtotal: 872.73, gst: 87.27 };

  for (const method of ['square', 'bank'] as const) {
    it(`a ${method} deposit: TOTAL $960 / Deposit paid −$300 / BALANCE DUE $660`, () => {
      const fields = invoicePdfPaymentFields({
        paidTotal: 300,
        payments: [{ id: `deposit-${method}-1`, kind: 'deposit', amount: 300 }],
      });
      const html = buildInvoicePdfHtml(invoiceData({ ...money, total: 960, ...fields }), business);

      expect(grandTotal(html)).toBe('TOTAL $960.00');
      expect(rows(html)).toEqual(['Deposit paid -$300.00']);
      expect(balance(html)).toBe('$660.00');
      expect(html).not.toContain('Deposit already paid');
    });
  }

  it('a later payment on top splits into its own row', () => {
    const fields = invoicePdfPaymentFields({
      paidTotal: 500,
      payments: [
        { id: 'deposit-sq-1', kind: 'deposit', amount: 300 },
        { id: 'p2', kind: 'manual', amount: 200 },
      ],
    });
    const html = buildInvoicePdfHtml(invoiceData({ ...money, total: 960, ...fields }), business);

    expect(rows(html)).toEqual(['Deposit paid -$300.00', 'Amount Paid -$200.00']);
    expect(balance(html)).toBe('$460.00');
  });

  it('a legacy-minted invoice (netted total) renders exactly as before: credit row, BALANCE DUE = total', () => {
    const fields = invoicePdfPaymentFields({
      paidTotal: 300,
      payments: [{ id: 'deposit-credit-q-9', kind: 'deposit', amount: 300 }],
    });
    expect(fields).toEqual({ paidAmount: 0, paidDepositAmount: 0, depositCredit: 300 });

    const html = buildInvoicePdfHtml(invoiceData({ ...money, total: 660, ...fields }), business);
    expect(rows(html)).toEqual(['Deposit already paid -$300.00']);
    expect(grandTotal(html)).toBe('BALANCE DUE $660.00');
    // No second "paid" block taking the same $300 off again.
    expect(balance(html)).toBeUndefined();
    expect(html).not.toContain('Deposit paid');
  });
});
