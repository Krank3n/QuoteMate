/**
 * Display-only "regular" (anchor) prices for the paywall.
 *
 * Customers are NEVER charged the REGULAR_PRICE_AUD amounts. They exist purely
 * to frame the actual charged price as a launch discount, via a struck-through
 * "was" price on the paywall and pricing page.
 *
 * The real charged prices live in the App Store / Play Store subscription
 * products and the Stripe prices. ACTUAL_PRICE_AUD below must be kept in sync
 * with those so the displayed discount percentage stays truthful. If you ever
 * change what is actually charged, update the store/Stripe products AND this
 * file together.
 */
export type BillingPeriod = 'monthly' | 'yearly';

/** What we actually charge — must match the live store / Stripe prices (AUD). */
export const ACTUAL_PRICE_AUD: Record<BillingPeriod, number> = {
  monthly: 49,
  yearly: 328,
};

/** The "regular" price shown struck-through. Display only — never charged. */
export const REGULAR_PRICE_AUD: Record<BillingPeriod, number> = {
  monthly: 99,
  yearly: 658,
};

/** Formatted regular ("was") price for the given period, e.g. "$99". */
export const regularPriceLabel = (period: BillingPeriod): string =>
  `$${REGULAR_PRICE_AUD[period]}`;

/** Whole-number percent off the regular price, e.g. 51 for $99 → $49. */
export const discountPercent = (period: BillingPeriod): number =>
  Math.round((1 - ACTUAL_PRICE_AUD[period] / REGULAR_PRICE_AUD[period]) * 100);
