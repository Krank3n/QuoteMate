/**
 * Cloning a document, for the two reasons a tradie ever wants one.
 *
 *   'repeat_visit'  — the same work again for the same customer, on a NEW job.
 *                     Recurring cleans, another fence. It lands Accepted,
 *                     because the tradie duplicating a job has already won it,
 *                     and the site photos belong to the old visit.
 *
 *   'quote_option'  — a second price for the SAME job: "either a multi-head
 *                     system, or two independent splits". It lands as a draft
 *                     to edit, and keeps the photos, because it is the same
 *                     site on the same day. See shared/document/quoteOptions.ts
 *                     for why an option is a second quote rather than a second
 *                     section inside one.
 *
 * Both used to be one hardcoded path; the differences between them are three
 * fields, and having them side by side here is what stops the option clone
 * quietly inheriting "Accepted" the way it would have.
 *
 * Pure, with ids and the clock injected, so the reset list below is testable
 * field by field. That list is the whole point of this function: everything a
 * clone must NOT inherit is money or delivery state, and forgetting one means
 * a fresh quote that claims to have been sent, paid, or linked to Square.
 */

import type { Document } from '../types/document';

export type CloneKind = 'repeat_visit' | 'quote_option';

export interface CloneOptions {
  kind: CloneKind;
  /** Job the clone belongs to. Same job for an option, a new one for a visit. */
  jobId: string;
  /** Id for the new document. */
  id: string;
  /** Document number (QU-…). A clone always gets its own. */
  number: string;
  now: number;
  /** Id factory for nested rows, injected so tests get stable output. */
  nextId: () => string;
}

export function cloneDocument(source: Document, opts: CloneOptions): Document {
  const { kind, jobId, id, number, now, nextId } = opts;
  const isOption = kind === 'quote_option';

  const clone: Document = {
    ...source,
    id,
    jobId,
    type: 'quote',
    // An option is a price the tradie is still writing — it has not been
    // agreed to, and stamping it Accepted the way a repeat visit is would put
    // a quote nobody has seen straight into the won column.
    stage: isOption ? 'draft' : 'quote_accepted',
    number,
    createdAt: now,
    updatedAt: now,
    // Delivery state belongs to the source. A clone has never gone anywhere.
    sentAt: undefined,
    sendMethod: undefined,
    acceptanceToken: undefined,
    acceptanceTokenCreatedAt: undefined,
    respondedAt: undefined,
    respondedBy: undefined,
    clientNotes: undefined,
    acceptedAt: isOption ? undefined : now,
    invoicedAt: undefined,
    issueDate: undefined,
    dueDate: undefined,
    // Money state — nothing has moved against this document.
    depositPaid: 0,
    depositPaidAt: undefined,
    paidTotal: 0,
    paidInFullAt: undefined,
    payments: [],
    // Pay links are minted per document and carry an amount; an inherited one
    // would charge the customer the source's price.
    depositPaymentLinkId: undefined,
    depositPaymentLinkUrl: undefined,
    depositPaymentLinkCreatedAt: undefined,
    depositSquarePaymentId: undefined,
    squarePaymentLinkId: undefined,
    squarePaymentLinkUrl: undefined,
    squarePaymentId: undefined,
    squarePaidAt: undefined,
    activePaymentLink: undefined,
    archivedPaymentLinks: undefined,
    // Xero state belongs to the source invoice.
    xeroInvoiceId: undefined,
    xeroSyncStatus: undefined,
    xeroSyncedAt: undefined,
    xeroSyncError: undefined,
    legacyInvoiceId: undefined,
    legacyQuoteId: undefined,
    // Re-id nested rows so editing one document never splashes onto the other.
    materials: (source.materials ?? []).map((m) => ({ ...m, id: nextId() })),
    sections: (source.sections ?? []).map((s) => ({ ...s, id: nextId() })),
    // Same site, same day: an option keeps the photos. A repeat visit is a
    // different day and its own photos.
    photos: isOption ? (source.photos ?? []) : [],
    // The body names the source's total, so it is wrong for both kinds.
    draftEmailBody: undefined,
    draftEmailSubject: undefined,
  } as Document;

  // A source invoice has had any paid deposit subtracted from `total` (see
  // convertDocumentToInvoice), so cloning it verbatim would quote the residual
  // rather than the job. Put the deposit back.
  const depositCredit =
    source.type === 'invoice'
      ? (source.payments ?? [])
          .filter((p: any) => p.kind === 'deposit')
          .reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0)
      : 0;
  const restoredTotal = (Number(source.total) || 0) + depositCredit;

  return {
    ...clone,
    materialsSubtotal: Number(source.materialsSubtotal) || 0,
    laborTotal: Number(source.laborTotal) || 0,
    subtotal: Number(source.subtotal) || 0,
    markupAmount: Number(source.markupAmount) || 0,
    gst: Number(source.gst) || 0,
    total: restoredTotal,
    balanceDue: restoredTotal,
  };
}
