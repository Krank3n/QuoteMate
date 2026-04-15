/**
 * Square Payments Service
 * Client-side service that calls Firebase Cloud Functions for Square operations.
 * Tokens stay server-side; this file never handles OAuth tokens directly.
 *
 * Modelled on xeroService.ts so the shapes / auth pattern are consistent.
 */

import { auth } from '../config/firebase';

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
      Authorization: `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

/**
 * Get the Square OAuth authorization URL to open in the system browser.
 */
export async function getSquareAuthUrl(): Promise<{ authUrl: string; state: string }> {
  return squareFetch('getSquareAuthUrl');
}

/**
 * Check whether the signed-in user has an active Square connection.
 * Network failures are treated as "disconnected" so the UI can't hang.
 */
export async function checkSquareConnection(): Promise<{
  connected: boolean;
  merchantId?: string;
  merchantName?: string;
  locationId?: string;
  locationName?: string;
  mode?: 'sandbox' | 'production';
  connectedAt?: string;
  syncEnabled?: boolean;
  disconnectedReason?: string;
}> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return { connected: false };

  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/checkSquareConnection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!response.ok) return { connected: false };
  return response.json();
}

/**
 * Disconnect Square (revoke tokens + delete connection doc).
 */
export async function disconnectSquare(): Promise<void> {
  await squareFetch('squareDisconnect');
}

/**
 * Mint a Square payment link for an invoice's outstanding balance.
 * Returns a short hosted-checkout URL suitable for sharing via SMS / email.
 */
export async function mintInvoicePaymentLink(
  invoiceId: string
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; reused: boolean }> {
  return squareFetch('createSquarePaymentLink', {
    kind: 'invoice',
    targetId: invoiceId,
  });
}

/**
 * Mint a Square payment link for the outstanding deposit on a quote.
 */
export async function mintQuoteDepositPaymentLink(
  quoteId: string
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; reused: boolean }> {
  return squareFetch('createSquarePaymentLink', {
    kind: 'quote_deposit',
    targetId: quoteId,
  });
}

// ============================================
// Phase 2a — Mobile Payments SDK wiring (deferred)
// ============================================

/**
 * Phase 2a: fetch a Square Mobile Payments SDK authorization code.
 * The SDK exchanges it for a session token. Not used until the SDK is added.
 */
export async function getMobileAuthCode(): Promise<{
  authorizationCode: string;
  expiresAt: string;
  locationId: string;
}> {
  return squareFetch('getSquareMobileAuthCode');
}

/**
 * Phase 2a: after the Mobile Payments SDK returns a successful payment, record
 * it server-side so the webhook can flip invoice / quote status when the
 * `payment.updated` event fires.
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
