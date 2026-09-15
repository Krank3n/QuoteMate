/**
 * Money for a period — the pure core behind the accountant statement.
 *
 * A sole trader asked for "a statement of invoices sent and received
 * payment" to hand their accountant instead of paying for an accounting
 * package. Two tables, so the accountant can work on either basis:
 *
 *   - Invoices issued: accrual view. An invoice belongs to the period its
 *     issue date falls in — the SAME date the invoice PDF prints, resolved
 *     by `invoiceIssueDateMs` below so the two can never disagree.
 *   - Payments received: cash view. Money belongs to the period its
 *     `paidAt` falls in, on any non-cancelled document. Deposits land on
 *     quotes, so quotes are included here (but never in invoices issued).
 *
 * A payment in range on an invoice issued before the range therefore shows
 * in payments only; an invoice issued in range and paid after it shows in
 * invoices only, with its balance still due. Both are correct.
 *
 * Generalises `src/utils/monthlyEarnings.ts` (`earnedInMonth`): payment
 * ledger only, cancelled documents skipped, amounts rounded to 2dp.
 *
 * Pure: no Firebase, no clock. Consumed by the Cloud Function (server
 * read, unbounded) and later by the on-device preview.
 */

import type { DocumentPaymentMethod, DocumentStage } from '../document/types';
import { toMs } from '../document/adapter';

export interface StatementRange {
  /** Inclusive start, ms epoch. */
  fromMs: number;
  /** Exclusive end, ms epoch. */
  toMs: number;
}

export interface StatementBusinessInput {
  /** undefined/true = registered; false = not registered (no GST column). */
  gstRegistered?: boolean;
  pricesIncludeGst?: boolean;
}

/** Stages that mean an invoice was actually issued to the customer. */
export const ISSUED_INVOICE_STAGES: ReadonlySet<DocumentStage> = new Set<DocumentStage>([
  'invoice_sent',
  'partially_paid',
  'paid',
]);

export type StatementInvoiceStage = 'invoice_sent' | 'partially_paid' | 'paid';

export interface StatementInvoiceRow {
  id: string;
  dateMs: number;
  number: string;
  customerName: string;
  subtotal: number;
  /** Present only when the business is GST-registered. */
  gst?: number;
  total: number;
  paid: number;
  balance: number;
  stage: StatementInvoiceStage;
}

/** `unrecorded` covers payments logged without a method. */
export type StatementPaymentMethod = DocumentPaymentMethod | 'unrecorded';

export interface StatementPaymentRow {
  dateMs: number;
  documentId: string;
  documentNumber: string;
  customerName: string;
  method: StatementPaymentMethod;
  amount: number;
}

export interface StatementMethodSubtotal {
  method: StatementPaymentMethod;
  amount: number;
  count: number;
}

export interface StatementSummary {
  invoicedTotal: number;
  /** Present only when the business is GST-registered. */
  gstCollected?: number;
  receivedTotal: number;
  /** Sum of balanceDue over invoices issued in the period. */
  outstandingTotal: number;
  invoiceCount: number;
  paymentCount: number;
}

export interface StatementData {
  range: StatementRange;
  gstRegistered: boolean;
  invoices: StatementInvoiceRow[];
  payments: StatementPaymentRow[];
  paymentsByMethod: StatementMethodSubtotal[];
  summary: StatementSummary;
}

/** Loose document shape — the same fields the client `Document` carries. */
export interface StatementDocumentInput {
  id: string;
  number?: string;
  type?: string;
  stage?: string;
  customerName?: string;
  createdAt?: unknown;
  documentDate?: unknown;
  issueDate?: unknown;
  subtotal?: number;
  gst?: number;
  total?: number;
  paidTotal?: number;
  balanceDue?: number;
  payments?: Array<{ amount?: number; paidAt?: unknown; method?: string }> | null;
  [key: string]: unknown;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

const positiveMs = (value: unknown): number | undefined => {
  const ms = toMs(value);
  return typeof ms === 'number' && ms > 0 ? ms : undefined;
};

/**
 * The date an invoice was issued, as the invoice PDF prints it:
 * `documentDate || issueDate || createdAt`. `documentDate` is the user's
 * backdate, `issueDate` the invoice-side edit, `createdAt` the fallback.
 *
 * Accepts ms numbers, Dates, ISO strings and Firestore Timestamps (the
 * legacy invoice record the PDF path uses carries Dates). Returns 0 only
 * when no date at all is usable.
 */
export function invoiceIssueDateMs(doc: {
  documentDate?: unknown;
  issueDate?: unknown;
  createdAt?: unknown;
}): number {
  return positiveMs(doc.documentDate) ?? positiveMs(doc.issueDate) ?? positiveMs(doc.createdAt) ?? 0;
}

const METHOD_ORDER: StatementPaymentMethod[] = ['square', 'bank', 'cash', 'other', 'unrecorded'];

function normaliseMethod(method: unknown): StatementPaymentMethod {
  return method === 'square' || method === 'bank' || method === 'cash' || method === 'other'
    ? method
    : 'unrecorded';
}

function inRange(ms: number, range: StatementRange): boolean {
  return ms >= range.fromMs && ms < range.toMs;
}

export function buildStatement(
  documents: StatementDocumentInput[],
  range: StatementRange,
  business: StatementBusinessInput,
): StatementData {
  const gstRegistered = business.gstRegistered !== false;

  const invoices: StatementInvoiceRow[] = [];
  const payments: StatementPaymentRow[] = [];

  for (const doc of documents || []) {
    if (!doc || doc.stage === 'cancelled') continue;

    const customerName = String(doc.customerName || '').trim();
    const number = String(doc.number || '').trim();

    if (doc.type === 'invoice' && ISSUED_INVOICE_STAGES.has(doc.stage as DocumentStage)) {
      const dateMs = invoiceIssueDateMs(doc);
      if (dateMs && inRange(dateMs, range)) {
        const row: StatementInvoiceRow = {
          id: doc.id,
          dateMs,
          number,
          customerName,
          subtotal: round2(doc.subtotal ?? 0),
          total: round2(doc.total ?? 0),
          paid: round2(doc.paidTotal ?? 0),
          balance: round2(doc.balanceDue ?? 0),
          stage: doc.stage as StatementInvoiceStage,
        };
        if (gstRegistered) row.gst = round2(doc.gst ?? 0);
        invoices.push(row);
      }
    }

    for (const payment of doc.payments || []) {
      const amount = Number(payment?.amount) || 0;
      if (amount <= 0) continue;
      const paidAt = positiveMs(payment?.paidAt);
      if (!paidAt || !inRange(paidAt, range)) continue;
      payments.push({
        dateMs: paidAt,
        documentId: doc.id,
        documentNumber: number,
        customerName,
        method: normaliseMethod(payment?.method),
        amount: round2(amount),
      });
    }
  }

  const byDate = <T extends { dateMs: number }>(a: T, b: T) => a.dateMs - b.dateMs;
  invoices.sort((a, b) => byDate(a, b) || a.number.localeCompare(b.number));
  payments.sort((a, b) => byDate(a, b) || a.documentNumber.localeCompare(b.documentNumber));

  const paymentsByMethod: StatementMethodSubtotal[] = METHOD_ORDER
    .map((method) => {
      const rows = payments.filter((p) => p.method === method);
      return {
        method,
        amount: round2(rows.reduce((sum, p) => sum + p.amount, 0)),
        count: rows.length,
      };
    })
    .filter((entry) => entry.count > 0);

  const summary: StatementSummary = {
    invoicedTotal: round2(invoices.reduce((sum, r) => sum + r.total, 0)),
    receivedTotal: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
    outstandingTotal: round2(invoices.reduce((sum, r) => sum + r.balance, 0)),
    invoiceCount: invoices.length,
    paymentCount: payments.length,
  };
  if (gstRegistered) {
    summary.gstCollected = round2(invoices.reduce((sum, r) => sum + (r.gst || 0), 0));
  }

  return { range, gstRegistered, invoices, payments, paymentsByMethod, summary };
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the CSV and the PDF
// ---------------------------------------------------------------------------

/** The app is Australian; the tradie's own zone can override this. */
export const DEFAULT_STATEMENT_TIME_ZONE = 'Australia/Sydney';

export const PAYMENT_METHOD_LABELS: Record<StatementPaymentMethod, string> = {
  square: 'Square',
  bank: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
  unrecorded: 'Not recorded',
};

export const INVOICE_STAGE_LABELS: Record<StatementInvoiceStage, string> = {
  invoice_sent: 'Sent',
  partially_paid: 'Part paid',
  paid: 'Paid',
};

/** `YYYY-MM-DD` in the given zone — the form spreadsheets sort correctly. */
export function isoDateInZone(ms: number, timeZone: string = DEFAULT_STATEMENT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Australian long date, e.g. "1 July 2026", in the given zone. */
export function longDateInZone(ms: number, timeZone: string = DEFAULT_STATEMENT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ms));
}

/**
 * "1 July 2025 – 30 June 2026". `toMs` is exclusive, so the last day shown
 * is the instant before it.
 */
export function statementPeriodLabel(range: StatementRange, timeZone: string = DEFAULT_STATEMENT_TIME_ZONE): string {
  return `${longDateInZone(range.fromMs, timeZone)} – ${longDateInZone(range.toMs - 1, timeZone)}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180: quote when the field holds a comma, quote, CR or LF; double quotes. */
export function csvField(value: string | number): string {
  const s = typeof value === 'number' ? String(value) : String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One CSV, both tables, distinguished by the leading `section` column
 * (`invoice` / `payment`) — one file opens cleanly in Excel and filters on
 * that column. Dates are `YYYY-MM-DD`; amounts plain numbers. The `gst`
 * column is omitted entirely when the business is not GST-registered.
 */
export function statementToCsv(data: StatementData, timeZone: string = DEFAULT_STATEMENT_TIME_ZONE): string {
  const header = [
    'section', 'date', 'number', 'customer', 'status', 'method',
    'subtotal', ...(data.gstRegistered ? ['gst'] : []), 'total', 'paid', 'balance', 'amount',
  ];
  const lines: string[] = [header.join(',')];

  for (const row of data.invoices) {
    lines.push([
      'invoice',
      isoDateInZone(row.dateMs, timeZone),
      csvField(row.number),
      csvField(row.customerName),
      INVOICE_STAGE_LABELS[row.stage],
      '',
      row.subtotal,
      ...(data.gstRegistered ? [row.gst ?? 0] : []),
      row.total,
      row.paid,
      row.balance,
      '',
    ].join(','));
  }

  for (const row of data.payments) {
    lines.push([
      'payment',
      isoDateInZone(row.dateMs, timeZone),
      csvField(row.documentNumber),
      csvField(row.customerName),
      '',
      PAYMENT_METHOD_LABELS[row.method],
      '',
      ...(data.gstRegistered ? [''] : []),
      '',
      '',
      '',
      row.amount,
    ].join(','));
  }

  return lines.join('\r\n') + '\r\n';
}
