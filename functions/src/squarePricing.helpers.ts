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
