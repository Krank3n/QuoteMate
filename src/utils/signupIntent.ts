/**
 * Signup intent handed over from the marketing site.
 *
 * Every acquisition CTA on quotemateapp.au ("Get my first quote", "Start
 * free", the pricing buttons) pointed at a bare /app, and AuthScreen opens on
 * sign-in — so the first screen a first-time visitor saw after clicking "get
 * started" said "Welcome back". Those CTAs now carry ?signup=1 and this reads
 * it, so they land on "Create your account" instead. The site's own "Log in"
 * links deliberately don't carry it.
 *
 * Intent only picks which side of the screen opens: the "Already have an
 * account? Sign In" switch is untouched, so a returning user who clicks a
 * marketing CTA is one tap from where they meant to go.
 *
 * Kept free of react-native imports so it stays a plain unit test. The
 * Platform guard lives at the call site.
 */

/** Values we accept for ?signup=. The key itself is case-sensitive — our own
 * links are the only thing that sets it, so there's nothing to be lenient
 * about. */
const TRUTHY = new Set(['1', 'true', 'yes']);

/**
 * True when a query string carries signup intent. Accepts a leading "?" or
 * not, and tolerates junk (a malformed string is just "no intent", never a
 * throw at launch).
 */
export function hasSignupIntent(search: string | null | undefined): boolean {
  if (!search) return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return false;
  }
  const value = params.get('signup');
  return value != null && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Read signup intent off the current URL. Web only in practice: native has no
 * landing page to arrive from, and `window.location` is undefined there, so
 * this returns false rather than throwing if it ever runs.
 */
export function readSignupIntentFromLocation(): boolean {
  if (typeof window === 'undefined') return false;
  return hasSignupIntent(window.location?.search);
}
