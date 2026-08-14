/**
 * Lump-sum sections, and the one rule every money path has to know about them.
 *
 * A section with `pricing: 'lumpSum'` carries a price the TRADIE TYPED. There
 * are no hours behind it and no rate behind it (both are 0 by invariant), so
 * nothing may derive its dollars from anything else — and, crucially, nothing
 * may mark it up. A tradie who types $1,200 into a "Bathroom regrout" section
 * and reads $1,380 on the customer's copy has been lied to by their own
 * software; the whole point of typing a lump sum is that it IS the price.
 *
 * Hourly labour keeps its markup untouched — that is a margin on a rate, which
 * the tradie set as a rate. This module is the single place that split lives,
 * so the client calculator, the shared integrity check, the server's
 * hide-markup display pass and the PDF can't drift apart on it.
 */

export interface LumpSumSectionLike {
  pricing?: 'hourly' | 'lumpSum';
  laborTotal?: number;
}

export function isLumpSumSection(s: LumpSumSectionLike | undefined | null): boolean {
  return !!s && s.pricing === 'lumpSum';
}

/** Σ of the lump-sum sections' dollars. */
export function lumpSumLabourTotal(sections?: LumpSumSectionLike[] | null): number {
  return (sections || []).reduce(
    (sum, s) => sum + (isLumpSumSection(s) ? (Number(s.laborTotal) || 0) : 0),
    0,
  );
}

/**
 * The slice of a document's labour total that labour markup may be applied to
 * — everything except the lump sums. Never negative: a document whose lump
 * sums somehow exceed its labour total gets a zero markup base rather than a
 * credit.
 */
export function markupableLabourTotal(
  laborTotal: number,
  sections?: LumpSumSectionLike[] | null,
): number {
  return Math.max(0, (Number(laborTotal) || 0) - lumpSumLabourTotal(sections));
}
