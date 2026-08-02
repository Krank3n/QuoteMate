/**
 * Deferred referral-code capture.
 *
 * A referral link (https://quotemateapp.au/ref/QM-AB2CD3) almost always lands
 * on someone who has just installed the app and is NOT signed in yet. The
 * applyReferralCode callable requires auth, so without somewhere to park the
 * code the whole journey was lost behind the auth gate and the referrer got no
 * credit — the tradie was expected to remember the code and go dig it out of
 * Settings after signing up.
 *
 * This stashes the code locally at launch and applies it once, automatically,
 * after the first successful sign-in. Fire-and-forget throughout: a storage or
 * network failure must never block launch or auth (same posture as
 * attributionService).
 *
 * Only ever holds a code that passes validation, so nothing unexpected can be
 * replayed into the callable later.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { extractReferralCode, isValidReferralCode } from '../utils/referral';

const PENDING_REFERRAL_KEY = '@quotemate:pending_referral';

/**
 * Park a referral code (or a full referral URL) for use after sign-in.
 * Returns the normalised code that was stored, or null if there was nothing
 * valid to store.
 */
export async function storePendingReferral(input: string | null | undefined): Promise<string | null> {
  const code = extractReferralCode(input);
  if (!isValidReferralCode(code)) return null;
  try {
    // First link wins: if a code is already pending, don't let a later link
    // (e.g. a second QR scan before signup completes) overwrite it.
    const existing = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    if (existing && isValidReferralCode(existing)) return existing;
    await AsyncStorage.setItem(PENDING_REFERRAL_KEY, code);
    return code;
  } catch {
    return null;
  }
}

export async function getPendingReferral(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    return stored && isValidReferralCode(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    // ignore
  }
}

export type ApplyPendingResult = 'none' | 'applied' | 'rejected' | 'retry';

/**
 * Apply any pending referral code for the signed-in user.
 *
 * Clearing policy matters: a REJECTION is terminal (own code, already referred,
 * already subscribed, outside the attribution window, unknown code) so the code
 * is dropped — retrying it forever would spam the callable on every launch. A
 * transport failure is left in place so the next launch can retry.
 */
export async function applyPendingReferral(): Promise<ApplyPendingResult> {
  const code = await getPendingReferral();
  if (!code) return 'none';

  try {
    const applyReferralCode = httpsCallable(getFunctions(), 'applyReferralCode');
    await applyReferralCode({ referralCode: code });
    await clearPendingReferral();
    return 'applied';
  } catch (error: unknown) {
    const rawCode = (error as { code?: string })?.code || '';
    const normalised = rawCode.replace('functions/', '');
    const terminal = [
      'not-found',
      'invalid-argument',
      'already-exists',
      'failed-precondition',
      'permission-denied',
    ].includes(normalised);

    if (terminal) {
      await clearPendingReferral();
      return 'rejected';
    }
    // unauthenticated / unavailable / internal / resource-exhausted → retry later
    return 'retry';
  }
}
