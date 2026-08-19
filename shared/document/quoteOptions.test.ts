/**
 * The rule that keeps competing quotes on one job coherent: accepting one
 * takes the others off the table.
 *
 * Every exclusion here is load-bearing — this function runs on the customer's
 * accept, unattended, and writes to documents the tradie is not looking at. A
 * false positive cancels live work.
 */
import { describe, it, expect } from 'vitest';

import {
  quotesSupersededByAccepting,
  liveQuoteCount,
  canAddQuoteOption,
  type SupersedableQuote,
} from './quoteOptions';

const q = (over: Partial<SupersedableQuote> & { id: string }): SupersedableQuote => ({
  jobId: 'job-1',
  type: 'quote',
  stage: 'quote_sent',
  ...over,
});

describe('quotesSupersededByAccepting', () => {
  it('supersedes the other quotes on the same job', () => {
    const accepted = q({ id: 'opt-1', stage: 'quote_accepted' });
    const all = [accepted, q({ id: 'opt-2' }), q({ id: 'opt-3' })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['opt-2', 'opt-3']);
  });

  it('never supersedes the accepted quote itself', () => {
    const accepted = q({ id: 'opt-1', stage: 'quote_accepted' });

    expect(quotesSupersededByAccepting(accepted, [accepted])).toEqual([]);
  });

  it('leaves quotes on other jobs alone', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'other', jobId: 'job-2' })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('leaves quotes with no job alone — an option is defined by its siblings', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'loose', jobId: undefined }), q({ id: 'null-job', jobId: null })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('does nothing at all when the accepted quote has no job', () => {
    const accepted = q({ id: 'opt-1', jobId: undefined });
    const all = [accepted, q({ id: 'opt-2', jobId: undefined })];

    // Otherwise every job-less quote in the account would supersede every other.
    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('never cancels an invoice — it is the same work, further along', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'inv-1', type: 'invoice', stage: 'invoice_sent' })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('skips quotes that are already cancelled', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [
      accepted,
      q({ id: 'gone', stage: 'cancelled' }),
      q({ id: 'gone-legacy', stage: undefined, status: 'cancelled' }),
      q({ id: 'live' }),
    ];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['live']);
  });

  it('skips a quote the customer has paid a deposit on', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'deposit-paid', depositPaid: 500 })];

    // Money has moved against it. Cancelling would orphan a real payment, and
    // two options with deposits is a mess a human has to see.
    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('skips a quote with any payment against it', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'part-paid', paidTotal: 0.01 })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('treats zero and missing money as unpaid', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [
      accepted,
      q({ id: 'zeroes', paidTotal: 0, depositPaid: 0 }),
      q({ id: 'nulls', paidTotal: null, depositPaid: null }),
    ];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['zeroes', 'nulls']);
  });

  it('supersedes an already-accepted sibling that carries no money', () => {
    // The accept that just happened is the newer statement of intent, and two
    // accepted quotes on one job is the ambiguity this exists to remove.
    const accepted = q({ id: 'opt-2', stage: 'quote_accepted' });
    const all = [q({ id: 'opt-1', stage: 'quote_accepted' }), accepted];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['opt-1']);
  });

  it('reads the legacy quotes shape, which has status and no type', () => {
    // The acceptance-link handler works on `users/{uid}/quotes`, where records
    // carry `status` and every row is a quote.
    const accepted: SupersedableQuote = { id: 'opt-1', jobId: 'job-1', status: 'accepted' };
    const all: SupersedableQuote[] = [
      accepted,
      { id: 'opt-2', jobId: 'job-1', status: 'sent' },
      { id: 'opt-3', jobId: 'job-1', status: 'draft' },
    ];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['opt-2', 'opt-3']);
  });

  it('supersedes draft options too — an unsent alternative is still on the table', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'never-sent', stage: 'draft' })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['never-sent']);
  });

  it('is empty when the job has only the accepted quote', () => {
    const accepted = q({ id: 'only' });

    expect(quotesSupersededByAccepting(accepted, [accepted])).toEqual([]);
  });

  it('does not mutate the list it is given', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'opt-2' })];
    const snapshot = JSON.stringify(all);

    quotesSupersededByAccepting(accepted, all);

    expect(JSON.stringify(all)).toBe(snapshot);
  });
});

describe('liveQuoteCount', () => {
  it('counts the quotes still on the table for a job', () => {
    const all = [
      q({ id: 'a' }),
      q({ id: 'b', stage: 'draft' }),
      q({ id: 'c', stage: 'cancelled' }),
      q({ id: 'inv', type: 'invoice', stage: 'invoice_sent' }),
      q({ id: 'elsewhere', jobId: 'job-2' }),
    ];

    expect(liveQuoteCount('job-1', all)).toBe(2);
  });

  it('is zero without a job', () => {
    expect(liveQuoteCount(null, [q({ id: 'a' })])).toBe(0);
    expect(liveQuoteCount(undefined, [q({ id: 'a' })])).toBe(0);
  });
});

describe('canAddQuoteOption', () => {
  const cases: Array<[string, SupersedableQuote | null | undefined, boolean]> = [
    ['a draft quote — pricing A then B back to back is the point', q({ id: 'a', stage: 'draft' }), true],
    ['a sent quote — the customer asked "what about the other system?"', q({ id: 'a', stage: 'quote_sent' }), true],
    ['a rejected quote — "not at that price" is when an alternative earns its place', q({ id: 'a', stage: 'quote_rejected' }), true],
    ['an ACCEPTED quote — they have already chosen', q({ id: 'a', stage: 'quote_accepted' }), false],
    ['a cancelled quote', q({ id: 'a', stage: 'cancelled' }), false],
    ['an invoice — the work is halfway billed', q({ id: 'a', type: 'invoice', stage: 'invoice_sent' }), false],
    ['a paid document', q({ id: 'a', stage: 'paid' }), false],
    ['a quote with no job, which has no siblings', q({ id: 'a', jobId: undefined }), false],
    ['nothing at all', null, false],
    ['undefined', undefined, false],
  ];

  for (const [label, doc, expected] of cases) {
    it(`${expected ? 'offers' : 'does not offer'} it for ${label}`, () => {
      expect(canAddQuoteOption(doc)).toBe(expected);
    });
  }

  it('reads the legacy status shape too', () => {
    expect(canAddQuoteOption({ id: 'a', jobId: 'job-1', status: 'sent' })).toBe(true);
    expect(canAddQuoteOption({ id: 'a', jobId: 'job-1', status: 'accepted' })).toBe(false);
  });
});
