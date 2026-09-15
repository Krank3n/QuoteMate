/**
 * When was this document settled?
 *
 * A fully paid invoice carries a PAID stamp on its PDF, dated the day the
 * money landed. Only the stage decides whether it's paid — never
 * `total - paidTotal`, because a converted-with-deposit invoice can carry the
 * deposit on its ledger and the arithmetic lies (see convertDocumentToInvoice).
 *
 * The date is the latest `payments[].paidAt`: the payment that closed the
 * balance is the settlement, and the tradie can backdate it to the day the
 * money really arrived. `paidInFullAt` is only a fallback, because it is
 * stamped once on the way INTO stage 'paid' and never reliably cleared —
 * the un-pay path writes `paidInFullAt: undefined`, which stripUndefined
 * drops before a merge write, so an invoice paid on the 13th, un-paid, and
 * paid again on the 15th kept "Paid 13 September" on its stamp (seen live on
 * INV-017). A Document rebuilt from a legacy `invoices/` row never gets
 * `paidInFullAt` at all, but the adapter does turn `paidDate` into a payment.
 * `updatedAt` is the last resort so a paid doc is never stamped with no date.
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
  let latest: number | undefined;
  for (const p of doc.payments ?? []) {
    const at = asMs(p?.paidAt);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest ?? asMs(doc.paidInFullAt) ?? asMs(doc.updatedAt);
}
