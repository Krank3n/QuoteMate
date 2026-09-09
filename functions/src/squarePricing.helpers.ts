import {
  QM_APP_FEE_PCT_ONLINE,
  QM_APP_FEE_PCT_ONLINE_FREE,
  QM_APP_FEE_PCT_IN_PERSON,
  QM_APP_FEE_PCT_IN_PERSON_FREE,
} from './shared/pdf/squareFees';
import { dollarsToCents, centsToDollars } from './shared/pdf/money';

export type SquareChannel = 'online' | 'in_person';
export type SquarePlan = 'trial' | 'free' | 'pro';

export interface SquarePricing {
  /** What the customer is charged. Always exactly the amount owed. */
  chargedDollars: number;
  /** QuoteMate's platform fee, sent to Square as app_fee_money. */
  appFeeCents: number;
}

/**
 * Compute Square pricing for a payment: the amount charged to the customer
 * and the QuoteMate app fee we take via Square's app_fee_money mechanism.
 *
 * The customer pays the amount owed and nothing more. Until September 2026
 * a tradie could opt into a 2.9% card surcharge (`surchargePaymentFees` on
 * their business settings) that was added on top; the RBA removed card
 * surcharging on eftpos, Mastercard and Visa from 1 October 2026, so that
 * path is gone. A stale flag still sitting on an old settings document must
 * never change the charged amount — that is why this takes no settings.
 *
 * Pro users pay the lower platform fee; free users pay the higher rate (the
 * freemium model's revenue source). Trial users get the Pro rate while in
 * their trial window. Percentages live in shared/pdf/squareFees.ts.
 */
/**
 * Card surcharging is prohibited in Australia from this instant (RBA,
 * 1 October 2026, Sydney time). A Square pay link minted before it may have
 * been grossed up by the retired 2.9% surcharge, and Square cannot reprice a
 * link, so such a link must never be handed to a customer again: the minters
 * treat it as stale and issue a fresh one at the amount owed. Links minted
 * after this instant were priced by the surcharge-free helper above.
 */
export const SURCHARGE_RETIRED_AT_MS = Date.parse('2026-10-01T00:00:00+10:00');

export function mintedBeforeSurchargeRetirement(createdAtMs: number | undefined | null): boolean {
  const t = Number(createdAtMs);
  // No stamp at all: the link predates stamping, so it predates the retirement.
  if (!Number.isFinite(t) || t <= 0) return true;
  return t < SURCHARGE_RETIRED_AT_MS;
}

export function computeSquarePricing(
  baseDollars: number,
  channel: SquareChannel,
  plan: SquarePlan = 'pro',
): SquarePricing {
  const chargedCents = dollarsToCents(baseDollars);
  const isFree = plan === 'free';
  const appFeePct = channel === 'in_person'
    ? (isFree ? QM_APP_FEE_PCT_IN_PERSON_FREE : QM_APP_FEE_PCT_IN_PERSON)
    : (isFree ? QM_APP_FEE_PCT_ONLINE_FREE : QM_APP_FEE_PCT_ONLINE);
  const appFeeCents = Math.max(0, dollarsToCents(
    centsToDollars(chargedCents) * (appFeePct / 100),
  ));
  return { chargedDollars: centsToDollars(chargedCents), appFeeCents };
}
