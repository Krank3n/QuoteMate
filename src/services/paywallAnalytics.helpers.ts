/**
 * Pure helpers for paywall/purchase analytics. Kept free of native and
 * firebase imports so they unit-test without the expo-iap module.
 */

export type PurchasePlan = 'monthly' | 'yearly' | 'unknown';

/**
 * Map a store SKU / product id to the plan it represents. Covers both the
 * Android (quotemate_premium_*) and iOS (quotemate_pro_*) SKU families; web
 * Stripe price ids don't encode a period and resolve to 'unknown' — the web
 * flow reports its own selectedPlan instead.
 */
export function planFromSku(sku: string | null | undefined): PurchasePlan {
  if (!sku) return 'unknown';
  const s = sku.toLowerCase();
  if (s.includes('yearly') || s.includes('annual')) return 'yearly';
  if (s.includes('monthly')) return 'monthly';
  return 'unknown';
}

/** Analytics payload for a completed store purchase. */
export function resolvePurchaseAnalytics(
  purchase: { productId?: string | null } | null | undefined,
  platform: string
): { plan: PurchasePlan; platform: string } {
  return { plan: planFromSku(purchase?.productId), platform };
}
