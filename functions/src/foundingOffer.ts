/**
 * Founding Member offer — CAP-ONLY model (decided 2026-07-16).
 *
 * The first FOUNDING_CAP billed subscribers lock the current $49/mo ($328/yr)
 * price for life; once the cap fills, the store/Stripe base prices genuinely
 * rise to NEXT_PRICE_AUD (today's struck-through anchor, making it honest)
 * and existing members are grandfathered.
 *
 * Deliberately absent: the per-user 72h post-trial claim window from the
 * original spec. Apple/Google can't charge different users different prices
 * for one product without a configured intro offer, and none is configured —
 * so no per-user deadline appears anywhere in copy until that store ops work
 * is done. The only scarcity is the cap, and it is real: `taken` is computed
 * from actual billed subscriptions (isBilledSub — bare isPro flags and
 * admin_grant comps never count), published by the aggregateEventFunnel cron
 * to config/foundingOffer (public read, server-only write).
 */
export const FOUNDING_CAP = 100;

// Price after the cap fills. MUST equal the app's REGULAR_PRICE_AUD anchor
// (src/config/pricingConfig.ts) — that anchor is the promise being made.
export const NEXT_PRICE_AUD = { monthly: 99, yearly: 658 };

export interface FoundingOfferStatus {
  taken: number;
  cap: number;
  /** Never negative, even if billed subs somehow exceed the cap. */
  spotsLeft: number;
  /** False once the cap is filled — all founding framing must disappear. */
  capActive: boolean;
}

/** Pure status derivation from the real billed-subscriber count. */
export function foundingOfferStatus(taken: number, cap: number = FOUNDING_CAP): FoundingOfferStatus {
  const safeTaken = Math.max(0, Math.floor(taken) || 0);
  const spotsLeft = Math.max(0, cap - safeTaken);
  return { taken: safeTaken, cap, spotsLeft, capActive: spotsLeft > 0 };
}
