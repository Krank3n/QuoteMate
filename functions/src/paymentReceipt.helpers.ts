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

// ---------------------------------------------------------------------------
// Customer payment receipt — unified `documents` shape
// ---------------------------------------------------------------------------

/**
 * Stages an invoice-type Document can be in and still earn its customer a
 * receipt. Deliberately the mirror image of the legacy `draft`/`cancelled`
 * skip: an invoice the customer has never been sent (still `draft`, or one
 * of the quote-side stages) must not produce an unsolicited receipt, and a
 * cancelled one must not either. `stageToInvoiceStatus` collapses every
 * excluded stage to legacy status 'draft' or 'cancelled', so the two shapes
 * agree on which payments are receiptable.
 */
const RECEIPTABLE_DOCUMENT_STAGES = new Set(['invoice_sent', 'partially_paid', 'paid']);

/** Dollars → whole cents. Cents keep the high-water mark float-noise free. */
function toCents(amount: unknown): number {
  return Math.round((Number(amount) || 0) * 100);
}

/**
 * Map a unified `DocumentPayment.method` onto the legacy method vocabulary
 * that `paymentMethodLabel` (and therefore the receipt email) speaks.
 * 'other' has no label of its own, which correctly hides the row.
 */
export function documentPaymentMethodToLegacy(method?: unknown): string | undefined {
  switch (method) {
    case 'square': return 'card';
    case 'bank': return 'bank_transfer';
    case 'cash': return 'cash';
    default: return undefined;
  }
}

export interface DocumentPaymentReceiptEvaluation extends PaymentReceiptEvaluation {
  /**
   * `paidTotal` after this payment, in whole cents. Persisted back onto the
   * document as `receiptSentPaidCents` once the receipt is away, so it
   * becomes the high-water mark the next evaluation has to clear.
   */
  receiptedPaidCents: number;
  /** ms epoch of the payment that triggered this receipt, for the date line. */
  paidAtMs: number;
  /** Invoice number as the unified doc spells it (`number`, not `invoiceNumber`). */
  invoiceNumber?: string;
}

/**
 * Decide whether a write to `users/{uid}/documents/{docId}` represents a
 * customer payment that deserves a receipt email. The document analogue of
 * `evaluatePaymentReceipt`, adapted to the unified shape: `paidTotal` instead
 * of `paidAmount`, `stage` instead of `status`, `number` instead of
 * `invoiceNumber`, and a `payments[]` ledger instead of a single payment.
 *
 * Single delivery rests on a monotonic high-water mark rather than a plain
 * before→after delta. We only fire when `paidTotal` clears BOTH the previous
 * value and `receiptSentPaidCents` (the paid total at the last receipt), so:
 *   - a resync / no-op write sends nothing (no increase);
 *   - the trigger's own write-back of the mark sends nothing (paidTotal
 *     unchanged), which is what stops it looping on itself;
 *   - an at-least-once redelivery of the same Firestore event sends nothing,
 *     because the mark already sits at the post-payment total;
 *   - the legacy→documents mirror re-deriving the same payments array sends
 *     nothing, since the totals it projects are the ones already receipted.
 * A genuine second part payment still clears the mark and gets its own
 * receipt.
 */
export function evaluateDocumentPaymentReceipt(
  before: Record<string, any>,
  after: Record<string, any>,
): DocumentPaymentReceiptEvaluation | null {
  if (after.type !== 'invoice') return null;

  const customerEmail = typeof after.customerEmail === 'string' ? after.customerEmail.trim() : '';
  if (!customerEmail) return null;

  // Judge "was this invoice ever sent?" on the BEFORE stage, matching the
  // legacy helper — the paying write itself moves the stage to paid/partial.
  if (!RECEIPTABLE_DOCUMENT_STAGES.has(String(before.stage))) return null;

  const total = Number(after.total) || 0;
  if (total <= 0) return null;

  const paidBeforeCents = toCents(before.paidTotal);
  const paidAfterCents = toCents(after.paidTotal);
  const alreadyReceiptedCents = Number(after.receiptSentPaidCents) || 0;
  const floorCents = Math.max(paidBeforeCents, alreadyReceiptedCents);
  const deltaCents = paidAfterCents - floorCents;
  if (deltaCents < 1) return null;

  const paidAfter = paidAfterCents / 100;
  const balanceDue = round2(Math.max(0, total - paidAfter));

  // Attribute the receipt to the payments this write actually added, falling
  // back to the newest one on the ledger when the ids are unchanged (the
  // mirror rebuilds them with synthetic, stable ids — see
  // shared/document/adapter.buildInvoicePayments).
  const beforeIds = new Set(
    (Array.isArray(before.payments) ? before.payments : []).map((p: any) => p?.id),
  );
  const afterPayments = Array.isArray(after.payments) ? after.payments : [];
  const added = afterPayments.filter((p: any) => !beforeIds.has(p?.id));
  const source = (added.length ? added : afterPayments).slice(-1)[0];

  return {
    customerEmail,
    amountReceived: round2(deltaCents / 100),
    isFullyPaid: after.stage === 'paid' || balanceDue <= EPSILON,
    balanceDue,
    paymentMethod: documentPaymentMethodToLegacy(source?.method),
    receiptedPaidCents: paidAfterCents,
    paidAtMs: Number(source?.paidAt) || Number(after.paidInFullAt) || Date.now(),
    invoiceNumber: typeof after.number === 'string' ? after.number : undefined,
  };
}

/**
 * Pure core of the receipt claim the documents trigger runs inside a
 * transaction: does this evaluation beat the mark already on the document?
 * `>=` would be the wrong comparison — a redelivered event carries the mark's
 * exact value and must NOT re-send, so only a strict advance claims.
 */
export function claimsReceipt(
  storedReceiptSentPaidCents: unknown,
  receiptedPaidCents: number,
): boolean {
  return (Number(storedReceiptSentPaidCents) || 0) < receiptedPaidCents;
}

/**
 * True when this document write is the moment an invoice became fully paid —
 * the unified analogue of `onInvoiceStatusChanged`'s status → 'paid' edge,
 * used to fire the tradie's `invoice_paid` push exactly once.
 */
export function shouldSendInvoicePaidPush(
  before: Record<string, any>,
  after: Record<string, any>,
): boolean {
  if (after.type !== 'invoice') return false;
  return before.stage !== 'paid' && after.stage === 'paid';
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
