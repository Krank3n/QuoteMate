/**
 * Pure helpers for ad-attribution capture (see
 * QuoteMateAppWebsite/marketing/fb-ads-growth-system-2026-07.md §2/§8).
 *
 * First-touch model: the params present when the web app is first opened are
 * the ones that get written to users/{uid}/profile/attribution, exactly once
 * per account. Attributed revenue is a floor, not a truth — cross-device and
 * cleared-storage journeys are invisible, which is why the growth system
 * cross-checks against baseline signup lift.
 */

export const ATTRIBUTION_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
] as const;

export type AttributionParam = (typeof ATTRIBUTION_PARAMS)[number];

export type AttributionParams = Partial<Record<AttributionParam, string>>;

/** sessionStorage key shared with the marketing site (same origin — the web
 * app is served at quotemateapp.au/app, so the landing page can hand the
 * params over via storage as well as via the URL). */
export const ATTRIBUTION_STORAGE_KEY = 'qm_attribution';

/**
 * Extract known attribution params from a query string ("?utm_source=…" or
 * "utm_source=…"). Returns null when none are present so callers can cheaply
 * skip organic sessions. Values are trimmed and length-capped — these end up
 * in Firestore and in admin tables, and URLs are attacker-controlled input.
 */
export function parseAttributionParams(search: string | null | undefined): AttributionParams | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return null;
  }
  const out: AttributionParams = {};
  for (const key of ATTRIBUTION_PARAMS) {
    const value = params.get(key);
    if (value) {
      const trimmed = value.trim().slice(0, 200);
      if (trimmed) out[key] = trimmed;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Shape written to users/{uid}/profile/attribution. */
export interface AttributionDoc extends AttributionParams {
  landedAt: string; // ISO — when the params were first seen, not when written
  capturedOn: 'web';
}

export function buildAttributionDoc(params: AttributionParams, landedAt: Date): AttributionDoc {
  return { ...params, landedAt: landedAt.toISOString(), capturedOn: 'web' };
}

/**
 * Parse a previously-stored payload (sessionStorage). Tolerates junk: returns
 * null unless it looks like something buildStoredPayload produced with at
 * least one known param.
 */
export function parseStoredAttribution(raw: string | null | undefined): AttributionDoc | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const params: AttributionParams = {};
    for (const key of ATTRIBUTION_PARAMS) {
      if (typeof parsed[key] === 'string' && parsed[key].trim()) {
        params[key] = parsed[key].trim().slice(0, 200);
      }
    }
    if (Object.keys(params).length === 0) return null;
    const landedAt = typeof parsed.landedAt === 'string' ? parsed.landedAt : new Date(0).toISOString();
    return { ...params, landedAt, capturedOn: 'web' };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ *
 * Organic/first-touch acquisition context (website → account)
 *
 * The marketing site records a small, non-campaign first-touch record under
 * `qm_acquisition` (session storage + a same-origin 30-minute cookie) — see
 * QuoteMateAppWebsite/app/components/acquisition.ts. The web app is served
 * from the same origin (quotemateapp.au/app), so it can read that record and
 * persist it to the account that gets created.
 *
 * Everything below treats the record as UNTRUSTED input: it is browser
 * storage that any visitor can hand-edit, and it lands in Firestore and in
 * admin tables. Validate the shape, cap the lengths, and drop anything that
 * does not match, rather than trusting the site that wrote it.
 *
 * Deliberate non-goals:
 *  - This does NOT replace or extend the paid `qm_attribution` contract above.
 *    Paid campaigns keep their own storage key, their own doc fields and their
 *    own rollup key. This record rides alongside under `acquisition`.
 *  - An absent or unusable record is `unknown`, never `organic`. We do not
 *    invent attribution for accounts we cannot explain.
 * ------------------------------------------------------------------------ */

/** sessionStorage key + cookie name shared with the marketing site. */
export const ACQUISITION_STORAGE_KEY = 'qm_acquisition';

/**
 * How stale a first-touch record may be and still be joined to a signup.
 * The site's cookie already expires in 30 minutes; sessionStorage, though,
 * survives for as long as the tab is open, which can be days. Beyond a week
 * the claim that "this landing page brought them" stops being honest, so the
 * account is recorded as unknown instead.
 */
export const MAX_ACQUISITION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How recently the Firebase account must have been created for this to count
 * as a genuinely new account. `persistAttributionIfNew` runs on every auth
 * state change — sign-in, token refresh, app reload — so without this a
 * two-year-old account signing in on the web for the first time would be
 * stamped with today's landing page as its origin.
 */
export const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

export type AcquisitionChannel =
  | 'paid'
  | 'organic_search'
  | 'referral'
  | 'direct'
  | 'unknown';

/** Exactly the fields the marketing site writes — no free-form payload. */
export interface AcquisitionContext {
  source: string;
  medium: string;
  landingPage: string;
  referrerHost: string;
  landedAt: string;
}

/** Persisted under `acquisition` on users/{uid}/profile/attribution. */
export interface AcquisitionRecord extends AcquisitionContext {
  channel: AcquisitionChannel;
  /** When the account picked the record up, distinct from `landedAt`. */
  recordedAt: string;
}

/**
 * Public marketing paths only. The site's own capture already allowlists
 * these, but a hand-edited record must not be able to park an authenticated,
 * private or customer-facing URL (/app, /admin, /portal, /q/<token>) in the
 * account record or the admin tables.
 */
const PRIVATE_PATH = /^\/(?:app|admin|portal|q|join|api)(?:\/|$)/i;
const SAFE_PATH = /^\/[A-Za-z0-9\-/]*$/;

function isPublicMarketingPath(path: string): boolean {
  return (
    typeof path === 'string' &&
    path.length <= 200 &&
    SAFE_PATH.test(path) &&
    !PRIVATE_PATH.test(path)
  );
}

/**
 * Parse the browser-supplied `qm_acquisition` payload. Returns null for
 * anything that is not exactly the expected shape — corrupt JSON, missing or
 * non-string fields, an unusable date, an over-long or private landing page,
 * or characters outside the small allowlists the site itself writes.
 *
 * Extra fields are dropped rather than forwarded: the returned object is
 * rebuilt key by key so a crafted payload cannot smuggle anything into
 * Firestore.
 */
export function parseAcquisitionContext(raw: string | null | undefined): AcquisitionContext | null {
  if (!raw || raw.length > 2000) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { source, medium, landingPage, referrerHost, landedAt } = parsed;
  if (
    typeof source !== 'string' ||
    typeof medium !== 'string' ||
    typeof landingPage !== 'string' ||
    typeof referrerHost !== 'string' ||
    typeof landedAt !== 'string'
  ) {
    return null;
  }
  if (!/^[a-z0-9_. ()-]{1,253}$/i.test(source)) return null;
  if (!/^[a-z0-9_. ()-]{1,80}$/i.test(medium)) return null;
  if (!isPublicMarketingPath(landingPage)) return null;
  if (referrerHost && !/^[a-z0-9.-]{1,253}$/i.test(referrerHost)) return null;
  const landedMs = Date.parse(landedAt);
  if (!Number.isFinite(landedMs)) return null;
  return { source, medium, landingPage, referrerHost, landedAt };
}

const PAID_MEDIUMS = new Set([
  'cpc',
  'ppc',
  'paid',
  'paidsocial',
  'paid_social',
  'paid-social',
  'cpm',
  'display',
  'retargeting',
]);

/**
 * Map a first-touch record onto a reporting channel.
 *
 * `unknown` is a real answer and the default: an internal referrer, a blank
 * medium or anything unrecognised stays unknown rather than being folded into
 * organic. Only a recognised search engine referral counts as organic search.
 */
export function classifyAcquisition(context: AcquisitionContext): AcquisitionChannel {
  const medium = context.medium.trim().toLowerCase();
  if (PAID_MEDIUMS.has(medium)) return 'paid';
  if (medium === 'organic') return 'organic_search';
  if (medium === 'referral') return 'referral';
  if (medium === '(none)' && context.source.trim().toLowerCase() === '(direct)') return 'direct';
  return 'unknown';
}

/**
 * True when the record is fresh enough, and predates account creation, to be
 * a credible explanation of where this account came from. A record stamped
 * after the account existed is somebody's later visit, not their first touch.
 */
export function acquisitionFitsAccount(
  context: AcquisitionContext,
  accountCreatedMs: number,
  nowMs: number,
): boolean {
  const landedMs = Date.parse(context.landedAt);
  if (!Number.isFinite(landedMs)) return false;
  if (landedMs > nowMs + 5 * 60 * 1000) return false; // clock skew tolerance
  if (nowMs - landedMs > MAX_ACQUISITION_AGE_MS) return false;
  // A minute of slack: the account write and the landing stamp come from two
  // different clocks (Firebase server vs the visitor's browser).
  return landedMs <= accountCreatedMs + 60 * 1000;
}

/**
 * True when the Firebase account was created just now, as opposed to a
 * returning user signing in or a token refreshing.
 */
export function isGenuinelyNewAccount(
  accountCreatedAt: string | number | null | undefined,
  nowMs: number,
): boolean {
  if (accountCreatedAt === null || accountCreatedAt === undefined) return false;
  const createdMs =
    typeof accountCreatedAt === 'number' ? accountCreatedAt : Date.parse(accountCreatedAt);
  if (!Number.isFinite(createdMs)) return false;
  const age = nowMs - createdMs;
  // Allow a little negative age for clock skew; reject anything genuinely old.
  return age <= NEW_ACCOUNT_WINDOW_MS && age >= -5 * 60 * 1000;
}

export function buildAcquisitionRecord(context: AcquisitionContext, now: Date): AcquisitionRecord {
  return {
    ...context,
    channel: classifyAcquisition(context),
    recordedAt: now.toISOString(),
  };
}
