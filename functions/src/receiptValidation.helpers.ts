/**
 * Pure helpers for validateAppleReceipt / validateGoogleReceipt (PAY-01).
 *
 * A store receipt that fails server-side validation must NEVER grant Pro.
 * Before Jul 2026 both endpoints computed a fallback expiry from the
 * client-supplied productId and wrote isPro:true unconditionally — a
 * fabricated transaction id, a store outage, or missing credentials granted
 * paid access (two such records existed in production). The verdict below is
 * the single gate: no grant, no subscription write.
 *
 * We distinguish an AFFIRMATIVE store rejection ('invalid' — the store told
 * us the receipt is bad) from an inability to reach a verdict ('unavailable'
 * — the store was unreachable, timed out, or a server credential is missing).
 * Only the former is a terminal rejection; 'unavailable' is retryable, so the
 * caller leaves the store transaction unfinished for later re-validation
 * instead of burning a real buyer's purchase during a store outage.
 */

export type ValidationOutcome = 'valid' | 'invalid' | 'unavailable';

export type ReceiptVerdict =
  | { grant: true; expiryDate: Date }
  | { grant: false; reason: 'not_validated' | 'expired'; retryable: boolean };

export function receiptVerdict(params: {
  outcome: ValidationOutcome;
  storeExpiry: Date | null;
  productId: string;
  now: Date;
}): ReceiptVerdict {
  const { outcome, storeExpiry, productId, now } = params;

  // Couldn't reach a verdict (store unreachable / missing credentials) — do
  // not grant, but signal retry so the buyer's transaction isn't consumed.
  if (outcome === 'unavailable') return { grant: false, reason: 'not_validated', retryable: true };
  // Store affirmatively rejected the receipt — terminal.
  if (outcome === 'invalid') return { grant: false, reason: 'not_validated', retryable: false };

  // outcome === 'valid'
  if (storeExpiry) {
    // A validated but already-lapsed subscription must not re-grant Pro
    // (checkQuoteLimit trusts isPro without re-checking currentPeriodEnd).
    if (storeExpiry.getTime() <= now.getTime()) return { grant: false, reason: 'expired', retryable: false };
    return { grant: true, expiryDate: storeExpiry };
  }
  // Validated with no store expiry (e.g. Apple status 0 without
  // latest_receipt_info) — grant one period derived from the productId.
  const isYearly = productId.includes('yearly');
  const periodMs = (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000;
  return { grant: true, expiryDate: new Date(now.getTime() + periodMs) };
}

/**
 * Is this validation the FIRST grant of a given store transaction?
 *
 * Both stores hand a LIVE subscription back on every launch — StoreKit's
 * currentEntitlements (via getAvailablePurchases) and Play's equivalent — and
 * the launch-time sweep re-posts whatever they hand back. So these endpoints
 * routinely re-validate a receipt they entitled weeks ago. Writing the
 * entitlement again is harmless and should keep happening; the side effects
 * that mean "someone just upgraded" must not.
 *
 * Before this gate a single yearly subscriber generated a "💰 New Pro
 * subscriber" admin email every time they opened the app, and re-entered
 * processReferralCommission on each launch — where a new month's billing
 * bucket would mint a second commission for one upfront payment.
 *
 * A renewal mints a NEW transactionId, so real recurring revenue still reads
 * as a new grant. When either id is missing we return true: failing open
 * costs a duplicate alert, failing closed silently swallows a real sale.
 */
export function isFirstGrantOfTransaction(
  priorSub: { isPro?: unknown; transactionId?: unknown } | undefined | null,
  transactionId: string,
): boolean {
  if (!priorSub || priorSub.isPro !== true) return true;
  if (typeof priorSub.transactionId !== 'string' || !priorSub.transactionId) return true;
  if (!transactionId) return true;
  return priorSub.transactionId !== transactionId;
}
