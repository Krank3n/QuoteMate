import { describe, it, expect } from 'vitest';
import { buildStatementPdfHtml, STATEMENT_EMPTY_LINE, STATEMENT_FOOTER_NOTE } from './statementHtml';
import { buildStatement, type StatementDocumentInput } from '../statement/buildStatement';
import type { BusinessPdfData } from './types';

const T = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);
const FY = { fromMs: T(2025, 7, 1, 0), toMs: T(2026, 7, 1, 0) };
const GENERATED = T(2026, 9, 15);

const business: BusinessPdfData = {
  businessName: 'Leo Wright Electrical Services',
  abn: '12 345 678 901',
  email: 'leo@example.com',
  logoHtml: '',
};

function inv(over: Partial<StatementDocumentInput> & { id: string }): StatementDocumentInput {
  return {
    number: `IN-${over.id}`,
    type: 'invoice',
    stage: 'invoice_sent',
    customerName: 'Sam <Customer> & Co',
    createdAt: T(2026, 3, 10),
    subtotal: 100,
    gst: 10,
    total: 110,
    paidTotal: 0,
    balanceDue: 110,
    payments: [{ amount: 40, paidAt: T(2026, 3, 12), method: 'bank' }],
    ...over,
  };
}

const docs = [inv({ id: '101' }), inv({ id: '102', stage: 'paid', paidTotal: 110, balanceDue: 0 }), inv({ id: '103' })];

describe('buildStatementPdfHtml', () => {
  it('says "Not registered for GST" and omits the GST column when gstRegistered is false', () => {
    const data = buildStatement(docs, FY, { gstRegistered: false });
    const html = buildStatementPdfHtml(data, business, { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' });
    expect(html).toContain('Not registered for GST');
    expect(html).not.toContain('<th class="num">GST</th>');
    expect(html).not.toContain('GST collected');
  });

  it('shows the GST column and GST collected for a registered business', () => {
    const data = buildStatement(docs, FY, { gstRegistered: true, pricesIncludeGst: true });
    const html = buildStatementPdfHtml(data, business, { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' });
    expect(html).not.toContain('Not registered for GST');
    expect(html).toContain('<th class="num">GST</th>');
    expect(html).toContain('GST collected');
  });

  it('lists every in-range invoice number and escapes the customer name', () => {
    const data = buildStatement(docs, FY, { gstRegistered: true });
    const html = buildStatementPdfHtml(data, business, { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' });
    for (const n of ['IN-101', 'IN-102', 'IN-103']) expect(html).toContain(n);
    expect(html).toContain('Sam &lt;Customer&gt; &amp; Co');
    expect(html).not.toContain('Sam <Customer>');
  });

  it('never uses a fixed-position overlay (multi-page safety) and keeps rows unbroken', () => {
    const data = buildStatement(docs, FY, { gstRegistered: true });
    const html = buildStatementPdfHtml(data, business, { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' });
    expect(html).not.toMatch(/position:\s*fixed/);
    expect(html).toContain('.statement-row { page-break-inside: avoid; break-inside: avoid; }');
  });

  it('renders "None in this period" for both empty tables', () => {
    const data = buildStatement([], FY, { gstRegistered: true });
    const html = buildStatementPdfHtml(data, business, { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' });
    expect(html.split(STATEMENT_EMPTY_LINE)).toHaveLength(3);
    expect(html).not.toContain('<table');
  });

  it('carries the business identity, period, generated date and the footer note', () => {
    const data = buildStatement(docs, FY, { gstRegistered: true });
    const html = buildStatementPdfHtml(data, business, { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' });
    expect(html).toContain('Leo Wright Electrical Services');
    expect(html).toContain('12 345 678 901');
    expect(html).toContain('1 July 2025 – 30 June 2026');
    expect(html).toContain('Generated 15 September 2026');
    expect(html).toContain(STATEMENT_FOOTER_NOTE);
    expect(html).toContain('Bank transfer (3)');
    expect(html).not.toMatch(/QuoteMate|\bAI\b/);
  });

  it('honours the brand colour and template like the other builders', () => {
    const data = buildStatement(docs, FY, { gstRegistered: true });
    const html = buildStatementPdfHtml(
      data,
      { ...business, brandColor: '#123456', pdfTemplate: 'bold' },
      { ...FY, generatedAtMs: GENERATED, timeZone: 'UTC' },
    );
    expect(html).toContain('--accent: #123456;');
  });
});
