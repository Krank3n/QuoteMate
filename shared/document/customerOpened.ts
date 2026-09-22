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
 * Two rules shape the answer:
 *
 *   1. Only opens at or after the LATEST send count. The legacy `sentAt` is
 *      re-stamped on every email send, so an open that predates it belongs
 *      to an earlier version of the quote and says nothing about this one.
 *
 *   2. Mail privacy proxies (Apple Mail's above all) prefetch images seconds
 *      after delivery, before any human has looked — and the pixel writes
 *      `emailFirstOpenedAt` exactly once, so a proxy that gets in first
 *      would own that stamp forever. A first open inside LIKELY_PREFETCH_MS
 *      of the send is therefore ignored, and the LAST open is consulted
 *      instead: the handler throttles writes to one per minute, so a later
 *      hit ≥ LIKELY_PREFETCH_MS after the send is a person. Every genuine
 *      open in prod so far arrived ≥18 s after the send. Change the constant,
 *      not the callers.
 */
import { toMs } from './time';

export const LIKELY_PREFETCH_MS = 60_000;

export type CustomerOpenSource = 'link' | 'email';

export interface CustomerOpenSignals {
  /** Latest send (legacy quotes re-stamp it on every email send). */
  sentAt?: unknown;
  firstViewedAt?: unknown;
  lastViewedAt?: unknown;
  emailFirstOpenedAt?: unknown;
  emailLastOpenedAt?: unknown;
  emailFirstOpenAfterMs?: unknown;
}

export interface CustomerOpen {
  at: number;
  source: CustomerOpenSource;
}

/** True when an email open arrived so soon after the send it is more likely a proxy prefetch than a person. */
export function isLikelyPrefetch(firstOpenAfterMs: unknown): boolean {
  return typeof firstOpenAfterMs === 'number'
    && Number.isFinite(firstOpenAfterMs)
    && firstOpenAfterMs < LIKELY_PREFETCH_MS;
}

function atOrAfterSend(t: number | undefined, sent: number | undefined): t is number {
  return t !== undefined && (sent === undefined || t >= sent);
}

/**
 * The customer's first trustworthy open of the CURRENT send, or null. A page
 * load wins over the pixel because it is the stronger signal and always the
 * customer's own action.
 */
export function deriveCustomerOpen(doc: CustomerOpenSignals | null | undefined): CustomerOpen | null {
  if (!doc) return null;
  const sent = toMs(doc.sentAt);

  const firstViewed = toMs(doc.firstViewedAt);
  const lastViewed = toMs(doc.lastViewedAt);
  if (atOrAfterSend(firstViewed, sent)) return { at: firstViewed, source: 'link' };
  if (atOrAfterSend(lastViewed, sent)) return { at: lastViewed, source: 'link' };

  const firstOpened = toMs(doc.emailFirstOpenedAt);
  if (atOrAfterSend(firstOpened, sent)) {
    const tooSoon = isLikelyPrefetch(doc.emailFirstOpenAfterMs)
      || (sent !== undefined && firstOpened - sent < LIKELY_PREFETCH_MS);
    if (!tooSoon) return { at: firstOpened, source: 'email' };
  }
  const lastOpened = toMs(doc.emailLastOpenedAt);
  if (atOrAfterSend(lastOpened, sent) && (sent === undefined || lastOpened - sent >= LIKELY_PREFETCH_MS)) {
    return { at: lastOpened, source: 'email' };
  }
  return null;
}

export function customerOpenedAtMs(doc: CustomerOpenSignals | null | undefined): number | null {
  return deriveCustomerOpen(doc)?.at ?? null;
}

export function customerOpenSource(doc: CustomerOpenSignals | null | undefined): CustomerOpenSource | null {
  return deriveCustomerOpen(doc)?.source ?? null;
}

/**
 * The open-related slice of the `documents` projection, from a legacy quote:
 * the raw stamps as epoch ms plus the derived answer. Used by the mirror's
 * projectShared AND written directly onto documents/{id} by the two handlers
 * that stamp opens, because those stamps never bump the legacy `updatedAt`
 * and the mirror skips a projection older than what is on disk.
 *
 * `customerOpenedAt` / `customerOpenSource` are `null` (not undefined) once
 * any raw stamp exists, so a merge write can clear a value that a re-send has
 * made stale.
 */
export interface CustomerOpenProjection {
  firstViewedAt?: number;
  lastViewedAt?: number;
  viewCount?: number;
  emailFirstOpenedAt?: number;
  emailLastOpenedAt?: number;
  emailOpenCount?: number;
  emailFirstOpenAfterMs?: number;
  customerOpenedAt?: number | null;
  customerOpenSource?: CustomerOpenSource | null;
}

export function customerOpenProjection(
  legacy: (CustomerOpenSignals & { viewCount?: unknown; emailOpenCount?: unknown }) | null | undefined,
): CustomerOpenProjection {
  if (!legacy) return {};
  const out: CustomerOpenProjection = {
    firstViewedAt: toMs(legacy.firstViewedAt),
    lastViewedAt: toMs(legacy.lastViewedAt),
    viewCount: typeof legacy.viewCount === 'number' ? legacy.viewCount : undefined,
    emailFirstOpenedAt: toMs(legacy.emailFirstOpenedAt),
    emailLastOpenedAt: toMs(legacy.emailLastOpenedAt),
    emailOpenCount: typeof legacy.emailOpenCount === 'number' ? legacy.emailOpenCount : undefined,
    emailFirstOpenAfterMs: typeof legacy.emailFirstOpenAfterMs === 'number' ? legacy.emailFirstOpenAfterMs : undefined,
  };
  const anyStamp = out.firstViewedAt !== undefined || out.lastViewedAt !== undefined
    || out.emailFirstOpenedAt !== undefined || out.emailLastOpenedAt !== undefined;
  if (anyStamp) {
    const open = deriveCustomerOpen(legacy);
    out.customerOpenedAt = open?.at ?? null;
    out.customerOpenSource = open?.source ?? null;
  }
  return out;
}
