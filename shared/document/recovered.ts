/**
 * `recovered-` documents, and the one rule every money path has to know about
 * them.
 *
 * The 2026-07 account-reclaim rebuild reconstructed deleted quotes from the
 * emails that had gone out (see functions/src/accountReclaim.rebuild.ts). Their
 * GRAND TOTAL is real — it is the figure the customer was actually quoted, read
 * straight off the email — but everything under it is synthesised: two or three
 * placeholder lines ("Materials (recovered)", "Labour (recovered)"), no rate,
 * no hours, no sections. The parts do not add up to the whole and were never
 * meant to: on `recovered-QU-177680` the material lines sum to $5,102.37, the
 * stored subtotal says $5,104.37, and the total ($5,698.95) is neither of those
 * plus the stored GST.
 *
 * So the usual direction of trust is INVERTED for these. Everywhere else a
 * recomputed total beats a stored one, because the stored figure can be stale.
 * Here the stored figure is the only real number in the document, and
 * recomputing from the placeholder lines would quietly move a historical record
 * — downwards, and in front of a customer.
 *
 * Shared rather than duplicated: `functions/src/shared` is a symlink to this
 * directory, so the client send flow and the server's funnel counts read one
 * definition.
 */

export function isRecoveredDocId(docId: string | null | undefined): boolean {
  return typeof docId === 'string' && docId.startsWith('recovered-');
}
