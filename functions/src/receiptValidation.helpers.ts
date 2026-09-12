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
import { isBilledSub, ts } from './subscription.helpers';

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
 * Is this validation the FIRST time we grant Pro for this sale?
 *
 * Both stores hand a LIVE subscription back on every launch — StoreKit's
 * currentEntitlements (via getAvailablePurchases) and Play's equivalent — and
 * the launch-time sweep re-posts whatever they hand back. So these endpoints
 * routinely re-validate a receipt they entitled weeks ago. Writing the
 * entitlement again is harmless and should keep happening; the side effects
 * that mean "someone just paid" (referral commission) must not.
 *
 * Before this gate a single yearly subscriber generated a "💰 New Pro
 * subscriber" admin email every time they opened the app, and re-entered
 * processReferralCommission on each launch — where a new month's billing
 * bucket would mint a second commission for one upfront payment.
 *
 * A renewal mints a NEW transactionId, so real recurring revenue still reads
 * as a new grant. When either id is missing we return true: failing open
 * costs a duplicate alert, failing closed silently swallows a real sale.
 *
 * Sep 2026: a subscriber whose Play renewal the nightly sweep had NOT seen
 * (they hadn't opened the app for 3 days after it) was flipped to isPro:false,
 * then re-validated the very same transaction on their next launch. Because
 * the prior doc was no longer Pro, that re-grant read as a first grant: a
 * fresh "new subscriber" email and a second pass through commission. So a
 * prior doc that carries an expiry/revoke marker for the SAME sale is a
 * re-grant, not a first grant. A doc with the same id but no marker is still
 * a first grant — that is the charged-but-never-entitled shape
 * recoverStuckPurchases.ts heals, and it MUST keep alerting.
 *
 * `purchaseToken` is the Play token (stable for the life of a subscription)
 * or the StoreKit JWS (unique per transaction) — either way, a match means
 * the same sale.
 */
export function isFirstGrantOfTransaction(
  priorSub: PriorSub | undefined | null,
  transactionId: string,
  purchaseToken?: string | null,
): boolean {
  if (!priorSub) return true;
  const sameSale = sameSaleAsPrior(priorSub, { transactionId, purchaseToken });
  if (priorSub.isPro === true) return !sameSale;
  return !(sameSale && wasEntitledBefore(priorSub));
}

export type PriorSub = {
  isPro?: unknown;
  transactionId?: unknown;
  originalTransactionId?: unknown;
  purchaseToken?: unknown;
  expiredAt?: unknown;
  expiredReason?: unknown;
  revokedAt?: unknown;
};

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function sameSaleAsPrior(
  prior: PriorSub,
  cur: { transactionId?: string | null; purchaseToken?: string | null },
): boolean {
  if (nonEmpty(prior.transactionId) && nonEmpty(cur.transactionId) && prior.transactionId === cur.transactionId) return true;
  if (nonEmpty(prior.purchaseToken) && nonEmpty(cur.purchaseToken) && prior.purchaseToken === cur.purchaseToken) return true;
  return false;
}

/** The doc was Pro once and something (sweep, admin) switched it off. */
function wasEntitledBefore(prior: PriorSub): boolean {
  return prior.expiredAt != null || prior.expiredReason != null || prior.revokedAt != null;
}

/**
 * Is this a subscriber we have never seen before — as opposed to a renewal
 * or a re-grant of a subscription already on the doc?
 *
 * The "💰 New Pro subscriber" admin email must fire once per SUBSCRIPTION,
 * not once per billing period: Apple mints a new transactionId on every
 * renewal (so isFirstGrantOfTransaction rightly says "new money" for
 * commission), but the subscriber is the same person on the same plan.
 * Apple's originalTransactionId and Play's purchaseToken are both stable for
 * the life of a subscription, so a match on either — whatever isPro says —
 * means we already alerted on this one.
 */
export function isNewSubscriber(
  priorSub: PriorSub | undefined | null,
  cur: { originalTransactionId?: string | null; purchaseToken?: string | null; transactionId?: string | null },
): boolean {
  if (!priorSub) return true;
  const priorOriginal = priorSub.originalTransactionId;
  if (nonEmpty(priorOriginal) && nonEmpty(cur.originalTransactionId) && priorOriginal === cur.originalTransactionId) return false;
  return !sameSaleAsPrior(priorSub, cur);
}

// ---------------------------------------------------------------------------
// Nightly expiry sweep — what to do with a sub whose period end has passed.
// ---------------------------------------------------------------------------

/** Renewal lag we tolerate before asking the store what happened. */
export const IAP_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * If the store can't tell us (API down, key lacks access), how long past the
 * period end we keep a sub alive before cutting it off anyway. Long enough
 * that a paying subscriber who simply hasn't opened the app is not locked
 * out; short enough that a genuinely lapsed sub does not stay Pro forever.
 */
export const IAP_UNVERIFIED_BACKSTOP_MS = 14 * 24 * 60 * 60 * 1000;

export type StoreStatus = {
  outcome: ValidationOutcome;
  /** The store's own expiry for the subscription, when it reported one. */
  expiryDate: Date | null;
  priceMicros?: number | null;
  currency?: string | null;
  /** Short machine-readable note for logs. */
  detail: string;
};

export type StaleAction =
  | { action: 'keep'; reason: 'not_stale' | 'store_live_no_expiry' | 'store_unavailable_within_backstop' }
  | { action: 'renew'; expiryDate: Date }
  | { action: 'expire'; reason: 'store_confirmed' | 'unchecked' | 'unverified_backstop' };

/**
 * Decide the sweep's action for one store subscription. Pure so it can be
 * tested without Firestore or the stores.
 *
 * - Not past period end + grace → keep (the caller need not ask the store).
 * - Store says live with a later expiry → renew: record the new period end.
 *   This is the Sep-2026 case — Play renewed, nobody told us.
 * - Store says live but can't give an expiry → keep; re-asked next night.
 * - Store says lapsed/expired/revoked → expire.
 * - Store unreachable → keep until the backstop, then expire anyway.
 * - No store credentials/token to check (`store` null) → expire, as before.
 */
export function staleSubscriptionAction(params: {
  periodEndMs: number | null;
  nowMs: number;
  store: StoreStatus | null | undefined;
}): StaleAction {
  const { periodEndMs, nowMs, store } = params;
  if (!periodEndMs || periodEndMs + IAP_GRACE_MS > nowMs) return { action: 'keep', reason: 'not_stale' };
  if (!store) return { action: 'expire', reason: 'unchecked' };
  if (store.outcome === 'valid') {
    if (!store.expiryDate) return { action: 'keep', reason: 'store_live_no_expiry' };
    if (store.expiryDate.getTime() > nowMs) return { action: 'renew', expiryDate: store.expiryDate };
    return { action: 'expire', reason: 'store_confirmed' };
  }
  if (store.outcome === 'invalid') return { action: 'expire', reason: 'store_confirmed' };
  if (periodEndMs + IAP_UNVERIFIED_BACKSTOP_MS <= nowMs) return { action: 'expire', reason: 'unverified_backstop' };
  return { action: 'keep', reason: 'store_unavailable_within_backstop' };
}

export type CompAction =
  | { action: 'keep' }
  | { action: 'expire'; reason: 'admin_grant_lapsed' | 'goodwill_lapsed' };

/**
 * Decide the sweep's action for a comped sub — one with no store or Stripe
 * behind it, so there is nobody to ask and the end date on the doc is the
 * whole truth. Same grace as the store path. Pure, like the one above.
 *
 * - platform 'admin_grant' with `currentPeriodEnd` past + grace → expire.
 * - An incident goodwill grant (`restoredFromIncident`) on a NON-store
 *   platform with `incidentProUntil` past + grace → expire. Store-platform
 *   restores are the store path's business (see isRestoredStorePro).
 * - A doc with no end date at all is never touched: bare `isPro: true` with
 *   no platform is the owner/demo account.
 * - A doc with a real billing record (a restored payer who has since
 *   re-subscribed through Stripe) belongs to that webhook, not to this.
 */
export function lapsedCompAction(sub: any, nowMs: number): CompAction {
  if (!sub?.isPro || isBilledSub(sub)) return { action: 'keep' };
  const platform = String(sub.platform || '').toLowerCase();
  if (platform === 'admin_grant') {
    const end = ts(sub.currentPeriodEnd);
    if (end !== null && end + IAP_GRACE_MS <= nowMs) return { action: 'expire', reason: 'admin_grant_lapsed' };
    return { action: 'keep' };
  }
  if (sub.restoredFromIncident && platform !== 'ios' && platform !== 'android') {
    const until = typeof sub.incidentProUntil === 'string' ? Date.parse(sub.incidentProUntil) : NaN;
    if (Number.isFinite(until) && until + IAP_GRACE_MS <= nowMs) return { action: 'expire', reason: 'goodwill_lapsed' };
  }
  return { action: 'keep' };
}
