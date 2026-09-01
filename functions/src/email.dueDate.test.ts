import { describe, it, expect } from 'vitest';
import { renderPricingRows } from './email';

/**
 * Regression: the "Due …" line vanishing from invoice emails.
 *
 * `dueDate` is declared `string` but is populated straight off a Firestore doc,
 * so it can arrive as a Timestamp. The old code did `new Date(input.dueDate)`
 * and then guarded with `!isNaN(due.getTime())` — so a Timestamp produced
 * Invalid Date, failed the guard, and the whole line was dropped. The invoice
 * went to the customer with no due date and nothing logged.
 *
 * Quieter than the PDF's "Invalid Date" and worse: nothing visibly wrong.
 *
 * 12:00 UTC keeps the calendar day identical in UTC and Australian zones.
 */
const AT_NOON_UTC = Date.UTC(2026, 7, 9, 12, 0, 0); // 9 Aug 2026
const base = { subtotal: 1000, total: 1100, isInvoice: true } as any;

describe('renderPricingRows — invoice due date', () => {
  it('renders the Due line when dueDate is a Firestore Timestamp — THE BUG', () => {
    const html = renderPricingRows({
      ...base,
      dueDate: { toDate: () => new Date(AT_NOON_UTC) },
    });
    expect(html).toContain('Due 9 August 2026');
  });

  it('renders it for {_seconds}, epoch millis and ISO strings alike', () => {
    for (const dueDate of [
      { _seconds: AT_NOON_UTC / 1000, _nanoseconds: 0 },
      AT_NOON_UTC,
      new Date(AT_NOON_UTC).toISOString(),
    ]) {
      expect(renderPricingRows({ ...base, dueDate })).toContain('Due 9 August 2026');
    }
  });

  it('still omits the line entirely when there is no usable due date', () => {
    for (const dueDate of [undefined, null, '', 'not a date']) {
      expect(renderPricingRows({ ...base, dueDate })).not.toContain('Due ');
    }
  });

  it('never emits "Invalid Date" to a customer', () => {
    for (const dueDate of [{ toDate: () => { throw new Error('x'); } }, {}, NaN]) {
      expect(renderPricingRows({ ...base, dueDate })).not.toContain('Invalid');
    }
  });
});
