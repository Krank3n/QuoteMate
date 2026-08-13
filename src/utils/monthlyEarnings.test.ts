/**
 * "Earned this month" read $0.00 on a day a $960 payment was recorded.
 *
 * It summed `total` for legacy QUOTES with status accepted/completed —
 * accepted quote value, labelled revenue. So a quote marked Accepted with
 * nothing paid counted in full, and an invoice genuinely paid counted
 * nothing, because once converted the legacy quote leaves those statuses.
 *
 * A revenue figure that ignores revenue quietly discredits every other
 * number on the screen, so these pin the two directions: money in counts,
 * promises don't.
 */
import { describe, it, expect } from 'vitest';

import { earnedInMonth } from './monthlyEarnings';

const AUG_13 = new Date(2026, 7, 13).getTime();
const AUG_1 = new Date(2026, 7, 1).getTime();
const JUL_31 = new Date(2026, 6, 31).getTime();
const SEP_1 = new Date(2026, 8, 1).getTime();
const LAST_AUG = new Date(2025, 7, 13).getTime();

function doc(over: Record<string, any> = {}): any {
  return { id: 'd1', type: 'invoice', stage: 'paid', total: 1000, paidTotal: 0, payments: [], ...over };
}

describe('earnedInMonth', () => {
  it('REGRESSION: counts a payment recorded this month', () => {
    const docs = [doc({ payments: [{ id: 'p1', amount: 960, paidAt: AUG_13 }] })];
    expect(earnedInMonth(docs, AUG_13)).toBe(960);
  });

  // The other half of the old bug: an accepted quote with no money is a
  // promise, not income.
  it('ignores a document with no payments, however large its total', () => {
    expect(earnedInMonth([doc({ total: 50000, stage: 'quote_accepted', type: 'quote' })], AUG_13)).toBe(0);
  });

  it('adds up payments across several documents', () => {
    const docs = [
      doc({ id: 'a', payments: [{ id: 'p1', amount: 500, paidAt: AUG_13 }] }),
      doc({ id: 'b', payments: [{ id: 'p2', amount: 250.5, paidAt: AUG_1 }] }),
    ];
    expect(earnedInMonth(docs, AUG_13)).toBe(750.5);
  });

  it('counts every payment on one document, not just the first', () => {
    const docs = [
      doc({
        payments: [
          { id: 'p1', amount: 400, paidAt: AUG_1 },
          { id: 'p2', amount: 560, paidAt: AUG_13 },
        ],
      }),
    ];
    expect(earnedInMonth(docs, AUG_13)).toBe(960);
  });

  it('excludes the months either side', () => {
    const docs = [
      doc({
        payments: [
          { id: 'p1', amount: 100, paidAt: JUL_31 },
          { id: 'p2', amount: 200, paidAt: AUG_13 },
          { id: 'p3', amount: 300, paidAt: SEP_1 },
        ],
      }),
    ];
    expect(earnedInMonth(docs, AUG_13)).toBe(200);
  });

  it('does not count the same month a year earlier', () => {
    const docs = [doc({ payments: [{ id: 'p1', amount: 999, paidAt: LAST_AUG }] })];
    expect(earnedInMonth(docs, AUG_13)).toBe(0);
  });

  // A cancelled invoice's payments were refunded or never belonged to it.
  it('skips cancelled documents', () => {
    const docs = [doc({ stage: 'cancelled', payments: [{ id: 'p1', amount: 500, paidAt: AUG_13 }] })];
    expect(earnedInMonth(docs, AUG_13)).toBe(0);
  });

  it('ignores payments with no date rather than guessing one', () => {
    const docs = [doc({ payments: [{ id: 'p1', amount: 500 }] })];
    expect(earnedInMonth(docs, AUG_13)).toBe(0);
  });

  it('rounds to cents so the tile never shows float noise', () => {
    const docs = [
      doc({
        payments: [
          { id: 'p1', amount: 0.1, paidAt: AUG_13 },
          { id: 'p2', amount: 0.2, paidAt: AUG_13 },
        ],
      }),
    ];
    expect(earnedInMonth(docs, AUG_13)).toBe(0.3);
  });

  it('survives an empty or junk ledger', () => {
    expect(earnedInMonth([], AUG_13)).toBe(0);
    expect(earnedInMonth([doc({ payments: undefined })], AUG_13)).toBe(0);
    expect(earnedInMonth([doc({ payments: [{ id: 'p', amount: 'abc', paidAt: AUG_13 }] })], AUG_13)).toBe(0);
  });
});
