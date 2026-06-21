/**
 * Pure, dependency-free helpers for the `quickFeedback` HTTPS handler
 * (see functions/src/index.ts). Extracted so the regression-critical logic —
 * scanner/prefetch detection, the deterministic (idempotent) feedback doc id,
 * and POST routing — is unit-testable without Firestore or email.
 *
 * Background: corporate email security scanners (Microsoft Safe Links,
 * Mimecast, Proofpoint, …) fetch every link in an email, which previously
 * recorded all three ratings (great/okay/bad) at once for one delivered email.
 */

export type FeedbackCategory = string | undefined;

/**
 * Deterministic doc id keyed by user + category so re-taps / prefetches upsert
 * a single record instead of appending a new one each time. Anything that isn't
 * 're-engagement' falls into the default first-quote bucket.
 */
export function getFeedbackDocId(uid: string, category: FeedbackCategory): string {
  return `${uid}__${category === 're-engagement' ? 're-engagement' : 'first-quote'}`;
}

/** Human label for the founder notification and the stored record. */
export function getCategoryLabel(category: FeedbackCategory): string {
  return category === 're-engagement' ? 'Re-engagement' : 'First Quote Follow-Up';
}

type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(',') : v || '';
}

/**
 * True when the request is a HEAD probe or an email-client / link-previewer
 * prefetch — both must be side-effect-free (no Firestore write, no founder
 * email). This is the core scanner-prefetch guard.
 */
export function isSideEffectFreeRequest(method: string | undefined, headers: HeaderBag): boolean {
  if ((method || '').toUpperCase() === 'HEAD') return true;
  const purpose = (
    headerValue(headers.purpose) ||
    headerValue(headers['x-purpose']) ||
    headerValue(headers['x-moz']) ||
    headerValue(headers['sec-purpose'])
  ).toLowerCase();
  return purpose.includes('prefetch') || purpose.includes('preview');
}

/**
 * A POST is a "record the rating" call (auto-fired on real page load) rather
 * than a detailed-feedback submission when it explicitly sets record:true, or
 * carries a rating with no details text.
 */
export function isRatingRecordRequest(body: { record?: unknown; rating?: unknown; details?: unknown }): boolean {
  return body.record === true || (!body.details && !!body.rating);
}
