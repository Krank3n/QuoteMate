/**
 * Web stub for the native Google Sign-In adapter.
 *
 * Google sign-in on web goes through Firebase `signInWithPopup` directly in
 * `AuthScreen`; this native-only module must never be invoked there. It exists
 * so the web bundle never resolves `@react-native-google-signin/google-signin`
 * (a native module). Metro picks this file for the web platform.
 */

export function ensureConfigured(): void {
  // no-op on web
}

export async function signInGetIdToken(): Promise<string | null> {
  throw new Error('nativeGoogleSignIn is unavailable on web');
}

/** Mirrors the SDK's statusCodes so `AuthScreen`'s error mapping type-checks. */
export const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
} as const;
