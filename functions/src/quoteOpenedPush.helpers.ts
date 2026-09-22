/**
 * Should this legacy-quote update push "Quote opened 👀" to the tradie?
 *
 * Two signals can say the customer opened the quote (see
 * shared/document/customerOpened.ts): the acceptance page loading
 * (lastViewedAt) and the email pixel (emailFirstOpenedAt). The onQuoteViewed
 * trigger in index.ts used to react to the page only, which is the ~8% path;
 * customers open the EMAIL ~70% of the time and the tradie never heard.
 *
 * Rules, in order:
 *   - a page view pushes each time lastViewedAt moves (as before);
 *   - an email open pushes only when customerOpenedAt just became known
 *     (first trustworthy open — repeat opens and proxy prefetches never push);
 *   - never once the quote is accepted / rejected / completed;
 *   - never inside 24 h of the last push for this quote (viewNotifiedAt).
 *
 * Pure so the branches are testable without the admin SDK; the trigger is a
 * thin wrapper that reads before/after and calls sendAussiePush.
 */
import { customerOpenedAtMs, type CustomerOpenSignals } from './shared/document/customerOpened';
import { toMs } from './shared/document/time';

export const QUOTE_OPENED_PUSH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const SETTLED_STATUSES = new Set(['accepted', 'rejected', 'completed']);

export interface QuoteOpenedPushInput extends CustomerOpenSignals {
  status?: unknown;
  viewNotifiedAt?: unknown;
}

export type QuoteOpenedPushDecision =
  | { push: true; signal: 'link' | 'email' }
  | { push: false; reason: 'no-open' | 'repeat-open' | 'settled' | 'cooldown' };

export function pageViewMoved(before: QuoteOpenedPushInput | null | undefined, after: QuoteOpenedPushInput): boolean {
  const afterMs = toMs(after.lastViewedAt);
  if (afterMs === undefined) return false;
  return toMs(before?.lastViewedAt) !== afterMs;
}

export function emailOpenBecameKnown(before: QuoteOpenedPushInput | null | undefined, after: QuoteOpenedPushInput): boolean {
  if (toMs(after.emailFirstOpenedAt) === undefined) return false;
  return customerOpenedAtMs(before) === null && customerOpenedAtMs(after) !== null;
}

export function decideQuoteOpenedPush(
  before: QuoteOpenedPushInput | null | undefined,
  after: QuoteOpenedPushInput,
  nowMs: number,
): QuoteOpenedPushDecision {
  const viaLink = pageViewMoved(before, after);
  const viaEmail = !viaLink && emailOpenBecameKnown(before, after);
  if (!viaLink && !viaEmail) {
    // A prefetch-only pixel hit is not an open at all; a known open that did
    // not move is a repeat.
    const anyOpen = toMs(after.lastViewedAt) !== undefined || customerOpenedAtMs(after) !== null;
    return { push: false, reason: anyOpen ? 'repeat-open' : 'no-open' };
  }
  if (SETTLED_STATUSES.has(String(after.status))) return { push: false, reason: 'settled' };
  const lastNotified = toMs(after.viewNotifiedAt);
  if (lastNotified !== undefined && nowMs - lastNotified < QUOTE_OPENED_PUSH_COOLDOWN_MS) {
    return { push: false, reason: 'cooldown' };
  }
  return { push: true, signal: viaLink ? 'link' : 'email' };
}
