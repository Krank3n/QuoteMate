/**
 * Pure decision logic for the password-reset request endpoint.
 *
 * Why this exists: Firebase Auth's own reset mail goes out from
 * `noreply@<project>.firebaseapp.com`, which has no SPF/DKIM alignment with
 * hansendev.com.au — a live send on 29 Jul 2026 landed straight in Gmail's
 * spam folder. Reset mail therefore has to travel the same Brevo path as the
 * rest of QuoteMate's email (proven inbox delivery, branded, logged to
 * emailLog). The endpoint generates the link with the Admin SDK and sends it
 * itself, so these helpers decide *what* to send without touching firebase or
 * Firestore.
 */

/** Format-only check; returns the normalized address or null. */
export function normalizeResetEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) return null;
  return normalized;
}

export interface ResetUserSnapshot {
  providers: string[];
  disabled: boolean;
}

export type ResetPlan =
  | { action: 'send-reset' }
  | { action: 'send-social-reminder'; providers: string[] }
  | { action: 'none'; reason: 'no-account' | 'disabled' };

/**
 * Decide what a given address should receive.
 *
 * The social-reminder branch is the point of the whole feature. A user who
 * signed up with Google or Apple has no password credential, so Firebase's
 * hosted flow sends them nothing at all and they sit waiting — which is how
 * one user ended up creating a duplicate account (Coastal HVAC, Jul 2026).
 * Emailing *the address itself* to say "use the Google/Apple button" leaks
 * nothing to a third party: only the mailbox owner ever sees it.
 */
export function planPasswordReset(user: ResetUserSnapshot | null): ResetPlan {
  if (!user) return { action: 'none', reason: 'no-account' };
  if (user.disabled) return { action: 'none', reason: 'disabled' };
  if (user.providers.includes('password')) return { action: 'send-reset' };

  const social = user.providers.filter((p) => p !== 'password');
  if (social.length > 0) return { action: 'send-social-reminder', providers: social };

  // No providers at all shouldn't happen, but sending nothing is the safe default.
  return { action: 'none', reason: 'no-account' };
}

/** Human label for a Firebase provider id, for use in email copy. */
export function providerLabel(providerId: string): string {
  switch (providerId) {
    case 'google.com':
      return 'Google';
    case 'apple.com':
      return 'Apple';
    case 'facebook.com':
      return 'Facebook';
    default:
      return providerId;
  }
}

/** Joins provider labels the way a person would say them: "Google or Apple". */
export function describeProviders(providers: string[]): string {
  const labels = Array.from(new Set(providers.map(providerLabel)));
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

export interface ThrottleRecord {
  count: number;
  windowStartMs: number;
}

export const RESET_WINDOW_MS = 60 * 60 * 1000;
export const RESET_MAX_PER_WINDOW = 5;

/**
 * Fixed-window limiter, keyed per address. The endpoint is unauthenticated and
 * sends real email, so without this it is an email-bomb relay pointed at any
 * address an attacker likes — and every send costs Brevo credit and sender
 * reputation.
 */
export function evaluateThrottle(
  record: ThrottleRecord | null | undefined,
  nowMs: number,
  windowMs: number = RESET_WINDOW_MS,
  max: number = RESET_MAX_PER_WINDOW,
): { allowed: boolean; next: ThrottleRecord } {
  if (!record || nowMs - record.windowStartMs >= windowMs) {
    return { allowed: true, next: { count: 1, windowStartMs: nowMs } };
  }
  if (record.count >= max) {
    return { allowed: false, next: record };
  }
  return { allowed: true, next: { count: record.count + 1, windowStartMs: record.windowStartMs } };
}
