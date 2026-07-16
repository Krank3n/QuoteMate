/**
 * Quote / invoice delivery guard.
 *
 * Free-tier users must connect Square and embed a Square payment link in
 * every quote and invoice they send — that's how the platform monetises the
 * free tier. This guard is the single chokepoint that enforces it before any
 * email / SMS / share / PDF-export flow runs.
 *
 * Pro and in-trial users skip the gate entirely.
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
 * Returns whether the user is allowed to deliver the supplied quote/invoice
 * right now, and a payment-link URL if one was minted as part of the check.
 *
 * Pro / trial → always `{ ok: true }`. Free → requires a connected Square
 * account and a mintable payment link; failure produces a typed reason the
 * caller can route on (e.g. open SquareIntegrationScreen).
 */
export async function ensureCanDeliver(target: DeliveryDoc): Promise<DeliveryGate> {
  const plan = useStore.getState().getEffectivePlan();
  if (plan === 'pro' || plan === 'trial') {
    return { ok: true, squarePaymentLinkUrl: target.doc.squarePaymentLinkUrl };
  }

  // Free tier — Square connection is mandatory.
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
      message: 'Connect Square to send quotes and invoices on the free plan.',
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
 * Mint the right payment link for a doc: invoice balance, quote deposit (when
 * a deposit is required), or full quote total. The server writes the link
 * onto the document, so every customer-facing surface (PDF, hosted page,
 * invoice email) picks it up from there. Shared by the free-tier gate above
 * and the trial opt-in below — one routing rule, not two.
 */
async function mintPaymentLinkForDoc(target: DeliveryDoc): Promise<string> {
  const result =
    target.kind === 'invoice'
      ? await squareService.mintInvoicePaymentLink(target.doc.id)
      : (target.doc.requireDeposit && (target.doc.depositPercentage ?? 0) > 0)
        ? await squareService.mintQuoteDepositPaymentLink(target.doc.id)
        : await squareService.mintQuoteFullPaymentLink(target.doc.id);
  return result.paymentLinkUrl;
}

/**
 * Whether the send sheet should offer the opt-in "get paid on this quote"
 * row. Trial users only: free users hit the mandatory gate instead, Pro users
 * already have payments wherever they've set them up, and a doc that already
 * carries a link needs nothing. Pure — unit tested.
 */
export function shouldOfferTrialPayLink(
  plan: 'trial' | 'free' | 'pro',
  doc: Pick<DeliverableDoc, 'squarePaymentLinkUrl'>,
): boolean {
  return plan === 'trial' && !doc.squarePaymentLinkUrl;
}

export type TrialPayLinkResult =
  | { status: 'connect_required' }
  | { status: 'attached'; squarePaymentLinkUrl: string }
  | { status: 'failed'; message: string };

/**
 * The trial opt-in: attach a Pay Now link to this doc if Square is connected,
 * or report that the user needs to connect first (caller routes them to
 * SquareIntegrationScreen). Never blocks a send — the caller proceeds with or
 * without a link; this exists so tradies wire up payments while they're most
 * engaged instead of at the post-trial gate.
 */
export async function attachTrialPayLink(target: DeliveryDoc): Promise<TrialPayLinkResult> {
  let connected = false;
  try {
    connected = (await checkSquareConnection()).connected;
  } catch {
    // Verification failure routes to the integration screen, which shows the
    // real connection state and offers reconnect.
  }
  if (!connected) return { status: 'connect_required' };

  if (target.doc.squarePaymentLinkUrl) {
    return { status: 'attached', squarePaymentLinkUrl: target.doc.squarePaymentLinkUrl };
  }

  try {
    return { status: 'attached', squarePaymentLinkUrl: await mintPaymentLinkForDoc(target) };
  } catch (error: any) {
    return {
      status: 'failed',
      message: error?.message || 'Could not create a Square payment link. Please try again.',
    };
  }
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
