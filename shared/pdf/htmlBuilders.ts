/**
 * Shared HTML builders for PDF quote and invoice generation
 * Used by both client (Expo Print) and server (Puppeteer) renderers
 */

import { PdfMaterial, LaborSection, QuotePdfData, InvoicePdfData, BusinessPdfData, PdfTemplateId, ReportPdfData } from './types';
import { formatCurrency } from './formatCurrency';
import { printMediaCSS, getTemplateCSS } from './templates';
import { PASSTHROUGH_SURCHARGE_PCT } from './squareFees';
import { resolveGstMode, NO_GST_NOTE } from '../document/gstMode';
import {
  normaliseLabourToHours,
  hoursForDisplay,
  rateForDisplay,
  type LabourUnit,
} from '../document/labourUnits';
import { pathHasInk } from './signatureInk';
import { isLumpSumSection, lineMarkupMultiplier, markupableLabourTotal } from '../document/lumpSum';
import { resolvePriceDetail, showsLineItems, showsPerLineMoney } from '../document/priceDetail';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatMultiline = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

const roundCents = (n: number) => Math.round(n * 100) / 100;

// Materials subtotals must equal the eyeball sum of the rounded line totals
// the customer sees in the table. Multiplying the pre-rounded subtotal by the
// markup multiplier and rounding once produces a different value when each
// line is rounded individually first.
//
// The multiplier is resolved PER LINE, because a work item's price is final —
// see shared/document/lumpSum.ts. Applying it to the whole array would inflate
// a scope line the tradie typed, and the subtotal would then disagree with the
// rows above it.
const sumRoundedLineTotals = (materials: PdfMaterial[], multiplier: number) =>
  materials.reduce(
    (sum, m) => sum + roundCents(m.totalPrice * lineMarkupMultiplier(m, multiplier)),
    0,
  );

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

/**
 * `omitCredentials` lets a template showcase them elsewhere (the accredited
 * template puts the badge at the top of the right-hand column) without ending
 * up with two copies in the header.
 */
function buildBusinessHeaderHTML(
  business: BusinessPdfData,
  options?: { omitCredentials?: boolean },
): string {
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
          ${options?.omitCredentials ? '' : buildBusinessCredentialsHTML(business)}
        </div>`;
}

/** Templates that print the accreditation badge large, in the document corner. */
export function showcasesCredentials(templateId: PdfTemplateId): boolean {
  return templateId === 'accredited';
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
 * Generate the itemised materials table, grouped by work section whenever the
 * document has sections. When markupPercent > 0, material prices are inflated
 * by the markup percentage.
 *
 * Grouping is no longer gated on a business setting. Labour sections already
 * rendered by default while material sections did not, so the same quote
 * showed its work broken out in one half of the document and lumped together
 * in the other. A tradie who went to the trouble of creating sections meant
 * them; the setting only decided whether the PDF agreed.
 *
 * `sections` supplies the ORDER. The material table used to sort its groups
 * alphabetically while the labour block used sortOrder, so "Demolition" and
 * "Painting" could appear in one order at the top of the page and another
 * further down. sortOrder is now the single source of truth for both, and for
 * the in-app list.
 */
export function generateMaterialsHTML(
  allMaterials: PdfMaterial[],
  markupPercent: number = 0,
  sections?: LaborSection[],
  options?: { perLineMoney?: boolean },
): string {
  // Same rule as the scope table: a row with no name is a half-typed line, and
  // it used to reach the customer as an empty "1 each · $0.00".
  const materials = allMaterials.filter((m) => !!m.name?.trim());
  if (materials.length === 0) {
    return `<p style="color: #666666; font-style: italic; margin: 10px 0;">No materials required - Labour only</p>`;
  }

  const multiplier = markupPercent > 0 ? (1 + markupPercent / 100) : 1;
  const displaySubtotal = sumRoundedLineTotals(materials, multiplier);
  // 'summary' presentation: the customer sees WHAT is being done, not what
  // each part of it costs. Names stay, every per-line figure goes, and the
  // section subtotals carry the money — so the visible numbers still add up
  // to the Subtotal below.
  const perLineMoney = options?.perLineMoney !== false;
  const columns = perLineMoney ? 4 : 2;

  const tableHeader = perLineMoney
    ? `
    <thead>
      <tr>
        <th>Item</th>
        <th>Quantity</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>`
    : `
    <thead>
      <tr>
        <th colspan="2">Item</th>
      </tr>
    </thead>`;

  // Mixed document: a work item inside the itemised table. It has no unit
  // price and its quantity is a bookkeeping 1, so both cells stay empty
  // rather than printing "1 each × $22,750.00" at a customer.
  const materialRow = (m: PdfMaterial) => {
    const isWork = m.kind === 'work';
    const scope = isWork && m.scope?.trim()
      ? `<div class="scope-body">${formatMultiline(m.scope.trim())}</div>`
      : '';
    if (!perLineMoney) {
      return `
    <tr>
      <td colspan="2">${escapeHtml(m.name)}${scope}</td>
    </tr>`;
    }
    return `
    <tr>
      <td>${escapeHtml(m.name)}${scope}</td>
      <td>${isWork ? '' : `${m.quantity} ${escapeHtml(m.unit)}`}</td>
      <td>${isWork ? '' : formatCurrency(m.price * multiplier)}</td>
      <td>${formatCurrency(m.totalPrice * lineMarkupMultiplier(m, multiplier))}</td>
    </tr>`;
  };

  const hasSections = materials.some(m => m.section);

  if (!hasSections) {
    return `
      <table>
        ${tableHeader}
        <tbody>
          ${materials.map(materialRow).join('')}
          <tr class="total-row">
            <td${columns > 2 ? ` colspan="${columns - 1}"` : ''}>Materials Subtotal</td>
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

  // Named sections in sortOrder (falling back to the array's own order for
  // legacy documents), then any material that belongs to no section.
  const orderByName = new Map<string, number>();
  (sections || []).forEach((sec, i) => {
    if (!orderByName.has(sec.name)) orderByName.set(sec.name, i);
  });
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (a !== '' && b === '') return -1;
    const oa = orderByName.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ob = orderByName.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  const descriptionByName = new Map<string, string>();
  (sections || []).forEach((sec) => {
    if (sec.description?.trim() && !descriptionByName.has(sec.name)) {
      descriptionByName.set(sec.name, sec.description.trim());
    }
  });

  let html = '';
  sortedKeys.forEach(key => {
    const sectionMaterials = grouped.get(key)!;
    const sectionTotal = sumRoundedLineTotals(sectionMaterials, multiplier);
    const sectionName = escapeHtml(key);
    const description = descriptionByName.get(key);
    // No invented "Other" heading: a material that belongs to no section is
    // shown as itself, exactly as the in-app list shows it, rather than under
    // a group name the tradie never created.
    const labelRow = key
      ? `
          <tr>
            <th colspan="${columns}" class="section-label">${sectionName}${
              description ? `<div class="section-scope">${formatMultiline(description)}</div>` : ''
            }</th>
          </tr>`
      : '';

    html += `
      <table>
        <thead>${labelRow}${tableHeader.replace('<thead>', '').replace('</thead>', '')}
        </thead>
        <tbody>
          ${sectionMaterials.map(materialRow).join('')}
          <tr class="total-row">
            <td${columns > 2 ? ` colspan="${columns - 1}"` : ''}>${key ? `${sectionName} Subtotal` : 'Subtotal'}</td>
            <td>${formatCurrency(sectionTotal)}</td>
          </tr>
        </tbody>
      </table>`;
  });

  html += `
    <table>
      <tbody>
        <tr class="total-row">
          <td${columns > 2 ? ` colspan="${columns - 1}"` : ''}><strong>All Materials Subtotal</strong></td>
          <td><strong>${formatCurrency(displaySubtotal)}</strong></td>
        </tr>
      </tbody>
    </table>`;

  return html;
}

/**
 * Every priced line is a lump-sum scope line → render the Project Scope table.
 *
 * The mode is DERIVED, never toggled. A tradie should not have to find a
 * setting to make their quote look like their quote, and `every()` is the
 * safety property: a document carrying so much as one real material can not
 * enter the scope branch, so nothing that renders as an itemised table today
 * can change shape. Add a material to a pure-scope quote and the PDF flips
 * back to four columns — deliberately, because there is now a quantity and a
 * unit price worth showing.
 */
export function isScopeQuote(materials: PdfMaterial[]): boolean {
  // Nameless rows don't count either way. The materials screen's rapid-entry
  // chain leaves a blank $0 draft behind, and one of those was enough to drop
  // a pure scope quote back into the four-column materials table — the exact
  // layout the tradie was trying to get away from. The entry screen prunes
  // them on the way out; this is the second line of defence, because the
  // question here is "what is this document", and an empty row says nothing.
  const real = materials.filter((m) => !!m.name?.trim());
  return real.length > 0 && real.every((m) => m.kind === 'work');
}

/** One row of the Project Scope table. `label` is already HTML-safe. */
interface ScopeContinuationRow {
  label: string;
  amount: number;
}

/**
 * The Project Scope table: a numbered list of lump-sum scope lines, each a
 * bold title over a scope paragraph, against one price. This is how a painter,
 * plasterer or cleaner has always quoted — the itemised materials table is the
 * wrong shape for a job whose cost is labour and method, not products.
 *
 * `continuationRows` are appended as further numbered rows (labour, when the
 * document also carries hours) so the customer reads one continuous list
 * rather than a scope table followed by an unrelated labour table.
 *
 * No subtotal row: the summary block immediately below carries Subtotal, GST
 * and TOTAL, and the two would otherwise print the same number twice in a row.
 */
export function generateScopeHTML(
  allMaterials: PdfMaterial[],
  markupPercent: number = 0,
  continuationRows: ScopeContinuationRow[] = [],
): string {
  // Nameless rows never reach the customer. The entry screen prunes the blank
  // draft its rapid-entry chain leaves behind, but quotes saved before that
  // fix still carry one, and an empty numbered row on a customer's quote looks
  // like the tradie forgot to finish it.
  const materials = allMaterials.filter((m) => !!m.name?.trim());
  const multiplier = markupPercent > 0 ? (1 + markupPercent / 100) : 1;

  const scopeRow = (index: number, title: string, body: string, amount: number) => `
    <tr>
      <td class="scope-num">${index}</td>
      <td class="scope-title"><strong>${title}</strong>${body}</td>
      <td class="scope-total">${formatCurrency(amount)}</td>
    </tr>`;

  const rows = materials.map((m, i) => {
    // An empty scope renders the title alone — no stray <br>, no empty <div>.
    const scope = m.scope?.trim();
    const body = scope ? `<div class="scope-body">${formatMultiline(scope)}</div>` : '';
    // Resolved per line rather than assuming every row here is a work item.
    // It is today (isScopeQuote demands it), but the price a tradie typed must
    // survive this function on its own terms, not on a caller's invariant.
    return scopeRow(
      i + 1,
      escapeHtml(m.name),
      body,
      m.totalPrice * lineMarkupMultiplier(m, multiplier),
    );
  });

  const continued = continuationRows.map((r, i) =>
    scopeRow(materials.length + i + 1, r.label, '', r.amount),
  );

  return `
      <table class="scope-table">
        <thead>
          <tr>
            <th class="scope-num">#</th>
            <th>Project Scope</th>
            <th class="scope-total">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('')}${continued.join('')}
        </tbody>
      </table>`;
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
 * Markup is broken out as its own line ONLY when the tradie asked for it AND
 * the document is itemised. Once per-line money is hidden there is nothing for
 * a Markup row to reconcile against, so it rolls into the visible figures
 * instead — the alternative is a page whose numbers don't add up.
 */
function rollMarkupFor(data: QuotePdfData): boolean {
  return data.showMarkup !== true || resolvePriceDetail(data) !== 'itemised';
}

/**
 * The labour total as the customer reads it: the hourly slice carrying any
 * rolled-in labour markup, plus the lump-sum sections at exactly the figures
 * the tradie typed. Marking a lump sum up would print a number the tradie
 * never chose — see shared/document/lumpSum.ts.
 */
function displayLabourTotal(data: QuotePdfData, laborMul: number): number {
  const markupable = markupableLabourTotal(data.laborTotal, data.sections);
  return (data.laborTotal - markupable) + markupable * laborMul;
}

/**
 * The labour lines exactly as the customer reads them: one row per section
 * (or a single "Labour" row when there are none), plus the extra-hours row.
 *
 * Shared by the standalone Labour block and by the Project Scope table, which
 * appends the same rows as numbered continuations — one derivation, so the two
 * presentations can never drift apart on hours, rates or rolled-in markup.
 *
 * `label` comes back HTML-safe (section names are escaped here) because the
 * rate detail has to be interpolated into the same string.
 */
function labourRowsForDisplay(rawData: QuotePdfData): ScopeContinuationRow[] {
  // Canonicalise first: every quantity below is HOURS and every rate is
  // $/hour, whatever shape the record arrived in. Days are then applied once,
  // at render, from the tradie's display preference — so a day rate can never
  // be mistaken for an hourly one (see shared/document/labourUnits.ts).
  const data = normaliseLabourToHours(rawData) as QuotePdfData;
  const displayUnit: LabourUnit = data.labourDisplayUnit === 'days' ? 'days' : 'hours';
  const unitLabel = displayUnit === 'days' ? 'days' : 'hours';
  const rateLabel = displayUnit === 'days' ? '/day' : '/hr';
  const qty = (hours: number) => Math.round(hoursForDisplay(hours, displayUnit) * 100) / 100;
  const perUnitRate = (hourly: number) => rateForDisplay(hourly, displayUnit);

  const hasSections = !!(data.sections && data.sections.length > 0);
  // When the user has hidden the breakdown, collapse sections to a single
  // "Labour" row showing only the total — no per-section rows.
  const showBreakdown = data.showLaborBreakdown !== false;
  const extra = data.laborExtraHours || 0;
  // Labor markup is rolled into displayed labour prices unless the user has
  // opted into showing markup as a separate line on the document.
  // "(30 hours @ $85.00/hr)" is a unit price. Once the tradie has chosen not
  // to show per-line money, it goes with the rest of it.
  const perLineMoney = showsPerLineMoney(resolvePriceDetail(rawData));
  const showHours = data.showLaborHours && perLineMoney;
  const rollLaborMarkup = rollMarkupFor(data);
  const laborMul = rollLaborMarkup ? 1 + ((data.laborMarkup || 0) / 100) : 1;
  const displayLaborTotal = displayLabourTotal(data, laborMul);

  if (hasSections && !showBreakdown) {
    return [{ label: 'Labour', amount: displayLaborTotal }];
  }

  if (!hasSections) {
    return [{
      label: showHours && data.laborHours && data.laborRate
        ? `Labour (${qty(data.laborHours)} ${unitLabel} @ ${formatCurrency(perUnitRate(data.laborRate) * laborMul)}${rateLabel})`
        : 'Labour',
      amount: displayLaborTotal,
    }];
  }

  const rows: ScopeContinuationRow[] = data.sections!.map((s) => {
    const name = escapeHtml(s.name);
    // A lump-sum section has no hours and no rate to show, and its price is
    // never marked up — see shared/document/lumpSum.ts.
    if (isLumpSumSection(s)) {
      return { label: name, amount: s.laborTotal };
    }
    const sTotalHours =
      typeof s.laborHoursTotal === 'number'
        ? s.laborHoursTotal
        : (s.laborHours || 0) * (s.multiplier || 1);
    return {
      label: showHours
        ? `${name} (${qty(sTotalHours)} ${unitLabel} @ ${formatCurrency(perUnitRate(s.laborRate) * laborMul)}${rateLabel})`
        : name,
      amount: s.laborTotal * laborMul,
    };
  });

  if (extra !== 0) {
    // Use the section's rate (or top-level fallback) for the extra row's math.
    const extraRate = (data.sections && data.sections[0]?.laborRate) || data.laborRate || 0;
    // Positive extra renders as "General Labour"; negative as "Labour
    // Adjustment" so the customer-facing label still reads sensibly.
    const extraLabel = extra >= 0 ? 'General Labour' : 'Labour Adjustment';
    const extraDetails = showHours
      ? ` (${extra > 0 ? '+' : ''}${qty(extra)} ${unitLabel} @ ${formatCurrency(perUnitRate(extraRate) * laborMul)}${rateLabel})`
      : '';
    rows.push({ label: `${extraLabel}${extraDetails}`, amount: extra * extraRate * laborMul });
  }

  return rows;
}

/**
 * Build labor section HTML with support for per-section labor breakdown
 * and an optional "General Labour" row for any extra hours added on top of
 * the section sums (laborExtraHours).
 */
function buildLaborHTML(rawData: QuotePdfData): string {
  // A pure-scope document with no labour has nothing to say here — a "Labour
  // $0.00" block under a Project Scope table reads as a mistake. When there IS
  // labour it rides in the scope table as continuation rows instead, so this
  // builder isn't called at all (see buildQuotePdfHtml).
  if (isScopeQuote(rawData.materials) && !rawData.laborTotal) return '';

  const data = normaliseLabourToHours(rawData) as QuotePdfData;
  const hasSections = !!(data.sections && data.sections.length > 0);
  const showBreakdown = data.showLaborBreakdown !== false;
  const rollLaborMarkup = rollMarkupFor(data);
  const laborMul = rollLaborMarkup ? 1 + ((data.laborMarkup || 0) / 100) : 1;
  const displayLaborTotal = displayLabourTotal(data, laborMul);
  const rows = labourRowsForDisplay(rawData);

  return `
      <div class="section-wrapper">
        <h3>Labour</h3>
        <table>
          <tbody>
            ${rows.map(r => `<tr>
              <td>${r.label}</td>
              <td style="text-align: right;">${formatCurrency(r.amount)}</td>
            </tr>`).join('')}
            ${hasSections && showBreakdown ? `<tr class="total-row">
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
  const rollMarkup = rollMarkupFor(data);
  const materialMul = rollMarkup ? 1 + ((data.markup || 0) / 100) : 1;
  const laborMul = rollMarkup ? 1 + ((data.laborMarkup || 0) / 100) : 1;
  // Match the eyeball sum of rounded line totals shown in the materials table.
  const displayMaterialsSubtotal = sumRoundedLineTotals(data.materials, materialMul);
  const displayLaborTotal = displayLabourTotal(data, laborMul);
  const displaySubtotal = displayMaterialsSubtotal + displayLaborTotal;
  const gstMode = resolveGstMode(data);
  // Under exclusive mode the GST line is *added* to reach the total, so it
  // sits above the divider as a separate addend. Under inclusive mode it's
  // disclosure only — shown beneath the line items, not added to anything.
  // A business that isn't GST-registered gets no GST row at all, just the
  // "No GST has been charged" note.
  const subtotalLabel = gstMode === 'exclusive' ? 'Subtotal (ex GST)' : 'Subtotal';
  const gstLabel = gstMode === 'inclusive' ? 'Includes GST' : 'GST (10%)';

  // The Materials/Labour split is 'itemised' only. In 'summary' the section
  // totals in the table already carry it, and in scope mode every line IS a
  // customer-facing total — either way, splitting here would re-split exactly
  // what the tradie chose not to itemise. One Subtotal row carries it instead.
  const scopeMode = isScopeQuote(data.materials);
  const detail = resolvePriceDetail(data);
  const showSplit = showsPerLineMoney(detail) && !scopeMode;
  // 'total' shows the grand total alone — no Subtotal, no Travel, nothing to
  // reconstruct the breakdown from. GST still appears; it is a legal
  // disclosure, not a preference. Subtotal/GST/Total reconcile in every mode
  // because displaySubtotal is computed regardless of what is rendered.
  const showSubtotalLine = showsLineItems(detail);

  return `
      <div class="summary">
        ${showSplit ? `
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(displayMaterialsSubtotal)}</span>
        </div>
        ` : ''}
        ${showSplit ? `
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
        ${showsPerLineMoney(detail) && !rollMarkup && data.markupAmount > 0 ? `
        <div class="summary-row">
          <span>Markup</span>
          <span>${formatCurrency(data.markupAmount)}</span>
        </div>
        ` : ''}
        ${showSubtotalLine && data.travelAdjustment && data.travelAdjustment > 0 ? `
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
 * The payment schedule: what is due before work starts, and what is due on
 * completion. Rendered only when the tradie has actually set a deposit.
 *
 * The deposit fields used to reach only the email body and the Square link, so
 * a customer who printed or forwarded the PDF — the artifact they actually
 * keep — saw no mention of the deposit at all, then got asked for one.
 */
function buildPaymentScheduleHTML(quote: QuotePdfData): string {
  if (quote.requireDeposit !== true) return '';
  const total = Number(quote.total) || 0;
  const pct = Number(quote.depositPercentage) || 0;
  // DERIVE from the percentage, don't trust the stored amount. `depositAmount`
  // is only written when the tradie touches the deposit control, so it goes
  // stale the moment the quote total changes — and the email recomputes it
  // live, which is how the same send could show two different deposits. A
  // percentage with no stored amount would otherwise print no schedule at all
  // while the email showed one.
  const amount = pct > 0
    ? Math.round(total * (pct / 100) * 100) / 100
    : Number(quote.depositAmount) || 0;
  if (amount <= 0) return '';
  // Never print a negative balance: a deposit larger than the total is a data
  // problem, not something to render as money owed back.
  const balance = Math.max(0, total - amount);
  const depositLabel = pct > 0 ? `Deposit (${pct}%)` : 'Deposit';
  return `
      <div class="info-section payment-schedule" style="page-break-inside: avoid;">
        <h3>Payment Schedule</h3>
        <div class="summary-row">
          <span>${depositLabel} &mdash; before commencement of any work</span>
          <span>${formatCurrency(amount)}</span>
        </div>
        <div class="summary-row">
          <span>Balance &mdash; on completion</span>
          <span>${formatCurrency(balance)}</span>
        </div>
      </div>`;
}

/**
 * Build the full quote PDF HTML document
 */
/**
 * The priced middle of a quote: its line items (materials or scope table),
 * its labour block when that doesn't ride inside the scope table, and its
 * totals ending in TOTAL.
 *
 * Split out because a quote is not the only document that prints one. A job
 * carrying competing OPTIONS prints several — one per option, each with its
 * own TOTAL and deliberately no grand total (see
 * buildQuoteOptionsPdfHtml). Two copies of this branching is how the options
 * document would end up disagreeing with the single-quote one about whether
 * labour is a row or a block.
 */
export function buildQuotePricingHTML(quote: QuotePdfData): string {
  // One resolver, one answer — see shared/document/priceDetail.ts.
  const detail = resolvePriceDetail(quote);
  const perLineMoney = showsPerLineMoney(detail);
  const rollMarkup = rollMarkupFor(quote) && quote.markup > 0;
  // 'total' hides the line items entirely; 'itemised' and 'summary' both show
  // them, differing only in how much money sits beside each one.
  const showLineItems = showsLineItems(detail);
  // Derived, not toggled — see isScopeQuote.
  const scopeMode = isScopeQuote(quote.materials);
  // Labour rides in the scope table as continuation rows, but only when that
  // table is actually rendered; with material costs hidden it isn't, so labour
  // falls back to its own block.
  // A scope line's Line Total IS its section total, so it survives 'summary'
  // (which hides per-LINE money, not section money) — the same rule that keeps
  // Σ section totals === Subtotal on an itemised document.
  const labourInScopeTable = scopeMode && showLineItems;
  const scopeLabourRows = labourInScopeTable && quote.laborTotal
    ? labourRowsForDisplay(quote)
    : [];

  return `
      ${showLineItems ? `
      <div class="section-wrapper">
        ${scopeMode ? '' : '<h3>Materials</h3>'}
        ${scopeMode
          ? generateScopeHTML(quote.materials, rollMarkup ? quote.markup : 0, scopeLabourRows)
          : generateMaterialsHTML(quote.materials, rollMarkup ? quote.markup : 0, quote.sections, { perLineMoney })}
      </div>
      ` : ''}

      ${showLineItems && !labourInScopeTable ? buildLaborHTML(quote) : ''}

      ${buildSummaryHTML(quote)}
`;
}

export function buildQuotePdfHtml(
  quote: QuotePdfData,
  business: BusinessPdfData,
  options?: { watermark?: string }
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
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
        ${buildBusinessHeaderHTML(business, { omitCredentials: showcasesCredentials(templateId) })}
        <div class="header-meta">
          ${showcasesCredentials(templateId) ? buildBusinessCredentialsHTML(business) : ''}
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

      ${buildQuotePricingHTML(quote)}

      ${buildPaymentScheduleHTML(quote)}

      ${quote.notes ? `<div class="info-section"><h3>Notes</h3><p>${escapeHtml(quote.notes)}</p></div>` : ''}

      ${generatePaymentMethodsHTML(quote.paymentMethods, { plan: quote.plan, squarePaymentLinkUrl: quote.squarePaymentLinkUrl, surchargePaymentFees: quote.surchargePaymentFees })}

      <div style="margin-top: 40px; font-size: 12px; color: #666666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
      </div>

      ${buildTermsHTML(quote.terms)}
      </div>

      <!-- The tradie's name, not ours. A quote is their document going to
           their customer; our branding on the footer reads to that customer
           like the job was subcontracted to software. The service report has
           always done it this way — quotes and invoices now match. -->
      <div class="pdf-footer">
        <p>${escapeHtml(business.businessName)}</p>
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
/**
 * One PDF showing several competing OPTIONS for the same job.
 *
 * A tradie pricing "either a multi-head system, or two independent splits"
 * sends one document with a price against each, and the customer picks. The
 * document therefore has exactly one rule that matters: EVERY OPTION CARRIES
 * ITS OWN TOTAL AND THE DOCUMENT CARRIES NONE. Adding them would state a
 * price nobody was offered — the same mistake that made sectioned options
 * charge for both, printed on the customer's copy.
 *
 * The job details, validity, terms and footer appear once: it is one job.
 * Each option repeats only its own priced middle, through the same
 * buildQuotePricingHTML the single-quote document uses, so the two can never
 * disagree about how a quote is laid out.
 *
 * Accepting still happens per option, through that option's own link — see
 * shared/document/quoteOptions.ts.
 */
export function buildQuoteOptionsPdfHtml(
  quotes: QuotePdfData[],
  business: BusinessPdfData,
  options?: { watermark?: string },
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
  const watermark = options?.watermark;
  // The options describe one job for one customer, so the framing comes from
  // the first and is printed once.
  const lead = quotes[0];

  const optionBlocks = quotes.map((quote, i) => `
      <div class="section-wrapper" style="page-break-inside: avoid;">
        <h3>Option ${i + 1}${quote.quoteNumber ? ` &middot; ${escapeHtml(quote.quoteNumber)}` : ''}</h3>
        ${buildQuotePricingHTML(quote)}
      </div>
  `).join('');

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
        ${buildBusinessHeaderHTML(business, { omitCredentials: showcasesCredentials(templateId) })}
        <div class="header-meta">
          ${showcasesCredentials(templateId) ? buildBusinessCredentialsHTML(business) : ''}
          <h2>QUOTATION</h2>
          <div class="document-date">${escapeHtml(lead.quoteDate)}</div>
          ${buildHeaderRecipientHTML({
            label: 'Prepared for',
            name: lead.customerName,
            address: lead.jobAddress,
            email: lead.customerEmail,
            phone: lead.customerPhone,
          })}
        </div>
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${escapeHtml(lead.job.name)}</strong></p>
        <p>${formatMultiline(lead.job.description)}</p>
      </div>

      <div class="info-section">
        <h3>Your options</h3>
        <p>${quotes.length} ways to do this job, priced separately. Choose the one
        that suits and accept it — you are only ever charged for the option you
        pick, never the total of them.</p>
      </div>

      ${optionBlocks}

      <div style="margin-top: 40px; font-size: 12px; color: #666666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
      </div>

      ${buildTermsHTML(lead.terms)}
      </div>

      <div class="pdf-footer">
        <p>${escapeHtml(business.businessName)}</p>
      </div>
    </body>
    </html>
    `;
}

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
        ${buildBusinessHeaderHTML(business, { omitCredentials: showcasesCredentials(templateId) })}
        <div class="header-meta">
          ${showcasesCredentials(templateId) ? buildBusinessCredentialsHTML(business) : ''}
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
 *
 * Titled "TAX INVOICE" for GST-registered businesses — the ATO expects a tax
 * invoice to be identifiable as one, and every AU tradie's own paperwork says
 * it. Non-registered businesses (gstRegistered === false) must NOT issue a tax
 * invoice, so they keep the plain "INVOICE" heading. Legacy docs leave
 * gstRegistered undefined, which means registered.
 */
export function buildInvoicePdfHtml(
  invoice: InvoicePdfData,
  business: BusinessPdfData,
  options?: { watermark?: string }
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
  // One resolver, one answer — see shared/document/priceDetail.ts.
  const detail = resolvePriceDetail(invoice);
  const perLineMoney = showsPerLineMoney(detail);
  const rollMarkup = rollMarkupFor(invoice) && invoice.markup > 0;
  // 'total' hides the line items entirely; 'itemised' and 'summary' both show
  // them, differing only in how much money sits beside each one.
  const showLineItems = showsLineItems(detail);
  const watermark = options?.watermark;
  // Symmetrical with the quote builder on purpose: an accepted scope quote
  // must not change shape the moment it becomes an invoice.
  const scopeMode = isScopeQuote(invoice.materials);
  // A scope line's Line Total IS its section total, so it survives 'summary'
  // (which hides per-LINE money, not section money) — the same rule that keeps
  // Σ section totals === Subtotal on an itemised document.
  const labourInScopeTable = scopeMode && showLineItems;
  const scopeLabourRows = labourInScopeTable && invoice.laborTotal
    ? labourRowsForDisplay(invoice)
    : [];

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
        ${buildBusinessHeaderHTML(business, { omitCredentials: showcasesCredentials(templateId) })}
        <div class="header-meta">
          ${showcasesCredentials(templateId) ? buildBusinessCredentialsHTML(business) : ''}
          <h2>${invoice.gstRegistered === false ? 'INVOICE' : 'TAX INVOICE'}</h2>
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

      ${showLineItems ? `
      <div class="section-wrapper">
        ${scopeMode ? '' : '<h3>Materials</h3>'}
        ${scopeMode
          ? generateScopeHTML(invoice.materials, rollMarkup ? invoice.markup : 0, scopeLabourRows)
          : generateMaterialsHTML(invoice.materials, rollMarkup ? invoice.markup : 0, invoice.sections, { perLineMoney })}
      </div>
      ` : ''}

      ${showLineItems && !labourInScopeTable ? buildLaborHTML(invoice) : ''}

      ${buildSummaryHTML(invoice, paidAmount, amountDue, invoice.depositCredit)}

      ${invoice.notes ? `<div class="info-section"><h3>Notes</h3><p>${escapeHtml(invoice.notes)}</p></div>` : ''}

      <div class="payment-box">
        <h3>Payment Information</h3>
        <p><strong>Amount Due:</strong> ${formatCurrency(amountDue)}</p>
        <p><strong>Due Date:</strong> ${invoice.dueDate}</p>
        ${invoice.invoiceNumber ? `<p>Please reference invoice number ${invoice.invoiceNumber} with your payment.</p>` : ''}
      </div>

      ${generatePaymentMethodsHTML(invoice.paymentMethods, { plan: invoice.plan, squarePaymentLinkUrl: invoice.squarePaymentLinkUrl, surchargePaymentFees: invoice.surchargePaymentFees })}

      ${buildTermsHTML(invoice.terms)}
      </div>

      <!-- The tradie's name, not ours. A quote is their document going to
           their customer; our branding on the footer reads to that customer
           like the job was subcontracted to software. The service report has
           always done it this way — quotes and invoices now match. -->
      <div class="pdf-footer">
        <p>${escapeHtml(business.businessName)}</p>
      </div>
    </body>
    </html>
    `;
}
