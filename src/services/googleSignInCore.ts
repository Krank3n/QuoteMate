/**
 * Pure, native-free logic for the native Google Sign-In flow.
 *
 * Kept deliberately free of `@react-native-google-signin/google-signin` and any
 * Expo/React Native imports so it runs under vitest (node) with only
 * `firebase/auth` mocked. The platform adapter (`nativeGoogleSignIn.native.ts`)
 * feeds the SDK's return values and thrown errors through these helpers.
 *
 * Why this exists: the browser-based `expo-auth-session` Google flow depended on
 * the device's default browser handing an OAuth redirect back to the app, which
 * Firefox (and other non-Chrome Custom Tabs providers) drop — so sign-in
 * silently failed. The native SDK has no browser/redirect, and this module is
 * where its results become a Firebase session.
 */
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import type { Auth, UserCredential } from 'firebase/auth';

/**
 * The subset of the SDK's `statusCodes` we branch on. Passed in (rather than
 * imported) so this module stays free of the native dependency.
 */
export interface GoogleStatusCodes {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
  SIGN_IN_REQUIRED: string;
}

export type GoogleSignInOutcome =
  | { status: 'success'; idToken: string }
  | { status: 'cancelled' }
  | { status: 'no-token' };

/**
 * Interpret the *return value* of `GoogleSignin.signIn()`.
 *
 * v13+ (incl. the installed v16) returns `{ type: 'cancelled', data: null }`
 * when the user backs out — a normal, non-error outcome — and
 * `{ type: 'success', data: { idToken, ... } }` on success. `idToken` can be
 * `null` on success in edge cases, which we surface as `no-token` so the caller
 * doesn't hand `null` to Firebase.
 */
export function interpretSignInResponse(res: unknown): GoogleSignInOutcome {
  const r = res as { type?: string; data?: { idToken?: string | null } } | null | undefined;
  if (r?.type === 'cancelled') return { status: 'cancelled' };
  const idToken = r?.data?.idToken ?? null;
  if (typeof idToken === 'string' && idToken.length > 0) {
    return { status: 'success', idToken };
  }
  return { status: 'no-token' };
}

export type GoogleSignInErrorKind = 'cancelled' | 'in-progress' | 'no-play-services' | 'failed';

/**
 * Classify a *thrown* SDK error (e.g. from `hasPlayServices()` or a native
 * module rejection). Cancellation normally arrives as a return value now, but a
 * thrown `SIGN_IN_CANCELLED` is still handled defensively. Unknown codes —
 * including Android's `DEVELOPER_ERROR` (a SHA-1 / OAuth-client misconfig) —
 * fall through to `failed`.
 */
export function mapGoogleSignInError(err: unknown, codes: GoogleStatusCodes): GoogleSignInErrorKind {
  const code = (err as { code?: string } | null | undefined)?.code;
  if (code === codes.SIGN_IN_CANCELLED) return 'cancelled';
  if (code === codes.IN_PROGRESS) return 'in-progress';
  if (code === codes.PLAY_SERVICES_NOT_AVAILABLE) return 'no-play-services';
  return 'failed';
}

/**
 * User-facing message for an error kind. `null` means show nothing (the user
 * cancelled, or a sign-in is already running — neither warrants an error).
 */
export function messageForGoogleSignInError(kind: GoogleSignInErrorKind): string | null {
  switch (kind) {
    case 'cancelled':
    case 'in-progress':
      return null;
    case 'no-play-services':
      return 'Google sign-in needs Google Play Services. Please sign in with email instead.';
    case 'failed':
    default:
      return 'Failed to sign in with Google. Please try again.';
  }
}

/**
 * Exchange a Google `idToken` for a Firebase session. The idToken's audience is
 * the web/server OAuth client, which is exactly what Firebase's Google provider
 * expects — so this is the same credential path the old browser flow used.
 */
export async function firebaseSignInWithGoogleIdToken(auth: Auth, idToken: string): Promise<UserCredential> {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}
