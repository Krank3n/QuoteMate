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
 * was left `type: 'quote'` WITH `invoicedAt`, which the UI then read as
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
 * Should the UI offer "Convert to invoice"? Quotes only, and never twice.
 *
 * Deliberately does NOT try to rescue a quote already stranded by the race
 * above. The first cut of this file did, on the theory that a half-finished
 * convert leaves `legacyInvoiceId` pointing at the document itself — and a
 * scan of production on 18 Aug 2026 proved that theory wrong. Across 198 users
 * holding quotes, 10 quotes carried `invoicedAt`, 8 pointed at a real invoice,
 * and the 2 stranded ones pointed at ids that exist in no collection at all.
 * Nothing was self-referential, so the rescue matched nothing and only added a
 * predicate that read as if it did something.
 *
 * Two documents is a repair job, not a product feature. Telling them apart
 * needs a lookup this pure predicate can't do, and the guard above stops new
 * ones appearing — so the honest thing here is the plain rule.
 */
export function canConvertDocument(doc?: ConvertCandidate | null): boolean {
  return !!doc && doc.type === 'quote' && !doc.invoicedAt;
}
