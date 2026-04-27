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
  type ReeceConnectionStatus,
} from './reeceApi';

export type ReeceConnectOutcome =
  | { kind: 'connected'; status: ReeceConnectionStatus }
  | { kind: 'cancelled' }
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
    // The most common failure here is the user closing the tab before
    // approving QuoteMate — Reece returns a 4xx and we surface the
    // backend's user-friendly message.
    const message = error?.message || '';
    if (/not approved/i.test(message)) {
      return { kind: 'cancelled' };
    }
    return {
      kind: 'failed',
      message: message || 'Could not finish connecting Reece. Please try again.',
    };
  }
}
