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

import { isTrialWindowExpired, TrialWindowSource } from '../utils/trialConfig';

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

/**
 * Play's entry for a base plan bought with no offer. openiap-google (expo-iap
 * 3.4) fills `id` with `offerId ?: basePlanId`, so on real data the base plan
 * arrives as `id === basePlanIdAndroid`; older payloads left it empty.
 */
const isBasePlanEntry = (o: any) =>
  !o?.offerId && !o?.offerIdAndroid && (!o?.id || (!!o?.basePlanIdAndroid && o.id === o.basePlanIdAndroid));

/**
 * Play lists every base plan of the product and every offer on each. The
 * paywall sells one base plan per SKU ("$49/month"), so an offer only counts
 * when it hangs off a base plan Play also listed as buyable here — otherwise a
 * second base plan (say a prepaid one) could advertise a free period for a
 * product the screen is not selling. With no base-plan entries to scope by
 * (older payloads), every offer is considered, as before.
 */
function onSoldBasePlans(offers: any[]): any[] {
  const sold = new Set(offers.filter(isBasePlanEntry).map((o) => o?.basePlanIdAndroid).filter(Boolean));
  if (sold.size === 0) return offers;
  return offers.filter((o) => !o?.basePlanIdAndroid || sold.has(o.basePlanIdAndroid));
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

  // Android: an offer whose first pricing phase is free, on a base plan we sell.
  const androidOffers: any[] = Array.isArray(product.subscriptionOffers) ? product.subscriptionOffers : [];
  for (const offer of onSoldBasePlans(androidOffers)) {
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
 * Which Android offer token to buy with. With `allowFreeTrial` (see
 * mayTakeStoreFreeTrial) prefer an offer that starts free (the intro), else
 * the base plan. Without it, never a free-start offer: the base plan, else the
 * first listed offer that charges from day one. Play always lists the base
 * plan, so a buyer who has had their trial is billed on tap.
 */
export function pickAndroidOfferToken(
  offers: any[] | null | undefined,
  opts: { allowFreeTrial?: boolean } = {},
): string | null {
  if (!Array.isArray(offers) || offers.length === 0) return null;
  const token = (o: any) => o?.offerTokenAndroid || o?.offerToken || null;
  const startsFree = (o: any) => {
    const phases: any[] = o?.pricingPhasesAndroid?.pricingPhaseList || o?.pricingPhases?.pricingPhaseList || [];
    return !!phases[0] && isFreePhase(phases[0]);
  };
  if (opts.allowFreeTrial) {
    const free = onSoldBasePlans(offers).find((o) => startsFree(o) && token(o));
    if (free) return token(free);
  }
  const base = offers.find((o) => isBasePlanEntry(o) && token(o));
  if (base) return token(base);
  const paid = opts.allowFreeTrial ? offers.find((o) => token(o)) : offers.find((o) => !startsFree(o) && token(o));
  return paid ? token(paid) : null;
}

/** The trial fields the store-trial rule reads. A SubscriptionStatus satisfies it. */
export interface StoreTrialSource extends TrialWindowSource {
  trialExpired?: boolean | null;
}

/**
 * May this account take a store's free introductory period? Only while the
 * QuoteMate trial is still ahead of them or running — the store offer exists
 * so subscribing mid-trial is not billed on tap (17 Sep 2026), not to hand a
 * second free fortnight to someone whose trial is over. Neither store knows
 * about our trial: Apple and Google grant the offer to any account that has
 * never subscribed, so the app has to withhold it.
 *
 * Fails closed: no status loaded yet → false (bill on tap, say so), because
 * the copy and the purchase both read this and an unknown account must not
 * be promised free days.
 */
export function mayTakeStoreFreeTrial(status: StoreTrialSource | null | undefined, now: number = Date.now()): boolean {
  if (!status) return false;
  if (status.trialExpired) return false;
  return !isTrialWindowExpired(status, now);
}

/**
 * The free days the paywall may promise. Android only takes the offer when
 * the app asks for it (pickAndroidOfferToken), so a withheld offer is no
 * offer. iOS applies the introductory offer by itself to any eligible Apple
 * ID — the app cannot withhold it in the shipped binaries — so there the copy
 * follows StoreKit, or it would say "billed today" and then not bill.
 */
export function storeFreeDaysToShow(
  platform: string,
  storeFreeDays: number | null | undefined,
  allowFreeTrial: boolean,
): number | null {
  const days = typeof storeFreeDays === 'number' && storeFreeDays > 0 ? storeFreeDays : null;
  if (platform === 'android' && !allowFreeTrial) return null;
  return days;
}
