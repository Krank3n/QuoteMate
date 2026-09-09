/**
 * Square fee model for QuoteMate.
 *
 * Two things happen on every Square payment:
 *  1. Square takes its processing fee (varies by card type + channel).
 *  2. QuoteMate takes a platform fee (app_fee_money on the Square API call,
 *     automatically deducted from the tradie's payout to our developer account).
 *
 * Both come out of the tradie's payout. Nothing is ever added to what the
 * customer is charged: the RBA removed card surcharging on eftpos, Mastercard
 * and Visa from 1 October 2026, so the old opt-in passthrough surcharge
 * (PASSTHROUGH_SURCHARGE_PCT, 2.9% on top of the invoice) was retired in
 * September 2026. The customer pays the quoted amount, full stop.
 *
 * Fees are hardcoded (not tradie-editable): QuoteMate's cut is a business
 * decision, not a per-tenant setting.
 */

/**
 * Our platform cut on online hosted-checkout payments. Pro users pay 1%; free
 * users pay 1.7% — the elevated rate is the freemium model's revenue source
 * and the headline pitch for the Pro upgrade ("drop the platform fee from
 * 1.7% to 1%"). Tier resolution is server-side: see `getUserPlanServerSide`.
 */
export const QM_APP_FEE_PCT_ONLINE = 1.0;
export const QM_APP_FEE_PCT_ONLINE_FREE = 1.7;

/**
 * Our platform cut on in-person Tap-to-Pay payments. Slightly higher than
 * online because Square's in-person rate is lower than their online rate.
 * Free-tier in-person matches free-tier online (1.7%) for simplicity.
 */
export const QM_APP_FEE_PCT_IN_PERSON = 1.5;
export const QM_APP_FEE_PCT_IN_PERSON_FREE = 1.7;
