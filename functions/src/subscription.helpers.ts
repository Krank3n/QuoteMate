/**
 * Pure, dependency-free subscription-field helpers shared by the admin CRM
 * callables (adminCrm.ts) and the funnel analytics (adminFunnel.helpers.ts).
 *
 * Extracted verbatim from adminCrm.ts so tier/status/billing derivation stays a
 * single source of truth AND can be unit-tested without Firestore / firebase.
 */

// Subscription data lives at users/{uid}/profile/subscription — NOT at top-level
// subscriptions/{uid} (which is empty in this app). Field shape varies by source:
//   - Stripe webhook sets: isPro, platform:'web', cancelAtPeriodEnd, currentPeriod*, subscriptionId, customerId
//   - Apple/Google validate: isPro:true, platform:'ios'|'android', currentPeriodEnd (Date)
//   - Client trial code (firestoreService.ts): isPro:false, NO platform, currentPeriodEnd stored as ISO STRING,
//     plus trialStartedAt (ISO string). This accounts for 80 of the 82 docs.
// "Canceled Pro" ≠ "trial expired" ≠ "free quota" — distinguish for the admin CRM.
// Must match src/utils/trialConfig.ts TRIAL_DAYS — update both together.
export const TRIAL_DAYS = 14;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// Monthly-equivalent AUD we actually bill per subscription. Source of truth:
// the live Stripe "Starter" prices ($49/mo, $328/yr); the iOS/Android yearly
// SKUs are priced to match. Update here if prices change.
const SUB_PRICE_AUD = { monthly: 49, yearly: 328 };

// Apple StoreKit 2 purchase tokens are JWS blobs (header.payload.signature)
// whose payload records the purchase environment ('Sandbox' | 'Production').
// validateAppleReceipt writes isPro + productId even when Apple validation
// fails, so a sandbox/TestFlight purchase is otherwise indistinguishable from
// a paid sub. Reads an explicit `environment` field first so a backfill can
// override without re-decoding.
export function subEnvironment(sub: any): string | null {
  if (typeof sub?.environment === 'string') return sub.environment;
  const token = sub?.purchaseToken;
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null; // legacy base64 receipts aren't JWS
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.environment === 'string' ? payload.environment : null;
  } catch {
    return null;
  }
}

// A subscription only contributes MRR if it's backed by a real billing record:
// an app-store purchase (productId) or a Stripe subscription (subscriptionId /
// priceId). Admin comps (platform 'admin_grant'), bare manual isPro flags
// (owner / test / orphan accounts), and App Store sandbox purchases bill $0 —
// counting them is what inflated the old "9 × $29" estimate.
export function isBilledSub(sub: any): boolean {
  if (!sub?.isPro) return false;
  if (sub.platform === 'admin_grant') return false;
  if ((subEnvironment(sub) || '').toLowerCase() === 'sandbox') return false;
  return !!(sub.productId || sub.subscriptionId || sub.priceId);
}

// A paying subscriber whose account was rebuilt by the incident-2026-07
// reclaim flow: Pro restored on a store platform, but the billing identifiers
// are gone until their device re-validates the receipt (accountReclaim.helpers
// buildProRestorePatch). Their Apple/Google billing kept running independently
// of Firebase, so for HEADCOUNT purposes they are paying — but they carry no
// verifiable billing record, so keep them out of isBilledSub/MRR maths.
export function isRestoredStorePro(sub: any, nowMs: number): boolean {
  if (!sub?.isPro || isBilledSub(sub)) return false;
  if (!sub.restoredFromIncident) return false;
  const platform = String(sub.platform || '').toLowerCase();
  if (platform !== 'ios' && platform !== 'android') return false;
  const until = typeof sub.incidentProUntil === 'string' ? Date.parse(sub.incidentProUntil) : NaN;
  return Number.isFinite(until) && until > nowMs;
}

function subInterval(sub: any): 'yearly' | 'monthly' {
  const i = String(sub?.interval || sub?.planInterval || '').toLowerCase();
  if (i.startsWith('year') || i.startsWith('annual')) return 'yearly';
  if (i.startsWith('month')) return 'monthly';
  const sku = String(sub?.productId || sub?.priceId || '').toLowerCase();
  if (sku.includes('year') || sku.includes('annual')) return 'yearly';
  return 'monthly';
}

// Monthly recurring revenue this subscription represents (AUD), 0 if not billed.
function monthlyRevenueAud(sub: any): number {
  if (!isBilledSub(sub)) return 0;
  return subInterval(sub) === 'yearly'
    ? Math.round((SUB_PRICE_AUD.yearly / 12) * 100) / 100
    : SUB_PRICE_AUD.monthly;
}

export interface SubFields {
  isPro: boolean;
  canceling: boolean;
  platform: string | null;
  tier: 'pro' | 'pro_canceling' | 'trialing' | 'trial_expired' | 'free';
  status: 'active' | 'canceling' | 'trialing' | 'trial_expired' | 'canceled' | 'free';
  productId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  validatedAt: number | null;
  cancelAt: number | null;
  trialStartedAt: number | null;
  trialDaysRemaining: number | null;
  billed: boolean;
  interval: 'yearly' | 'monthly' | null;
  monthlyAud: number;
}

export function ts(v: any): number | null {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  if (v._seconds) return v._seconds * 1000;
  if (v.toMillis) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

export function deriveSubFields(sub: any | undefined | null, now: number = Date.now()): SubFields {
  const isPro = !!sub?.isPro;
  const canceling = isPro && !!sub?.cancelAtPeriodEnd;
  const platform = sub?.platform || null;
  const trialStartedAt = ts(sub?.trialStartedAt);
  const trialElapsed = trialStartedAt ? now - trialStartedAt : Infinity;
  const inTrial = trialStartedAt !== null && trialElapsed < TRIAL_MS;
  const trialDaysRemaining = inTrial ? Math.ceil((TRIAL_MS - trialElapsed) / (24 * 60 * 60 * 1000)) : null;

  let tier: SubFields['tier'];
  let status: SubFields['status'];
  if (isPro) {
    tier = canceling ? 'pro_canceling' : 'pro';
    status = canceling ? 'canceling' : 'active';
  } else if (inTrial) {
    tier = 'trialing';
    status = 'trialing';
  } else if (trialStartedAt !== null && !inTrial) {
    tier = 'trial_expired';
    status = 'trial_expired';
  } else if (platform === 'web' && sub?.subscriptionId) {
    // Had a Stripe subscription that's no longer active = genuinely canceled Pro
    tier = 'free';
    status = 'canceled';
  } else {
    tier = 'free';
    status = 'free';
  }

  return {
    isPro,
    canceling,
    platform,
    tier,
    status,
    productId: sub?.productId || null,
    currentPeriodStart: ts(sub?.currentPeriodStart),
    currentPeriodEnd: ts(sub?.currentPeriodEnd),
    validatedAt: ts(sub?.validatedAt),
    cancelAt: canceling ? ts(sub?.currentPeriodEnd) : null,
    trialStartedAt,
    trialDaysRemaining,
    billed: isBilledSub(sub),
    interval: isBilledSub(sub) ? subInterval(sub) : null,
    monthlyAud: monthlyRevenueAud(sub),
  };
}
