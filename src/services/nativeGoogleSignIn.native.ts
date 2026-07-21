/**
 * Native (iOS/Android) Google Sign-In adapter.
 *
 * Uses the native Google Play Services / iOS account picker via
 * `@react-native-google-signin/google-signin` — there is NO browser or OAuth
 * redirect, so sign-in works regardless of the device's default browser. This
 * replaces the old `expo-auth-session` Custom Tab flow, which Firefox and other
 * non-Chrome browsers broke by dropping the `com.quotemate.app:/oauthredirect`
 * hand-off back to the app.
 *
 * Metro resolves this file on native; `nativeGoogleSignIn.web.ts` is used on
 * web (where Google sign-in goes through Firebase `signInWithPopup` instead).
 * All branching logic lives in `googleSignInCore.ts` so it stays unit-testable.
 */
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { interpretSignInResponse } from './googleSignInCore';

let configured = false;

export function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({
    // webClientId is the *server*/web OAuth client. The idToken it yields is
    // minted for this audience, which is exactly what Firebase's Google
    // provider verifies — so no extra Firebase wiring is needed.
    webClientId: Constants.expoConfig?.extra?.googleWebClientId,
    iosClientId: Constants.expoConfig?.extra?.googleIosClientId,
    offlineAccess: false,
  });
  configured = true;
}

/**
 * Present the native account picker and return a Google `idToken`, or `null` if
 * the user cancelled (a normal outcome the caller should treat as a no-op).
 * Throws for real failures — no Play Services, or a SHA-1 / OAuth-client
 * misconfiguration (`DEVELOPER_ERROR`) — which the caller maps via
 * `mapGoogleSignInError`.
 */
export async function signInGetIdToken(): Promise<string | null> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  const outcome = interpretSignInResponse(res);
  if (outcome.status === 'cancelled') return null;
  if (outcome.status === 'no-token') throw new Error('no-id-token');
  return outcome.idToken;
}

export { statusCodes };
