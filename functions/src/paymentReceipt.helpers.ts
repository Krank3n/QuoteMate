/**
 * Pure helpers for invoice part-payments and customer payment receipts.
 * No firebase imports so they stay unit-testable (see paymentReceipt.helpers.test.ts).
 */

/** Two-decimal money rounding; all invoice amounts are dollars. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Amounts within half a cent are considered equal (matches webhook epsilon). */
const EPSILON = 0.005;

// ---------------------------------------------------------------------------
// Pay link pricing
// ---------------------------------------------------------------------------

/**
 * The base amount a Square payment link should charge for an invoice: the
 * outstanding balance, not the full total. invoice.total is already net of
 * any quote deposit credit (the deposit is subtracted when the invoice is
 * created from the quote), so balance due is simply total − paidAmount.
 */
export function invoiceLinkAmountDue(invoice: {
  total?: unknown;
  paidAmount?: unknown;
}): number {
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.paidAmount) || 0;
  return round2(Math.max(0, total - paid));
}

// ---------------------------------------------------------------------------
// Square webhook → legacy invoice reconciliation
// ---------------------------------------------------------------------------

/**
 * True when this Square payment id has already been applied to the invoice.
 * Older docs only carry the single `squarePaymentId` field (last payment);
 * newer writes accumulate every applied id in `squarePaymentIds`.
 */
export function isPaymentAlreadyApplied(
  invoice: { squarePaymentId?: unknown; squarePaymentIds?: unknown },
  paymentId: string,
): boolean {
  if (invoice.squarePaymentId === paymentId) return true;
  const ids = invoice.squarePaymentIds;
  return Array.isArray(ids) && ids.includes(paymentId);
}

export interface SquarePaymentApplication {
  /** Portion of the payment credited to the invoice (surcharge excluded). */
  paidAgainstInvoice: number;
  newPaidAmount: number;
  newStatus: 'paid' | 'partial';
  balanceDue: number;
}

/**
 * Accumulate a Square payment onto the invoice's paid amount. Additive — a
 * second part payment stacks on the first instead of replacing it. The
 * credited portion is capped at the remaining balance so a surcharged charge
 * (balance + card fee) never reports the invoice as overpaid.
 */
export function applySquarePaymentToInvoice(input: {
  total: number;
  existingPaidAmount: number;
  paymentDollars: number;
}): SquarePaymentApplication {
  const total = Number(input.total) || 0;
  const existingPaid = Number(input.existingPaidAmount) || 0;
  const remaining = Math.max(0, total - existingPaid);
  const paidAgainstInvoice = round2(Math.min(Math.max(0, input.paymentDollars), remaining));
  const newPaidAmount = round2(existingPaid + paidAgainstInvoice);
  return {
    paidAgainstInvoice,
    newPaidAmount,
    newStatus: newPaidAmount + EPSILON >= total ? 'paid' : 'partial',
    balanceDue: round2(Math.max(0, total - newPaidAmount)),
  };
}

// ---------------------------------------------------------------------------
// Customer payment receipt
// ---------------------------------------------------------------------------

export interface PaymentReceiptEvaluation {
  customerEmail: string;
  amountReceived: number;
  isFullyPaid: boolean;
  balanceDue: number;
  paymentMethod?: string;
}

/**
 * Decide whether an invoice update represents a customer payment that
 * deserves a receipt email. Fires on any paidAmount increase (manual Record
 * Payment, Square pay link, Tap to Pay) so repeat part payments each get a
 * receipt. Draft/cancelled invoices are skipped — the customer has never
 * been sent the invoice, so an unsolicited receipt would be confusing.
 */
export function evaluatePaymentReceipt(
  before: Record<string, any>,
  after: Record<string, any>,
): PaymentReceiptEvaluation | null {
  const customerEmail = typeof after.customerEmail === 'string' ? after.customerEmail.trim() : '';
  if (!customerEmail) return null;

  if (before.status === 'draft' || before.status === 'cancelled') return null;

  const total = Number(after.total) || 0;
  if (total <= 0) return null;

  const paidBefore = Number(before.paidAmount) || 0;
  const paidAfter = Number(after.paidAmount) || 0;
  const delta = paidAfter - paidBefore;
  if (delta <= EPSILON) return null;

  const balanceDue = round2(Math.max(0, total - paidAfter));
  return {
    customerEmail,
    amountReceived: round2(delta),
    isFullyPaid: after.status === 'paid' || balanceDue <= EPSILON,
    balanceDue,
    paymentMethod: typeof after.paymentMethod === 'string' ? after.paymentMethod : undefined,
  };
}

/** Human label for the stored payment method; undefined hides the row. */
export function paymentMethodLabel(method?: string): string | undefined {
  switch (method) {
    case 'card': return 'Card';
    case 'bank_transfer': return 'Bank transfer';
    case 'cash': return 'Cash';
    case 'cheque': return 'Cheque';
    default: return undefined;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatAud(amount: number): string {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export interface PaymentReceiptContentInput {
  customerName?: string;
  businessName: string;
  invoiceNumber?: string;
  jobName?: string;
  amountReceived: number;
  isFullyPaid: boolean;
  balanceDue: number;
  paymentMethod?: string;
  /** Pre-formatted AU date, e.g. "2 July 2026". */
  paidDateText: string;
}

/**
 * Inner HTML for the receipt email; the caller wraps it in the shared
 * business-branded template. Customer-facing: the tradie's business is the
 * voice throughout.
 */
export function buildPaymentReceiptContentHtml(input: PaymentReceiptContentInput): string {
  const esc = escapeHtml;
  const methodLabel = paymentMethodLabel(input.paymentMethod);
  const rows: Array<[string, string]> = [
    ['Date', esc(input.paidDateText)],
    ...(input.invoiceNumber ? [['Invoice', esc(input.invoiceNumber)] as [string, string]] : []),
    ...(input.jobName ? [['Job', esc(input.jobName)] as [string, string]] : []),
    ...(methodLabel ? [['Payment method', methodLabel] as [string, string]] : []),
  ];

  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;font-size:14px;">${label}</td>
      <td style="padding:6px 0;color:#111827;font-size:14px;text-align:right;font-weight:600;">${value}</td>
    </tr>`).join('');

  const balanceLine = input.isFullyPaid
    ? `<p style="color:#059669;font-size:15px;font-weight:700;margin:0 0 16px;">This invoice is now paid in full.</p>`
    : `<p style="color:#374151;font-size:15px;margin:0 0 16px;">Remaining balance: <strong style="color:#111827;">${formatAud(input.balanceDue)}</strong></p>`;

  return `
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">Payment received</h1>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px;">Hi ${esc(input.customerName || 'there')},</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px;">Thanks for your payment — here's your receipt.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Amount received</p>
          <p style="margin:0 0 12px;color:#111827;font-size:28px;font-weight:800;">${formatAud(input.amountReceived)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}
          </table>
        </td>
      </tr>
    </table>
    ${balanceLine}
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">Any questions, just reply to this email.</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:16px 0 0;">Regards,<br/><strong>${esc(input.businessName)}</strong></p>`;
}
