/**
 * Call Katie live-demo bridge (client side).
 *
 * Thin wrappers over the `requestKatieDemoCall` / `getKatieSignupLink`
 * callables. All the secrets, signing and rate-limiting live server-side — the
 * app only ever asks for a demo call or the signup handoff link and renders the
 * result. The real number/business details are loaded server-side from the
 * user's settings, so we pass at most an edited phone override.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';

/** Discriminated result the CallKatie screen renders directly. */
export type KatieDemoResult =
  | { status: 'success'; phone: string; remaining: number; signupUrl: string }
  | { status: 'limit'; code: string; message: string }
  | { status: 'error'; code: string; message: string };

/**
 * Ask Katie to place a live demo call. `phone` optionally overrides the number
 * saved in settings (the user can edit it on screen). Throws on transport
 * failure; app-level outcomes come back as a KatieDemoResult.
 */
export async function requestKatieDemoCall(phone?: string): Promise<KatieDemoResult> {
  const callable = httpsCallable(getFunctions(), 'requestKatieDemoCall');
  const res = await callable(phone ? { phone } : {});
  return res.data as KatieDemoResult;
}

/**
 * Build (and mark as tapped) the signed CallKatie signup handoff URL for the
 * current user. Call this right before opening the link so the recovery drip
 * knows they've converted.
 */
export async function getKatieSignupLink(): Promise<string> {
  const callable = httpsCallable(getFunctions(), 'getKatieSignupLink');
  const res = await callable({});
  return (res.data as { url: string }).url;
}
