/**
 * Default AU tradie Terms & Conditions template. Businesses can edit this
 * in Settings → Business Profile, or restore the default at any time.
 *
 * Deliberately plain-English and short. Legally-minded businesses should
 * replace with their own bespoke terms.
 */
export const DEFAULT_AU_TRADIE_TERMS = `1. Quote validity
This quote is valid for 30 days from the issue date. Prices may change after this period due to material cost movement.

2. Deposit
A deposit (as specified on this quote) is payable to secure your booking. Once paid, we will confirm your start date. Deposits are non-refundable after work has commenced or materials have been ordered.

3. Payment terms
Final payment is due on completion of work unless otherwise agreed in writing. Late payments may incur interest at 10% per annum from the due date.

4. GST
All prices are in Australian dollars and include GST where applicable.

5. Scope and variations
This quote covers only the work described. Any additional work, changes in scope, or unforeseen site conditions will be quoted separately and must be approved in writing before proceeding.

6. Materials
Materials are sourced to meet the described specification. Substitutions of equivalent quality may occur due to supplier availability.

7. Site access and readiness
The customer is responsible for providing safe, clear access to the work site. Delays caused by site issues (power, water, access, weather) may incur additional charges.

8. Warranty
Workmanship is guaranteed for 12 months from completion. This warranty does not cover damage caused by misuse, normal wear and tear, or third-party interference.

9. Cancellation
Cancellations made after work has started or materials have been ordered may be charged for labour performed and materials supplied to date.

10. Liability
Our liability is limited to the cost of the work quoted. We are not liable for indirect or consequential losses.

11. Disputes
Any disputes will be resolved in accordance with the laws of the state in which the work is performed.

By paying a deposit or invoice you confirm you have read and accept these terms.`;

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
