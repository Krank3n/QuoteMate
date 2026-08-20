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
  canAddQuoteOption,
  liveQuoteOptions,
  isQuoteOpenForResponse,
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

  it('refuses to withdraw a quote the customer can still PAY', () => {
    // Nothing voids a Square link — they lapse on their own TTL — so
    // cancelling behind a payable URL sets a trap: the payment lands on a
    // cancelled quote, where every job aggregate skips it. A quote someone can
    // still pay is not off the table.
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'payable', squarePaymentLinkUrl: 'https://square.test/pay' })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('sees a payable link in the unified shape too', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [
      accepted,
      q({ id: 'payable', activePaymentLink: { url: 'https://square.test/pay' } }),
    ];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('sees a deposit link', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [accepted, q({ id: 'payable', depositPaymentLinkUrl: 'https://square.test/dep' })];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('still withdraws an option with no way to pay it', () => {
    const accepted = q({ id: 'opt-1' });
    const all = [
      accepted,
      q({ id: 'plain', activePaymentLink: null, squarePaymentLinkUrl: null }),
    ];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['plain']);
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

  it('REFUSES to supersede an already-accepted sibling', () => {
    // The race this closes: a customer holding two links accepts both within
    // the same window. Each accept writes its own quote then cancels the
    // other, and one interleaving leaves BOTH cancelled — a job that has lost
    // the sale after the customer said yes twice. Two accepted quotes is
    // untidy; a human can see and resolve it.
    const accepted = q({ id: 'opt-2', stage: 'quote_accepted' });
    const all = [q({ id: 'opt-1', stage: 'quote_accepted' }), accepted];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual([]);
  });

  it('refuses in the legacy status shape too, which is where the race runs', () => {
    // The acceptance-link handler works on `users/{uid}/quotes`.
    const accepted: SupersedableQuote = { id: 'opt-2', jobId: 'job-1', status: 'accepted' };
    const all: SupersedableQuote[] = [
      { id: 'opt-1', jobId: 'job-1', status: 'accepted' },
      { id: 'opt-3', jobId: 'job-1', status: 'sent' },
      accepted,
    ];

    expect(quotesSupersededByAccepting(accepted, all)).toEqual(['opt-3']);
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

describe('isQuoteOpenForResponse', () => {
  it('lets a sent quote be answered', () => {
    expect(isQuoteOpenForResponse(q({ id: 'a', stage: 'quote_sent' }))).toBe(true);
  });

  it('closes a superseded option, whose link is still in the customer’s inbox', () => {
    // Otherwise they accept option 1, then option 2 an hour later, and the
    // agreed price is whichever email got clicked last.
    expect(isQuoteOpenForResponse(q({ id: 'a', stage: 'cancelled' }))).toBe(false);
  });

  it('closes a cancelled quote in the legacy status shape', () => {
    expect(isQuoteOpenForResponse({ id: 'a', status: 'cancelled' })).toBe(false);
  });
});

describe('liveQuoteOptions', () => {
  it('returns the quotes still on the table', () => {
    const docs = [q({ id: 'a' }), q({ id: 'b', stage: 'draft' })];

    expect(liveQuoteOptions(docs).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('drops invoices — an invoice is not a competing price', () => {
    const docs = [q({ id: 'a' }), q({ id: 'inv', type: 'invoice', stage: 'invoice_sent' })];

    expect(liveQuoteOptions(docs).map((d) => d.id)).toEqual(['a']);
  });

  it('drops superseded options', () => {
    const docs = [q({ id: 'a' }), q({ id: 'gone', stage: 'cancelled' })];

    expect(liveQuoteOptions(docs).map((d) => d.id)).toEqual(['a']);
  });

  it('gives one entry for the ordinary job, so it is not an option set', () => {
    // The screen treats >1 as an option set; a single quote must never trip it.
    expect(liveQuoteOptions([q({ id: 'only' })])).toHaveLength(1);
  });

  it('is empty for a job whose only document is an invoice', () => {
    expect(liveQuoteOptions([q({ id: 'inv', type: 'invoice', stage: 'paid' })])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const docs = [q({ id: 'a' }), q({ id: 'b' })];
    const before = docs.map((d) => d.id);

    liveQuoteOptions(docs);

    expect(docs.map((d) => d.id)).toEqual(before);
  });
});
