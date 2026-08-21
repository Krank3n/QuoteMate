import { buildQuotePdfHtml, buildInvoicePdfHtml } from './htmlBuilders';
import { getTemplateCSS } from './templates';
import type { QuotePdfData, InvoicePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = {
  businessName: 'Test Trades',
  email: 'test@example.com',
  phone: '0400 000 000',
  abn: '12 345 678 901',
  logoHtml: '',
};

function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'Leo Customer',
    quoteDate: '10 July 2026',
    job: { name: 'Fence repair', description: 'Fix the back fence' },
    materials: [
      { name: 'Treated pine sleeper', quantity: 4, unit: 'each', price: 25, totalPrice: 100 },
    ],
    materialsSubtotal: 100,
    laborTotal: 200,
    subtotal: 300,
    markup: 0,
    markupAmount: 0,
    gst: 30,
    total: 330,
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

describe('licence and accreditation header lockup', () => {
  const accreditedBusiness: BusinessPdfData = {
    ...business,
    credentials: [{ label: 'ARC Authorisation', number: 'AU12345' }],
  };

  it('appears inside the quote business header rather than as a page-wide banner', () => {
    const html = buildQuotePdfHtml(quoteData(), accreditedBusiness);
    expect(html).toContain('class="business-credentials"');
    expect(html).toContain('ARC Authorisation');
    expect(html).toContain('AU12345');
    const businessHeader = html.indexOf('class="header-business"');
    const credentials = html.indexOf('class="business-credentials"');
    const documentMeta = html.indexOf('class="header-meta"');
    expect(credentials).toBeGreaterThan(businessHeader);
    expect(credentials).toBeLessThan(documentMeta);
  });

  it('appears on invoice PDFs', () => {
    const html = buildInvoicePdfHtml(invoiceData(), accreditedBusiness);
    expect(html).toContain('class="business-credentials"');
    expect(html).toContain('ARC Authorisation');
    expect(html).toContain('AU12345');
  });
});

describe('buildQuotePdfHtml — GST modes', () => {
  it('exclusive (default): shows ex-GST subtotal and a GST (10%) row, no note', () => {
    const html = buildQuotePdfHtml(quoteData(), business);
    expect(html).toContain('Subtotal (ex GST)');
    expect(html).toContain('GST (10%)');
    expect(html).not.toContain('No GST has been charged.');
  });

  it('inclusive: shows plain Subtotal and an includes-GST disclosure below the total', () => {
    const html = buildQuotePdfHtml(
      quoteData({ pricesIncludeGst: true, gst: 30, total: 330 }),
      business,
    );
    expect(html).toContain('Total includes GST of $30.00');
    expect(html).not.toContain('Subtotal (ex GST)');
    expect(html).not.toContain('No GST has been charged.');
    // Disclosure, not an addend: it must sit BELOW the total line, where the
    // customer cannot read it as one more figure to sum.
    expect(html.indexOf('Total includes GST of')).toBeGreaterThan(html.indexOf('<span>TOTAL</span>'));
    expect(html).not.toContain('<span>GST (10%)</span>');
  });

  it('not registered: no GST row at all and a "No GST has been charged" note', () => {
    const html = buildQuotePdfHtml(
      quoteData({ gstRegistered: false, gst: 0, total: 300 }),
      business,
    );
    expect(html).not.toContain('GST (10%)');
    expect(html).not.toMatch(/includes GST/i);
    expect(html).not.toContain('Subtotal (ex GST)');
    expect(html).toContain('No GST has been charged.');
    // Total is the plain subtotal — no 10% anywhere.
    expect(html).toContain('$300.00');
    expect(html).not.toContain('$330.00');
  });

  it('not registered wins over pricesIncludeGst=true', () => {
    const html = buildQuotePdfHtml(
      quoteData({ gstRegistered: false, pricesIncludeGst: true, gst: 0, total: 300 }),
      business,
    );
    expect(html).not.toMatch(/includes GST/i);
    expect(html).toContain('No GST has been charged.');
  });
});

describe('buildInvoicePdfHtml — GST modes', () => {
  it('is titled "Tax Invoice" only when registered (AU compliance)', () => {
    const registered = buildInvoicePdfHtml(invoiceData(), business);
    const notRegistered = buildInvoicePdfHtml(
      invoiceData({ gstRegistered: false, gst: 0, total: 300 }),
      business,
    );
    expect(registered).toContain('<h2>TAX INVOICE</h2>');
    // A business that isn't registered for GST must not issue a tax invoice.
    expect(notRegistered).not.toMatch(/tax invoice/i);
    expect(notRegistered).toContain('<h2>INVOICE</h2>');
  });

  it('legacy invoices with gstRegistered undefined are treated as registered', () => {
    const legacy = buildInvoicePdfHtml(invoiceData({ gstRegistered: undefined }), business);
    expect(legacy).toContain('<h2>TAX INVOICE</h2>');
  });

  it('not registered: invoice carries the note and no GST row', () => {
    const html = buildInvoicePdfHtml(
      invoiceData({ gstRegistered: false, gst: 0, total: 300 }),
      business,
    );
    expect(html).not.toContain('GST (10%)');
    expect(html).toContain('No GST has been charged.');
  });

  it('registered invoice is unchanged: GST row present, no note', () => {
    const html = buildInvoicePdfHtml(invoiceData(), business);
    expect(html).toContain('GST (10%)');
    expect(html).not.toContain('No GST has been charged.');
  });
});

describe('accredited template — credential placement', () => {
  const credentialed = {
    ...business,
    credentials: [
      {
        label: 'ARC Authorisation',
        number: 'AU 065871',
        logoHtml: '<img src="arc.png" class="credential-logo" />',
      },
    ],
  };

  it('moves the badge into the document-meta column, and only once', () => {
    const html = buildInvoicePdfHtml(invoiceData(), { ...credentialed, pdfTemplate: 'accredited' });
    const meta = html.slice(html.indexOf('<div class="header-meta">'));
    expect(meta).toContain('business-credentials');
    // Exactly one copy of the MARKUP — the left column must not also render
    // it. Counting the bare class name would also match the stylesheet.
    expect(html.split('<div class="business-credentials">').length - 1).toBe(1);
  });

  it('leaves every other template with the badge in the left column', () => {
    const html = buildInvoicePdfHtml(invoiceData(), { ...credentialed, pdfTemplate: 'professional' });
    const meta = html.slice(html.indexOf('<div class="header-meta">'));
    expect(meta).not.toContain('business-credentials');
    expect(html).toContain('business-credentials');
  });

  it('sizes the badge far larger than the inline placement', () => {
    const css = getTemplateCSS('accredited');
    expect(css).toContain('max-height: 96px !important');
    expect(getTemplateCSS('professional')).not.toContain('max-height: 96px !important');
  });
});
