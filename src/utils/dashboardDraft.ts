/**
 * Dashboard draft-banner rules.
 *
 * The banner offers one-tap resume of the newest unfinished wizard draft,
 * but only while that draft is plausibly still "the job I'm working on".
 * A weeks-old abandoned draft parked in the most prominent slot on the
 * home screen is clutter, and its only escape hatch is a destructive
 * delete — so stale drafts drop off the dashboard and stay reachable via
 * the Jobs list instead.
 */

import type { Quote } from '../types';

export const DRAFT_BANNER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Newest in-progress draft (status draft + wizard step stamped), or null
 * if there isn't one touched within the banner window.
 */
export function pickDashboardDraft(quotes: Quote[], now: number = Date.now()): Quote | null {
  const newest = quotes
    // An invoiced quote is finished work, not an in-progress draft — the
    // unified convert path used to leave the legacy row as status 'draft',
    // so the invoiceId/invoicedAt check also heals rows stamped before
    // convertDocumentToInvoice started clearing them.
    .filter((q) => q.status === 'draft' && q.draftStep && !q.invoiceId && !q.invoicedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (!newest) return null;
  const age = now - new Date(newest.updatedAt).getTime();
  return age <= DRAFT_BANNER_MAX_AGE_MS ? newest : null;
}

/**
 * While the banner is showing a draft, its auto-created Job would appear
 * again at the top of Recent Jobs (freshest updatedAt) — the same
 * work-in-progress listed twice on one screen. Drop that job from the
 * recent list; the banner is its representative.
 */
export function excludeDraftJob<T extends { id: string }>(
  jobs: T[],
  draftJobId: string | undefined | null,
): T[] {
  if (!draftJobId) return jobs;
  return jobs.filter((j) => j.id !== draftJobId);
}
