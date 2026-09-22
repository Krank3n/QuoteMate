/**
 * One definition of "the customer has opened this quote", shared by the
 * server (push trigger, documents projection) and the client (timeline,
 * stage chip), so the three never disagree about what counts.
 *
 * Two signals land on the legacy users/{uid}/quotes doc:
 *   - the acceptance page loading (`firstViewedAt` / `lastViewedAt` /
 *     `viewCount`, stamped by getQuoteForAcceptance) — a deliberate click,
 *     always trusted;
 *   - the email-open pixel (`emailFirstOpenedAt` / `emailLastOpenedAt` /
 *     `emailOpenCount` / `emailFirstOpenAfterMs`, stamped by trackEmailOpen).
 *
 * The pixel needs one guard: mail privacy proxies (Apple Mail's in
 * particular) prefetch images seconds after delivery, before any human has
 * looked. Every genuine open in prod so far arrived ≥18 s after the send,
 * so an open inside LIKELY_PREFETCH_MS is recorded on the doc but never
 * surfaced as the customer reading the quote. Change the constant, not the
 * callers.
 */
import { toMs } from './time';

export const LIKELY_PREFETCH_MS = 60_000;

export type CustomerOpenSource = 'link' | 'email';

export interface CustomerOpenSignals {
  firstViewedAt?: unknown;
  lastViewedAt?: unknown;
  emailFirstOpenedAt?: unknown;
  emailFirstOpenAfterMs?: unknown;
}

/** True when an email open arrived so soon after the send it is more likely a proxy prefetch than a person. */
export function isLikelyPrefetch(firstOpenAfterMs: unknown): boolean {
  return typeof firstOpenAfterMs === 'number'
    && Number.isFinite(firstOpenAfterMs)
    && firstOpenAfterMs < LIKELY_PREFETCH_MS;
}

/**
 * When the customer first opened the quote, in ms, or null when there is no
 * trustworthy open yet. A page load wins over the pixel because it is the
 * stronger signal and always the customer's own action.
 */
export function customerOpenedAtMs(doc: CustomerOpenSignals | null | undefined): number | null {
  if (!doc) return null;
  const viewed = toMs(doc.firstViewedAt) ?? toMs(doc.lastViewedAt);
  if (viewed !== undefined) return viewed;
  const emailOpened = toMs(doc.emailFirstOpenedAt);
  if (emailOpened === undefined) return null;
  return isLikelyPrefetch(doc.emailFirstOpenAfterMs) ? null : emailOpened;
}

/** Which signal `customerOpenedAtMs` is reporting, or null when there is none. */
export function customerOpenSource(doc: CustomerOpenSignals | null | undefined): CustomerOpenSource | null {
  if (!doc) return null;
  if (toMs(doc.firstViewedAt) !== undefined || toMs(doc.lastViewedAt) !== undefined) return 'link';
  return customerOpenedAtMs(doc) !== null ? 'email' : null;
}
