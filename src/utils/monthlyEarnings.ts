/**
 * Money actually received in a calendar month.
 *
 * The dashboard's "Earned this month" used to sum `total` for legacy QUOTES
 * with status accepted/completed and an updatedAt in the month — accepted
 * quote value, labelled revenue. So a quote marked Accepted with nothing
 * paid counted in full, and an invoice genuinely paid counted nothing,
 * because once converted the legacy quote leaves those statuses. Recording
 * $960 left the tile reading $0.00.
 *
 * Earnings come from the payment ledger, which is the only record of money
 * having moved. That is exactly the accountant statement's cash view, so
 * this is a month-shaped call into the shared core rather than a second
 * implementation that could drift from it.
 */

import type { Document } from '../types/document';
import { buildStatement } from '../../shared/statement/buildStatement';

export function earnedInMonth(documents: Document[], now: number | Date = Date.now()): number {
  const ref = now instanceof Date ? now : new Date(now);
  // Local time: the tile means the tradie's own calendar month.
  const fromMs = new Date(ref.getFullYear(), ref.getMonth(), 1).getTime();
  const toMs = new Date(ref.getFullYear(), ref.getMonth() + 1, 1).getTime();
  return buildStatement(documents as any, { fromMs, toMs }, {}).summary.receivedTotal;
}
