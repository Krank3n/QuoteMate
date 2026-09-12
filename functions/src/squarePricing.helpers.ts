import { squareAppFeePct, type SquareFeeChannel, type SquareFeePlan } from './shared/pdf/squareFees';
import { dollarsToCents, centsToDollars } from './shared/pdf/money';

export type SquareChannel = SquareFeeChannel;
export type SquarePlan = SquareFeePlan;

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
  const appFeePct = squareAppFeePct(channel, plan);
  const appFeeCents = Math.max(0, dollarsToCents(
    centsToDollars(chargedCents) * (appFeePct / 100),
  ));
  return { chargedDollars: centsToDollars(chargedCents), appFeeCents };
}

// ---------------------------------------------------------------------------
// What Square itself reported on a completed payment.
// ---------------------------------------------------------------------------

export interface SquareFeeFields {
  /** Square's own `app_fee_money.amount` on the payment, when it carried one. */
  squareAppFeeCents: number | null;
  /** Sum of Square's `processing_fee[].amount_money.amount` entries, when any parsed. */
  squareProcessingFeeCents: number | null;
  /**
   * True when Square's platform fee and our recomputed `appFeeCents` are both
   * known and disagree; false when both are known and agree; null when Square
   * gave no figure to compare against.
   */
  feeMismatch: boolean | null;
}

/** A Square money amount as an integer number of cents, or null if it isn't one. */
function moneyCents(money: any): number | null {
  const raw = money?.amount;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/**
 * Read the fees Square says it applied from a `payment.updated` webhook
 * payload, so the ledger records what was actually taken rather than only
 * what we asked for. Sep 2026 reconciliation: every `squarePayments` row held
 * a RECOMPUTED `appFeeCents`, so nobody could tell whether the platform fee
 * had been collected at all. Tolerant of a missing or malformed payload — a
 * webhook must never fail over an unreadable fee field.
 */
export function squareFeeFieldsFromPayment(
  payment: any,
  appFeeCents: number | null | undefined,
): SquareFeeFields {
  const squareAppFeeCents = moneyCents(payment?.app_fee_money);
  let squareProcessingFeeCents: number | null = null;
  if (Array.isArray(payment?.processing_fee)) {
    for (const entry of payment.processing_fee) {
      const cents = moneyCents(entry?.amount_money);
      if (cents === null) continue;
      squareProcessingFeeCents = (squareProcessingFeeCents ?? 0) + cents;
    }
  }
  const feeMismatch =
    typeof appFeeCents === 'number' && Number.isFinite(appFeeCents) && squareAppFeeCents !== null
      ? squareAppFeeCents !== appFeeCents
      : null;
  return { squareAppFeeCents, squareProcessingFeeCents, feeMismatch };
}
