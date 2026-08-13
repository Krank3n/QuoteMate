/**
 * Money actually received in a calendar month.
 *
 * The dashboard's "Earned this month" used to sum `total` for legacy QUOTES
 * with status accepted/completed and an updatedAt in the month. That measured
 * accepted quote value and called it revenue, which is wrong twice over:
 *
 *   - A quote marked Accepted with nothing paid counted its FULL value as
 *     earned.
 *   - An invoice you were genuinely paid for counted nothing, because once
 *     converted the legacy quote no longer sits in those statuses. Recording
 *     $960 left the tile reading $0.00.
 *
 * Earnings come from the payment ledger, which is the only record of money
 * having moved. Cancelled documents are excluded — a cancelled invoice's
 * payments were refunded or never belonged to it.
 */

import type { Document } from '../types/document';

export function earnedInMonth(documents: Document[], now: number | Date = Date.now()): number {
  const ref = now instanceof Date ? now : new Date(now);
  const month = ref.getMonth();
  const year = ref.getFullYear();

  let total = 0;
  for (const doc of documents || []) {
    if (!doc || doc.stage === 'cancelled') continue;
    for (const payment of doc.payments || []) {
      const amount = Number(payment?.amount) || 0;
      if (amount <= 0) continue;
      const paidAt = Number(payment?.paidAt) || 0;
      if (!paidAt) continue;
      const at = new Date(paidAt);
      if (at.getMonth() === month && at.getFullYear() === year) {
        total += amount;
      }
    }
  }
  // Two decimals — summing floats otherwise shows $1,919.9999999 on a tile.
  return Math.round(total * 100) / 100;
}
