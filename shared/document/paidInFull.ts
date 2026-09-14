/**
 * When was this document settled?
 *
 * A fully paid invoice carries a PAID stamp on its PDF, dated the day the
 * money landed. Only the stage decides whether it's paid — never
 * `total - paidTotal`, because a converted-with-deposit invoice can carry the
 * deposit on its ledger and the arithmetic lies (see convertDocumentToInvoice).
 *
 * The date falls back in this order:
 *   1. `paidInFullAt` — stamped by the ledger recompute the first time the
 *      doc moves to paid.
 *   2. the latest `payments[].paidAt` — a Document rebuilt from a legacy
 *      `invoices/` row never gets `paidInFullAt` (the adapter doesn't carry
 *      it), but the adapter does turn `paidDate` into a payment entry.
 *   3. `updatedAt` — last resort so a paid doc is never stamped "PAID" with
 *      no date.
 */

type PaidInFullSource = {
  stage?: string;
  paidInFullAt?: number | null;
  payments?: Array<{ paidAt?: number | null }> | null;
  updatedAt?: number | null;
};

const asMs = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

export function paidInFullAtMs(doc: PaidInFullSource): number | undefined {
  if (doc.stage !== 'paid') return undefined;
  const stamped = asMs(doc.paidInFullAt);
  if (stamped) return stamped;
  let latest: number | undefined;
  for (const p of doc.payments ?? []) {
    const at = asMs(p?.paidAt);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest ?? asMs(doc.updatedAt);
}
