/**
 * Square OAuth state handling (PAY-03).
 *
 * The old flow base64-encoded { uid, ts } as the OAuth `state` and the
 * unauthenticated callback trusted the decoded uid — anyone could forge a
 * fresh state for a victim uid and bind their own Square account to that
 * user. The fix: `state` is a random single-use nonce; only its SHA-256 hash
 * is stored server-side (squareOAuthStates/{hash}) against the uid that was
 * authenticated when the flow started, and the callback consumes the doc
 * transactionally, so a state can neither be forged nor replayed.
 */
import * as crypto from 'crypto';

export const SQUARE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const SQUARE_OAUTH_STATES_COLLECTION = 'squareOAuthStates';

/** Random, URL-safe, single-use OAuth state nonce. */
export function newOAuthState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Hash stored server-side so a Firestore read leak can't mint valid states. */
export function hashOAuthState(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex');
}

export type OAuthStateVerdict =
  | { ok: true; uid: string }
  | { ok: false; status: number; error: string };

/**
 * Validate a stored state doc (undefined = not found/already consumed).
 * Pure so the expiry/shape rules are unit-testable without Firestore.
 */
export function oauthStateVerdict(
  docData: { uid?: unknown; createdAtMs?: unknown } | undefined,
  nowMs: number,
): OAuthStateVerdict {
  if (!docData || typeof docData.uid !== 'string' || !docData.uid) {
    return { ok: false, status: 400, error: 'Invalid state parameter' };
  }
  const createdAtMs = typeof docData.createdAtMs === 'number' ? docData.createdAtMs : NaN;
  if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs > SQUARE_OAUTH_STATE_TTL_MS) {
    return { ok: false, status: 400, error: 'Authorization expired. Please try again.' };
  }
  return { ok: true, uid: docData.uid };
}
