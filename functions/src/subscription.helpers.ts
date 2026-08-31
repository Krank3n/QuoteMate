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

// Resolve a user's effective tier from their profile/subscription doc for
// server-side gating (free-tier send gate, Square fee tier, invoice payment
// block). Source of truth on the server so the client cannot claim a tier.
//
// SECURITY (PAY-02): a stored `plan` string is NOT trusted — it was
// historically client-writable, so a free/expired user could set
// plan:'trial' or plan:'pro' to dodge the free-tier gate and the higher fee.
// `isPro` is server-owned (firestore.rules denies client true-writes and every
// server Pro-writer — Stripe, Apple/Google validators, incident restore — sets
// it), so it is the only trustworthy Pro signal; trial/free is re-derived from
// trialStartedAt. (trialStartedAt stays client-writable for the first-quote
// trial bootstrap — a known, separately-tracked weakness; gaming it only
// extends the trial, it does not grant Pro.)
export function resolveServerPlan(
  data: Record<string, any> | undefined | null,
  nowMs: number,
): 'trial' | 'free' | 'pro' {
  if (!data) return 'trial';
  if (data.isPro === true) return 'pro';
  const rawStart = data.trialStartedAt;
  if (rawStart) {
    const startedAt = rawStart?.toDate ? rawStart.toDate() : new Date(rawStart);
    const startMs = startedAt.getTime();
    if (Number.isFinite(startMs)) {
      return nowMs - startMs < TRIAL_MS ? 'trial' : 'free';
    }
  }
  return 'trial';
}

// Monthly-equivalent AUD we actually bill per subscription. Source of truth:
// the live Stripe "Starter" prices ($49/mo, $328/yr); the iOS/Android yearly
// SKUs are priced to match. Update here if prices change.
export const SUB_PRICE_AUD = { monthly: 49, yearly: 328 };

// Apple StoreKit 2 purchase tokens are JWS blobs (header.payload.signature).
// The payload is a signed transaction record: environment, ids, AND the price
// actually charged (`price` in milliunits + `currency`), so a stored token is
// a free, offline source of truth for what a subscriber really pays.
export function appleJwsPayload(sub: any): Record<string, any> | null {
  const token = sub?.purchaseToken;
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null; // legacy base64 receipts aren't JWS
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

// The purchase environment ('Sandbox' | 'Production'). Until Jul 2026
// validateAppleReceipt wrote isPro + productId even when Apple validation
// failed (fixed — PAY-01, receiptValidation.helpers.ts), so HISTORICAL
// sandbox/TestFlight docs are otherwise indistinguishable from paid subs.
// Reads an explicit `environment` field first so a backfill can override
// without re-decoding.
export function subEnvironment(sub: any): string | null {
  if (typeof sub?.environment === 'string') return sub.environment;
  const payload = appleJwsPayload(sub);
  return typeof payload?.environment === 'string' ? payload.environment : null;
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

export function subInterval(sub: any): 'yearly' | 'monthly' {
  const i = String(sub?.interval || sub?.priceInterval || sub?.planInterval || '').toLowerCase();
  if (i.startsWith('year') || i.startsWith('annual')) return 'yearly';
  if (i.startsWith('month')) return 'monthly';
  const sku = String(sub?.productId || sub?.priceId || '').toLowerCase();
  if (sku.includes('year') || sku.includes('annual')) return 'yearly';
  return 'monthly';
}

export interface SubPriceInfo {
  /** Amount charged per billing period, in `currency` units. */
  amount: number;
  currency: string;
  interval: 'yearly' | 'monthly';
  /**
   * 'store' = the amount the store/Stripe says this subscriber is billed.
   * 'listed' = today's list price, used only when the doc carries no real
   * amount. A grandfathered subscriber (the Android SKUs were A$29/A$199
   * before 2026-08-04) is billed their OLD price forever, so a 'listed' row
   * is a guess and is flagged as such in the admin.
   */
  source: 'store' | 'listed';
}

// What this subscriber is actually charged, best source first:
//   1. priceMicros/priceCurrency stamped at validation (receipt validators,
//      Stripe webhook, scripts/backfillSubPrices.ts),
//   2. the signed Apple JWS still sitting on the doc,
//   3. today's list price — a fallback, never a fact.
export function subPriceInfo(sub: any): SubPriceInfo {
  const interval = subInterval(sub);

  const micros = Number(sub?.priceMicros);
  const storedCurrency = typeof sub?.priceCurrency === 'string' ? sub.priceCurrency.toUpperCase() : null;
  if (Number.isFinite(micros) && micros > 0 && storedCurrency) {
    return { amount: micros / 1e6, currency: storedCurrency, interval, source: 'store' };
  }

  // Apple quotes `price` in milliunits (329000 = A$329.00), Google in micros.
  const jws = appleJwsPayload(sub);
  const jwsPrice = Number(jws?.price);
  if (jws && Number.isFinite(jwsPrice) && jwsPrice > 0 && typeof jws?.currency === 'string') {
    return { amount: jwsPrice / 1000, currency: jws.currency.toUpperCase(), interval, source: 'store' };
  }

  return {
    amount: interval === 'yearly' ? SUB_PRICE_AUD.yearly : SUB_PRICE_AUD.monthly,
    currency: 'AUD',
    interval,
    source: 'listed',
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fields to merge onto a subscription doc so the price a subscriber is REALLY
 * charged is recorded at the moment the store tells us, instead of being
 * re-guessed from the current list price on every admin read.
 *
 * Returns {} when the store gave us nothing usable — a missing price must
 * never blank out a good one already on the doc.
 */
export function storePricePatch(input: {
  micros: number | null | undefined;
  currency: string | null | undefined;
  interval: 'yearly' | 'monthly';
  source: 'apple' | 'google' | 'stripe';
  now?: Date;
}): Record<string, any> {
  const micros = Number(input.micros);
  const currency = typeof input.currency === 'string' ? input.currency.toUpperCase() : '';
  if (!Number.isFinite(micros) || micros <= 0 || !currency) return {};
  return {
    priceMicros: Math.round(micros),
    priceCurrency: currency,
    priceInterval: input.interval,
    priceCapturedFrom: input.source,
    priceCapturedAt: (input.now || new Date()).toISOString(),
  };
}


// A billed sub whose paid period has run out is NOT revenue. Firestore only
// learns about a renewal when the device re-validates its receipt, so a lapsed
// row means "unconfirmed", not "definitely churned" — the admin reports these
// separately instead of quietly banking them.
export function subPeriodEnded(sub: any, nowMs: number = Date.now()): boolean {
  const end = ts(sub?.currentPeriodEnd);
  return end !== null && end < nowMs;
}

// Monthly recurring revenue this subscription represents (AUD), 0 if it isn't
// billed, its period has lapsed, or it bills in a foreign currency (no FX rate
// here — a non-AUD sub is surfaced separately rather than counted at face
// value).
export function monthlyRevenueAud(sub: any, nowMs: number = Date.now()): number {
  if (!isBilledSub(sub)) return 0;
  if (subPeriodEnded(sub, nowMs)) return 0;
  const price = subPriceInfo(sub);
  if (price.currency !== 'AUD') return 0;
  return price.interval === 'yearly' ? round2(price.amount / 12) : round2(price.amount);
}

// Money that actually lands in the bank, per month.
//
// App stores: an AU store price is GST-inclusive and the store remits that GST
// itself (it is the merchant of record for GST on AU app sales), then keeps a
// 15% Small Business Program commission. Developer proceeds = ex-GST × 0.85.
//
// Stripe: QuoteMate is the merchant of record, so the full GST-inclusive
// amount is received and any GST liability is separate (and only exists if
// registered) — deduct the processing fee only. The 30c is charged once per
// invoice, so an annual plan carries a twelfth of it per month.
export const GST_RATE = 0.1;
export const STORE_COMMISSION_RATE = 0.15;
export const STRIPE_FEE_RATE = 0.0175;
export const STRIPE_FEE_FIXED_AUD = 0.3;

export function netMonthlyRevenueAud(sub: any, nowMs: number = Date.now()): number {
  const gross = monthlyRevenueAud(sub, nowMs);
  if (gross <= 0) return 0;
  const platform = String(sub?.platform || '').toLowerCase();
  if (platform === 'ios' || platform === 'android') {
    return round2((gross / (1 + GST_RATE)) * (1 - STORE_COMMISSION_RATE));
  }
  if (platform === 'web') {
    const chargesPerMonth = subInterval(sub) === 'yearly' ? 1 / 12 : 1;
    return round2(gross * (1 - STRIPE_FEE_RATE) - STRIPE_FEE_FIXED_AUD * chargesPerMonth);
  }
  return gross;
}

// Identity of the STORE PURCHASE behind a subscription, so one purchase can
// only be counted once. Two Firebase accounts routinely share one purchase:
// someone signs up again after a failed validation (one Play subscription
// landed on two accounts that way in Aug 2026, and MRR counted it twice) or an
// account gets rebuilt. Keyed on the purchase, not the account.
export function storePurchaseKey(sub: any): string | null {
  const platform = String(sub?.platform || '').toLowerCase();
  if (platform === 'ios') {
    const jws = appleJwsPayload(sub);
    const id = jws?.originalTransactionId || sub?.originalTransactionId || sub?.transactionId;
    return id ? `ios:${id}` : null;
  }
  if (platform === 'android') {
    // purchaseToken is stable across the life of a Play subscription; order
    // ids gain a "..N" suffix on each renewal, so strip it.
    const token = sub?.purchaseToken || sub?.transactionId;
    return token ? `android:${String(token).split('..')[0]}` : null;
  }
  if (platform === 'web') {
    const id = sub?.subscriptionId || sub?.customerId;
    return id ? `web:${id}` : null;
  }
  return null;
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
  /**
   * When the 14-day trial runs (or ran) out. NOT currentPeriodEnd — for a
   * non-Pro user that field is the calendar month end of the free-quote
   * counter, so reading it as a trial date makes every trial look like it
   * ended on the 1st of the month.
   */
  trialEndsAt: number | null;
  trialDaysRemaining: number | null;
  billed: boolean;
  interval: 'yearly' | 'monthly' | null;
  /** Monthly-equivalent AUD this sub bills right now (0 once the period lapses). */
  monthlyAud: number;
  /** What lands in the bank after the store cut / processor fee. */
  netMonthlyAud: number;
  /** The amount charged per period, as the store/Stripe reports it. */
  priceAmount: number;
  priceCurrency: string;
  /** 'listed' = priced from today's list price because the doc carries none. */
  priceSource: 'store' | 'listed';
  /** Billed, but the paid period has run out and no renewal has been seen. */
  periodEnded: boolean;
  /** Identity of the underlying store purchase — dedupes shared purchases. */
  purchaseKey: string | null;
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
  const price = subPriceInfo(sub);
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
    trialEndsAt: trialStartedAt !== null ? trialStartedAt + TRIAL_MS : null,
    trialDaysRemaining,
    billed: isBilledSub(sub),
    interval: isBilledSub(sub) ? subInterval(sub) : null,
    monthlyAud: monthlyRevenueAud(sub, now),
    netMonthlyAud: netMonthlyRevenueAud(sub, now),
    priceAmount: price.amount,
    priceCurrency: price.currency,
    priceSource: price.source,
    periodEnded: isBilledSub(sub) && subPeriodEnded(sub, now),
    purchaseKey: isBilledSub(sub) ? storePurchaseKey(sub) : null,
  };
}

// ============================================================
// REVENUE ROLLUP
// ============================================================

export interface RevenueEntry {
  uid: string;
  billed: boolean;
  platform: string | null;
  interval: 'yearly' | 'monthly' | null;
  monthlyAud: number;
  netMonthlyAud: number;
  /** Amount charged per period — used to price a lapsed row's at-risk MRR. */
  priceAmount: number;
  priceCurrency: string;
  priceSource: 'store' | 'listed';
  periodEnded: boolean;
  purchaseKey: string | null;
  restored?: boolean;
}

export interface PlatformRevenue {
  payers: number;
  mrrGross: number;
  mrrNet: number;
}

export interface RevenueRollup {
  /** Distinct store/Stripe purchases currently billing. */
  payers: number;
  mrrGross: number;
  mrrNet: number;
  arrGross: number;
  arrNet: number;
  byPlatform: Record<string, PlatformRevenue>;
  byInterval: { monthly: number; yearly: number };
  /** Rows priced from the list price because no real amount is stored. */
  estimatedPricing: number;
  /** Extra accounts sharing a purchase already counted (uid list). */
  duplicateUids: string[];
  /** Billed, but the paid period ended and no renewal has been confirmed. */
  lapsed: { count: number; mrrGross: number };
  /** Incident-restored store payers with no billing record to price. */
  restoredUnverified: number;
  /** Billed in a currency other than AUD — excluded from the AUD totals. */
  foreignCurrency: number;
}

const emptyPlatform = (): PlatformRevenue => ({ payers: 0, mrrGross: 0, mrrNet: 0 });

/**
 * Roll per-account rows up into the revenue numbers the admin reports.
 *
 * Deduplicates by store purchase (one purchase = one payer, however many
 * Firebase accounts carry it), keeps lapsed periods out of MRR, and reports
 * how much of the total is a guess rather than a store-confirmed amount.
 */
export function rollupRevenue(entries: RevenueEntry[]): RevenueRollup {
  const out: RevenueRollup = {
    payers: 0,
    mrrGross: 0,
    mrrNet: 0,
    arrGross: 0,
    arrNet: 0,
    byPlatform: {},
    byInterval: { monthly: 0, yearly: 0 },
    estimatedPricing: 0,
    duplicateUids: [],
    lapsed: { count: 0, mrrGross: 0 },
    restoredUnverified: 0,
    foreignCurrency: 0,
  };

  const seen = new Map<string, RevenueEntry>();
  for (const e of entries) {
    if (e.restored && !e.billed) out.restoredUnverified++;
    if (!e.billed) continue;

    if (e.periodEnded) {
      // monthlyAud is 0 once a period lapses, so price the at-risk amount from
      // the last known price instead.
      out.lapsed.count++;
      out.lapsed.mrrGross = round2(
        out.lapsed.mrrGross + (e.interval === 'yearly' ? e.priceAmount / 12 : e.priceAmount)
      );
      continue;
    }

    if (e.priceCurrency !== 'AUD') {
      out.foreignCurrency++;
      continue;
    }

    // One store purchase, one payer. Keep the first row and record the rest as
    // duplicates so they can be cleaned up rather than silently double-counted.
    const key = e.purchaseKey;
    if (key) {
      const prior = seen.get(key);
      if (prior) {
        out.duplicateUids.push(e.uid);
        continue;
      }
      seen.set(key, e);
    }

    out.payers++;
    out.mrrGross += e.monthlyAud;
    out.mrrNet += e.netMonthlyAud;
    if (e.priceSource === 'listed') out.estimatedPricing++;
    if (e.interval === 'yearly') out.byInterval.yearly++;
    else out.byInterval.monthly++;

    const platform = e.platform || 'unknown';
    const bucket = (out.byPlatform[platform] = out.byPlatform[platform] || emptyPlatform());
    bucket.payers++;
    bucket.mrrGross = round2(bucket.mrrGross + e.monthlyAud);
    bucket.mrrNet = round2(bucket.mrrNet + e.netMonthlyAud);
  }

  out.mrrGross = round2(out.mrrGross);
  out.mrrNet = round2(out.mrrNet);
  out.arrGross = round2(out.mrrGross * 12);
  out.arrNet = round2(out.mrrNet * 12);
  return out;
}
