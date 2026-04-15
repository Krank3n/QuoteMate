/**
 * Square Integration Service
 * Client-side wrapper around Firebase Functions for Square OAuth + payment links.
 * Tokens live server-side only — this service never sees access tokens.
 *
 * Mirrors the shape of xeroService.ts.
 */

import { auth } from '../config/firebase';
import { SquareEnv } from '../types';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

async function squareFetch(endpoint: string, body?: any): Promise<any> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in');

  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // If the endpoint isn't deployed (404) or the gateway errors, Firebase
  // Hosting returns an HTML error page. JSON-parsing that yields a cryptic
  // "Unexpected character <" — surface a clearer message instead.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Square service unavailable (HTTP ${response.status}). Please try again.`
    );
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export interface SquareConnectionStatus {
  connected: boolean;
  merchantId?: string | null;
  merchantName?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  env?: SquareEnv;
  connectedAt?: string | null;
  disconnectedReason?: string | null;
}

/**
 * Get the Square OAuth authorization URL. Open in the system browser for
 * the tradie to authorise — the hosted callback page will post back to the
 * squareCallback Function and redirect the user to close the tab.
 */
export async function getSquareAuthUrl(): Promise<{
  authUrl: string;
  state: string;
  env: SquareEnv;
}> {
  return squareFetch('getSquareAuthUrl');
}

/**
 * Check the current Square connection status. Returns only non-sensitive
 * fields — access tokens never leave the server.
 */
export async function checkSquareConnection(): Promise<SquareConnectionStatus> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return { connected: false };

  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/checkSquareConnection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
  });

  if (!response.ok) return { connected: false };
  return response.json();
}

/**
 * Disconnect Square — revokes the access token at Square and clears the
 * stored connection.
 */
export async function disconnectSquare(): Promise<void> {
  await squareFetch('squareDisconnect');
}

/**
 * Ask the server to create a fresh Square payment link for an invoice.
 * Normally this is done automatically inside sendInvoiceEmail; this export
 * exists so we can support a "Refresh payment link" action later.
 */
export async function createSquarePaymentLink(
  invoiceId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string }> {
  const res = await squareFetch('createSquarePaymentLink', { invoiceId });
  return { paymentLinkId: res.paymentLinkId, paymentLinkUrl: res.paymentLinkUrl };
}

/**
 * Mint (or reuse) a Square payment link for an invoice's outstanding balance.
 * Used by the in-app Take Payment sheet's "Share Pay Link" option.
 */
export async function mintInvoicePaymentLink(
  invoiceId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; reused: boolean }> {
  const res = await squareFetch('createSquarePaymentLink', {
    kind: 'invoice',
    targetId: invoiceId,
  });
  return {
    paymentLinkId: res.paymentLinkId,
    paymentLinkUrl: res.paymentLinkUrl,
    reused: !!res.reused,
  };
}

/**
 * Mint (or reuse) a Square payment link for the outstanding deposit on a quote.
 */
export async function mintQuoteDepositPaymentLink(
  quoteId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; reused: boolean }> {
  const res = await squareFetch('createSquarePaymentLink', {
    kind: 'quote_deposit',
    targetId: quoteId,
  });
  return {
    paymentLinkId: res.paymentLinkId,
    paymentLinkUrl: res.paymentLinkUrl,
    reused: !!res.reused,
  };
}

/**
 * Mint (or reuse) a Square payment link for the FULL outstanding balance of
 * a quote (total − depositPaid). Used by TakePaymentSheet's "Full amount"
 * mode so the tradie can share a link instead of using Tap to Pay.
 */
export async function mintQuoteFullPaymentLink(
  quoteId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; reused: boolean }> {
  const res = await squareFetch('createSquarePaymentLink', {
    kind: 'quote_full',
    targetId: quoteId,
  });
  return {
    paymentLinkId: res.paymentLinkId,
    paymentLinkUrl: res.paymentLinkUrl,
    reused: !!res.reused,
  };
}

// ============================================
// Phase 2 — Mobile Payments SDK (Tap to Pay) wiring
// ============================================

/**
 * Fetch a Square Mobile Payments SDK authorization code. The native SDK
 * exchanges this for a session token before it can take a payment.
 */
export async function getMobileAuthCode(): Promise<{
  authorizationCode: string;
  expiresAt: string;
  locationId: string;
}> {
  return squareFetch('getSquareMobileAuthCode');
}

/**
 * After the Mobile Payments SDK returns a successful payment, record it
 * server-side so the Square webhook can flip invoice / quote status when
 * `payment.updated` arrives.
 */
export async function recordInAppPayment(args: {
  kind: 'invoice' | 'quote_deposit';
  targetId: string;
  paymentId: string;
  orderId: string;
  amountCents: number;
}): Promise<void> {
  await squareFetch('recordInAppSquarePayment', args);
}
