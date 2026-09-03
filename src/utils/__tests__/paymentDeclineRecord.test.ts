/**
 * Apple req 5.10 — the record a customer gets when their card is declined.
 *
 * Two things have to hold at once and pull in opposite directions: the record
 * must reassure (say plainly that no money moved) without explaining (the app
 * is never told why a bank declined, and inventing a reason would be worse than
 * saying nothing). It is also customer-facing, so the tradie's business is the
 * only name on it.
 */
import { describe, it, expect } from 'vitest';

import { buildDeclineRecord } from '../paymentDeclineRecord';

// Built from LOCAL components on purpose. An absolute instant would render a
// different day in a different timezone, so this assertion would pass in Sydney
// and fail in CI — the record itself is meant to read in the tradie's local
// time, which is exactly what local components pin down.
const at = new Date(2026, 8, 3, 9, 41);

describe('buildDeclineRecord', () => {
  it('leads with the tradie business name', () => {
    const out = buildDeclineRecord({ businessName: 'Hansen Plumbing', amount: 360, at });
    expect(out.split('\n')[0]).toBe('Hansen Plumbing');
  });

  it('never puts the app on a customer-facing artifact', () => {
    const out = buildDeclineRecord({
      businessName: 'Hansen Plumbing',
      reference: 'INV-1042',
      amount: 360,
      at,
    });
    expect(out).not.toMatch(/quotemate/i);
    expect(out).not.toMatch(/\bvia\b/i);
  });

  it('says plainly that no money was taken', () => {
    const out = buildDeclineRecord({ amount: 360, at });
    expect(out).toMatch(/no money was taken/i);
    expect(out).toMatch(/nothing has been charged/i);
  });

  it('states the amount attempted in AUD', () => {
    const out = buildDeclineRecord({ amount: 3337.64, at });
    expect(out).toContain('$3,337.64');
  });

  it('carries the invoice reference when there is one', () => {
    const out = buildDeclineRecord({ reference: 'INV-1042', amount: 360, at });
    expect(out).toContain('For: INV-1042');
  });

  it('omits the reference line entirely rather than printing an empty one', () => {
    const out = buildDeclineRecord({ reference: '   ', amount: 360, at });
    expect(out).not.toMatch(/^For:/m);
  });

  it('omits the business name line when the tradie has not set one', () => {
    const out = buildDeclineRecord({ businessName: '  ', amount: 360, at });
    expect(out.split('\n')[0]).toMatch(/declined/i);
  });

  it('never invents a reason for the decline', () => {
    const out = buildDeclineRecord({ amount: 360, at });
    // The app is not told why. Anything resembling a cause is a fabrication.
    expect(out).not.toMatch(/insufficient|expired|fraud|limit|blocked|stolen/i);
  });

  it('timestamps the attempt from the injected time, not the clock', () => {
    const out = buildDeclineRecord({ amount: 360, at });
    // en-AU abbreviates September as "Sept".
    expect(out).toMatch(/When: 3 Sept? 2026, 9:41 am/);
  });
});
