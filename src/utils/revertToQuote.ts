/**
 * Whether converting this quote to an invoice can still be undone.
 *
 * Conversion is deliberately one-way for anything that has left the
 * building. Once an invoice has gone to a customer or taken money, turning
 * it back into a quote rewrites a financial record the customer already
 * holds — the correct move there is to cancel and re-issue, or raise a
 * credit note, not to quietly un-invoice it.
 *
 * What's left is the misclick: converted a moment ago, nothing sent,
 * nothing paid, nothing synced. The document machine already carries this
 * instinct — `cancelled → draft` and `quote_accepted → draft` are both
 * documented as mistake-recovery edges (shared/document/stage.ts).
 *
 * The invoice number stays burnt either way. Tax invoice numbering should
 * be gapless and never reused, so a spent number is the cost of the undo —
 * we don't hand it back to the pool.
 */

import type { Document } from '../types/document';

export function canRevertToQuote(doc?: Document | null): boolean {
  if (!doc || doc.type !== 'invoice') return false;

  // No stash means it was never converted from a quote (or was converted
  // before this shipped) — there's nothing to restore it to.
  if (!doc.convertedFromQuote) return false;

  // Still a draft: sending is what makes it the customer's record.
  if (doc.stage !== 'draft') return false;

  // Sent after it became an invoice, even if the stage didn't catch up.
  const invoicedAt = Number(doc.invoicedAt) || 0;
  const sentAt = Number(doc.sentAt) || 0;
  if (invoicedAt && sentAt && sentAt >= invoicedAt) return false;

  // Any money against it — including a deposit taken on the quote — makes
  // this a record, not a draft.
  if ((Number(doc.paidTotal) || 0) > 0) return false;
  if ((doc.payments || []).length > 0) return false;

  // Live in Xero: a local revert wouldn't remove it there, so the two
  // would silently disagree.
  if (doc.xeroSyncStatus === 'synced' || doc.xeroInvoiceId) return false;

  // A live pay link is money in flight — the customer may be mid-checkout.
  if (doc.activePaymentLink) return false;

  return true;
}
