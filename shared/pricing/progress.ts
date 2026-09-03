/**
 * Pricing-pipeline events → the chat's live working card.
 *
 * Shared by the draft and reprice apply paths so their progress reads the
 * same; `status` carries the slow-changing phase headline, `detail` the rapid
 * per-item progress (kept separate so fast item events don't blow away the
 * headline). Lives in shared/pricing because the server-side pricing run
 * maps the same events into the same shape and writes it to the run document
 * the phone is watching.
 */

import type { PricingEvent } from './pipeline';

/** The one-line outcome the working card shows: "12 priced · 1 need pricing". */
export function summarisePriceCounts(counts: {
  fetchedCount: number;
  failedCount: number;
  skippedCount: number;
}): string {
  const parts: string[] = [];
  if (counts.fetchedCount > 0) parts.push(`${counts.fetchedCount} priced`);
  if (counts.failedCount > 0) parts.push(`${counts.failedCount} need pricing`);
  if (counts.skippedCount > 0) parts.push(`${counts.skippedCount} already priced`);
  return parts.join(' · ') || 'Nothing to price.';
}

export interface WorkingStatus {
  /** Pipeline phase identifier — drives icon + style. */
  phase: 'preflight' | 'analyzing' | 'building' | 'pricing' | 'done' | 'failed';
  /** Single short line — what's happening right now. */
  status: string;
  /** Optional secondary line — e.g. names of items being processed. */
  detail?: string;
  /** Optional rolling list of items being searched — shown under the status
   *  line so the user can see WHAT Mate is currently looking up, not just
   *  a generic "batch X of Y" progress headline. Populated during the
   *  Bunnings batch phase. */
  items?: Array<{ name: string; status: 'pending' | 'searching' | 'done' | 'failed' }>;
  /** When true, the spinner stops and the card renders the final state. */
  done: boolean;
  /** Final summary text shown when done. */
  summary?: string;
  /**
   * The run is executing on the server, so it survives the app being
   * backgrounded or the phone being locked. The working card uses this to
   * tell the tradie they can put the phone down (and to offer the "ping me
   * when it's done" push).
   */
  runsOnServer?: boolean;
}


export function pricingEventToProgress(event: PricingEvent): Partial<WorkingStatus> | null {
  if (event.kind === 'phase-start') {
    // Clear the per-item list when we move off the batch phase so stale
    // "Searching…" rows don't linger into reconcile/individual passes.
    return {
      phase: 'pricing',
      status: event.status,
      detail: undefined,
      // Clear the per-item list on every phase boundary — the next
      // batch-chunk event repopulates it, and non-batch phases shouldn't
      // carry stale rows.
      items: undefined,
    };
  }
  if (event.kind === 'batch-chunk') {
    return {
      status:
        event.currentName || `Checking Bunnings (batch ${event.chunkIndex} of ${event.totalChunks})…`,
      detail: `${event.progress.current}/${event.progress.total} items priced`,
      items: event.items,
    };
  }
  if (event.kind === 'item-priced') {
    const progressLine = event.progress
      ? `${event.progress.current}/${event.progress.total} priced`
      : undefined;
    const itemLine = event.success
      ? `${progressLine ? progressLine + ' · ' : ''}Just priced ${event.name}`
      : `${progressLine ? progressLine + ' · ' : ''}Couldn't find ${event.name}`;
    return { detail: itemLine };
  }
  if (event.kind === 'reconcile-start') {
    return { status: 'Sorting pack sizes and quantities…', detail: 'Mate is double-checking every line.' };
  }
  if (event.kind === 'reece-reauth') {
    return { status: 'Reece sign-in expired — sort it in Settings to use Reece prices.', detail: undefined };
  }
  if (event.kind === 'supplier-priority-fallback') {
    // The tradie ranked a supplier above Bunnings and the local pass still
    // came up empty for these terms. Saying so beats silently substituting a
    // retail price for a rate they thought they had.
    const missed = event.missedTerms.length;
    return {
      detail: `Your supplier list didn't cover ${missed} item${missed === 1 ? '' : 's'} — filling from Bunnings.`,
    };
  }
  return null;
}
