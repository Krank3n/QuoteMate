/**
 * Google Calendar — OAuth token store + disconnect callables.
 *
 * The client (src/services/googleCalendarAuth.ts) does the OAuth dance
 * and ends up holding a refresh token. It calls `storeGoogleCalendarToken`
 * to hand the refresh token to the server; we store it at
 * `users/{uid}/integrations/google.calendar`. Refresh tokens never live
 * in the client store after this hop.
 *
 * Refreshing access tokens on the server uses the OAuth WEB client (not
 * mobile) because mobile clients don't have a secret and Google's token
 * endpoint accepts the WEB client's id+secret pair against any refresh
 * token issued by the same project. (Refresh tokens are project-scoped,
 * not client-scoped.) The web client ID + secret are read from
 * functions config:
 *
 *   firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
 *   firebase functions:config:set google.client_id="…apps.googleusercontent.com"
 *
 * (Or use a single `google.web_client_id` env var — see getOauthClient
 * below for the resolution order.)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

const db = () => admin.firestore();

// Document path that the trigger + the client both watch.
export function calendarIntegrationRef(uid: string) {
  return db().doc(`users/${uid}/integrations/google.calendar`);
}

interface OauthClient {
  id: string;
  secret: string;
}

/**
 * Read the OAuth web-client credentials from Firebase Functions config.
 * `firebase functions:config:set google.web_client_id="…" google.web_client_secret="…"`
 *
 * Falls through to env vars (`GOOGLE_OAUTH_WEB_CLIENT_ID` /
 * `GOOGLE_OAUTH_WEB_CLIENT_SECRET`) so local emulator runs work too.
 */
function getOauthClient(): OauthClient | null {
  const cfg = (functions.config() as any).google || {};
  const id =
    cfg.web_client_id ||
    process.env.GOOGLE_OAUTH_WEB_CLIENT_ID ||
    cfg.client_id ||
    '';
  const secret =
    cfg.web_client_secret ||
    process.env.GOOGLE_OAUTH_WEB_CLIENT_SECRET ||
    cfg.client_secret ||
    '';
  if (!id || !secret) return null;
  return { id, secret };
}

function requireAuth(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
  }
  return uid;
}

interface StoreTokenInput {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number | null;
  scope?: string;
}

/**
 * storeGoogleCalendarToken — client uploads the refresh token after the
 * OAuth dance. Light verification: hit Google's tokeninfo endpoint with
 * the access token to grab the email so we can show "Connected as
 * jane@example.com" in the UI.
 */
export const storeGoogleCalendarToken = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (data: StoreTokenInput, context) => {
    const uid = requireAuth(context);
    const refreshToken = (data?.refreshToken || '').trim();
    if (!refreshToken) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'refreshToken is required.',
      );
    }

    let email: string | undefined;
    if (data.accessToken) {
      try {
        const res = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
            data.accessToken,
          )}`,
        );
        if (res.ok) {
          const info = (await res.json()) as { email?: string };
          email = info?.email;
        }
      } catch {
        // tokeninfo is best-effort; we don't fail the connection on it.
      }
    }

    await calendarIntegrationRef(uid).set(
      {
        provider: 'google',
        connectedAt: Date.now(),
        refreshToken,
        // Cache the access token + expiry so the trigger can avoid an
        // immediate refresh round-trip on the first event push.
        accessToken: data.accessToken || null,
        accessTokenExpiresAt: data.expiresAt || null,
        scope: data.scope || null,
        email: email || null,
        // Clear any prior failure when reconnecting.
        lastSyncError: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );

    return { ok: true, email: email || null };
  });

/**
 * disconnectGoogleCalendar — revoke the refresh token at Google and
 * delete the integration doc. Per Google's OAuth docs, hitting the
 * revocation endpoint with the refresh token revokes ALL tokens issued
 * to that grant.
 */
export const disconnectGoogleCalendar = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);
  const ref = calendarIntegrationRef(uid);
  const snap = await ref.get();
  if (snap.exists) {
    const refreshToken = (snap.data() || {}).refreshToken;
    if (refreshToken) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
          { method: 'POST' },
        );
      } catch {
        // Best-effort revoke — proceed to delete locally even if Google
        // is down. The token won't be useful without our server pushing
        // it anyway.
      }
    }
  }
  await ref.delete().catch(() => undefined);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Helpers re-used by the sync trigger
// ---------------------------------------------------------------------------

interface AccessTokenSnapshot {
  accessToken: string;
  expiresAt: number;
}

/**
 * Mint a fresh access token using the stored refresh token. Updates the
 * cache on the integration doc so subsequent pushes within the access
 * token's TTL skip the round trip.
 */
export async function mintAccessTokenForUser(uid: string): Promise<AccessTokenSnapshot | null> {
  const ref = calendarIntegrationRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};

  // Use the cached access token if it has > 60s left.
  const cachedToken = data.accessToken as string | undefined;
  const cachedExpires = Number(data.accessTokenExpiresAt) || 0;
  if (cachedToken && cachedExpires > Date.now() + 60_000) {
    return { accessToken: cachedToken, expiresAt: cachedExpires };
  }

  const refreshToken = data.refreshToken as string | undefined;
  if (!refreshToken) return null;

  const oauth = getOauthClient();
  if (!oauth) {
    functions.logger.warn(
      '[gcal] missing OAuth client config — set google.web_client_id + google.web_client_secret',
    );
    return null;
  }

  const body = new URLSearchParams({
    client_id: oauth.id,
    client_secret: oauth.secret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    functions.logger.warn('[gcal] refresh failed', { status: res.status, body: text });
    // 400 = invalid_grant → token is dead. Delete the integration so the
    // tradie sees the "Disconnected" state and can reconnect.
    if (res.status === 400) {
      await ref.delete().catch(() => undefined);
    } else {
      await ref
        .set(
          {
            lastSyncError: {
              at: Date.now(),
              message: `Refresh failed (${res.status})`,
            },
          },
          { merge: true },
        )
        .catch(() => undefined);
    }
    return null;
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  const expiresAt = Date.now() + json.expires_in * 1000;
  await ref.set(
    {
      accessToken: json.access_token,
      accessTokenExpiresAt: expiresAt,
    },
    { merge: true },
  );
  return { accessToken: json.access_token, expiresAt };
}
