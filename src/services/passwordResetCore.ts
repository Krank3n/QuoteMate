/**
 * Pure, native-free logic for the "Forgot password?" flow on AuthScreen.
 *
 * Kept free of Expo/React Native imports (same rationale as googleSignInCore)
 * so it runs under vitest with only `firebase/functions` mocked.
 *
 * Why this exists: AuthScreen shipped with no password-reset affordance at all.
 * A locked-out tradie's only route back in was to create a *second* account
 * with Google/Apple, stranding their jobs on the first one — which is exactly
 * what happened to at least one user (Coastal HVAC, Jul 2026: password account
 * 19 Jul, duplicate Apple account 28 Jul, original never signed into again).
 *
 * Why this calls a Cloud Function rather than Firebase's own
 * `sendPasswordResetEmail`: Firebase mails reset links from
 * `noreply@<project>.firebaseapp.com`, which has no SPF/DKIM alignment with
 * hansendev.com.au. A live send on 29 Jul 2026 landed in Gmail's spam folder —
 * useless on a recovery path. The `requestPasswordReset` callable mints the
 * link server-side and posts it through Brevo, the same path as every other
 * QuoteMate email, which reaches the inbox.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';

export type PasswordResetOutcome =
  | { status: 'sent'; message: string }
  | { status: 'needs-email'; message: string }
  | { status: 'invalid-email'; message: string }
  | { status: 'failed'; message: string };

/**
 * Deliberately hedged, for two reasons that point the same way:
 *
 *  1. Account enumeration — a definite "sent!" vs "no such user" tells an
 *     attacker which addresses are registered.
 *  2. A social-only account has no password to reset, so what actually lands
 *     is the "sign in with Google/Apple instead" email, not a reset link.
 *
 * The server decides which of those emails to send; the client is told nothing
 * either way, so this copy has to cover both without promising either.
 */
export const RESET_SENT_MESSAGE =
  "Check your email — we've sent you what you need to get back in. Give it a minute, and check your junk folder if it hasn't turned up.";

/**
 * Format-only check. Deliberately NOT reusing AuthScreen's
 * `validateSignupEmail`: that one also rejects disposable domains, which is a
 * signup policy. Someone who already has an account must be able to reset it
 * regardless of the domain they used.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Ask the backend to send a reset. Never throws — every path resolves to an
 * outcome the caller can render directly.
 */
export async function requestPasswordReset(rawEmail: string): Promise<PasswordResetOutcome> {
  const normalized = (rawEmail || '').trim().toLowerCase();

  if (!normalized) {
    return { status: 'needs-email', message: 'Pop your email address in first, then tap Forgot password.' };
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    return { status: 'invalid-email', message: 'Please enter a valid email address' };
  }

  try {
    const callable = httpsCallable(getFunctions(), 'requestPasswordReset');
    await callable({ email: normalized });
    return { status: 'sent', message: RESET_SENT_MESSAGE };
  } catch (err) {
    const code = (err as { code?: string } | null | undefined)?.code;
    if (code === 'functions/unavailable' || code === 'unavailable') {
      return { status: 'failed', message: 'Network error. Please check your connection' };
    }
    return { status: 'failed', message: "Couldn't send the reset email. Please try again." };
  }
}
