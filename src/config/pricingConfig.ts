/**
 * Paywall pricing: what we charge today, and the committed post-cap price.
 *
 * REGULAR_PRICE_AUD is the price new members will pay once the founding-member
 * cap fills (cap-only model, decided 2026-07-16) — a FUTURE price, not a "was"
 * price. Nobody has ever been charged it yet. It must equal NEXT_PRICE_AUD in
 * functions/src/foundingOffer.ts (crossPackageMirrors.guard.test.ts pins both),
 * because that rise is the promise the founding offer makes: when the cap
 * fills, the store/Stripe base prices genuinely move to these amounts and
 * founding members are grandfathered at ACTUAL_PRICE_AUD.
 *
 * Display rule (paywall + website): founding framing and the struck-through
 * anchor only render while config/foundingOffer confirms capActive — never as
 * an unconditional "launch discount".
 *
 * The real charged prices live in the App Store / Play Store subscription
 * products and the Stripe prices. ACTUAL_PRICE_AUD below must be kept in sync
 * with those. If you ever change what is actually charged, update the
 * store/Stripe products AND this file together.
 */
export type BillingPeriod = 'monthly' | 'yearly';

/** What we actually charge — must match the live store / Stripe prices (AUD). */
export const ACTUAL_PRICE_AUD: Record<BillingPeriod, number> = {
  monthly: 49,
  yearly: 328,
};

/** Post-founding-cap price (mirrors functions NEXT_PRICE_AUD). Not charged yet. */
export const REGULAR_PRICE_AUD: Record<BillingPeriod, number> = {
  monthly: 99,
  yearly: 658,
};

/** Formatted post-cap price for the given period, e.g. "$99". */
export const regularPriceLabel = (period: BillingPeriod): string =>
  `$${REGULAR_PRICE_AUD[period]}`;

/** Whole-number percent off the regular price, e.g. 51 for $99 → $49. */
export const discountPercent = (period: BillingPeriod): number =>
  Math.round((1 - ACTUAL_PRICE_AUD[period] / REGULAR_PRICE_AUD[period]) * 100);

/**
 * Whole-number percent the yearly plan saves vs paying monthly for a year —
 * derived from the charged prices so the paywall badge can never drift from
 * reality the way a hardcoded "Save 44%" could. $328 vs $588 → 44.
 */
export const yearlyVsMonthlySavingsPercent = (): number =>
  Math.round((1 - ACTUAL_PRICE_AUD.yearly / (ACTUAL_PRICE_AUD.monthly * 12)) * 100);

// Platform fee on Square payments, in basis points. Free-plan sends carry the
// higher fee; Pro drops it — the delta is Pro's concrete value for tradies
// already collecting. Mirrors the server's fee configuration.
export const FREE_PLAN_FEE_BPS = 170;
export const PRO_PLAN_FEE_BPS = 100;

/**
 * Dollars/month Pro's lower fee would keep, given real collected volume over
 * the last 30 days. Zero for zero/invalid volume — callers show nothing.
 */
export const monthlyFeeSaving = (collectedLast30d: number): number => {
  if (!Number.isFinite(collectedLast30d) || collectedLast30d <= 0) return 0;
  return (collectedLast30d * (FREE_PLAN_FEE_BPS - PRO_PLAN_FEE_BPS)) / 10000;
};

/** Below this monthly saving the fee-bleed claim is too thin to make. */
export const FEE_SAVING_CLAIM_THRESHOLD_AUD = 5;

/**
 * The paywall's fee-bleed line, or null when the data is too thin to claim
 * anything. Real volume only — never rendered from invented numbers.
 */
export const feeSavingLabel = (collectedLast30d: number): string | null => {
  const saving = monthlyFeeSaving(collectedLast30d);
  if (saving < FEE_SAVING_CLAIM_THRESHOLD_AUD) return null;
  return `On your recent volume, Pro's lower fee would keep you about $${Math.round(saving)}/mo`;
};

/**
 * Sum of REAL Square payments (webhook-written, method 'square') collected in
 * the last 30 days across the user's documents. Manual cash/bank records
 * don't count — they carry no platform fee, so they save nothing on Pro.
 */
export const squareCollectedLast30d = (
  docs: Array<{ payments?: Array<{ amount?: number; paidAt?: number; method?: string }> }>,
  nowMs: number,
): number => {
  const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const doc of docs) {
    for (const p of doc.payments ?? []) {
      if (p?.method !== 'square') continue;
      if (typeof p.paidAt !== 'number' || p.paidAt < cutoff || p.paidAt > nowMs) continue;
      total += Number(p.amount) || 0;
    }
  }
  return total;
};
