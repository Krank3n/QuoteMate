/**
 * PDF Template Registry
 * CSS-only template variants for quotes and invoices
 */

import { PdfTemplateId, PdfTemplateInfo } from '../types';

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
    description: 'Minimalist design with lots of whitespace and subtle accents',
    accentColor: '#6B7280',
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Dark header band with heavy visual weight and alternating rows',
    accentColor: '#1F2937',
  },
  {
    id: 'tradesman',
    name: 'Tradesman',
    description: 'Classic no-frills invoice with ruled lines and traditional feel',
    accentColor: '#374151',
  },
];

/** Print media CSS shared across all templates */
export const printMediaCSS = `
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
  @media print {
    @page {
      margin-top: 40px;
      margin-bottom: 40px;
      margin-left: 40px;
      margin-right: 40px;
    }
    .header, .info-section, .summary, .section-wrapper {
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
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
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
    background-color: #F9FAFB;
    color: #374151;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding-top: 14px;
    padding-bottom: 6px;
    border-bottom: 1px solid #E5E7EB;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 50px;
    color: #1f2937;
    line-height: 1.6;
  }
  .header {
    border-bottom: none;
    padding-bottom: 30px;
    margin-bottom: 40px;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .logo {
    width: 70px;
    height: 70px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #1f2937;
    margin: 0 0 8px 0;
    font-weight: 300;
    font-size: 28px;
    letter-spacing: 1px;
  }
  .header p {
    color: #6B7280;
    margin: 3px 0;
    font-size: 13px;
  }
  .info-section {
    margin-bottom: 30px;
  }
  .info-section h2 {
    color: #6B7280;
    margin-bottom: 15px;
    font-weight: 400;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .info-section h3 {
    color: #1f2937;
    margin-bottom: 10px;
    padding-left: 12px;
    border-left: 3px solid #6B7280;
    font-weight: 500;
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
    margin-bottom: 20px;
  }
  th {
    background-color: #F9FAFB;
    color: #6B7280;
    padding: 10px 12px;
    text-align: left;
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid #E5E7EB;
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid #F3F4F6;
    color: #374151;
    font-size: 14px;
  }
  .total-row {
    font-weight: 600;
    background-color: transparent;
    border-top: 2px solid #E5E7EB;
  }
  .total-row td {
    border-bottom: none;
  }
  .grand-total {
    font-size: 18px;
    color: #1f2937;
    font-weight: 600;
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
    padding: 24px;
    background-color: transparent;
    border-radius: 0;
    border: none;
    border-top: 1px solid #E5E7EB;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    color: #4B5563;
    font-size: 14px;
  }
  h3 {
    color: #1f2937;
    margin-bottom: 10px;
    padding-left: 12px;
    border-left: 3px solid #6B7280;
    font-weight: 500;
  }
  .section-wrapper {
    margin-bottom: 20px;
  }
  .payment-box {
    margin-top: 30px;
    padding: 20px;
    background-color: #F9FAFB;
    border: 1px solid #E5E7EB;
    border-radius: 4px;
  }
  .payment-box h3 {
    margin-top: 0;
    border-left: 3px solid #6B7280;
  }
  .payment-methods-section {
    margin-top: 30px;
    padding: 20px;
    background-color: #F9FAFB;
    border: 1px solid #E5E7EB;
    border-radius: 4px;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 15px;
    border-left: 3px solid #6B7280;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .payment-method {
    flex: 1;
    min-width: 200px;
    padding: 12px;
    background-color: white;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.5;
    border: 1px solid #E5E7EB;
  }
  .payment-method strong {
    color: #374151;
  }
`;

const boldCSS = `
  .section-label {
    background-color: #374151;
    color: white;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    padding-top: 14px;
    padding-bottom: 6px;
  }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding: 0;
    color: #1a1a1a;
  }
  .header {
    background-color: #1F2937;
    padding: 30px 40px;
    margin-bottom: 30px;
    border-bottom: none;
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
    border-radius: 8px;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #FFFFFF;
    margin: 0 0 8px 0;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }
  .header p {
    color: #D1D5DB;
    margin: 3px 0;
    font-size: 13px;
  }
  .info-section {
    margin-bottom: 30px;
    padding: 0 40px;
  }
  .info-section h2 {
    color: #1F2937;
    margin-bottom: 15px;
    font-size: 22px;
    font-weight: 800;
  }
  .info-section h3 {
    color: #1F2937;
    margin-bottom: 10px;
    font-weight: 700;
  }
  .info-section p {
    color: #4B5563;
    margin: 5px 0;
  }
  .invoice-details {
    margin-bottom: 20px;
  }
  table {
    width: calc(100% - 80px);
    margin-left: 40px;
    margin-right: 40px;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  th {
    background-color: #1F2937;
    color: white;
    padding: 12px 10px;
    text-align: left;
    font-weight: 700;
    font-size: 13px;
    text-transform: uppercase;
  }
  td {
    padding: 10px;
    border-bottom: 1px solid #E5E7EB;
    color: #374151;
  }
  tr:nth-child(even) {
    background-color: #F9FAFB;
  }
  .total-row {
    font-weight: bold;
    background-color: #F3F4F6 !important;
  }
  .grand-total {
    font-size: 20px;
    color: #1F2937;
    font-weight: 800;
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
    margin: 30px 40px 0 40px;
    padding: 20px;
    background-color: #F3F4F6;
    border-radius: 0;
    border: 2px solid #1F2937;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    color: #374151;
    font-weight: 500;
  }
  h3 {
    color: #1F2937;
    margin-bottom: 10px;
    font-weight: 700;
  }
  .section-wrapper {
    margin-bottom: 20px;
    padding: 0 40px;
  }
  .section-wrapper table {
    width: 100%;
    margin-left: 0;
    margin-right: 0;
  }
  .payment-box {
    margin: 30px 40px 0 40px;
    padding: 20px;
    background-color: #F3F4F6;
    border: 2px solid #1F2937;
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
  }
  .payment-methods-section {
    margin: 30px 40px 0 40px;
    padding: 20px;
    background-color: #F3F4F6;
    border: 2px solid #1F2937;
    border-radius: 0;
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
    border-radius: 0;
    font-size: 13px;
    line-height: 1.5;
    border: 1px solid #D1D5DB;
  }
  .payment-method strong {
    color: #1F2937;
  }
`;

const tradesmanCSS = `
  .section-label {
    background-color: transparent;
    color: #374151;
    font-size: 13px;
    font-weight: bold;
    padding-top: 14px;
    padding-bottom: 6px;
    border-top: 2px solid #374151;
    border-bottom: 1px solid #9CA3AF;
  }
  body {
    font-family: Georgia, 'Times New Roman', Times, serif;
    padding: 40px;
    color: #1a1a1a;
  }
  .header {
    border-bottom: 2px solid #374151;
    padding-bottom: 15px;
    margin-bottom: 25px;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .logo {
    width: 70px;
    height: 70px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #374151;
    margin: 0 0 8px 0;
    font-size: 24px;
    font-weight: bold;
  }
  .header p {
    color: #4B5563;
    margin: 3px 0;
    font-size: 13px;
  }
  .info-section {
    margin-bottom: 25px;
  }
  .info-section h2 {
    color: #374151;
    margin-bottom: 12px;
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid #9CA3AF;
    padding-bottom: 5px;
  }
  .info-section h3 {
    color: #374151;
    margin-bottom: 8px;
    font-size: 15px;
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
    margin-bottom: 20px;
  }
  th {
    background-color: transparent;
    color: #374151;
    padding: 8px 6px;
    text-align: left;
    font-weight: bold;
    font-size: 13px;
    border-top: 2px solid #374151;
    border-bottom: 2px solid #374151;
  }
  td {
    padding: 7px 6px;
    border-bottom: 1px solid #D1D5DB;
    color: #4B5563;
    font-size: 14px;
  }
  .total-row {
    font-weight: bold;
    background-color: transparent;
    border-top: 2px solid #374151;
  }
  .total-row td {
    color: #374151;
    border-bottom: none;
  }
  .grand-total {
    font-size: 18px;
    color: #374151;
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
    margin-top: 25px;
    padding: 15px 0;
    background-color: transparent;
    border-radius: 0;
    border: none;
    border-top: 2px solid #374151;
    border-bottom: 2px solid #374151;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    color: #4B5563;
    font-size: 14px;
  }
  h3 {
    color: #374151;
    margin-bottom: 8px;
    font-size: 15px;
  }
  .section-wrapper {
    margin-bottom: 20px;
  }
  .payment-box {
    margin-top: 25px;
    padding: 15px;
    background-color: transparent;
    border: 1px solid #9CA3AF;
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
  }
  .payment-methods-section {
    margin-top: 25px;
    padding: 15px;
    background-color: transparent;
    border: 1px solid #9CA3AF;
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 12px;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
  }
  .payment-method {
    flex: 1;
    min-width: 200px;
    padding: 10px;
    background-color: transparent;
    border-radius: 0;
    font-size: 13px;
    line-height: 1.5;
    border: 1px solid #D1D5DB;
  }
  .payment-method strong {
    color: #374151;
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
