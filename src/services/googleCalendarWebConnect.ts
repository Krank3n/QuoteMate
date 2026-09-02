/**
 * Google Calendar connect — web transport.
 *
 * On iOS/Android the app runs the OAuth prompt itself and receives a
 * refresh token from Google (mobile OAuth clients have no secret). The
 * browser can't: Google refuses a code exchange for a "Web application"
 * client without its secret, so `expo-auth-session` on web could only
 * ever produce an access token and the connection failed with "no
 * refresh token". Web therefore mirrors the Square integration: ask the
 * server for a consent URL bound to the signed-in user, send this tab to
 * Google, and let the hosted callback page
 * (quotemateapp.au/google-calendar/callback) finish the exchange via the
 * googleCalendarCallback function. The settings screen's live snapshot
 * of users/{uid}/integrations/google.calendar flips to "Connected" when
 * the tradie comes back.
 */

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
export const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

const GOOGLE_ACCOUNTS_ORIGIN = 'https://accounts.google.com/';

export interface WebConnectDeps {
  /** Firebase ID token for the signed-in user, or undefined when signed out. */
  getIdToken: () => Promise<string | undefined>;
  /** Navigates the current tab. Injected so tests don't touch window. */
  assign: (url: string) => void;
  fetchImpl?: typeof fetch;
  functionsUrl?: string;
}

/**
 * Kick off the web connect. Resolves after the tab has been told to
 * navigate; the promise never "completes" the connection because the
 * page is leaving. Throws with a message fit for the settings screen.
 */
export async function startWebCalendarConnect(deps: WebConnectDeps): Promise<void> {
  const idToken = await deps.getIdToken();
  if (!idToken) throw new Error('Sign in first, then connect Google Calendar.');

  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.functionsUrl ?? FIREBASE_FUNCTIONS_URL;
  const response = await fetchImpl(`${base}/getGoogleCalendarAuthUrl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Google Calendar service unavailable (HTTP ${response.status}). Please try again.`);
  }
  const data = (await response.json()) as { authUrl?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`);
  }

  const authUrl = typeof data.authUrl === 'string' ? data.authUrl : '';
  // Only ever send the tab to Google. A bad server response must not turn
  // into an open redirect from the settings screen.
  if (!authUrl.startsWith(GOOGLE_ACCOUNTS_ORIGIN)) {
    throw new Error('Could not open Google sign-in. Please try again.');
  }
  deps.assign(authUrl);
}
