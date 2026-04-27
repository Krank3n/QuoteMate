/**
 * PDF Template Registry
 * CSS-only template variants for quotes and invoices
 */

import { PdfTemplateId, PdfTemplateInfo } from './types';

export const PDF_TEMPLATES: PdfTemplateInfo[] = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Corporate style with green accents and rounded summary box',
    accentColor: '#059669',
  },
  {
    id: 'clean',
    name: 'Clean & Simple',
    description: 'Editorial minimalism with generous whitespace and refined typography',
    accentColor: '#6B7280',
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Full-bleed dark header, uppercase type and a strong bordered summary card',
    accentColor: '#1F2937',
  },
  {
    id: 'tradesman',
    name: 'Tradesman',
    description: 'Premium letterpress feel with warm paper tone, small-caps and double rules',
    accentColor: '#374151',
  },
];

/** Print media CSS shared across all templates */
export const printMediaCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
  html, body {
    min-height: 100%;
    margin: 0;
  }
  body {
    display: flex;
    flex-direction: column;
  }
  .content-wrapper {
    flex: 1;
  }
  .pdf-footer {
    margin-top: auto;
    padding-top: 20px;
    border-top: 1px solid #e0e0e0;
    font-size: 12px;
    color: #666666;
    text-align: center;
  }
  @page {
    size: A4;
    margin: 40px;
  }
  @media print {
    @page {
      size: A4;
      margin: 40px;
    }
    .header, .info-section, .summary, .section-wrapper, .payment-methods-section, .payment-method {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    h2, h3 {
      page-break-after: avoid;
      break-after: avoid;
      orphans: 3;
      widows: 3;
    }
    .info-section, .summary, .section-wrapper {
      page-break-before: auto;
      break-before: auto;
      margin-top: 20px;
    }
    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    table {
      page-break-before: auto;
      break-before: auto;
      margin-top: 15px;
    }
    table thead {
      display: table-header-group;
    }
    .section-wrapper {
      padding-top: 10px;
      padding-bottom: 10px;
    }
    .section-wrapper::after {
      content: "";
      display: block;
      margin-bottom: 20px;
    }
  }
`;

const professionalCSS = `
  body {
    font-family: 'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding: 40px;
    color: #1a1a1a;
  }
  .section-label {
    background-color: #059669;
    color: white;
    font-size: 13px;
    padding-top: 14px;
    padding-bottom: 6px;
  }
  .header {
    border-bottom: 3px solid #059669;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .logo {
    width: 80px;
    height: 80px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #059669;
    margin: 0 0 10px 0;
  }
  .header p {
    color: #333333;
    margin: 5px 0;
  }
  .info-section {
    margin-bottom: 30px;
  }
  .info-section h2 {
    color: #1a1a1a;
    margin-bottom: 15px;
  }
  .info-section h3 {
    color: #059669;
    margin-bottom: 10px;
  }
  .info-section p {
    color: #333333;
    margin: 5px 0;
  }
  .invoice-details {
    margin-bottom: 20px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  th {
    background-color: #059669;
    color: white;
    padding: 10px;
    text-align: left;
  }
  td {
    padding: 8px;
    border-bottom: 1px solid #e0e0e0;
    color: #333333;
  }
  .total-row {
    font-weight: bold;
    background-color: #f5f5f5;
  }
  .grand-total {
    font-size: 18px;
    color: #059669;
    font-weight: bold;
  }
  .balance-due {
    font-size: 16px;
    color: #dc3545;
    font-weight: bold;
    border-top: 2px solid #dc3545;
    padding-top: 8px;
    margin-top: 8px;
  }
  .summary {
    margin-top: 30px;
    padding: 20px;
    background-color: #f9f9f9;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    color: #333333;
  }
  h3 {
    color: #059669;
    margin-bottom: 10px;
  }
  .section-wrapper {
    margin-bottom: 20px;
  }
  .payment-box {
    margin-top: 30px;
    padding: 20px;
    background-color: #f0f9ff;
    border: 2px solid #059669;
    border-radius: 8px;
  }
  .payment-box h3 {
    margin-top: 0;
  }
  .payment-methods-section {
    margin-top: 30px;
    padding: 20px;
    background-color: #f0f9ff;
    border: 2px solid #059669;
    border-radius: 8px;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 15px;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
  }
  .payment-method {
    flex: 1;
    min-width: 200px;
    padding: 10px;
    background-color: white;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.5;
  }
  .payment-method strong {
    color: #059669;
  }
`;

const cleanCSS = `
  .section-label {
    background-color: transparent;
    color: #6B7280;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 3px;
    padding-top: 18px;
    padding-bottom: 10px;
    border-bottom: 1px solid #111827;
  }
  body {
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, sans-serif;
    padding: 64px 56px;
    color: #111827;
    line-height: 1.65;
    background-color: #FFFFFF;
  }
  .header {
    border-bottom: 1px solid #E5E7EB;
    padding-bottom: 40px;
    margin-bottom: 48px;
  }
  .header-content {
    display: flex;
    align-items: flex-start;
    gap: 28px;
  }
  .logo {
    width: 72px;
    height: 72px;
    object-fit: contain;
    flex-shrink: 0;
    margin-top: 8px;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #111827;
    margin: 0 0 14px 0;
    font-weight: 200;
    font-size: 44px;
    letter-spacing: -0.8px;
    line-height: 1.05;
  }
  .header p {
    color: #6B7280;
    margin: 2px 0;
    font-size: 12px;
    letter-spacing: 0.2px;
  }
  .info-section {
    margin-bottom: 36px;
  }
  .info-section h2 {
    color: #9CA3AF;
    margin-bottom: 18px;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 3px;
    border-bottom: 1px solid #E5E7EB;
    padding-bottom: 12px;
  }
  .info-section h3 {
    color: #111827;
    margin-bottom: 10px;
    padding-left: 0;
    border-left: none;
    font-weight: 600;
    font-size: 18px;
    letter-spacing: -0.2px;
  }
  .info-section p {
    color: #4B5563;
    margin: 4px 0;
    font-size: 14px;
  }
  .invoice-details {
    margin-bottom: 20px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
  }
  th {
    background-color: transparent;
    color: #9CA3AF;
    padding: 16px 10px 12px 10px;
    text-align: left;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    border-bottom: 1px solid #111827;
  }
  td {
    padding: 14px 10px;
    border-bottom: 1px solid #F3F4F6;
    color: #1F2937;
    font-size: 14px;
  }
  .total-row {
    font-weight: 600;
    background-color: transparent;
    border-top: 1px solid #111827;
  }
  .total-row td {
    border-bottom: none;
    padding-top: 18px;
  }
  .grand-total {
    font-size: 24px;
    color: #111827;
    font-weight: 300;
    letter-spacing: -0.4px;
  }
  .balance-due {
    font-size: 16px;
    color: #B91C1C;
    font-weight: 600;
    border-top: 1px solid #B91C1C;
    padding-top: 10px;
    margin-top: 10px;
  }
  .summary {
    margin-top: 40px;
    padding: 32px 0 0 0;
    background-color: transparent;
    border-radius: 0;
    border: none;
    border-top: 1px solid #111827;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    color: #4B5563;
    font-size: 14px;
  }
  h3 {
    color: #111827;
    margin-bottom: 12px;
    padding-left: 0;
    border-left: none;
    font-weight: 600;
    font-size: 17px;
    letter-spacing: -0.2px;
  }
  .section-wrapper {
    margin-bottom: 32px;
  }
  .payment-box {
    margin-top: 40px;
    padding: 28px 32px;
    background-color: #FAFAF9;
    border: none;
    border-left: 2px solid #6B7280;
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
    border-left: none;
    padding-left: 0;
  }
  .payment-methods-section {
    margin-top: 40px;
    padding: 28px 32px;
    background-color: #FAFAF9;
    border: none;
    border-left: 2px solid #6B7280;
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 18px;
    border-left: none;
    padding-left: 0;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
  }
  .payment-method {
    flex: 1;
    min-width: 200px;
    padding: 16px 18px;
    background-color: #FFFFFF;
    border-radius: 0;
    font-size: 13px;
    line-height: 1.6;
    border: 1px solid #E5E7EB;
  }
  .payment-method strong {
    color: #111827;
    font-weight: 600;
  }
`;

const boldCSS = `
  .section-label {
    background-color: #1F2937;
    color: white;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 2px;
    padding-top: 14px;
    padding-bottom: 10px;
    padding-left: 14px;
  }
  body {
    font-family: 'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding: 0;
    color: #111827;
    background-color: #FFFFFF;
  }
  .header {
    background-color: #1F2937;
    padding: 52px 50px 56px 50px;
    margin-bottom: 44px;
    border-bottom: none;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 26px;
  }
  .logo {
    width: 88px;
    height: 88px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: 10px;
    background-color: rgba(255, 255, 255, 0.06);
    padding: 6px;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #FFFFFF;
    margin: 0 0 12px 0;
    font-size: 40px;
    font-weight: 900;
    letter-spacing: -0.5px;
    text-transform: uppercase;
    line-height: 1;
  }
  .header p {
    color: #D1D5DB;
    margin: 3px 0;
    font-size: 13px;
    letter-spacing: 0.3px;
  }
  .info-section {
    margin-bottom: 36px;
    padding: 0 50px;
  }
  .info-section h2 {
    color: #111827;
    margin-bottom: 18px;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    padding-bottom: 10px;
    border-bottom: 3px solid #1F2937;
  }
  .info-section h3 {
    color: #1F2937;
    margin-bottom: 10px;
    font-weight: 800;
    font-size: 17px;
  }
  .info-section p {
    color: #4B5563;
    margin: 5px 0;
    font-size: 14px;
  }
  .invoice-details {
    margin-bottom: 20px;
  }
  table {
    width: calc(100% - 100px);
    margin-left: 50px;
    margin-right: 50px;
    border-collapse: collapse;
    margin-bottom: 24px;
    background-color: #FFFFFF;
  }
  th {
    background-color: #1F2937;
    color: white;
    padding: 14px 12px;
    text-align: left;
    font-weight: 800;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }
  td {
    padding: 12px;
    border-bottom: 1px solid #E5E7EB;
    color: #1F2937;
    font-size: 14px;
  }
  tr:nth-child(even) td {
    background-color: #F9FAFB;
  }
  .total-row {
    font-weight: 800;
    background-color: #111827 !important;
  }
  .total-row td {
    color: #FFFFFF !important;
    background-color: #111827 !important;
    border-bottom: none;
    padding: 16px 12px;
  }
  .grand-total {
    font-size: 22px;
    color: #FFFFFF;
    font-weight: 900;
    letter-spacing: -0.3px;
  }
  .balance-due {
    font-size: 16px;
    color: #FCA5A5;
    font-weight: 800;
    border-top: 2px solid #FCA5A5;
    padding-top: 10px;
    margin-top: 10px;
  }
  .summary {
    margin: 40px 50px 0 50px;
    padding: 28px 32px;
    background-color: #FFFFFF;
    border-radius: 0;
    border: 3px solid #1F2937;
    box-shadow: 0 6px 18px rgba(17, 24, 39, 0.08);
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 10px 0;
    color: #1F2937;
    font-weight: 600;
    font-size: 14px;
    border-bottom: 1px solid #F3F4F6;
  }
  h3 {
    color: #1F2937;
    margin-bottom: 12px;
    font-weight: 800;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }
  .section-wrapper {
    margin-bottom: 28px;
    padding: 0 50px;
  }
  .section-wrapper table {
    width: 100%;
    margin-left: 0;
    margin-right: 0;
  }
  .payment-box {
    margin: 40px 50px 0 50px;
    padding: 28px 32px;
    background-color: #F9FAFB;
    border: none;
    border-top: 6px solid #1F2937;
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
  }
  .payment-methods-section {
    margin: 40px 50px 0 50px;
    padding: 28px 32px;
    background-color: #F9FAFB;
    border: none;
    border-top: 6px solid #1F2937;
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 18px;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
  }
  .payment-method {
    flex: 1;
    min-width: 200px;
    padding: 16px 18px;
    background-color: #FFFFFF;
    border-radius: 0;
    font-size: 13px;
    line-height: 1.6;
    border-left: 4px solid #1F2937;
  }
  .payment-method strong {
    color: #1F2937;
    font-weight: 800;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 1.5px;
  }
`;

const tradesmanCSS = `
  .section-label {
    background-color: transparent;
    color: #1C1917;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 3px;
    padding-top: 16px;
    padding-bottom: 8px;
    border-top: 3px double #374151;
    border-bottom: 1px solid #A8A29E;
    font-variant: small-caps;
  }
  body {
    font-family: Georgia, 'Times New Roman', Times, serif;
    padding: 52px 46px;
    color: #1C1917;
    background-color: #FDFCF8;
    line-height: 1.6;
  }
  .header {
    border-bottom: 3px double #374151;
    padding-bottom: 24px;
    margin-bottom: 32px;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .logo {
    width: 76px;
    height: 76px;
    object-fit: contain;
    flex-shrink: 0;
    border: 1px solid #D6D3D1;
    padding: 4px;
    background-color: #FFFFFF;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #1C1917;
    margin: 0 0 10px 0;
    font-size: 34px;
    font-weight: 700;
    letter-spacing: 1.5px;
    font-variant: small-caps;
    line-height: 1.1;
  }
  .header p {
    color: #44403C;
    margin: 3px 0;
    font-size: 13px;
    font-style: italic;
  }
  .info-section {
    margin-bottom: 28px;
  }
  .info-section h2 {
    color: #1C1917;
    margin-bottom: 14px;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 3px;
    font-weight: 700;
    border-bottom: 1px solid #A8A29E;
    padding-bottom: 10px;
    font-variant: small-caps;
  }
  .info-section h3 {
    color: #1C1917;
    margin-bottom: 10px;
    font-size: 17px;
    font-weight: 700;
    font-style: italic;
  }
  .info-section p {
    color: #44403C;
    margin: 4px 0;
    font-size: 14px;
  }
  .invoice-details {
    margin-bottom: 20px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 22px;
  }
  th {
    background-color: transparent;
    color: #1C1917;
    padding: 12px 8px;
    text-align: left;
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-top: 3px double #374151;
    border-bottom: 3px double #374151;
    font-variant: small-caps;
  }
  td {
    padding: 10px 8px;
    border-bottom: 1px solid #D6D3D1;
    color: #1C1917;
    font-size: 14px;
  }
  .total-row {
    font-weight: 700;
    background-color: transparent;
    border-top: 3px double #374151;
  }
  .total-row td {
    color: #1C1917;
    border-bottom: none;
    padding-top: 14px;
  }
  .grand-total {
    font-size: 22px;
    color: #1C1917;
    font-weight: 700;
    font-variant: small-caps;
    letter-spacing: 1.5px;
  }
  .balance-due {
    font-size: 16px;
    color: #991B1B;
    font-weight: 700;
    border-top: 3px double #991B1B;
    padding-top: 10px;
    margin-top: 10px;
    font-variant: small-caps;
    letter-spacing: 1.5px;
  }
  .summary {
    margin-top: 32px;
    padding: 22px 28px;
    background-color: #FAF7EE;
    border-radius: 0;
    border: none;
    border-top: 3px double #374151;
    border-bottom: 3px double #374151;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 7px 0;
    color: #44403C;
    font-size: 14px;
  }
  h3 {
    color: #1C1917;
    margin-bottom: 10px;
    font-size: 16px;
    font-weight: 700;
    font-style: italic;
  }
  .section-wrapper {
    margin-bottom: 24px;
  }
  .payment-box {
    margin-top: 32px;
    padding: 22px 28px;
    background-color: #FAF7EE;
    border: none;
    border-top: 3px double #374151;
    border-bottom: 3px double #374151;
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
    font-variant: small-caps;
    letter-spacing: 2px;
    font-style: normal;
    font-size: 14px;
    text-transform: uppercase;
  }
  .payment-methods-section {
    margin-top: 32px;
    padding: 22px 28px;
    background-color: #FAF7EE;
    border: none;
    border-top: 3px double #374151;
    border-bottom: 3px double #374151;
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 16px;
    font-variant: small-caps;
    letter-spacing: 2px;
    font-style: normal;
    font-size: 14px;
    text-transform: uppercase;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
  }
  .payment-method {
    flex: 1;
    min-width: 200px;
    padding: 14px 16px;
    background-color: #FFFFFF;
    border-radius: 0;
    font-size: 13px;
    line-height: 1.6;
    border: 1px solid #D6D3D1;
  }
  .payment-method strong {
    color: #1C1917;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 2px;
  }
`;

const templateCSSMap: Record<PdfTemplateId, string> = {
  professional: professionalCSS,
  clean: cleanCSS,
  bold: boldCSS,
  tradesman: tradesmanCSS,
};

/** Map of template ID to its default accent color for brand color replacement */
const templateAccentMap: Record<PdfTemplateId, string> = {
  professional: '#059669',
  clean: '#6B7280',
  bold: '#1F2937',
  tradesman: '#374151',
};

export function getTemplateCSS(templateId: PdfTemplateId, brandColor?: string): string {
  let css = templateCSSMap[templateId] || professionalCSS;
  if (brandColor) {
    const defaultAccent = templateAccentMap[templateId];
    // Replace all occurrences of the template's default accent with the brand color
    css = css.split(defaultAccent).join(brandColor);
  }
  return css;
}

export function getTemplateAccentColor(templateId: PdfTemplateId): string {
  return templateAccentMap[templateId];
}
