/**
 * Words for a Square account that can't take card payments yet.
 *
 * Square connects fine and mints links fine for a seller account that never
 * finished activation; the link just opens "This business is currently not
 * accepting payments". The server stores a verdict on the connection
 * (functions/src/squareReadiness.ts) and refuses to mint while it stands.
 * This is what the tradie reads on the Square settings screen so they know
 * why no Pay Now button is going out, and what to do about it.
 */

export type SquareReadinessReason =
  | 'no_card_processing'
  | 'location_inactive'
  | 'merchant_inactive'
  | 'currency_mismatch';

export interface SquarePaymentReadiness {
  ready: boolean;
  reasons: SquareReadinessReason[];
  checkedAt: number;
  currency?: string;
  country?: string;
  capabilities?: string[];
}

export interface SquareNotReadyCopy {
  title: string;
  body: string;
  /** The one thing to do next. */
  action: string;
}

export function squareNotReadyCopy(
  readiness: Pick<SquarePaymentReadiness, 'reasons' | 'currency'>,
  merchantName?: string | null,
): SquareNotReadyCopy {
  const who = merchantName || 'this Square account';

  if (readiness.reasons.includes('currency_mismatch')) {
    const cur = readiness.currency ? ` (${readiness.currency})` : '';
    return {
      title: 'This Square account is not Australian',
      body: `${who} isn't set up for Australian dollars${cur}, so card payments through QuoteMate can't go to it. Quotes and invoices go out without a Pay Now button until an Australian Square account is connected.`,
      action: 'Connect an Australian Square account',
    };
  }

  return {
    title: 'Square hasn’t switched on card payments yet',
    body: `${who} can't take card payments until Square finishes activating it (identity and bank details, at squareup.com). Quotes and invoices go out without a Pay Now button until then.`,
    action: 'Finish activating at squareup.com, then check again',
  };
}
