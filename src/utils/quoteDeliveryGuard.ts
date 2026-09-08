/**
 * Quote / invoice delivery guard.
 *
 * Two jobs, kept apart on purpose.
 *
 * `ensureCanDeliver` is the free-tier gate. A free user must connect Square
 * before a document that asks for money — an invoice, or a quote with a
 * deposit — can go out, because the platform fee on that payment is how the
 * free tier monetises. A plain quote carries nothing a Pay Now button could
 * collect, so it is never gated: sending is the activation event, and 8 of
 * the 13 tradies who met this gate on a quote abandoned the send. Pro and
 * trial users pass without a network round-trip.
 *
 * `attachPayLink` is best-effort and plan-agnostic. An email send gets its
 * link from the server (sendDocumentEmail mints one whenever Square is
 * connected), but SMS, Share and Export PDF compose the customer-facing copy
 * on the phone, so they have to fetch the link themselves — otherwise the
 * invoice leaves without one, which is what happened to 13 of the first 36.
 */

import { checkSquareConnection } from '../services/squareService';
import * as squareService from '../services/squareService';
import { useStore } from '../store/useStore';

/**
 * Minimal shape the guard needs from a Quote / Invoice / Document. Keeping
 * this as a structural type means callers can pass whichever representation
 * they have on hand without converting first.
 */
export interface DeliverableDoc {
  id: string;
  squarePaymentLinkUrl?: string;
  requireDeposit?: boolean;
  depositPercentage?: number;
}

export type DeliveryDoc =
  | { kind: 'quote'; doc: DeliverableDoc }
  | { kind: 'invoice'; doc: DeliverableDoc };

export type DeliveryGate =
  | { ok: true; squarePaymentLinkUrl?: string }
  | { ok: false; reason: 'connect_square' | 'mint_link_failed'; message: string };

/**
 * Whether a Pay Now link has anything to collect on this document: an
 * invoice's balance, or a quote's deposit. A quote without a deposit is
 * accepted, not paid, so nothing here applies to it. Pure — unit tested.
 */
export function carriesPayableAmount(target: DeliveryDoc): boolean {
  if (target.kind === 'invoice') return true;
  return target.doc.requireDeposit === true && (target.doc.depositPercentage ?? 0) > 0;
}

/**
 * Returns whether the user is allowed to deliver the supplied quote/invoice
 * right now, and a payment-link URL if one was minted as part of the check.
 *
 * Pro / trial → always `{ ok: true }`. Free → a document that carries a
 * payable amount requires a connected Square account and a mintable payment
 * link; failure produces a typed reason the caller can route on (e.g. open
 * SquareIntegrationScreen). A plain quote passes on every plan.
 */
export async function ensureCanDeliver(target: DeliveryDoc): Promise<DeliveryGate> {
  const plan = useStore.getState().getEffectivePlan();
  if (plan === 'pro' || plan === 'trial' || !carriesPayableAmount(target)) {
    return { ok: true, squarePaymentLinkUrl: target.doc.squarePaymentLinkUrl };
  }

  // Free tier, money on the document — Square connection is mandatory.
  let connection;
  try {
    connection = await checkSquareConnection();
  } catch {
    return {
      ok: false,
      reason: 'connect_square',
      message: 'Could not verify your Square connection. Please reconnect Square to send this.',
    };
  }
  if (!connection.connected) {
    return {
      ok: false,
      reason: 'connect_square',
      message: 'Connect Square to send invoices and deposit quotes on the free plan.',
    };
  }

  // Reuse a previously-minted link if the doc already carries one.
  if (target.doc.squarePaymentLinkUrl) {
    return { ok: true, squarePaymentLinkUrl: target.doc.squarePaymentLinkUrl };
  }

  try {
    return { ok: true, squarePaymentLinkUrl: await mintPaymentLinkForDoc(target) };
  } catch (error: any) {
    return {
      ok: false,
      reason: 'mint_link_failed',
      message:
        error?.message ||
        'Could not create a Square payment link. Please try again.',
    };
  }
}

/**
 * The Pay Now link for a document the phone is about to put in front of a
 * customer itself (SMS body, share text, exported PDF). Reuses the link the
 * doc already carries, otherwise mints one when Square is connected. Never
 * throws and never blocks: a send goes ahead without a link sooner than not
 * at all. Plain quotes have nothing to link, so they cost no round-trip.
 */
export async function attachPayLink(target: DeliveryDoc): Promise<string | undefined> {
  if (target.doc.squarePaymentLinkUrl) return target.doc.squarePaymentLinkUrl;
  if (!carriesPayableAmount(target)) return undefined;
  try {
    if (!(await checkSquareConnection()).connected) return undefined;
    return await mintPaymentLinkForDoc(target);
  } catch {
    return undefined;
  }
}

/**
 * Mint the right payment link for a doc: invoice balance, or quote deposit.
 * The server writes the link onto the document, so every customer-facing
 * surface (PDF, hosted page, invoice email) picks it up from there. Only
 * reached for a doc that carries a payable amount.
 */
async function mintPaymentLinkForDoc(target: DeliveryDoc): Promise<string> {
  const result =
    target.kind === 'invoice'
      ? await squareService.mintInvoicePaymentLink(target.doc.id)
      : await squareService.mintQuoteDepositPaymentLink(target.doc.id);
  return result.paymentLinkUrl;
}

/**
 * Gate for in-person payment / Tap to Pay flows. If Square isn't connected
 * yet, routes to the SquareIntegration settings screen so the tradie can
 * wire it up before retrying. Stack navigation handles "back" naturally —
 * the user lands back where they started. Returns true when the caller may
 * proceed, false when it must abort because the user has been redirected.
 */
export async function ensureSquareConnectedForPayment(
  navigation: { navigate: (route: string) => void },
): Promise<boolean> {
  try {
    const conn = await checkSquareConnection();
    if (conn.connected) return true;
  } catch {
    // Treat errors as "not connected" — send them to settings to recover.
  }
  navigation.navigate('SquareIntegration');
  return false;
}
