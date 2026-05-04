/**
 * Reece connect flow — shared between the Settings screen and the optional
 * onboarding nudge step so both surfaces behave identically.
 *
 * The Reece onboarding is a two-step OAuth-like dance:
 *   1. Backend mints a `requestToken` and returns the maX consent URL.
 *   2. User signs into maX in the browser and approves QuoteMate.
 *   3. Reece redirects to a static QuoteMate callback page (no params — the
 *      redirect itself is the only completion signal), the user closes the
 *      tab.
 *   4. Frontend calls `completeReeceConnect(requestToken)` which exchanges
 *      the requestToken for a long-lived customer token (stored encrypted on
 *      the backend).
 *
 * Unlike Square's webhook-driven model, the customer-token exchange is
 * synchronous on step 4 — no polling required.
 */

import * as WebBrowser from 'expo-web-browser';

import {
  startReeceConnect,
  completeReeceConnect,
  enableReecePriceFile,
  confirmReecePriceFile,
  type ReeceConnectionStatus,
} from './reeceApi';

export type ReeceConnectOutcome =
  | { kind: 'connected'; status: ReeceConnectionStatus }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export type ReecePriceFileEnableOutcome =
  | { kind: 'enabled' }
  | { kind: 'failed'; message: string };

/**
 * Run the full Reece connect flow end-to-end. Resolves with a structured
 * outcome rather than throwing so callers can render the right UI without a
 * try/catch wrapper everywhere.
 */
export async function runReeceConnectFlow(): Promise<ReeceConnectOutcome> {
  let requestToken: string;
  let authUrl: string;
  try {
    const started = await startReeceConnect();
    requestToken = started.requestToken;
    authUrl = started.authUrl;
  } catch (error: any) {
    return {
      kind: 'failed',
      message: error?.message || 'Could not start Reece connection. Please try again.',
    };
  }

  try {
    await WebBrowser.openBrowserAsync(authUrl, { dismissButtonStyle: 'done' });
  } catch (error: any) {
    return {
      kind: 'failed',
      message: error?.message || 'Could not open the Reece sign-in page.',
    };
  }

  try {
    const status = await completeReeceConnect(requestToken);
    return { kind: 'connected', status };
  } catch (error: any) {
    // We used to silently treat "not approved" as `cancelled` — but that left
    // users with no feedback when they thought they'd connected. Reece's
    // "Invalid request token" response means the user landed on the consent
    // page but didn't actually tap Approve/Link, which is identical to a
    // genuine cancel from the user's perspective. Surface it as a failure
    // either way so they know they need to retry and click through.
    return {
      kind: 'failed',
      message:
        error?.message ||
        'Could not finish connecting Reece. Please try again and tap Approve on the Reece consent page.',
    };
  }
}

/**
 * Run the Reece price-file enable flow. The user picks their format settings
 * on reece.com.au's price-select page and is redirected back to QuoteMate's
 * callback. Unlike the connect flow there's no request/exchange dance —
 * confirmReecePriceFile just flips the local flag and kicks off the initial
 * fetch in the background.
 */
export async function runReecePriceFileEnableFlow(): Promise<ReecePriceFileEnableOutcome> {
  let authUrl: string;
  try {
    const started = await enableReecePriceFile();
    authUrl = started.authUrl;
  } catch (error: any) {
    return {
      kind: 'failed',
      message: error?.message || 'Could not start Reece catalogue sync. Please try again.',
    };
  }

  try {
    await WebBrowser.openBrowserAsync(authUrl, { dismissButtonStyle: 'done' });
  } catch (error: any) {
    return {
      kind: 'failed',
      message: error?.message || 'Could not open the Reece price-file consent page.',
    };
  }

  try {
    await confirmReecePriceFile();
    return { kind: 'enabled' };
  } catch (error: any) {
    return {
      kind: 'failed',
      message: error?.message || 'Could not enable Reece catalogue sync. Please try again.',
    };
  }
}
