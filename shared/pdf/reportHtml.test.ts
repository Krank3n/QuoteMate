import { describe, it, expect } from 'vitest';
import { buildReportPdfHtml } from './htmlBuilders';
import type { ReportPdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = {
  businessName: 'Aussie Plumbing Co',
  email: 'jobs@aussieplumbing.com.au',
  phone: '0400 111 222',
  abn: '12 345 678 901',
  logoHtml: '',
};

function reportData(over: Partial<ReportPdfData> = {}): ReportPdfData {
  return {
    reportNumber: 'RP-001',
    customerName: 'Craig Customer',
    visitDate: '22 July 2026',
    serviceType: 'Hot water service',
    equipment: ['Ladder', 'Pipe wrench'],
    itemsChecked: [
      { text: 'Isolation valve operating', checked: true },
      { text: 'Pressure relief valve tested', checked: false },
    ],
    natureOfProblem: 'No hot water at the kitchen tap.',
    workCarriedOut: 'Replaced the faulty thermostat.',
    recommendedWork: '',
    ...over,
  };
}

describe('buildReportPdfHtml', () => {
  it('renders checked and unchecked items differently', () => {
    const html = buildReportPdfHtml(reportData(), business);
    // Checked uses a tick glyph, unchecked an empty box — they must differ.
    expect(html).toContain('&#10003;'); // tick for the checked item
    expect(html).toContain('&#9744;'); // empty box for the unchecked item
    expect(html).toContain('Isolation valve operating');
    expect(html).toContain('Pressure relief valve tested');
  });

  it('omits a narrative block entirely when its text is empty', () => {
    const html = buildReportPdfHtml(reportData({ recommendedWork: '' }), business);
    expect(html).not.toContain('Recommended Work');
    // A populated block is still present.
    expect(html).toContain('Nature of Problem');
    expect(html).toContain('No hot water at the kitchen tap.');
  });

  it('omits a narrative block for whitespace-only text', () => {
    const html = buildReportPdfHtml(reportData({ workCarriedOut: '   \n  ' }), business);
    expect(html).not.toContain('Work Carried Out');
  });

  it('shows the business name in the footer and never "QuoteMate"', () => {
    const html = buildReportPdfHtml(reportData(), business);
    expect(html).toContain('Aussie Plumbing Co');
    expect(html).not.toContain('QuoteMate');
  });

  it('renders a compact accreditation lockup without repeating a logo label', () => {
    const html = buildReportPdfHtml(reportData(), {
      ...business,
      credentials: [
        {
          label: 'ARC Authorisation',
          number: 'AU12345',
          logoHtml: '<img src="data:image/png;base64,AAAA" class="credential-logo" />',
        },
      ],
    });
    expect(html).toContain('class="business-credentials"');
    expect(html).not.toContain('ARC Authorisation');
    expect(html).toContain('AU12345');
    expect(html).toContain('credential-logo');
  });

  it('omits the credential lockup when none are configured', () => {
    const html = buildReportPdfHtml(reportData(), business);
    expect(html).not.toContain('class="business-credentials"');
  });

  it('renders a signature svgPath inline in the output', () => {
    const svgPath = 'M10 10 L20 20 L30 5';
    const html = buildReportPdfHtml(
      reportData({
        customerSignature: { svgPath, name: 'Craig Customer' },
      }),
      business,
    );
    expect(html).toContain(svgPath);
    expect(html).toContain('I am satisfied the above work has been carried out as stated.');
    expect(html).toContain('Craig Customer');
  });

  it('renders photos from dataUri or url', () => {
    const html = buildReportPdfHtml(
      reportData({
        photos: [{ url: 'https://example.com/a.jpg' }, { dataUri: 'data:image/png;base64,AAAA' }],
      }),
      business,
    );
    expect(html).toContain('https://example.com/a.jpg');
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  // Regression: the signature viewBox must match the pad the ink was drawn
  // on. A hardcoded 300×150 clipped the bottom of every signature captured
  // on the real pad (~360×180).
  it('uses the captured pad dimensions as the signature viewBox', () => {
    const html = buildReportPdfHtml(
      reportData({
        customerSignature: {
          svgPath: 'M10 10 L200 170',
          name: 'Craig Customer',
          width: 384,
          height: 180,
        },
      }),
      business,
    );
    expect(html).toContain('viewBox="0 0 384 180"');
  });

  it('falls back to a 300x150 viewBox for legacy captures without dimensions', () => {
    const html = buildReportPdfHtml(
      reportData({
        customerSignature: { svgPath: 'M10 10 L20 20', name: 'Craig Customer' },
      }),
      business,
    );
    expect(html).toContain('viewBox="0 0 300 150"');
  });

  // Regression: an unsigned party must not render as a heading over blank
  // space — it reads as "forgot to fill this in" on a customer document.
  it('omits the block for a party who has not signed', () => {
    const html = buildReportPdfHtml(
      reportData({
        technicianSignature: { svgPath: 'M 10 80 L 60 20 L 110 90', name: 'Jess Tech' },
        customerSignature: undefined,
      }),
      business,
    );
    expect(html).toContain('Technician');
    expect(html).toContain('Jess Tech');
    expect(html).not.toContain('report-signature-label">Customer<');
  });

  // Regression: an accidental tap on the pad captured `M x y` (no line-to)
  // — invisible ink that rendered an empty "signed" block plus the
  // satisfaction statement on the customer PDF.
  it('treats a tap-only path as unsigned — no block, no statement', () => {
    const html = buildReportPdfHtml(
      reportData({
        customerSignature: { svgPath: 'M 224 92', name: '.' },
      }),
      business,
    );
    expect(html).not.toContain('class="report-signature-label"');
    expect(html).not.toContain('I am satisfied the above work');
  });

  // Regression: the exact ghost path from RP-001 in production — a tap with
  // a micro-twitch captures a ZERO-LENGTH line-to, which defeats any
  // structural "contains an L" check. Only measured ink length catches it.
  it('treats a zero-length line-to as unsigned (RP-001 ghost)', () => {
    const html = buildReportPdfHtml(
      reportData({
        customerSignature: {
          svgPath: 'M 400 57.0625 L 400 57.0625 M 369 86.0625',
          name: '',
          width: 798,
          height: 178,
        },
      }),
      business,
    );
    expect(html).not.toContain('class="report-signature-label"');
    expect(html).not.toContain('I am satisfied the above work');
  });

  it('omits the name row when the signer name is blank', () => {
    const html = buildReportPdfHtml(
      reportData({
        technicianSignature: { svgPath: 'M 1 1 L 50 20', name: '' },
      }),
      business,
    );
    expect(html).toContain('report-signature-label">Technician<');
    expect(html).not.toContain('class="report-signature-name"');
  });
});
