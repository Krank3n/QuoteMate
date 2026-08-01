/**
 * Shared HTML builders for PDF quote and invoice generation
 * Used by both client (Expo Print) and server (Puppeteer) renderers
 */

import { PdfMaterial, QuotePdfData, InvoicePdfData, BusinessPdfData, PdfTemplateId, ReportPdfData } from './types';
import { formatCurrency } from './formatCurrency';
import { printMediaCSS, getTemplateCSS } from './templates';
import { PASSTHROUGH_SURCHARGE_PCT } from './squareFees';
import { resolveGstMode, NO_GST_NOTE } from '../document/gstMode';
import { pathHasInk } from './signatureInk';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatMultiline = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

const roundCents = (n: number) => Math.round(n * 100) / 100;

// Materials subtotals must equal the eyeball sum of the rounded line totals
// the customer sees in the table. Multiplying the pre-rounded subtotal by the
// markup multiplier and rounding once produces a different value when each
// line is rounded individually first.
const sumRoundedLineTotals = (materials: PdfMaterial[], multiplier: number) =>
  materials.reduce((sum, m) => sum + roundCents(m.totalPrice * multiplier), 0);

/**
 * Render the T&Cs section at the end of a quote/invoice PDF. Preserves
 * paragraph breaks by splitting on blank lines and wrapping each in <p>.
 * Escapes HTML so hand-edited terms can't break the document.
 */
/**
 * Diagonal watermark for gated previews / local share-PDFs. The Send path
 * never reaches this code (quoteDeliveryGuard blocks before mint+send), so
 * a watermarked PDF only appears when the user is exporting locally and
 * trying to bypass the gate.
 */
function buildWatermarkCSS(): string {
  return `
    .pdf-watermark {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 9999;
      transform: rotate(-28deg);
      transform-origin: center center;
    }
    .pdf-watermark .pdf-watermark-text {
      font-size: 140px;
      font-weight: 900;
      letter-spacing: 8px;
      color: rgba(220, 38, 38, 0.18);
      text-align: center;
      line-height: 1;
    }
    .pdf-watermark .pdf-watermark-sub {
      display: block;
      font-size: 22px;
      letter-spacing: 3px;
      color: rgba(220, 38, 38, 0.32);
      margin-top: 12px;
    }
  `;
}

function buildWatermarkHTML(text: string): string {
  return `
    <div class="pdf-watermark">
      <div>
        <div class="pdf-watermark-text">DRAFT</div>
        <div class="pdf-watermark-sub">${escapeHtml(text)}</div>
      </div>
    </div>
  `;
}

export function buildBusinessCredentialsHTML(business: BusinessPdfData): string {
  const credentials = (business.credentials || []).filter(
    (credential) => credential.label?.trim() || credential.number?.trim() || credential.logoHtml,
  );
  if (credentials.length === 0) return '';

  return `
      <div class="business-credentials">
        ${credentials.map((credential) => `
          <div class="business-credential">
            ${credential.logoHtml || ''}
            <div class="business-credential-copy">
              ${!credential.logoHtml && credential.label?.trim() ? `<strong>${escapeHtml(credential.label.trim())}</strong>` : ''}
              ${credential.number?.trim() ? `<div>${escapeHtml(credential.number.trim())}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
}

function buildBusinessHeaderHTML(business: BusinessPdfData): string {
  const hasLogo = !!business.logoHtml;
  const directContacts = [business.email, business.phone]
    .filter((value): value is string => !!value)
    .map(escapeHtml)
    .join(' &middot; ');
  return `
        <div class="header-business">
          <div class="header-content business-identity${hasLogo ? ' has-logo' : ''}">
            ${business.logoHtml || ''}
            <div class="header-text">
              <h1>${escapeHtml(business.businessName)}</h1>
              <div class="business-contact-details">
                ${business.abn ? `<div><strong>ABN</strong> ${escapeHtml(business.abn)}</div>` : ''}
                ${business.address ? `<div>${formatMultiline(business.address)}</div>` : ''}
                ${directContacts ? `<div>${directContacts}</div>` : ''}
                ${business.website ? `<div>${escapeHtml(business.website)}</div>` : ''}
              </div>
            </div>
          </div>
          ${buildBusinessCredentialsHTML(business)}
        </div>`;
}

function buildHeaderRecipientHTML(input: {
  label: string;
  name?: string;
  address?: string;
  email?: string;
  phone?: string;
}): string {
  const contacts = [input.email, input.phone]
    .filter((value): value is string => !!value)
    .map(escapeHtml)
    .join(' &middot; ');
  if (!input.name?.trim() && !input.address?.trim() && !contacts) return '';
  return `
          <div class="header-recipient">
            <div class="header-recipient-label">${escapeHtml(input.label)}</div>
            ${input.name?.trim() ? `<div class="header-recipient-name">${escapeHtml(input.name.trim())}</div>` : ''}
            ${input.address?.trim() ? `<div>${formatMultiline(input.address.trim())}</div>` : ''}
            ${contacts ? `<div class="header-recipient-contact">${contacts}</div>` : ''}
          </div>`;
}

export function buildTermsHTML(terms: string | undefined): string {
  if (!terms || !terms.trim()) return '';
  const paras = terms
    .split(/\n\s*\n/)
    .map((p) => escapeHtml(p.trim()).replace(/\n/g, '<br>'))
    .filter(Boolean)
    .map((p) => `<p style="margin: 0 0 8px 0;">${p}</p>`)
    .join('');
  return `
      <div class="terms-section" style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; page-break-inside: avoid;">
        <h3 style="margin: 0 0 12px 0;">Terms &amp; Conditions</h3>
        <div style="font-size: 11px; color: #4b5563; line-height: 1.5;">${paras}</div>
      </div>`;
}

/**
 * Generate materials table HTML, optionally grouped by work section
 * When markupPercent > 0, material prices are inflated by the markup percentage
 */
export function generateMaterialsHTML(
  materials: PdfMaterial[],
  groupBySection: boolean,
  markupPercent: number = 0,
): string {
  if (materials.length === 0) {
    return `<p style="color: #666666; font-style: italic; margin: 10px 0;">No materials required - Labor only</p>`;
  }

  const multiplier = markupPercent > 0 ? (1 + markupPercent / 100) : 1;
  const displaySubtotal = sumRoundedLineTotals(materials, multiplier);

  const tableHeader = `
    <thead>
      <tr>
        <th>Item</th>
        <th>Quantity</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>`;

  const materialRow = (m: PdfMaterial) => `
    <tr>
      <td>${m.name}</td>
      <td>${m.quantity} ${m.unit}</td>
      <td>${formatCurrency(m.price * multiplier)}</td>
      <td>${formatCurrency(m.totalPrice * multiplier)}</td>
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
            <td>${formatCurrency(displaySubtotal)}</td>
          </tr>
        </tbody>
      </table>`;
  }

  // Group materials by section
  const grouped = new Map<string, PdfMaterial[]>();
  materials.forEach(m => {
    const key = m.section || '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  });

  // Sort: named sections first (alphabetically), then ungrouped
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (a !== '' && b === '') return -1;
    return a.localeCompare(b);
  });

  let html = '';
  sortedKeys.forEach(key => {
    const sectionMaterials = grouped.get(key)!;
    const sectionTotal = sumRoundedLineTotals(sectionMaterials, multiplier);
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
          <td><strong>${formatCurrency(displaySubtotal)}</strong></td>
        </tr>
      </tbody>
    </table>`;

  return html;
}

/**
 * Generate HTML for the Square "Pay Now" block. Rendered above the rest of
 * the payment methods when a hosted-checkout URL is available. The plain-text
 * URL underneath the styled button is the printed-PDF fallback so paper-mail
 * recipients can still type the link in. When the tradie has opted into
 * surchargePaymentFees, a subtle disclosure sits below the URL so the
 * customer isn't surprised when checkout charges them PASSTHROUGH_SURCHARGE_PCT
 * more than the quoted total.
 */
function generateSquarePayNowHTML(url: string, surchargeOn: boolean): string {
  const surchargeLine = surchargeOn
    ? `<div style="margin-top: 4px; font-size: 10px; color: #888; font-style: italic;">Card payments include a ${PASSTHROUGH_SURCHARGE_PCT}% processing fee.</div>`
    : '';
  return `
    <div class="payment-method square-pay-now">
      <strong>Pay Online</strong><br>
      <a href="${url}" class="square-pay-button" style="display: inline-block; margin-top: 6px; padding: 10px 18px; background: #006AFF; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700;">
        Pay with Square
      </a>
      <div style="margin-top: 6px; font-size: 11px; color: #555;">${url}</div>
      ${surchargeLine}
    </div>
  `;
}

/**
 * Generate HTML for payment methods section.
 *
 * On the free plan, only the Square "Pay Now" block renders — bank /
 * PayID / BPAY / PayPal / other are intentionally suppressed so every paid
 * quote funnels through Square (where the platform fee is collected).
 */
export function generatePaymentMethodsHTML(
  pm: any,
  options?: {
    plan?: 'trial' | 'free' | 'pro';
    squarePaymentLinkUrl?: string;
    surchargePaymentFees?: boolean;
  }
): string {
  const plan = options?.plan;
  const squareUrl = options?.squarePaymentLinkUrl;
  const surchargeOn = options?.surchargePaymentFees === true;
  const isFree = plan === 'free';

  // showOnDocuments is the user's "render the payment-methods section" toggle.
  // For free-tier docs we always need to render the Square block (that's how
  // the platform fee is collected), even if the user hasn't enabled the
  // section — so we override the toggle when on free + a Square link exists.
  if (!pm?.showOnDocuments && !(isFree && squareUrl)) return '';

  const sections: string[] = [];

  // Square Pay Now — rendered first (priority placement) so the customer
  // sees the online-payment CTA before bank/PayID/etc.
  if (squareUrl) {
    sections.push(generateSquarePayNowHTML(squareUrl, surchargeOn));
  }

  // The remaining methods are Pro-only; suppressed on the free plan.
  if (!isFree) {
    // Bank Transfer - check enabled and has at least one field with data
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

    // PayID - check enabled and has value
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

    // BPAY - check enabled and has at least one field with data
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

    // PayPal - check enabled and has email
    if (pm.paypal?.enabled && pm.paypal?.email) {
      sections.push(`
        <div class="payment-method">
          <strong>PayPal</strong><br>
          ${pm.paypal.email}
        </div>
      `);
    }

    // Other Instructions - check enabled and has instructions
    if (pm.other?.enabled && pm.other?.instructions) {
      sections.push(`
        <div class="payment-method">
          <strong>Other Payment Options</strong><br>
          ${pm.other.instructions.replace(/\n/g, '<br>')}
        </div>
      `);
    }
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

/**
 * Build labor section HTML with support for per-section labor breakdown
 * and an optional "General Labour" row for any extra hours added on top of
 * the section sums (laborExtraHours).
 */
function buildLaborHTML(data: QuotePdfData): string {
  const hasSections = !!(data.sections && data.sections.length > 0);
  // When the user has hidden the breakdown, collapse sections to a single
  // "Labour" row showing only the total — no per-section rows.
  const showBreakdown = data.showLaborBreakdown !== false;
  const extra = data.laborExtraHours || 0;
  // Labor markup is rolled into displayed labour prices unless the user has
  // opted into showing markup as a separate line on the document.
  const rollLaborMarkup = data.showMarkup !== true;
  const laborMul = rollLaborMarkup ? 1 + ((data.laborMarkup || 0) / 100) : 1;
  // Use the section's rate (or top-level fallback) for the extra row's per-hour math.
  const extraRate = (hasSections && data.sections && data.sections[0]?.laborRate) || data.laborRate || 0;
  const extraUnit = (hasSections && data.sections && data.sections[0]?.laborUnit) || data.laborUnit || 'hours';
  const extraUnitLabel = extraUnit === 'days' ? 'days' : 'hours';
  const extraRateLabel = extraUnit === 'days' ? '/day' : '/hr';
  // Positive extra renders as "General Labour"; negative as "Labour Adjustment"
  // so the customer-facing label still reads sensibly.
  const extraLabel = extra >= 0 ? 'General Labour' : 'Labour Adjustment';
  const extraDetails = data.showLaborHours
    ? ` (${extra > 0 ? '+' : ''}${extra} ${extraUnitLabel} @ ${formatCurrency(extraRate * laborMul)}${extraRateLabel})`
    : '';
  const displayLaborTotal = data.laborTotal * laborMul;

  // Collapsed view: a single "Labour" row with the displayed total.
  if (hasSections && !showBreakdown) {
    return `
      <div class="section-wrapper">
        <h3>Labour</h3>
        <table>
          <tbody>
            <tr>
              <td>Labour</td>
              <td style="text-align: right;">${formatCurrency(displayLaborTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  return `
      <div class="section-wrapper">
        <h3>Labour</h3>
        <table>
          <tbody>
            ${hasSections ? data.sections!.map(s => {
              const sUnit = s.laborUnit || 'hours';
              const sLabel = sUnit === 'days' ? 'days' : 'hours';
              const sRate = sUnit === 'days' ? '/day' : '/hr';
              const sTotalUnits =
                typeof s.laborHoursTotal === 'number'
                  ? s.laborHoursTotal
                  : Math.round((s.laborHours || 0) * (s.multiplier || 1) * 100) / 100;
              return `<tr>
                <td>${data.showLaborHours ? `${s.name} (${sTotalUnits} ${sLabel} @ ${formatCurrency(s.laborRate * laborMul)}${sRate})` : s.name}</td>
                <td style="text-align: right;">${formatCurrency(s.laborTotal * laborMul)}</td>
              </tr>`;
            }).join('') : `<tr>
              <td>${data.showLaborHours && data.laborHours && data.laborRate ? `Labour (${data.laborHours} ${(data.laborUnit || 'hours') === 'days' ? 'days' : 'hours'} @ ${formatCurrency(data.laborRate * laborMul)}${(data.laborUnit || 'hours') === 'days' ? '/day' : '/hr'})` : 'Labour'}</td>
              <td style="text-align: right;">${formatCurrency(displayLaborTotal)}</td>
            </tr>`}
            ${hasSections && extra !== 0 ? `<tr>
              <td>${extraLabel}${extraDetails}</td>
              <td style="text-align: right;">${formatCurrency(extra * extraRate * laborMul)}</td>
            </tr>` : ''}
            ${hasSections ? `<tr class="total-row">
              <td>Labour Total</td>
              <td style="text-align: right;">${formatCurrency(displayLaborTotal)}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>`;
}

/**
 * Build summary/totals HTML, with optional paid amount/balance for invoices
 */
function buildSummaryHTML(data: QuotePdfData, paidAmount?: number, amountDue?: number, depositCredit?: number): string {
  // By default markup is rolled into the displayed line totals (combined).
  // When showMarkup is explicitly true, the markup is broken out as its own
  // line and the materials/labour rows show their raw (pre-markup) totals.
  const rollMarkup = data.showMarkup !== true;
  const materialMul = rollMarkup ? 1 + ((data.markup || 0) / 100) : 1;
  const laborMul = rollMarkup ? 1 + ((data.laborMarkup || 0) / 100) : 1;
  // Match the eyeball sum of rounded line totals shown in the materials table.
  const displayMaterialsSubtotal = sumRoundedLineTotals(data.materials, materialMul);
  const displayLaborTotal = data.laborTotal * laborMul;
  const displaySubtotal = displayMaterialsSubtotal + displayLaborTotal;
  const gstMode = resolveGstMode(data);
  // Under exclusive mode the GST line is *added* to reach the total, so it
  // sits above the divider as a separate addend. Under inclusive mode it's
  // disclosure only — shown beneath the line items, not added to anything.
  // A business that isn't GST-registered gets no GST row at all, just the
  // "No GST has been charged" note.
  const subtotalLabel = gstMode === 'exclusive' ? 'Subtotal (ex GST)' : 'Subtotal';
  const gstLabel = gstMode === 'inclusive' ? 'Includes GST' : 'GST (10%)';

  // Per-section visibility. When materials/labour costs are hidden, the
  // corresponding subtotal row in the summary is hidden too. When BOTH are
  // hidden, the Subtotal row is also dropped so the customer sees only the
  // grand TOTAL (with GST disclosure). Subtotal/GST/Total still reconcile
  // because displaySubtotal is computed regardless.
  const showMaterials = data.showMaterialCosts !== false;
  const showLabor = data.showLaborCosts !== false;
  const showSubtotalLine = showMaterials || showLabor;

  return `
      <div class="summary">
        ${showMaterials ? `
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(displayMaterialsSubtotal)}</span>
        </div>
        ` : ''}
        ${showLabor ? `
        <div class="summary-row">
          <span>Labour</span>
          <span>${formatCurrency(displayLaborTotal)}</span>
        </div>
        ` : ''}
        ${showSubtotalLine ? `
        <div class="summary-row">
          <span>${subtotalLabel}</span>
          <span>${formatCurrency(displaySubtotal)}</span>
        </div>
        ` : ''}
        ${!rollMarkup && data.markupAmount > 0 ? `
        <div class="summary-row">
          <span>Markup</span>
          <span>${formatCurrency(data.markupAmount)}</span>
        </div>
        ` : ''}
        ${data.travelAdjustment && data.travelAdjustment > 0 ? `
        <div class="summary-row">
          <span>Travel Adjustment (${data.travelAdjustment}%)</span>
          <span>${formatCurrency(data.subtotal * (data.travelAdjustment / 100))}</span>
        </div>
        ` : ''}
        ${gstMode !== 'none' ? `
        <div class="summary-row">
          <span>${gstLabel}</span>
          <span>${formatCurrency(data.gst)}</span>
        </div>
        ` : ''}
        ${depositCredit && depositCredit > 0 ? `
        <div class="summary-row" style="color: #28a745;">
          <span>Deposit already paid</span>
          <span>-${formatCurrency(depositCredit)}</span>
        </div>
        ` : ''}
        <hr>
        <div class="summary-row grand-total">
          <span>${depositCredit && depositCredit > 0 ? 'BALANCE DUE' : 'TOTAL'}</span>
          <span>${formatCurrency(data.total)}</span>
        </div>
        ${gstMode === 'none' ? `
        <div class="summary-row" style="font-size: 0.85em; color: #666;">
          <span>${NO_GST_NOTE}</span>
          <span></span>
        </div>
        ` : ''}
        ${paidAmount && paidAmount > 0 ? `
        <div class="summary-row" style="color: #28a745;">
          <span>Amount Paid</span>
          <span>-${formatCurrency(paidAmount)}</span>
        </div>
        <div class="summary-row balance-due">
          <span>BALANCE DUE</span>
          <span>${formatCurrency(amountDue || 0)}</span>
        </div>
        ` : ''}
      </div>`;
}

/**
 * Build the full quote PDF HTML document
 */
export function buildQuotePdfHtml(
  quote: QuotePdfData,
  business: BusinessPdfData,
  options?: { watermark?: string }
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
  const rollMarkup = quote.showMarkup !== true && quote.markup > 0;
  const showMaterials = quote.showMaterialCosts !== false;
  const showLabor = quote.showLaborCosts !== false;
  const watermark = options?.watermark;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, business.brandColor)}
        ${watermark ? buildWatermarkCSS() : ''}
      </style>
    </head>
    <body>
      ${watermark ? buildWatermarkHTML(watermark) : ''}
      <div class="content-wrapper">
      <div class="header document-header">
        ${buildBusinessHeaderHTML(business)}
        <div class="header-meta">
          <h2>QUOTATION</h2>
          ${quote.quoteNumber ? `<div class="document-reference">${escapeHtml(quote.quoteNumber)}</div>` : ''}
          <div class="document-date">${escapeHtml(quote.quoteDate)}</div>
          ${buildHeaderRecipientHTML({
            label: 'Prepared for',
            name: quote.customerName,
            address: quote.jobAddress,
            email: quote.customerEmail,
            phone: quote.customerPhone,
          })}
        </div>
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${escapeHtml(quote.job.name)}</strong></p>
        <p>${formatMultiline(quote.job.description)}</p>
      </div>

      ${showMaterials ? `
      <div class="section-wrapper">
        <h3>Materials</h3>
        ${generateMaterialsHTML(quote.materials, quote.groupMaterialsBySection === true, rollMarkup ? quote.markup : 0)}
      </div>
      ` : ''}

      ${showLabor ? buildLaborHTML(quote) : ''}

      ${buildSummaryHTML(quote)}

      ${quote.notes ? `<div class="info-section"><h3>Notes</h3><p>${quote.notes}</p></div>` : ''}

      ${generatePaymentMethodsHTML(quote.paymentMethods, { plan: quote.plan, squarePaymentLinkUrl: quote.squarePaymentLinkUrl, surchargePaymentFees: quote.surchargePaymentFees })}

      <div style="margin-top: 40px; font-size: 12px; color: #666666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
      </div>

      ${buildTermsHTML(quote.terms)}
      </div>

      <div class="pdf-footer">
        <p>QuoteMate</p>
      </div>
    </body>
    </html>
    `;
}

/**
 * Render a single narrative block (nature of problem / work carried out /
 * recommended work). Returns '' when the text is empty so the block is
 * omitted entirely rather than left as an empty heading.
 */
function buildReportNarrativeHTML(heading: string, text: string | undefined): string {
  if (!text || !text.trim()) return '';
  return `
      <div class="info-section" style="page-break-inside: avoid;">
        <h3>${escapeHtml(heading)}</h3>
        <p>${formatMultiline(text.trim())}</p>
      </div>`;
}

/**
 * Render one signature block: the printed name with the captured SVG path
 * drawn inline underneath it. The viewBox matches the signature pad's
 * coordinate space so the stroke scales to fit.
 */
function buildReportSignatureHTML(
  label: string,
  sig: { svgPath: string; name: string; width?: number; height?: number } | undefined,
): string {
  // No signature → no block. A heading over blank space on a customer
  // document reads as "forgot to fill this in", not "optional". Structural
  // checks aren't enough — a tap with a micro-twitch captures a zero-length
  // line-to — so "signed" means measurable ink (see signatureInk).
  if (!sig || !pathHasInk(sig.svgPath)) return '';
  const name = sig.name ? escapeHtml(sig.name) : '';
  // viewBox must match the capture-space of the pad the ink was drawn on;
  // a fixed guess clips signatures from pads with other proportions. The
  // 300×150 fallback only covers legacy captures without dimensions.
  const vbWidth = sig.width && sig.width > 0 ? sig.width : 300;
  const vbHeight = sig.height && sig.height > 0 ? sig.height : 150;
  const svg = `<svg class="report-signature-svg" viewBox="0 0 ${vbWidth} ${vbHeight}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="${sig.svgPath}" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
  return `
      <div class="report-signature">
        <div class="report-signature-label">${escapeHtml(label)}</div>
        ${name ? `<div class="report-signature-name">${name}</div>` : ''}
        ${svg}
      </div>`;
}

/**
 * Build the full service-report PDF HTML document. A service report is a
 * customer-facing leave-behind: what was found, what was done, what's
 * recommended next — no money, no line items. Reuses the same header / logo
 * / footer chrome as the quote and invoice builders. The footer shows only
 * the tradie's business name (never "QuoteMate") because this is a
 * customer-facing artifact.
 */
export function buildReportPdfHtml(data: ReportPdfData, business: BusinessPdfData): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';

  const equipmentHtml = data.equipment.length > 0
    ? `
      <div class="section-wrapper" style="page-break-inside: avoid;">
        <h3>Equipment</h3>
        <ul class="report-list">
          ${data.equipment.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const checklistHtml = data.itemsChecked.length > 0
    ? `
      <div class="section-wrapper" style="page-break-inside: avoid;">
        <h3>Items checked</h3>
        <ul class="report-checklist">
          ${data.itemsChecked.map((it) => `<li><span class="report-check-box">${it.checked ? '&#10003;' : '&#9744;'}</span><span class="report-check-text">${escapeHtml(it.text)}</span></li>`).join('')}
        </ul>
      </div>`
    : '';

  const photosHtml = (data.photos && data.photos.length > 0)
    ? (() => {
        const imgs = data.photos!
          .map((p) => p.dataUri || p.url)
          .filter((src): src is string => !!src)
          .map((src) => `<div class="report-photo"><img src="${src}" alt="Service photo" /></div>`)
          .join('');
        return imgs
          ? `
      <div class="section-wrapper" style="page-break-inside: avoid;">
        <h3>Photos</h3>
        <div class="report-photo-grid">${imgs}</div>
      </div>`
          : '';
      })()
    : '';

  // Only measurable ink counts — an accidental tap renders nothing, so it
  // must not pull in the "I am satisfied…" statement either.
  const hasSignature =
    pathHasInk(data.customerSignature?.svgPath) || pathHasInk(data.technicianSignature?.svgPath);
  const signaturesHtml = hasSignature
    ? `
      <div class="section-wrapper report-signatures" style="page-break-inside: avoid;">
        <p class="report-signature-statement">I am satisfied the above work has been carried out as stated.</p>
        <div class="report-signature-grid">
          ${buildReportSignatureHTML('Customer', data.customerSignature)}
          ${buildReportSignatureHTML('Technician', data.technicianSignature)}
        </div>
      </div>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, business.brandColor)}
        .report-list { margin: 8px 0; padding-left: 20px; }
        .report-list li { margin: 2px 0; }
        .report-checklist { list-style: none; margin: 8px 0; padding: 0; }
        .report-checklist li { display: flex; align-items: flex-start; margin: 4px 0; }
        .report-check-box { display: inline-block; width: 20px; font-size: 15px; line-height: 1.4; }
        .report-check-text { flex: 1; }
        .report-photo-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
        .report-photo { width: 48%; box-sizing: border-box; }
        .report-photo img { width: 100%; height: auto; border-radius: 6px; }
        .report-signature-statement { font-size: 12px; color: #4b5563; margin: 0 0 12px 0; }
        .report-signature-grid { display: flex; gap: 24px; }
        .report-signature { flex: 1; }
        .report-signature-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; }
        .report-signature-name { font-weight: 700; margin: 4px 0; min-height: 18px; }
        .report-signature-svg { width: 100%; max-width: 260px; height: 90px; border-bottom: 1px solid #9ca3af; }
      </style>
    </head>
    <body>
      <div class="content-wrapper">
      <div class="header document-header">
        ${buildBusinessHeaderHTML(business)}
        <div class="header-meta">
          <h2>SERVICE REPORT</h2>
          <div class="document-subtitle">${escapeHtml(data.serviceType)}</div>
          ${data.reportNumber ? `<div class="document-reference">${escapeHtml(data.reportNumber)}</div>` : ''}
          <div class="document-date">${escapeHtml(data.visitDate)}</div>
          ${buildHeaderRecipientHTML({
            label: 'Customer',
            name: data.customerName,
            address: data.jobAddress,
            email: data.customerEmail,
            phone: data.customerPhone,
          })}
        </div>
      </div>

      ${buildReportNarrativeHTML('Risk Assessment', data.riskAssessment)}

      ${equipmentHtml}

      ${checklistHtml}

      ${buildReportNarrativeHTML('Nature of Problem', data.natureOfProblem)}

      ${buildReportNarrativeHTML('Work Carried Out', data.workCarriedOut)}

      ${buildReportNarrativeHTML('Recommended Work', data.recommendedWork)}

      ${photosHtml}

      ${signaturesHtml}
      </div>

      <div class="pdf-footer">
        <p>${escapeHtml(business.businessName)}</p>
      </div>
    </body>
    </html>
    `;
}

/**
 * Build the full invoice PDF HTML document
 */
export function buildInvoicePdfHtml(
  invoice: InvoicePdfData,
  business: BusinessPdfData,
  options?: { watermark?: string }
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
  const rollMarkup = invoice.showMarkup !== true && invoice.markup > 0;
  const showMaterials = invoice.showMaterialCosts !== false;
  const showLabor = invoice.showLaborCosts !== false;
  const watermark = options?.watermark;

  const paidAmount = invoice.paidAmount || 0;
  const amountDue = invoice.total - paidAmount;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, business.brandColor)}
        ${watermark ? buildWatermarkCSS() : ''}
      </style>
    </head>
    <body>
      ${watermark ? buildWatermarkHTML(watermark) : ''}
      <div class="content-wrapper">
      <div class="header document-header">
        ${buildBusinessHeaderHTML(business)}
        <div class="header-meta">
          <h2>INVOICE</h2>
          ${invoice.invoiceNumber ? `<div class="document-reference">${escapeHtml(invoice.invoiceNumber)}</div>` : ''}
          <div class="document-date">Issued ${escapeHtml(invoice.issueDate)} &middot; Due ${escapeHtml(invoice.dueDate)}</div>
          ${invoice.paymentTerms ? `<div class="document-terms">${escapeHtml(invoice.paymentTerms)}</div>` : ''}
          ${buildHeaderRecipientHTML({
            label: 'Customer',
            name: invoice.customerName,
            address: invoice.jobAddress,
            email: invoice.customerEmail,
            phone: invoice.customerPhone,
          })}
        </div>
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${escapeHtml(invoice.job.name)}</strong></p>
        <p>${formatMultiline(invoice.job.description)}</p>
      </div>

      ${showMaterials ? `
      <div class="section-wrapper">
        <h3>Materials</h3>
        ${generateMaterialsHTML(invoice.materials, invoice.groupMaterialsBySection === true, rollMarkup ? invoice.markup : 0)}
      </div>
      ` : ''}

      ${showLabor ? buildLaborHTML(invoice) : ''}

      ${buildSummaryHTML(invoice, paidAmount, amountDue, invoice.depositCredit)}

      ${invoice.notes ? `<div class="info-section"><h3>Notes</h3><p>${invoice.notes}</p></div>` : ''}

      <div class="payment-box">
        <h3>Payment Information</h3>
        <p><strong>Amount Due:</strong> ${formatCurrency(amountDue)}</p>
        <p><strong>Due Date:</strong> ${invoice.dueDate}</p>
        ${invoice.invoiceNumber ? `<p>Please reference invoice number ${invoice.invoiceNumber} with your payment.</p>` : ''}
      </div>

      ${generatePaymentMethodsHTML(invoice.paymentMethods, { plan: invoice.plan, squarePaymentLinkUrl: invoice.squarePaymentLinkUrl, surchargePaymentFees: invoice.surchargePaymentFees })}

      ${buildTermsHTML(invoice.terms)}
      </div>

      <div class="pdf-footer">
        <p>QuoteMate</p>
      </div>
    </body>
    </html>
    `;
}
