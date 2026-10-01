/**
 * Timesheet PDF — hours logged for a period. Same chrome as the accountant
 * statement (statementHtml.ts): the shared business header, the tradie's
 * pdfTemplate + brandColor, A4 print CSS with rows that never split.
 *
 * It's the tradie's own record, handed to an accountant, a bookkeeper or a
 * customer asking what the hours were — so the business is the only name on
 * it, like every other document.
 */

import type { BusinessPdfData, PdfTemplateId } from './types';
import { printMediaCSS, getTemplateCSS } from './templates';
import { buildBusinessHeaderHTML, buildBusinessCredentialsHTML, escapeHtml, showcasesCredentials } from './htmlBuilders';
import { formatHours } from '../time/hours';
import { formatCurrency } from './formatCurrency';
import { timesheetSummaryLine, type TimesheetData } from '../time/buildTimesheet';

export interface TimesheetPdfOptions {
  /** Shown under the title, e.g. "1 July 2025 – 30 June 2026". */
  periodLabel: string;
  /** e.g. "30 September 2026". */
  generatedLabel: string;
}

export const TIMESHEET_EMPTY_LINE = 'No time logged in this period';

/** "2026-09-30" → "Wed 30 Sep 2026", without touching time zones. */
export function timesheetDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(day);
}

const hoursCell = (h: number) => formatHours(h).replace(' h', '');

function buildEntriesHTML(data: TimesheetData): string {
  if (data.rows.length === 0) return `<p class="statement-empty">${TIMESHEET_EMPTY_LINE}</p>`;
  const anyNotCharged = data.rows.some((r) => !r.billable);
  const manyWorkers = data.byWorker.length > 1;
  return `
      <table class="statement-table">
        <thead>
          <tr>
            <th>Date</th>
            ${manyWorkers ? '<th>Worked by</th>' : ''}
            <th>Job</th>
            <th>Note</th>
            <th class="num">Hours</th>
            ${anyNotCharged ? '<th>Charged</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${data.rows.map((r) => `
          <tr>
            <td>${escapeHtml(timesheetDayLabel(r.date))}</td>
            ${manyWorkers ? `<td>${escapeHtml(r.workerName)}</td>` : ''}
            <td>${escapeHtml(r.jobName)}${r.customerName ? `<div class="timesheet-sub">${escapeHtml(r.customerName)}</div>` : ''}</td>
            <td>${escapeHtml(r.note)}</td>
            <td class="num">${hoursCell(r.hours)}</td>
            ${anyNotCharged ? `<td>${r.billable ? 'Yes' : 'No'}</td>` : ''}
          </tr>`).join('')}
          <tr class="total-row">
            <td colspan="${manyWorkers ? 4 : 3}">Total</td>
            <td class="num">${hoursCell(data.totalHours)}</td>
            ${anyNotCharged ? '<td></td>' : ''}
          </tr>
        </tbody>
      </table>`;
}

function buildByJobHTML(data: TimesheetData): string {
  const anyCost = data.byJob.some((j) => typeof j.cost === 'number');
  // One job is just the total — unless there's a cost to show for it.
  if (data.byJob.length < 2 && !anyCost) return '';
  const anyNotCharged = data.billableHours !== data.totalHours;
  return `
      <div class="section-wrapper">
        <h3>By job</h3>
        <table class="statement-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Customer</th>
              <th class="num">Entries</th>
              <th class="num">Hours</th>
              ${anyNotCharged ? '<th class="num">Charged</th>' : ''}
              ${anyCost ? '<th class="num">Crew cost</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${data.byJob.map((j) => `
            <tr>
              <td>${escapeHtml(j.jobName)}</td>
              <td>${escapeHtml(j.customerName)}</td>
              <td class="num">${j.entryCount}</td>
              <td class="num">${hoursCell(j.hours)}</td>
              ${anyNotCharged ? `<td class="num">${hoursCell(j.billableHours)}</td>` : ''}
              ${anyCost ? `<td class="num">${typeof j.cost === 'number' ? formatCurrency(j.cost) : ''}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
}

function buildByWorkerHTML(data: TimesheetData): string {
  const anyCost = data.byWorker.some((w) => typeof w.cost === 'number');
  if (data.byWorker.length < 2 && !anyCost) return '';
  return `
      <div class="section-wrapper">
        <h3>By person</h3>
        <table class="statement-table">
          <thead>
            <tr>
              <th>Worked by</th>
              <th class="num">Hours</th>
              ${anyCost ? '<th class="num">Cost incl. super</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${data.byWorker.map((w) => `
            <tr>
              <td>${escapeHtml(w.workerName)}</td>
              <td class="num">${hoursCell(w.hours)}</td>
              ${anyCost ? `<td class="num">${typeof w.cost === 'number' ? formatCurrency(w.cost) : ''}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
}

export function buildTimesheetPdfHtml(
  data: TimesheetData,
  business: BusinessPdfData,
  options: TimesheetPdfOptions,
): string {
  const templateId: PdfTemplateId = business.pdfTemplate || 'professional';
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
        .statement-table th, .statement-table td { padding: 6px 8px; vertical-align: top; }
        .statement-table td:first-child { white-space: nowrap; }
        .timesheet-sub { color: #6b7280; font-size: 10px; margin-top: 2px; }
        .statement-empty { color: #6b7280; font-size: 12px; margin: 4px 0 12px 0; }
        .timesheet-summary { font-size: 13px; font-weight: 600; margin: 8px 0 16px 0; }
      </style>
    </head>
    <body>
      <div class="content-wrapper">
      <div class="header document-header">
        ${buildBusinessHeaderHTML(business, { omitCredentials: showcasesCredentials(templateId) })}
        <div class="header-meta">
          ${showcasesCredentials(templateId) ? buildBusinessCredentialsHTML(business) : ''}
          <h2>TIMESHEET</h2>
          <div class="document-subtitle">Hours worked</div>
          <div class="document-date">${escapeHtml(options.periodLabel)}</div>
          <p>Generated ${escapeHtml(options.generatedLabel)}</p>
        </div>
      </div>

      <p class="timesheet-summary">${escapeHtml(timesheetSummaryLine(data))}</p>

      ${buildByWorkerHTML(data)}

      ${buildByJobHTML(data)}

      <div class="section-wrapper">
        <h3>Entries</h3>
        ${buildEntriesHTML(data)}
      </div>
      </div>

      <div class="pdf-footer">
        <p>${escapeHtml(business.businessName)}</p>
      </div>
    </body>
    </html>
    `;
}
