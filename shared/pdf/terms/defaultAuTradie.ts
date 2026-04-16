/**
 * Starter Terms & Conditions template for AU tradies.
 *
 * Deliberately short, plain-English, and tradie-voiced — not a solicitor's
 * document. Businesses can paste their own longer version if they want more
 * coverage. The app treats T&Cs as opt-in: this template only gets inserted
 * when the tradie taps "Use starter template" in Settings.
 */
export const DEFAULT_AU_TRADIE_TERMS = `- This quote is valid for 30 days from the date of issue.
- A deposit locks in your booking. Deposits are non-refundable once work has started or materials have been ordered.
- Final payment is due on completion unless otherwise agreed.
- All prices include GST.
- Anything outside the work described above is quoted separately before we do it.
- Workmanship is guaranteed for 12 months from completion.

Paying means you're happy with these terms.`;

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
