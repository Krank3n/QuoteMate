/**
 * A quote is the tradie's document, going to the tradie's customer. Our name
 * has no business on it — to that customer, software branding on the footer
 * reads as if the job were subcontracted out. The service report has always
 * printed the business name (see reportHtml.test.ts); these pin the same
 * guarantee for quotes and invoices, which used to print "QuoteMate".
 */
import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml, buildInvoicePdfHtml } from './htmlBuilders';
import type { QuotePdfData, InvoicePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = {
  businessName: 'Lucas Painting and Decorating',
  email: 'info@example.com.au',
  phone: '0400 000 000',
  logoHtml: '',
};

const base = {
  customerName: 'A Customer',
  job: { name: 'Repaint', description: 'Full repaint' },
  materials: [{ name: 'Merbau decking', quantity: 1, unit: 'each', price: 100, totalPrice: 100 }],
  materialsSubtotal: 100,
  laborTotal: 0,
  subtotal: 100,
  markup: 0,
  markupAmount: 0,
  gst: 10,
  total: 110,
};

const quote: QuotePdfData = { ...base, quoteDate: '10 July 2026' } as QuotePdfData;
const invoice: InvoicePdfData = {
  ...base,
  quoteDate: '10 July 2026',
  issueDate: '10 July 2026',
  dueDate: '24 July 2026',
} as InvoicePdfData;

describe('customer-facing documents carry the tradie’s name, not ours', () => {
  it('prints the business name in the quote footer', () => {
    const html = buildQuotePdfHtml(quote, business);
    expect(html).toContain('<p>Lucas Painting and Decorating</p>');
  });

  it('never prints QuoteMate anywhere on a quote', () => {
    expect(buildQuotePdfHtml(quote, business)).not.toContain('QuoteMate');
  });

  it('prints the business name in the invoice footer', () => {
    const html = buildInvoicePdfHtml(invoice, business);
    expect(html).toContain('<p>Lucas Painting and Decorating</p>');
  });

  it('never prints QuoteMate anywhere on an invoice', () => {
    expect(buildInvoicePdfHtml(invoice, business)).not.toContain('QuoteMate');
  });

  it('escapes a business name containing markup characters', () => {
    const html = buildQuotePdfHtml(quote, { ...business, businessName: 'Smith & Sons <Painting>' });
    expect(html).toContain('Smith &amp; Sons &lt;Painting&gt;');
  });
});

describe('Australian spelling on customer-facing documents', () => {
  it('labels the labour block "Labour", never "Labor"', () => {
    const html = buildQuotePdfHtml(
      { ...quote, laborTotal: 960, laborHours: 8, laborRate: 120 } as QuotePdfData,
      business,
    );
    expect(html).toContain('Labour');
    expect(html).not.toMatch(/\bLabor\b/);
  });

  it('says "Labour only" when a quote carries no materials', () => {
    const html = buildQuotePdfHtml(
      { ...quote, materials: [], materialsSubtotal: 0 } as QuotePdfData,
      business,
    );
    expect(html).not.toMatch(/\bLabor\b/);
  });
});
