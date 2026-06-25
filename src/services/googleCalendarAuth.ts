/**
 * Google Calendar OAuth + connection state.
 *
 * Phase 14 of the jobs refactor — push Job schedules to the tradie's
 * Google Calendar. This module owns the client-side OAuth dance:
 *
 *  1. `useGoogleCalendarAuth()` exposes `connect`, `disconnect`,
 *     `connection`, `pending`. Calling `connect()` triggers the OAuth
 *     prompt with the calendar.events scope + offline access so we get
 *     a refresh token back.
 *  2. On success the hook hands the refresh token to the
 *     `storeGoogleCalendarToken` callable, which stashes it at
 *     `users/{uid}/integrations/google/calendar` server-side. Refresh
 *     tokens never live in the client store.
 *  3. The server-side trigger (functions/src/googleCalendarSync.ts)
 *     mints fresh access tokens via the refresh token and pushes Job
 *     events to Google Calendar.
 *
 * The OAuth client IDs are the SAME ones already configured for sign-in
 * (env vars consumed by AuthScreen). We just request an extra scope on
 * the connection prompt; sign-in continues to ask only for openid /
 * email / profile.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import { ResponseType } from 'expo-auth-session';
import {
  doc as firestoreDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';

import { auth, db } from '../config/firebase';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/**
 * Snapshot of the user's Google Calendar connection. Mirrors the shape
 * of the doc at users/{uid}/integrations/google/calendar (minus the
 * refresh token, which never leaves the server).
 */
export interface GoogleCalendarConnection {
  connectedAt: number;
  email?: string;
  scope?: string;
  /** When the most recent sync attempt failed, what went wrong. */
  lastSyncError?: { at: number; message: string };
}

interface UseGoogleCalendarAuthResult {
  /** True until the OAuth request has finished initialising. */
  ready: boolean;
  /** A connect attempt is in flight (prompt open, code exchange running, or
   *  callable persisting the token). */
  pending: boolean;
  /** Latest error message, cleared on next attempt. */
  lastError: string | null;
  /** Live connection doc — null when disconnected. */
  connection: GoogleCalendarConnection | null;
  /** Trigger the OAuth prompt + token storage. */
  connect: () => Promise<void>;
  /** Revoke + delete the stored token. */
  disconnect: () => Promise<void>;
}

/**
 * Hook surface used by the settings screen. Owns the OAuth request and
 * the live subscription to the integration doc.
 */
export function useGoogleCalendarAuth(): UseGoogleCalendarAuthResult {
  const androidClientId =
    __DEV__ && process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
      ? process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
      : process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.GOOGLE_OAUTH_IOS_CLIENT_ID || undefined,
    androidClientId: androidClientId || undefined,
    // Public web OAuth client ID fallback — non-EXPO_PUBLIC env vars aren't
    // inlined into the web bundle, so without this Google.useAuthRequest throws
    // on web. See src/config/firebase.ts for the same pattern.
    webClientId: process.env.GOOGLE_OAUTH_WEB_CLIENT_ID
      || '652758863537-86a4q9860h9aalo36f4sb9tpt39ut7bs.apps.googleusercontent.com',
    // Request the calendar.events scope on top of the implicit defaults
    // (openid, email, profile). Asking for the full scope each connect
    // means an existing read-only grant is upgraded automatically.
    scopes: ['openid', 'email', 'profile', CALENDAR_SCOPE],
    // Code flow with offline access → we get a refresh_token back.
    // shouldAutoExchangeCode lets the hook turn the auth code into a
    // {accessToken, refreshToken} pair via Google's token endpoint.
    responseType: ResponseType.Code,
    extraParams: {
      access_type: 'offline',
      // Force the consent screen so refresh_token is reissued every
      // connect — Google omits it on silent re-auth otherwise.
      prompt: 'consent',
    },
    shouldAutoExchangeCode: true,
  });

  const [pending, setPending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);

  // Live subscription to the integration doc so the UI reflects connect /
  // disconnect / sync-error stamps without a refresh.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setConnection(null);
      return;
    }
    let unsub: Unsubscribe | undefined;
    try {
      const ref = firestoreDoc(db, 'users', uid, 'integrations', 'google.calendar');
      unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) {
          setConnection(null);
          return;
        }
        const data = snap.data();
        setConnection({
          connectedAt: Number(data.connectedAt) || 0,
          email: data.email || undefined,
          scope: data.scope || undefined,
          lastSyncError: data.lastSyncError
            ? {
                at: Number(data.lastSyncError.at) || 0,
                message: String(data.lastSyncError.message || ''),
              }
            : undefined,
        });
      });
    } catch {
      // ignore — connection just stays null
    }
    return () => unsub?.();
  }, [auth.currentUser?.uid]);

  // Token-exchange completion → ship the refresh token to the callable.
  useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') {
      if (response.type === 'error' || response.type === 'cancel') {
        setPending(false);
        if (response.type === 'error') {
          setLastError((response as any).error?.message || 'Authorisation failed.');
        }
      }
      return;
    }

    const tokens = response.authentication;
    if (!tokens?.refreshToken) {
      setPending(false);
      // Web sign-in via the Auth Proxy doesn't currently surface refresh
      // tokens. Surface a friendly error so the user knows to retry on
      // mobile / re-grant consent.
      setLastError(
        Platform.OS === 'web'
          ? 'Connect from the mobile app — web OAuth doesn’t return a refresh token.'
          : 'No refresh token returned. Try connecting again and accept all prompts.',
      );
      return;
    }

    (async () => {
      try {
        const callable = httpsCallable(getFunctions(), 'storeGoogleCalendarToken');
        await callable({
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresIn
            ? Date.now() + Number(tokens.expiresIn) * 1000
            : null,
          scope: tokens.scope || CALENDAR_SCOPE,
        });
        setLastError(null);
      } catch (err: any) {
        setLastError(err?.message || 'Failed to save the connection.');
      } finally {
        setPending(false);
      }
    })();
  }, [response]);

  const connect = async () => {
    if (!request) return;
    setLastError(null);
    setPending(true);
    try {
      await promptAsync();
    } catch (err: any) {
      setLastError(err?.message || 'Could not open Google sign-in.');
      setPending(false);
    }
  };

  const disconnect = async () => {
    setLastError(null);
    setPending(true);
    try {
      const callable = httpsCallable(getFunctions(), 'disconnectGoogleCalendar');
      await callable({});
    } catch (err: any) {
      setLastError(err?.message || 'Failed to disconnect.');
    } finally {
      setPending(false);
    }
  };

  return {
    ready: !!request,
    pending,
    lastError,
    connection,
    connect,
    disconnect,
  };
}
