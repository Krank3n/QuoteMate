/**
 * Accountant statement PDF — HTML in, rendered by the same Puppeteer path
 * as every other document. Follows the service-report builder: the shared
 * business header, the user's pdfTemplate + brandColor, A4 print CSS.
 *
 * Multi-page rules (the PAID-stamp lesson): nothing is `position: fixed`,
 * and the shared print CSS keeps every table row and the summary box
 * unbroken and repeats the table header per page.
 *
 * Customer-facing document: the tradie's business is the sender. No app
 * name appears beyond what invoices already carry (none).
 */

import type { BusinessPdfData, PdfTemplateId } from './types';
import { formatCurrency } from './formatCurrency';
import { printMediaCSS, getTemplateCSS } from './templates';
import { buildBusinessHeaderHTML, buildBusinessCredentialsHTML, escapeHtml, showcasesCredentials } from './htmlBuilders';
import {
  DEFAULT_STATEMENT_TIME_ZONE,
  INVOICE_STAGE_LABELS,
  PAYMENT_METHOD_LABELS,
  longDateInZone,
  statementPeriodLabel,
} from '../statement/buildStatement';
import type { StatementData } from '../statement/buildStatement';

export interface StatementPdfOptions {
  fromMs: number;
  toMs: number;
  generatedAtMs: number;
  /** IANA zone the dates are shown in. Defaults to Australia/Sydney. */
  timeZone?: string;
}

export const STATEMENT_NOT_REGISTERED_LINE = 'Not registered for GST — no GST charged';
export const STATEMENT_EMPTY_LINE = 'None in this period';
export const STATEMENT_FOOTER_NOTE =
  'Invoices issued lists invoices by issue date. Payments received lists money by the date it was recorded. Where a deposit was taken on the quote, the invoice total is the amount invoiced after that deposit; the deposit itself appears under Payments received. Figures are as recorded in the app.';

const money = (n: number) => formatCurrency(Number(n) || 0);

function emptyLine(): string {
  return `<p class="statement-empty">${STATEMENT_EMPTY_LINE}</p>`;
}

function buildSummaryHTML(data: StatementData, timeZone: string): string {
  const s = data.summary;
  const rows: Array<[string, string]> = [
    [`Invoices issued (${s.invoiceCount})`, money(s.invoicedTotal)],
    ...(data.gstRegistered ? [['GST collected', money(s.gstCollected || 0)] as [string, string]] : []),
    [`Payments received (${s.paymentCount})`, money(s.receivedTotal)],
    [`Outstanding at ${longDateInZone(data.range.toMs - 1, timeZone)}`, money(s.outstandingTotal)],
  ];
  return `
      <div class="summary">
        ${rows.map(([label, value]) => `
        <div class="summary-row">
          <span>${escapeHtml(label)}</span>
          <span class="num">${value}</span>
        </div>`).join('')}
      </div>`;
}

function buildInvoicesHTML(data: StatementData, timeZone: string): string {
  if (data.invoices.length === 0) return emptyLine();
  const gst = data.gstRegistered;
  const s = data.summary;
  const subtotalSum = data.invoices.reduce((sum, r) => sum + r.subtotal, 0);
  const paidSum = data.invoices.reduce((sum, r) => sum + r.paid, 0);
  return `
      <table class="statement-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Invoice</th>
            <th>Customer</th>
            <th class="num">Subtotal</th>
            ${gst ? '<th class="num">GST</th>' : ''}
            <th class="num">Total</th>
            <th class="num">Paid</th>
            <th class="num">Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.invoices.map((row) => `
          <tr>
            <td>${escapeHtml(longDateInZone(row.dateMs, timeZone))}</td>
            <td>${escapeHtml(row.number)}</td>
            <td>${escapeHtml(row.customerName)}</td>
            <td class="num">${money(row.subtotal)}</td>
            ${gst ? `<td class="num">${money(row.gst || 0)}</td>` : ''}
            <td class="num">${money(row.total)}</td>
            <td class="num">${money(row.paid)}</td>
            <td class="num">${money(row.balance)}</td>
            <td>${INVOICE_STAGE_LABELS[row.stage]}</td>
          </tr>`).join('')}
          <tr class="total-row">
            <td colspan="3">Total</td>
            <td class="num">${money(subtotalSum)}</td>
            ${gst ? `<td class="num">${money(s.gstCollected || 0)}</td>` : ''}
            <td class="num">${money(s.invoicedTotal)}</td>
            <td class="num">${money(paidSum)}</td>
            <td class="num">${money(s.outstandingTotal)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>`;
}

function buildPaymentsHTML(data: StatementData, timeZone: string): string {
  if (data.payments.length === 0) return emptyLine();
  return `
      <table class="statement-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Document</th>
            <th>Customer</th>
            <th>Method</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${data.payments.map((row) => `
          <tr>
            <td>${escapeHtml(longDateInZone(row.dateMs, timeZone))}</td>
            <td>${escapeHtml(row.documentNumber)}</td>
            <td>${escapeHtml(row.customerName)}</td>
            <td>${PAYMENT_METHOD_LABELS[row.method]}</td>
            <td class="num">${money(row.amount)}</td>
          </tr>`).join('')}
          ${data.paymentsByMethod.map((entry) => `
          <tr class="statement-method-subtotal">
            <td colspan="3"></td>
            <td>${PAYMENT_METHOD_LABELS[entry.method]} (${entry.count})</td>
            <td class="num">${money(entry.amount)}</td>
          </tr>`).join('')}
          <tr class="total-row">
            <td colspan="4">Total received</td>
            <td class="num">${money(data.summary.receivedTotal)}</td>
          </tr>
        </tbody>
      </table>`;
}

export function buildStatementPdfHtml(
  data: StatementData,
  business: BusinessPdfData,
  options: StatementPdfOptions,
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
  const timeZone = options.timeZone || DEFAULT_STATEMENT_TIME_ZONE;
  const period = statementPeriodLabel({ fromMs: options.fromMs, toMs: options.toMs }, timeZone);
  const generated = longDateInZone(options.generatedAtMs, timeZone);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, business.brandColor)}
        .statement-table { font-size: 11px; }
        .statement-table th, .statement-table td { padding: 6px 8px; white-space: nowrap; }
        .statement-table td:nth-child(3) { white-space: normal; }
        .statement-method-subtotal td { color: #4b5563; font-style: italic; border-bottom: none; }
        .statement-empty { color: #6b7280; font-size: 12px; margin: 4px 0 12px 0; }
        .statement-gst-line { font-size: 11px; color: #4b5563; margin-top: 6px; }
        .statement-note { font-size: 10px; color: #6b7280; margin-top: 18px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="content-wrapper">
      <div class="header document-header">
        ${buildBusinessHeaderHTML(business, { omitCredentials: showcasesCredentials(templateId) })}
        <div class="header-meta">
          ${showcasesCredentials(templateId) ? buildBusinessCredentialsHTML(business) : ''}
          <h2>STATEMENT</h2>
          <div class="document-subtitle">Invoices issued and payments received</div>
          <div class="document-date">${escapeHtml(period)}</div>
          <p>Generated ${escapeHtml(generated)}</p>
          ${data.gstRegistered ? '' : `<p class="statement-gst-line">${STATEMENT_NOT_REGISTERED_LINE}</p>`}
        </div>
      </div>

      ${buildSummaryHTML(data, timeZone)}

      <div class="section-wrapper">
        <h3>Invoices issued</h3>
        ${buildInvoicesHTML(data, timeZone)}
      </div>

      <div class="section-wrapper">
        <h3>Payments received</h3>
        ${buildPaymentsHTML(data, timeZone)}
      </div>

      <p class="statement-note">${STATEMENT_FOOTER_NOTE}</p>
      </div>

      <div class="pdf-footer">
        <p>${escapeHtml(business.businessName)}</p>
      </div>
    </body>
    </html>
    `;
}
