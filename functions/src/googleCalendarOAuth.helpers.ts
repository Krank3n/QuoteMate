/**
 * Google Calendar web OAuth — pure helpers.
 *
 * The native apps get a refresh token straight from Google via
 * expo-auth-session (mobile clients have no secret). Web can't: Google's
 * token endpoint refuses a code exchange for a "Web application" client
 * without its secret, so the browser never sees a refresh token. The web
 * flow therefore mirrors Square's (PAY-03): `getGoogleCalendarAuthUrl`
 * mints a single-use state bound to the signed-in uid and sends the tab
 * to Google's consent page; Google redirects to the hosted callback page
 * (QuoteMateAppWebsite app/google-calendar/callback), which POSTs
 * { code, state } to `googleCalendarCallback`, and the exchange happens
 * server-side with the web client id + secret.
 *
 * Everything here is pure so the URL contract and the token-response
 * parsing are unit-testable without Firestore or the network.
 */

export const GOOGLE_CALENDAR_OAUTH_STATES_COLLECTION = 'googleCalendarOAuthStates';
/**
 * Google's consent flow can take a while (account chooser, the unverified-app
 * interstitial, 2-step verification), so the state nonce lives longer than
 * Square's 10 minutes. Still single-use.
 */
export const GOOGLE_CALENDAR_OAUTH_STATE_TTL_MS = 30 * 60 * 1000;
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Hosted callback page (Next.js, trailing slash — the site exports with trailingSlash: true). */
export const DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI =
  'https://quotemateapp.au/google-calendar/callback/';

export interface BuildAuthUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
}

/**
 * Consent URL for the calendar.events grant. `access_type=offline` +
 * `prompt=consent` are what make Google issue a refresh token (it omits
 * one on silent re-auth). `include_granted_scopes` keeps an existing
 * sign-in grant intact instead of replacing it.
 */
export function buildGoogleCalendarAuthUrl(input: BuildAuthUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: ['openid', 'email', 'profile', GOOGLE_CALENDAR_SCOPE].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: input.state,
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleCalendarGrant {
  refreshToken: string;
  accessToken: string;
  /** Epoch ms, null when Google didn't say. */
  expiresAt: number | null;
  scope: string;
}

export type TokenResponseVerdict =
  | { ok: true; grant: GoogleCalendarGrant }
  | { ok: false; error: string };

/**
 * Validate Google's token-endpoint JSON. A grant without a refresh token
 * is useless to the sync trigger (it can't mint access tokens later), and
 * a grant where the tradie un-ticked the calendar box on the consent
 * screen would "connect" and then fail on every push — reject both up
 * front with a message the callback page can show.
 */
export function parseGoogleTokenResponse(json: unknown, nowMs: number): TokenResponseVerdict {
  const data = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : '';
  const scope = typeof data.scope === 'string' ? data.scope : '';

  if (!accessToken || !refreshToken) {
    return {
      ok: false,
      error: 'Google did not return a complete token set. Please try connecting again.',
    };
  }
  if (!scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) {
    return {
      ok: false,
      error:
        'Calendar permission was not granted. Please try again and tick the calendar box on the Google screen.',
    };
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : NaN;
  return {
    ok: true,
    grant: {
      refreshToken,
      accessToken,
      expiresAt: Number.isFinite(expiresIn) ? nowMs + expiresIn * 1000 : null,
      scope,
    },
  };
}
