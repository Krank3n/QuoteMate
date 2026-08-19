/**
 * Which document a job leads with — the one the sticky action bar acts on and
 * the job screen shows in full.
 *
 * Lives apart from StickyJobActionBar because the component drags in the whole
 * React Native / Paper / theme graph, and the choice itself is a two-line rule
 * that every job surface depends on. It went untested for exactly that reason.
 */

import type { Document } from '../types/document';

/**
 * Pick the primary actionable doc: any invoice beats the latest quote.
 *
 * Cancelled documents are considered only when there is nothing else — they
 * are, by definition, the one thing on the job with no action left. This used
 * to be decided on `updatedAt` alone, which meant cancelling a quote made it
 * the thing the job screen led with. Accepting one of several options made
 * that routine: the accept saves first and the supersede writes a moment
 * later, so the job would headline the option the customer had just turned
 * down, complete with a red Cancelled chip, while the accepted one sat below
 * under "Also on this job".
 */
export function pickPrimaryDoc(docs: Document[]): Document | null {
  if (docs.length === 0) return null;
  const byNewest = (a: Document, b: Document) =>
    (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const live = docs.filter((d) => d.stage !== 'cancelled');
  const pool = live.length > 0 ? live : docs;
  const invoices = pool.filter((d) => d.type === 'invoice');
  if (invoices.length > 0) return [...invoices].sort(byNewest)[0];
  return [...pool].sort(byNewest)[0];
}
