/**
 * Store introductory offers, read off the product the store hands back.
 *
 * Both stores can attach a free introductory period to a subscription (set in
 * App Store Connect / the Play Console, not in code). When one is live and the
 * buyer is eligible, the store bills nothing on tap and takes the first charge
 * when the period ends. The paywall must say so — and must NOT say so when
 * the store reports no offer, or the buyer has used theirs. Everything here is
 * pure so the copy rules can be tested without expo-iap.
 *
 * Shapes (expo-iap 3.x, OpenIAP):
 *  - iOS: `subscriptionInfoIOS.introductoryOffer` with paymentMode 'free-trial'
 *    and a period {unit, value}; eligibility is a separate StoreKit query.
 *  - Android: `subscriptionOffers[]`, each with an offerTokenAndroid and
 *    `pricingPhasesAndroid.pricingPhaseList`; a free phase has
 *    priceAmountMicros '0' and an ISO-8601 billingPeriod ('P2W'). Play only
 *    returns offers this buyer is eligible for.
 */

export interface StoreIntroOffer {
  /** Whole days the store gives free before the first charge. */
  freeDays: number;
  /** [Android] The token requestPurchase must carry to get the offer. */
  offerTokenAndroid: string | null;
}

/** ISO-8601 duration → days (P2W → 14, P14D → 14, P1M → 30). Null when unparseable. */
export function isoDurationDays(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/i.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, w, d] = m;
  const days = (Number(y || 0) * 365) + (Number(mo || 0) * 30) + (Number(w || 0) * 7) + Number(d || 0);
  return days > 0 ? days : null;
}

/** {unit, value} period → days. Null for unknown units or a zero value. */
export function periodDays(period: any): number | null {
  const value = Number(period?.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (String(period?.unit || '').toLowerCase()) {
    case 'day': return value;
    case 'week': return value * 7;
    case 'month': return value * 30;
    case 'year': return value * 365;
    default: return null;
  }
}

function isFreePhase(phase: any): boolean {
  const micros = Number(phase?.priceAmountMicros);
  return Number.isFinite(micros) && micros === 0 && !!isoDurationDays(phase?.billingPeriod);
}

/**
 * The free introductory offer on a store product, or null when there is none.
 * iOS eligibility is NOT decided here (StoreKit answers that per subscription
 * group) — pass `eligibleIOS: false` to suppress the offer for a buyer who has
 * already used theirs.
 */
export function introOfferFromProduct(product: any, opts: { eligibleIOS?: boolean } = {}): StoreIntroOffer | null {
  if (!product) return null;

  // Android: an offer whose first pricing phase is free.
  const androidOffers: any[] = Array.isArray(product.subscriptionOffers) ? product.subscriptionOffers : [];
  for (const offer of androidOffers) {
    const phases: any[] = offer?.pricingPhasesAndroid?.pricingPhaseList || offer?.pricingPhases?.pricingPhaseList || [];
    const first = phases[0];
    if (first && isFreePhase(first)) {
      const perPhase = isoDurationDays(first.billingPeriod) || 0;
      const cycles = Math.max(1, Number(first.billingCycleCount) || 1);
      const token = offer.offerTokenAndroid || offer.offerToken || null;
      if (perPhase > 0 && token) return { freeDays: perPhase * cycles, offerTokenAndroid: token };
    }
  }

  // iOS: the subscription's introductory offer, if StoreKit says this buyer may use it.
  const intro = product.subscriptionInfoIOS?.introductoryOffer;
  if (intro && opts.eligibleIOS !== false) {
    const mode = String(intro.paymentMode || '').toLowerCase().replace('_', '-');
    if (mode === 'free-trial') {
      const days = periodDays(intro.period);
      const count = Math.max(1, Number(intro.periodCount) || 1);
      if (days) return { freeDays: days * count, offerTokenAndroid: null };
    }
  }

  return null;
}

/**
 * Which Android offer token to buy with. Prefer an offer that starts free
 * (the intro), else the base plan (no offerId), else whatever Play listed
 * first — which is what the app did before offers existed.
 */
export function pickAndroidOfferToken(offers: any[] | null | undefined): string | null {
  if (!Array.isArray(offers) || offers.length === 0) return null;
  const token = (o: any) => o?.offerTokenAndroid || o?.offerToken || null;
  const free = offers.find((o) => {
    const phases: any[] = o?.pricingPhasesAndroid?.pricingPhaseList || o?.pricingPhases?.pricingPhaseList || [];
    return phases[0] && isFreePhase(phases[0]) && token(o);
  });
  if (free) return token(free);
  const base = offers.find((o) => !o?.id && !o?.offerId && !o?.offerIdAndroid && token(o));
  if (base) return token(base);
  return token(offers[0]);
}
