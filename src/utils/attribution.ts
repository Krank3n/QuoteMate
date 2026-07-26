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
