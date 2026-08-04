import { buildQuotePdfHtml, buildInvoicePdfHtml } from './htmlBuilders';
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

  it('inclusive: shows plain Subtotal and an Includes GST disclosure', () => {
    const html = buildQuotePdfHtml(
      quoteData({ pricesIncludeGst: true, gst: 30, total: 330 }),
      business,
    );
    expect(html).toContain('Includes GST');
    expect(html).not.toContain('Subtotal (ex GST)');
    expect(html).not.toContain('No GST has been charged.');
  });

  it('not registered: no GST row at all and a "No GST has been charged" note', () => {
    const html = buildQuotePdfHtml(
      quoteData({ gstRegistered: false, gst: 0, total: 300 }),
      business,
    );
    expect(html).not.toContain('GST (10%)');
    expect(html).not.toContain('Includes GST');
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
    expect(html).not.toContain('Includes GST');
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
