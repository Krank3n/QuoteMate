/**
 * Square fee model for QuoteMate.
 *
 * Two things happen on every Square payment:
 *  1. Square takes its processing fee (varies by card type + channel).
 *  2. QuoteMate takes a platform fee (app_fee_money on the Square API call,
 *     automatically deducted from the tradie's payout to our developer account).
 *
 * When the tradie opts into surchargePaymentFees, we bump the amount the
 * customer pays by PASSTHROUGH_SURCHARGE_PCT — enough to cover both fees so
 * the tradie nets their full quoted amount. When off, both fees come out of
 * the tradie's margin.
 *
 * Fees are hardcoded (not tradie-editable) because:
 *  - ACCC rules forbid surcharges above the actual cost of acceptance.
 *  - QuoteMate's cut is a business decision, not a per-tenant setting.
 */

/** Our platform cut on online hosted-checkout payments. */
export const QM_APP_FEE_PCT_ONLINE = 1.0;

/**
 * Our platform cut on in-person Tap-to-Pay payments. Slightly higher because
 * Square's in-person rate is lower than their online rate, so the combined
 * cost of acceptance still sits under the 2.9% passthrough.
 */
export const QM_APP_FEE_PCT_IN_PERSON = 1.5;

/**
 * Surcharge added to the customer-facing price when surchargePaymentFees is
 * enabled. Covers Square's ~1.9% online + QuoteMate's 1% online, with a
 * small buffer. Also labelled on the payment page so the customer sees it.
 * Capped at 2.9% so we stay under the ACCC "excessive surcharge" threshold
 * for any realistic card type.
 */
export const PASSTHROUGH_SURCHARGE_PCT = 2.9;
