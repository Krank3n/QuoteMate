/**
 * Starter Terms & Conditions template for AU tradies.
 *
 * Deliberately short, plain-English, and tradie-voiced — not a solicitor's
 * document. Businesses can paste their own longer version if they want more
 * coverage. The app treats T&Cs as opt-in: this template only gets inserted
 * when the tradie taps "Use starter template" in Settings.
 *
 * Two variants — the GST line is the only difference. Pick based on the
 * business's pricesIncludeGst setting via {@link defaultAuTradieTerms}.
 */
const TERMS_INCLUSIVE = `- This quote is valid for 30 days from the date of issue.
- A deposit locks in your booking. Deposits are non-refundable once work has started or materials have been ordered.
- Final payment is due on completion unless otherwise agreed.
- All prices include GST.
- Anything outside the work described above is quoted separately before we do it.
- Workmanship is guaranteed for 12 months from completion.

Paying means you're happy with these terms.`;

const TERMS_EXCLUSIVE = `- This quote is valid for 30 days from the date of issue.
- A deposit locks in your booking. Deposits are non-refundable once work has started or materials have been ordered.
- Final payment is due on completion unless otherwise agreed.
- All prices are exclusive of GST. 10% GST will be added to the total.
- Anything outside the work described above is quoted separately before we do it.
- Workmanship is guaranteed for 12 months from completion.

Paying means you're happy with these terms.`;

/** Pick the starter template variant matching the business's GST mode. */
export function defaultAuTradieTerms(pricesIncludeGst: boolean): string {
  return pricesIncludeGst ? TERMS_INCLUSIVE : TERMS_EXCLUSIVE;
}

/**
 * True iff `text` is one of our unmodified starter templates. Used by the
 * GST-mode toggle to decide whether it's safe to auto-swap the GST clause:
 * if the tradie has hand-edited their terms, we leave them alone.
 */
export function isUnmodifiedStarterTerms(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return trimmed === TERMS_INCLUSIVE.trim() || trimmed === TERMS_EXCLUSIVE.trim();
}

/**
 * @deprecated Use {@link defaultAuTradieTerms} so the GST line matches the
 * business's mode. Retained for the version-hash comparison in older flows.
 */
export const DEFAULT_AU_TRADIE_TERMS = TERMS_INCLUSIVE;

/**
 * Generate a stable version hash for a given T&Cs text. Same input always
 * produces the same hash, so changing one character bumps the version.
 * Uses a lightweight FNV-1a so it works in every runtime (no crypto import
 * needed on the client). 32-bit hash is plenty for version identification.
 */
export function hashTerms(terms: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < terms.length; i++) {
    hash ^= terms.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned hex, pad to 8 chars.
  return ('0000000' + (hash >>> 0).toString(16)).slice(-8);
}
