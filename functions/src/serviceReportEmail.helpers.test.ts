import { describe, it, expect } from 'vitest';
import {
  sanitizeReportFilename,
  reportAttachmentFilename,
  fmtAuDate,
  buildReportEmailHtml,
  buildReportPdfData,
} from './serviceReportEmail';
import type { ServiceReport } from './shared/report/types';

const baseReport: ServiceReport = {
  id: 'r1',
  jobId: 'j1',
  userId: 'u1',
  number: 'RP-001',
  visitDate: Date.UTC(2026, 6, 22, 3, 0, 0), // 22 July 2026 (AU)
  serviceType: 'Annual pump service',
  riskAssessment: 'Isolate power before work',
  equipment: ['Multimeter', 'Torque wrench'],
  itemsChecked: [
    { id: 'a', text: 'Pressure tested', checked: true },
    { id: 'b', text: 'Seals replaced', checked: false },
  ],
  natureOfProblem: 'Pump losing prime',
  workCarriedOut: 'Replaced impeller seal',
  recommendedWork: 'Replace pressure switch next visit',
  photos: [
    { id: 'p1', storageUrl: 'https://cdn.example/p1.jpg' },
    { id: 'p2', storageUrl: 'https://cdn.example/p2.jpg' },
  ],
  customerSignature: { svgPath: 'M0 0 L1 1', name: 'Jane Client', signedAt: 1 },
  technicianSignature: { svgPath: 'M2 2 L3 3', name: 'Bob Tradie', signedAt: 2 },
  status: 'draft',
  createdAt: 1,
  updatedAt: 1,
};

const job = {
  customerName: "O'Brien & Sons",
  customerEmail: 'jane@example.com',
  customerPhone: '0400 000 000',
  jobAddress: '12 Smith St, Bendigo VIC',
};

describe('sanitizeReportFilename', () => {
  it('strips punctuation and collapses whitespace', () => {
    expect(sanitizeReportFilename("O'Brien & Sons")).toBe('OBrien_Sons');
  });
  it('caps length at 30 chars', () => {
    expect(sanitizeReportFilename('x'.repeat(50)).length).toBe(30);
  });
});

describe('reportAttachmentFilename', () => {
  it('builds a Service_Report_<num>_<who>.pdf name', () => {
    expect(reportAttachmentFilename('RP-001', 'John Smith')).toBe('Service_Report_RP001_John_Smith.pdf');
  });
  it('falls back to Report/Client when tokens sanitise to empty', () => {
    expect(reportAttachmentFilename('###', '!!!')).toBe('Service_Report_Report_Client.pdf');
  });
});

describe('fmtAuDate', () => {
  it('formats an epoch as an AU long date', () => {
    expect(fmtAuDate(Date.UTC(2026, 6, 22, 3, 0, 0))).toBe('22 July 2026');
  });
});

describe('buildReportEmailHtml', () => {
  const html = buildReportEmailHtml({
    businessName: 'Acme Plumbing',
    customerName: 'Jane Client',
    reportNumber: 'RP-001',
    serviceType: 'Annual pump service',
    visitDate: '22 July 2026',
    emailBody: 'Thanks for having us out today.',
  });

  it('shows the business name', () => {
    expect(html).toContain('Acme Plumbing');
  });
  it('never mentions QuoteMate (customer-facing artifact)', () => {
    expect(html).not.toContain('QuoteMate');
    expect(html.toLowerCase()).not.toContain('quotemate');
  });
  it('never uses the word "AI"', () => {
    // Match a standalone "AI" token, case-insensitive — must not appear.
    expect(/\bAI\b/i.test(html)).toBe(false);
  });
  it('escapes the tradie note and includes report metadata', () => {
    expect(html).toContain('Thanks for having us out today.');
    expect(html).toContain('RP-001');
    expect(html).toContain('22 July 2026');
  });
  it('escapes HTML in the business/customer names', () => {
    const evil = buildReportEmailHtml({
      businessName: '<script>x</script>',
      customerName: 'a & b',
      reportNumber: 'RP-002',
      serviceType: 'Test',
      visitDate: '1 January 2026',
      emailBody: '',
    });
    expect(evil).not.toContain('<script>x</script>');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('a &amp; b');
  });
});

describe('buildReportPdfData', () => {
  const data = buildReportPdfData(baseReport, job);

  it('maps customer identity from the parent job', () => {
    expect(data.customerName).toBe("O'Brien & Sons");
    expect(data.customerEmail).toBe('jane@example.com');
    expect(data.customerPhone).toBe('0400 000 000');
    expect(data.jobAddress).toBe('12 Smith St, Bendigo VIC');
  });

  it('preformats the visit date and carries the report body fields', () => {
    expect(data.visitDate).toBe('22 July 2026');
    expect(data.serviceType).toBe('Annual pump service');
    expect(data.equipment).toEqual(['Multimeter', 'Torque wrench']);
    expect(data.itemsChecked).toEqual([
      { text: 'Pressure tested', checked: true },
      { text: 'Seals replaced', checked: false },
    ]);
    expect(data.natureOfProblem).toBe('Pump losing prime');
    expect(data.workCarriedOut).toBe('Replaced impeller seal');
    expect(data.recommendedWork).toBe('Replace pressure switch next visit');
  });

  it('maps photo storageUrl to the PDF url field', () => {
    expect(data.photos).toEqual([
      { url: 'https://cdn.example/p1.jpg' },
      { url: 'https://cdn.example/p2.jpg' },
    ]);
  });

  it('passes signatures through as {svgPath, name}', () => {
    expect(data.customerSignature).toEqual({ svgPath: 'M0 0 L1 1', name: 'Jane Client' });
    expect(data.technicianSignature).toEqual({ svgPath: 'M2 2 L3 3', name: 'Bob Tradie' });
  });

  it('omits photos when includePhotos is false', () => {
    expect(buildReportPdfData(baseReport, job, false).photos).toBeUndefined();
  });

  it('carries NO money, terms, or Square/payment fields (report ≠ invoice)', () => {
    const keys = Object.keys(data);
    for (const forbidden of [
      'total', 'subtotal', 'gst', 'materials', 'terms', 'termsSnapshot',
      'squarePaymentLinkUrl', 'payNowUrl', 'depositAmount', 'stage',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('falls back to Client when no job is linked', () => {
    const orphan = buildReportPdfData(baseReport, null);
    expect(orphan.customerName).toBe('Client');
    expect(orphan.customerEmail).toBeUndefined();
  });
});
