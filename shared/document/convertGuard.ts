/**
 * Whether a document may still be turned into an invoice.
 *
 * This exists because the convert flow used to disable itself. The client
 * stamps the LEGACY quote first (`invoiceId` + `invoicedAt`, so the dashboard
 * stops offering the draft), `onQuoteWritten` mirrors that legacy row onto the
 * unified document, and the adapter carries `invoicedAt` across while the doc
 * is still `type: 'quote'`. Only then does the convert RPC run — and it was
 * guarded on `type === 'invoice' || invoicedAt`, so it saw the stamp its own
 * caller had just written, returned `alreadyInvoiced: true` with a 200, and
 * never flipped the type.
 *
 * Observed 18 Aug 2026: the mirror finished at 01:30:15.817 and the convert
 * started at 01:30:21.691 — 5.9s later, reading its own residue. The document
 * was left `type: 'quote'` WITH `invoicedAt`, which `canConvert` then read as
 * "already done": the row disappeared from both doors and the document sent as
 * a quote. A race with a permanent, silent dead end.
 *
 * So: TYPE is the only answer to "is this already an invoice". `invoicedAt` on
 * a quote is evidence about the legacy row, not about this document.
 */

/** Structural on purpose — the client Document and the functions-side shape
 *  both satisfy it, and neither package has to import the other's types. */
export interface ConvertCandidate {
  id?: string;
  type?: string;
  invoicedAt?: number;
  /** Mirrors the legacy `quote.invoiceId` — see shared/document/adapter.ts. */
  legacyInvoiceId?: string;
}

/**
 * Has this document already BECOME an invoice? The only safe idempotency key
 * for the convert RPC and its client-side twin.
 */
export function isAlreadyInvoiced(doc?: ConvertCandidate | null): boolean {
  return doc?.type === 'invoice';
}

/**
 * A quote left carrying `invoicedAt` from a convert that never completed.
 *
 * Distinguishable from a quote that genuinely spawned a legacy invoice: the
 * legacy path stamps `invoiceId` with the NEW invoice's id, so the mirrored
 * `legacyInvoiceId` points somewhere else. The half-finished unified convert
 * stamps `invoiceId: documentId` — itself. Anything ambiguous (no
 * `legacyInvoiceId` at all) is deliberately NOT healed: offering convert on a
 * quote that already has a real invoice elsewhere would bill the customer twice.
 */
export function isSelfStampedConvert(doc?: ConvertCandidate | null): boolean {
  if (!doc || doc.type !== 'quote' || !doc.invoicedAt) return false;
  return !!doc.legacyInvoiceId && !!doc.id && doc.legacyInvoiceId === doc.id;
}

/**
 * Should the UI offer "Convert to invoice"? Quotes only, never twice — but a
 * document stranded by the race above is offered again so it can be recovered
 * without a support round-trip.
 */
export function canConvertDocument(doc?: ConvertCandidate | null): boolean {
  if (!doc || doc.type !== 'quote') return false;
  if (!doc.invoicedAt) return true;
  return isSelfStampedConvert(doc);
}
