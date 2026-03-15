/**
 * Server-side PDF Generator
 * Generates quote PDF HTML and renders to PDF buffer via Puppeteer
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// ---- Currency formatting (mirrors client-side formatCurrency) ----

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);
}

// ---- Types ----

interface Material {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  totalPrice: number;
  section?: string;
}

interface QuotePdfData {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  quoteNumber?: string;
  quoteDate: string; // ISO date string
  job: { name: string; description: string };
  materials: Material[];
  materialsSubtotal: number;
  laborHours?: number;
  laborRate?: number;
  laborTotal: number;
  subtotal: number;
  markup: number;
  markupAmount: number;
  travelAdjustment?: number;
  gst: number;
  total: number;
  notes?: string;
  showLaborHours?: boolean;
  groupMaterialsBySection?: boolean;
  paymentMethods?: any;
}

type PdfTemplateId = 'professional' | 'clean' | 'bold' | 'tradesman';

interface BusinessPdfData {
  businessName: string;
  email?: string;
  phone?: string;
  abn?: string;
  logoUrl?: string;
  brandColor?: string;
  pdfTemplate?: PdfTemplateId;
}

// ---- Materials HTML ----

function generateMaterialsHTML(materials: Material[], groupBySection: boolean, materialsSubtotal: number): string {
  if (materials.length === 0) {
    return `<p style="color: #666666; font-style: italic; margin: 10px 0;">No materials required - Labor only</p>`;
  }

  const tableHeader = `
    <thead>
      <tr>
        <th>Item</th>
        <th>Quantity</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>`;

  const materialRow = (m: Material) => `
    <tr>
      <td>${m.name}</td>
      <td>${m.quantity} ${m.unit}</td>
      <td>${formatCurrency(m.price)}</td>
      <td>${formatCurrency(m.totalPrice)}</td>
    </tr>`;

  const hasSections = groupBySection && materials.some(m => m.section);

  if (!hasSections) {
    return `
      <table>
        ${tableHeader}
        <tbody>
          ${materials.map(materialRow).join('')}
          <tr class="total-row">
            <td colspan="3">Materials Subtotal</td>
            <td>${formatCurrency(materialsSubtotal)}</td>
          </tr>
        </tbody>
      </table>`;
  }

  const grouped = new Map<string, Material[]>();
  materials.forEach(m => {
    const key = m.section || '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  });

  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (a !== '' && b === '') return -1;
    return a.localeCompare(b);
  });

  let html = '';
  sortedKeys.forEach(key => {
    const sectionMaterials = grouped.get(key)!;
    const sectionTotal = sectionMaterials.reduce((sum, m) => sum + m.totalPrice, 0);
    const sectionName = key || 'Other';

    html += `
      <table>
        <thead>
          <tr>
            <th colspan="4" class="section-label">${sectionName}</th>
          </tr>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${sectionMaterials.map(materialRow).join('')}
          <tr class="total-row">
            <td colspan="3">${sectionName} Subtotal</td>
            <td>${formatCurrency(sectionTotal)}</td>
          </tr>
        </tbody>
      </table>`;
  });

  html += `
    <table>
      <tbody>
        <tr class="total-row">
          <td colspan="3"><strong>All Materials Subtotal</strong></td>
          <td><strong>${formatCurrency(materialsSubtotal)}</strong></td>
        </tr>
      </tbody>
    </table>`;

  return html;
}

// ---- Payment Methods HTML ----

function generatePaymentMethodsHTML(pm: any): string {
  if (!pm?.showOnDocuments) return '';

  const sections: string[] = [];

  const bankHasData = pm.bankAccount?.accountName || pm.bankAccount?.bsb || pm.bankAccount?.accountNumber;
  if (pm.bankAccount?.enabled && bankHasData) {
    sections.push(`
      <div class="payment-method">
        <strong>Bank Transfer</strong><br>
        ${pm.bankAccount.accountName ? `Account Name: ${pm.bankAccount.accountName}<br>` : ''}
        ${pm.bankAccount.bsb ? `BSB: ${pm.bankAccount.bsb}<br>` : ''}
        ${pm.bankAccount.accountNumber ? `Account: ${pm.bankAccount.accountNumber}` : ''}
      </div>
    `);
  }

  if (pm.payId?.enabled && pm.payId?.payIdValue) {
    const payIdLabel = pm.payId.payIdType === 'phone' ? 'Phone' :
                       pm.payId.payIdType === 'email' ? 'Email' : 'ABN';
    sections.push(`
      <div class="payment-method">
        <strong>PayID</strong><br>
        ${payIdLabel}: ${pm.payId.payIdValue}
      </div>
    `);
  }

  const bpayHasData = pm.bpay?.billerCode || pm.bpay?.referenceNumber;
  if (pm.bpay?.enabled && bpayHasData) {
    sections.push(`
      <div class="payment-method">
        <strong>BPAY</strong><br>
        ${pm.bpay.billerCode ? `Biller Code: ${pm.bpay.billerCode}<br>` : ''}
        ${pm.bpay.referenceNumber ? `Reference: ${pm.bpay.referenceNumber}` : ''}
      </div>
    `);
  }

  if (pm.paypal?.enabled && pm.paypal?.email) {
    sections.push(`
      <div class="payment-method">
        <strong>PayPal</strong><br>
        ${pm.paypal.email}
      </div>
    `);
  }

  if (pm.other?.enabled && pm.other?.instructions) {
    sections.push(`
      <div class="payment-method">
        <strong>Other Payment Options</strong><br>
        ${pm.other.instructions.replace(/\n/g, '<br>')}
      </div>
    `);
  }

  if (sections.length === 0) return '';

  return `
    <div class="payment-methods-section">
      <h3>Payment Methods</h3>
      <div class="payment-methods-grid">
        ${sections.join('')}
      </div>
    </div>
  `;
}

// ---- Template CSS system (mirrors client-side pdfTemplates.ts) ----

const printMediaCSS = `
  html, body { min-height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; }
  .content-wrapper { flex: 1; }
  .pdf-footer { margin-top: auto; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666666; text-align: center; }
  @media print {
    @page { margin: 40px; }
    .header, .info-section, .summary, .section-wrapper { page-break-inside: avoid; break-inside: avoid; }
    h2, h3 { page-break-after: avoid; break-after: avoid; orphans: 3; widows: 3; }
    .info-section, .summary, .section-wrapper { page-break-before: auto; break-before: auto; margin-top: 20px; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    table { page-break-before: auto; break-before: auto; margin-top: 15px; }
    table thead { display: table-header-group; }
    .section-wrapper { padding-top: 10px; padding-bottom: 10px; }
    .section-wrapper::after { content: ""; display: block; margin-bottom: 20px; }
  }
`;

const professionalCSS = `
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #1a1a1a; }
  .section-label { background-color: #059669; color: white; font-size: 13px; padding-top: 14px; padding-bottom: 6px; }
  .header { border-bottom: 3px solid #059669; padding-bottom: 20px; margin-bottom: 30px; }
  .header-content { display: flex; align-items: center; gap: 20px; }
  .logo { width: 80px; height: 80px; object-fit: contain; flex-shrink: 0; }
  .header-text { flex: 1; }
  .header h1 { color: #059669; margin: 0 0 10px 0; }
  .header p { color: #333333; margin: 5px 0; }
  .info-section { margin-bottom: 30px; }
  .info-section h2 { color: #1a1a1a; margin-bottom: 15px; }
  .info-section h3 { color: #059669; margin-bottom: 10px; }
  .info-section p { color: #333333; margin: 5px 0; }
  .invoice-details { margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background-color: #059669; color: white; padding: 10px; text-align: left; }
  td { padding: 8px; border-bottom: 1px solid #e0e0e0; color: #333333; }
  .total-row { font-weight: bold; background-color: #f5f5f5; }
  .grand-total { font-size: 18px; color: #059669; font-weight: bold; }
  .balance-due { font-size: 16px; color: #dc3545; font-weight: bold; border-top: 2px solid #dc3545; padding-top: 8px; margin-top: 8px; }
  .summary { margin-top: 30px; padding: 20px; background-color: #f9f9f9; border-radius: 8px; border: 1px solid #e0e0e0; }
  .summary-row { display: flex; justify-content: space-between; padding: 8px 0; color: #333333; }
  h3 { color: #059669; margin-bottom: 10px; }
  .section-wrapper { margin-bottom: 20px; }
  .payment-box { margin-top: 30px; padding: 20px; background-color: #f0f9ff; border: 2px solid #059669; border-radius: 8px; }
  .payment-box h3 { margin-top: 0; }
  .payment-methods-section { margin-top: 30px; padding: 20px; background-color: #f0f9ff; border: 2px solid #059669; border-radius: 8px; }
  .payment-methods-section h3 { margin-top: 0; margin-bottom: 15px; }
  .payment-methods-grid { display: flex; flex-wrap: wrap; gap: 20px; }
  .payment-method { flex: 1; min-width: 200px; padding: 10px; background-color: white; border-radius: 4px; font-size: 13px; line-height: 1.5; }
  .payment-method strong { color: #059669; }
`;

const cleanCSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 50px; color: #1f2937; line-height: 1.6; }
  .section-label { background-color: #F9FAFB; color: #374151; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; padding-top: 14px; padding-bottom: 6px; border-bottom: 1px solid #E5E7EB; }
  .header { border-bottom: none; padding-bottom: 30px; margin-bottom: 40px; }
  .header-content { display: flex; align-items: center; gap: 20px; }
  .logo { width: 70px; height: 70px; object-fit: contain; flex-shrink: 0; }
  .header-text { flex: 1; }
  .header h1 { color: #1f2937; margin: 0 0 8px 0; font-weight: 300; font-size: 28px; letter-spacing: 1px; }
  .header p { color: #6B7280; margin: 3px 0; font-size: 13px; }
  .info-section { margin-bottom: 30px; }
  .info-section h2 { color: #6B7280; margin-bottom: 15px; font-weight: 400; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; }
  .info-section h3 { color: #1f2937; margin-bottom: 10px; padding-left: 12px; border-left: 3px solid #6B7280; font-weight: 500; }
  .info-section p { color: #4B5563; margin: 4px 0; font-size: 14px; }
  .invoice-details { margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background-color: #F9FAFB; color: #6B7280; padding: 10px 12px; text-align: left; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #E5E7EB; }
  td { padding: 10px 12px; border-bottom: 1px solid #F3F4F6; color: #374151; font-size: 14px; }
  .total-row { font-weight: 600; background-color: transparent; border-top: 2px solid #E5E7EB; }
  .total-row td { border-bottom: none; }
  .grand-total { font-size: 18px; color: #1f2937; font-weight: 600; }
  .balance-due { font-size: 16px; color: #dc3545; font-weight: bold; border-top: 2px solid #dc3545; padding-top: 8px; margin-top: 8px; }
  .summary { margin-top: 30px; padding: 24px; background-color: transparent; border-radius: 0; border: none; border-top: 1px solid #E5E7EB; }
  .summary-row { display: flex; justify-content: space-between; padding: 6px 0; color: #4B5563; font-size: 14px; }
  h3 { color: #1f2937; margin-bottom: 10px; padding-left: 12px; border-left: 3px solid #6B7280; font-weight: 500; }
  .section-wrapper { margin-bottom: 20px; }
  .payment-box { margin-top: 30px; padding: 20px; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 4px; }
  .payment-box h3 { margin-top: 0; border-left: 3px solid #6B7280; }
  .payment-methods-section { margin-top: 30px; padding: 20px; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 4px; }
  .payment-methods-section h3 { margin-top: 0; margin-bottom: 15px; border-left: 3px solid #6B7280; }
  .payment-methods-grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .payment-method { flex: 1; min-width: 200px; padding: 12px; background-color: white; border-radius: 4px; font-size: 13px; line-height: 1.5; border: 1px solid #E5E7EB; }
  .payment-method strong { color: #374151; }
`;

const boldCSS = `
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 0; color: #1a1a1a; }
  .section-label { background-color: #374151; color: white; font-size: 13px; font-weight: 800; text-transform: uppercase; padding-top: 14px; padding-bottom: 6px; }
  .header { background-color: #1F2937; padding: 30px 40px; margin-bottom: 30px; border-bottom: none; }
  .header-content { display: flex; align-items: center; gap: 20px; }
  .logo { width: 80px; height: 80px; object-fit: contain; flex-shrink: 0; border-radius: 8px; }
  .header-text { flex: 1; }
  .header h1 { color: #FFFFFF; margin: 0 0 8px 0; font-size: 30px; font-weight: 800; letter-spacing: 0.5px; }
  .header p { color: #D1D5DB; margin: 3px 0; font-size: 13px; }
  .info-section { margin-bottom: 30px; padding: 0 40px; }
  .info-section h2 { color: #1F2937; margin-bottom: 15px; font-size: 22px; font-weight: 800; }
  .info-section h3 { color: #1F2937; margin-bottom: 10px; font-weight: 700; }
  .info-section p { color: #4B5563; margin: 5px 0; }
  .invoice-details { margin-bottom: 20px; }
  table { width: calc(100% - 80px); margin-left: 40px; margin-right: 40px; border-collapse: collapse; margin-bottom: 20px; }
  th { background-color: #1F2937; color: white; padding: 12px 10px; text-align: left; font-weight: 700; font-size: 13px; text-transform: uppercase; }
  td { padding: 10px; border-bottom: 1px solid #E5E7EB; color: #374151; }
  tr:nth-child(even) { background-color: #F9FAFB; }
  .total-row { font-weight: bold; background-color: #F3F4F6 !important; }
  .grand-total { font-size: 20px; color: #1F2937; font-weight: 800; }
  .balance-due { font-size: 16px; color: #dc3545; font-weight: bold; border-top: 2px solid #dc3545; padding-top: 8px; margin-top: 8px; }
  .summary { margin: 30px 40px 0 40px; padding: 20px; background-color: #F3F4F6; border-radius: 0; border: 2px solid #1F2937; }
  .summary-row { display: flex; justify-content: space-between; padding: 8px 0; color: #374151; font-weight: 500; }
  h3 { color: #1F2937; margin-bottom: 10px; font-weight: 700; }
  .section-wrapper { margin-bottom: 20px; padding: 0 40px; }
  .section-wrapper table { width: 100%; margin-left: 0; margin-right: 0; }
  .payment-box { margin: 30px 40px 0 40px; padding: 20px; background-color: #F3F4F6; border: 2px solid #1F2937; border-radius: 0; }
  .payment-box h3 { margin-top: 0; }
  .payment-methods-section { margin: 30px 40px 0 40px; padding: 20px; background-color: #F3F4F6; border: 2px solid #1F2937; border-radius: 0; }
  .payment-methods-section h3 { margin-top: 0; margin-bottom: 15px; }
  .payment-methods-grid { display: flex; flex-wrap: wrap; gap: 20px; }
  .payment-method { flex: 1; min-width: 200px; padding: 10px; background-color: white; border-radius: 0; font-size: 13px; line-height: 1.5; border: 1px solid #D1D5DB; }
  .payment-method strong { color: #1F2937; }
`;

const tradesmanCSS = `
  body { font-family: Georgia, 'Times New Roman', Times, serif; padding: 40px; color: #1a1a1a; }
  .section-label { background-color: transparent; color: #374151; font-size: 13px; font-weight: bold; padding-top: 14px; padding-bottom: 6px; border-top: 2px solid #374151; border-bottom: 1px solid #9CA3AF; }
  .header { border-bottom: 2px solid #374151; padding-bottom: 15px; margin-bottom: 25px; }
  .header-content { display: flex; align-items: center; gap: 20px; }
  .logo { width: 70px; height: 70px; object-fit: contain; flex-shrink: 0; }
  .header-text { flex: 1; }
  .header h1 { color: #374151; margin: 0 0 8px 0; font-size: 24px; font-weight: bold; }
  .header p { color: #4B5563; margin: 3px 0; font-size: 13px; }
  .info-section { margin-bottom: 25px; }
  .info-section h2 { color: #374151; margin-bottom: 12px; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #9CA3AF; padding-bottom: 5px; }
  .info-section h3 { color: #374151; margin-bottom: 8px; font-size: 15px; }
  .info-section p { color: #4B5563; margin: 4px 0; font-size: 14px; }
  .invoice-details { margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background-color: transparent; color: #374151; padding: 8px 6px; text-align: left; font-weight: bold; font-size: 13px; border-top: 2px solid #374151; border-bottom: 2px solid #374151; }
  td { padding: 7px 6px; border-bottom: 1px solid #D1D5DB; color: #4B5563; font-size: 14px; }
  .total-row { font-weight: bold; background-color: transparent; border-top: 2px solid #374151; }
  .total-row td { color: #374151; border-bottom: none; }
  .grand-total { font-size: 18px; color: #374151; font-weight: bold; }
  .balance-due { font-size: 16px; color: #dc3545; font-weight: bold; border-top: 2px solid #dc3545; padding-top: 8px; margin-top: 8px; }
  .summary { margin-top: 25px; padding: 15px 0; background-color: transparent; border-radius: 0; border: none; border-top: 2px solid #374151; border-bottom: 2px solid #374151; }
  .summary-row { display: flex; justify-content: space-between; padding: 5px 0; color: #4B5563; font-size: 14px; }
  h3 { color: #374151; margin-bottom: 8px; font-size: 15px; }
  .section-wrapper { margin-bottom: 20px; }
  .payment-box { margin-top: 25px; padding: 15px; background-color: transparent; border: 1px solid #9CA3AF; border-radius: 0; }
  .payment-box h3 { margin-top: 0; }
  .payment-methods-section { margin-top: 25px; padding: 15px; background-color: transparent; border: 1px solid #9CA3AF; border-radius: 0; }
  .payment-methods-section h3 { margin-top: 0; margin-bottom: 12px; }
  .payment-methods-grid { display: flex; flex-wrap: wrap; gap: 15px; }
  .payment-method { flex: 1; min-width: 200px; padding: 10px; background-color: transparent; border-radius: 0; font-size: 13px; line-height: 1.5; border: 1px solid #D1D5DB; }
  .payment-method strong { color: #374151; }
`;

const templateCSSMap: Record<PdfTemplateId, string> = {
  professional: professionalCSS,
  clean: cleanCSS,
  bold: boldCSS,
  tradesman: tradesmanCSS,
};

const templateAccentMap: Record<PdfTemplateId, string> = {
  professional: '#059669',
  clean: '#6B7280',
  bold: '#1F2937',
  tradesman: '#374151',
};

function getTemplateCSS(templateId: PdfTemplateId, brandColor?: string): string {
  let css = templateCSSMap[templateId] || professionalCSS;
  if (brandColor) {
    const defaultAccent = templateAccentMap[templateId];
    css = css.split(defaultAccent).join(brandColor);
  }
  return css;
}

// ---- Build full quote PDF HTML ----

export function buildQuotePdfHtml(quote: QuotePdfData, business: BusinessPdfData): string {
  const quoteDate = new Date(quote.quoteDate);
  const dateStr = quoteDate.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });

  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';

  const logoHtml = business.logoUrl
    ? `<img src="${business.logoUrl}" alt="${business.businessName}" class="logo" />`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, business.brandColor)}
      </style>
    </head>
    <body>
      <div class="content-wrapper">
      <div class="header">
        <div class="header-content">
          ${logoHtml}
          <div class="header-text">
            <h1>${business.businessName}</h1>
            <p>
              ${business.abn ? `ABN: ${business.abn}<br>` : ''}
              ${business.email ? `Email: ${business.email}<br>` : ''}
              ${business.phone ? `Phone: ${business.phone}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div class="info-section">
        <h2>QUOTATION</h2>
        ${quote.quoteNumber ? `<p><strong>Quote #:</strong> ${quote.quoteNumber}</p>` : ''}
        <p><strong>Quote Date:</strong> ${dateStr}</p>
        <p><strong>Customer:</strong> ${quote.customerName}</p>
        ${quote.customerEmail ? `<p><strong>Email:</strong> ${quote.customerEmail}</p>` : ''}
        ${quote.customerPhone ? `<p><strong>Phone:</strong> ${quote.customerPhone}</p>` : ''}
        ${quote.jobAddress ? `<p><strong>Job Address:</strong> ${quote.jobAddress}</p>` : ''}
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${quote.job.name}</strong></p>
        <p>${quote.job.description}</p>
      </div>

      <div class="section-wrapper">
        <h3>Materials</h3>
        ${generateMaterialsHTML(quote.materials, quote.groupMaterialsBySection === true, quote.materialsSubtotal)}
      </div>

      <div class="section-wrapper">
        <h3>Labor</h3>
        <table>
          <tbody>
            <tr>
              <td>${quote.showLaborHours && quote.laborHours && quote.laborRate ? `Labor (${quote.laborHours} hours @ ${formatCurrency(quote.laborRate)}/hr)` : 'Labor'}</td>
              <td style="text-align: right;">${formatCurrency(quote.laborTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="summary">
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(quote.materialsSubtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Labor</span>
          <span>${formatCurrency(quote.laborTotal)}</span>
        </div>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatCurrency(quote.subtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Markup (${quote.markup}%)</span>
          <span>${formatCurrency(quote.markupAmount)}</span>
        </div>
        ${quote.travelAdjustment && quote.travelAdjustment > 0 ? `
        <div class="summary-row">
          <span>Travel Adjustment (${quote.travelAdjustment}%)</span>
          <span>${formatCurrency(quote.subtotal * (quote.travelAdjustment / 100))}</span>
        </div>
        ` : ''}
        <div class="summary-row">
          <span>GST (10%)</span>
          <span>${formatCurrency(quote.gst)}</span>
        </div>
        <hr>
        <div class="summary-row grand-total">
          <span>TOTAL</span>
          <span>${formatCurrency(quote.total)}</span>
        </div>
      </div>

      ${quote.notes ? `<div class="info-section"><h3>Notes</h3><p>${quote.notes}</p></div>` : ''}

      ${generatePaymentMethodsHTML(quote.paymentMethods)}

      <div style="margin-top: 40px; font-size: 12px; color: #666666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
      </div>
      </div>

      <div class="pdf-footer">
        <p>Powered by QuoteMate | quotemateapp.au</p>
      </div>
    </body>
    </html>
  `;
}

// ---- Build full invoice PDF HTML ----

interface InvoicePdfData extends QuotePdfData {
  invoiceNumber?: string;
  issueDate: string;
  dueDate: string;
  paymentTerms?: string;
  paidAmount?: number;
}

export function buildInvoicePdfHtml(invoice: InvoicePdfData, business: BusinessPdfData): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
  const issueDate = new Date(invoice.issueDate);
  const issueDateStr = issueDate.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
  const dueDate = new Date(invoice.dueDate);
  const dueDateStr = dueDate.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });

  const logoHtml = business.logoUrl
    ? `<img src="${business.logoUrl}" alt="${business.businessName}" class="logo" />`
    : '';

  const paidAmount = invoice.paidAmount || 0;
  const amountDue = invoice.total - paidAmount;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, business.brandColor)}
      </style>
    </head>
    <body>
      <div class="content-wrapper">
      <div class="header">
        <div class="header-content">
          ${logoHtml}
          <div class="header-text">
            <h1>${business.businessName}</h1>
            <p>
              ${business.abn ? `ABN: ${business.abn}<br>` : ''}
              ${business.email ? `Email: ${business.email}<br>` : ''}
              ${business.phone ? `Phone: ${business.phone}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div class="info-section">
        <h2>INVOICE</h2>
        ${invoice.invoiceNumber ? `<p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>` : ''}
        <p><strong>Issue Date:</strong> ${issueDateStr}</p>
        <p><strong>Due Date:</strong> ${dueDateStr}</p>
        ${invoice.paymentTerms ? `<p><strong>Payment Terms:</strong> ${invoice.paymentTerms}</p>` : ''}
        <p><strong>Customer:</strong> ${invoice.customerName}</p>
        ${invoice.customerEmail ? `<p><strong>Email:</strong> ${invoice.customerEmail}</p>` : ''}
        ${invoice.customerPhone ? `<p><strong>Phone:</strong> ${invoice.customerPhone}</p>` : ''}
        ${invoice.jobAddress ? `<p><strong>Job Address:</strong> ${invoice.jobAddress}</p>` : ''}
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${invoice.job.name}</strong></p>
        <p>${invoice.job.description}</p>
      </div>

      <div class="section-wrapper">
        <h3>Materials</h3>
        ${generateMaterialsHTML(invoice.materials, invoice.groupMaterialsBySection === true, invoice.materialsSubtotal)}
      </div>

      <div class="section-wrapper">
        <h3>Labor</h3>
        <table>
          <tbody>
            <tr>
              <td>${invoice.showLaborHours && invoice.laborHours && invoice.laborRate ? `Labor (${invoice.laborHours} hours @ ${formatCurrency(invoice.laborRate)}/hr)` : 'Labor'}</td>
              <td style="text-align: right;">${formatCurrency(invoice.laborTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="summary">
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(invoice.materialsSubtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Labor</span>
          <span>${formatCurrency(invoice.laborTotal)}</span>
        </div>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatCurrency(invoice.subtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Markup (${invoice.markup}%)</span>
          <span>${formatCurrency(invoice.markupAmount)}</span>
        </div>
        ${invoice.travelAdjustment && invoice.travelAdjustment > 0 ? `
        <div class="summary-row">
          <span>Travel Adjustment (${invoice.travelAdjustment}%)</span>
          <span>${formatCurrency(invoice.subtotal * (invoice.travelAdjustment / 100))}</span>
        </div>
        ` : ''}
        <div class="summary-row">
          <span>GST (10%)</span>
          <span>${formatCurrency(invoice.gst)}</span>
        </div>
        <hr>
        <div class="summary-row grand-total">
          <span>TOTAL</span>
          <span>${formatCurrency(invoice.total)}</span>
        </div>
        ${paidAmount > 0 ? `
        <div class="summary-row" style="color: #28a745;">
          <span>Amount Paid</span>
          <span>-${formatCurrency(paidAmount)}</span>
        </div>
        <div class="summary-row balance-due">
          <span>BALANCE DUE</span>
          <span>${formatCurrency(amountDue)}</span>
        </div>
        ` : ''}
      </div>

      ${invoice.notes ? `<div class="info-section"><h3>Notes</h3><p>${invoice.notes}</p></div>` : ''}

      <div class="payment-box">
        <h3>Payment Information</h3>
        <p><strong>Amount Due:</strong> ${formatCurrency(amountDue)}</p>
        <p><strong>Due Date:</strong> ${dueDateStr}</p>
        ${invoice.invoiceNumber ? `<p>Please reference invoice number ${invoice.invoiceNumber} with your payment.</p>` : ''}
      </div>

      ${generatePaymentMethodsHTML(invoice.paymentMethods)}

      <div style="margin-top: 40px; font-size: 12px; color: #666666;">
        <p>Payment is due by ${dueDateStr}.</p>
        <p>Thank you for your business!</p>
      </div>
      </div>

      <div class="pdf-footer">
        <p>Powered by QuoteMate | quotemateapp.au</p>
      </div>
    </body>
    </html>
  `;
}

// ---- Render HTML to PDF buffer via Puppeteer ----

export async function generateQuotePdfBuffer(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1920, height: 1080 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '40px', right: '40px', bottom: '40px', left: '40px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
