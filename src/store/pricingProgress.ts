// Pricing-pipeline events → the chat's live working card.
//
// Shared by the draft and reprice apply paths so their progress reads the
// same; `status` carries the slow-changing phase headline, `detail` the rapid
// per-item progress (kept separate so fast item events don't blow away the
// headline).
//
// PricingEvent is a TYPE-ONLY import — esbuild elides it, so this module never
// pulls materialsPipeline's react-native / LLM graph into the test runner
// (the same trick priceFetchTelemetry documents).

import type { PricingEvent } from '../services/materialsPipeline';
import type { WorkingStatus } from '../types/assistant';

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
