/**
 * "Your supplier list didn't cover this job" — decided here, pure.
 *
 * ⚠️ The pipeline's `supplier-priority-fallback` event never fires for most
 * tradies: materialsPipeline only emits it when businessSettings.supplierPriority
 * ranks a local supplier above Bunnings, and only TradePricingScreen ever
 * writes that. So missedTerms.length === 0 does NOT mean the book covered
 * everything — it usually means the signal was never armed. The estimate count
 * is the reading that works for everyone, and the two are combined.
 *
 * Returns null unless the gap is actually worth a line. A note on every quote
 * is a nag; a note on a quote that's fine is a lie.
 */

export interface SupplierGapSummary {
  /** Terms the local pass missed while a supplier outranked Bunnings. */
  missedTerms: string[];
  /** Rows the pipeline could only estimate rather than really price. */
  estimatedCount: number;
  /** Rows that came back with a price at all — the denominator. */
  pricedRowCount: number;
  /** Whether this phone can see any of the tradie's own rates. */
  supplierBookPopulated: boolean;
  /**
   * Rows carrying no real price: either still at $0 (a run never reached them)
   * or holding the last-resort placeholder. Distinct from an estimate — an
   * estimate is a researched number worth checking, these are blanks. Always
   * worth a word, however few there are.
   */
  needsPriceTerms?: string[];
}

/** Three estimated rows is a pattern, not a one-off. */
const MIN_ESTIMATED = 3;
/** …or a third of a short quote, which reads just as badly. */
const MIN_ESTIMATE_RATIO = 0.3;
/** Naming more than two items turns an aside into a list. */
const MAX_NAMED = 2;

export function buildSupplierGapNote(gap: SupplierGapSummary): string | null {
  const missed = gap.missedTerms.map((t) => t?.trim()).filter((t): t is string => !!t);
  const needsPrice = (gap.needsPriceTerms ?? []).map((t) => t?.trim()).filter((t): t is string => !!t);
  const ratio = gap.pricedRowCount > 0 ? gap.estimatedCount / gap.pricedRowCount : 0;

  // A row with no real price outranks every other gap and has no threshold:
  // one placeholder is already a line that will go out wrong. Ask for the two
  // things that actually fix it — the supplier's list, or the number.
  if (needsPrice.length > 0) {
    const named = needsPrice.slice(0, MAX_NAMED);
    const rest = needsPrice.length - named.length;
    const more = rest > 0 ? ` and ${rest} more` : '';
    const count = needsPrice.length === 1 ? 'One row' : `${needsPrice.length} rows`;
    const verb = needsPrice.length === 1 ? 'has' : 'have';
    return (
      `${count} on this quote ${verb} no real price — ${named.join(', ')}${more}. ` +
      'Those are placeholders, not researched estimates, so the total is wrong until they are set. ' +
      "Tell them plainly, then offer both ways out in ONE line: send through the supplier's " +
      'price list for these items, or give you the price and you will put it in. Ask once, ' +
      'and drop it if they knock it back.'
    );
  }
  const worthMentioning =
    missed.length > 0 || gap.estimatedCount >= MIN_ESTIMATED || ratio >= MIN_ESTIMATE_RATIO;
  if (!worthMentioning) return null;

  const estimateLine =
    gap.estimatedCount > 0
      ? ` ${gap.estimatedCount} of ${gap.pricedRowCount} priced rows are estimates rather than real supplier prices.`
      : '';
  const tail =
    ' Fold that into ONE line of your acknowledgement and offer to read their price list in — once only, and drop it if they knock it back.';

  if (!gap.supplierBookPopulated) {
    // Never "you haven't got one": the book lives on the device and a fresh
    // install reads empty even when Firestore still holds the import.
    return `The supplier list on this phone is empty.${estimateLine}${tail}`;
  }

  const named = missed.slice(0, MAX_NAMED);
  const what = named.length ? `: ${named.join(', ')}` : ' rows';
  return `Their supplier list didn't cover these${what}.${estimateLine}${tail}`;
}
