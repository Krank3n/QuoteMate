/**
 * Customer follow-up selection.
 *
 * The admin funnel put numbers on when a silent quote is worth chasing:
 * acceptances land in a median of 20 hours, so the first reminder goes at 48
 * hours and the second at 7 days. These pin both boundaries and every reason a
 * quote is left alone — answered, link lapsed, no link, already chased twice.
 */
import { describe, it, expect } from 'vitest';

import {
  selectQuotesForFollowUp,
  selectInvoicesForFollowUp,
  type FollowUpQuote,
  type FollowUpInvoice,
  FIRST_FOLLOW_UP_MS,
  MIN_GAP_MS,
  SECOND_FOLLOW_UP_MS,
  TOKEN_EXPIRATION_MS,
  FIRST_INVOICE_FOLLOW_UP_MS,
  SECOND_INVOICE_FOLLOW_UP_MS,
  INVOICE_MIN_GAP_MS,
  MAX_OVERDUE_AGE_MS,
  DEFAULT_ON_FROM_MS,
} from './customerFollowUp';

const NOW = new Date('2026-09-04T09:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A quote that WOULD be followed up: emailed, unanswered, link live, sent
 * three days ago with no reminders yet. Each test overrides only what its
 * scenario needs.
 */
function quote(overrides: Partial<FollowUpQuote> = {}): FollowUpQuote {
  const sentAtMs = overrides.sentAtMs ?? NOW - 3 * DAY;
  return {
    id: 'q1',
    customerEmail: 'customer@somewhere.com',
    sendMethod: 'email',
    respondedAtMs: null,
    suppressAutoFollowUp: false,
    sentAtMs,
    acceptanceTokenCreatedAtMs: sentAtMs,
    followUpCount: 0,
    ...overrides,
  };
}

function select(q: FollowUpQuote) {
  return selectQuotesForFollowUp([q], NOW);
}

describe('selectQuotesForFollowUp — timing', () => {
  it('does not send the first reminder at 47 hours', () => {
    expect(select(quote({ sentAtMs: NOW - 47 * HOUR }))).toEqual([]);
  });

  it('sends the first reminder at 48 hours', () => {
    const out = select(quote({ sentAtMs: NOW - 48 * HOUR, acceptanceTokenCreatedAtMs: NOW - 48 * HOUR }));
    expect(out).toHaveLength(1);
    expect(out[0].followUpNumber).toBe(1);
  });

  it('sends nothing new at 6 days when the first reminder already went out', () => {
    // count 1: first reminder sent (token re-minted then), still shy of 7 days.
    expect(
      select(quote({ sentAtMs: NOW - 6 * DAY, followUpCount: 1, acceptanceTokenCreatedAtMs: NOW - 4 * DAY })),
    ).toEqual([]);
  });

  it('sends the second reminder at 7 days', () => {
    const out = select(
      quote({ sentAtMs: NOW - 7 * DAY, followUpCount: 1, acceptanceTokenCreatedAtMs: NOW - 5 * DAY }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].followUpNumber).toBe(2);
  });
});

describe('selectQuotesForFollowUp — never sends', () => {
  it('never chases a quote the customer has responded to', () => {
    expect(select(quote({ respondedAtMs: NOW - 1 * DAY }))).toEqual([]);
  });

  it('never sends once the acceptance token has expired (31 days)', () => {
    expect(
      select(quote({ sentAtMs: NOW - 31 * DAY, acceptanceTokenCreatedAtMs: NOW - 31 * DAY })),
    ).toEqual([]);
  });

  it('never sends for a quote with no acceptance link', () => {
    expect(select(quote({ acceptanceTokenCreatedAtMs: null }))).toEqual([]);
  });

  it('never sends a third reminder once two have gone out', () => {
    expect(select(quote({ sentAtMs: NOW - 20 * DAY, followUpCount: 2 }))).toEqual([]);
  });
});

describe('selectQuotesForFollowUp — eligibility guards', () => {
  it('skips a quote with no customer email', () => {
    expect(select(quote({ customerEmail: null }))).toEqual([]);
  });

  it('skips a quote that was sent by SMS rather than email', () => {
    expect(select(quote({ sendMethod: 'sms' }))).toEqual([]);
  });

  it('follows up a legacy quote with no sendMethod (always an email send)', () => {
    const out = select(quote({ sendMethod: null }));
    expect(out).toHaveLength(1);
    expect(out[0].followUpNumber).toBe(1);
  });

  it('skips a quote the tradie muted', () => {
    expect(select(quote({ suppressAutoFollowUp: true }))).toEqual([]);
  });

  it('skips a quote with no send timestamp', () => {
    expect(select(quote({ sentAtMs: null }))).toEqual([]);
  });
});

describe('selectQuotesForFollowUp — batch', () => {
  // One customer each: this covers the selection rules, and sharing an address
  // would instead exercise the one-chase-per-customer cap tested below.
  it('returns one selection per due quote and leaves the rest alone', () => {
    const out = selectQuotesForFollowUp(
      [
        quote({ id: 'first', customerEmail: 'a@somewhere.com', sentAtMs: NOW - 3 * DAY, acceptanceTokenCreatedAtMs: NOW - 3 * DAY }),
        quote({ id: 'second', customerEmail: 'b@somewhere.com', sentAtMs: NOW - 8 * DAY, followUpCount: 1, acceptanceTokenCreatedAtMs: NOW - 6 * DAY }),
        quote({ id: 'too-fresh', customerEmail: 'c@somewhere.com', sentAtMs: NOW - 1 * DAY }),
        quote({ id: 'answered', customerEmail: 'd@somewhere.com', respondedAtMs: NOW - 1 * HOUR }),
      ],
      NOW,
    );
    expect(out.map((s) => [s.quote.id, s.followUpNumber])).toEqual([
      ['first', 1],
      ['second', 2],
    ]);
  });
});

describe('follow-up constants', () => {
  it('first reminder is 48 hours, second is 7 days, tokens expire at 30 days', () => {
    expect(FIRST_FOLLOW_UP_MS).toBe(48 * HOUR);
    expect(SECOND_FOLLOW_UP_MS).toBe(7 * DAY);
    expect(TOKEN_EXPIRATION_MS).toBe(30 * DAY);
  });
});

describe('selectQuotesForFollowUp — spacing, self-sends and the 30-day edge', () => {
  it('waits 5 days after the first reminder even when the quote is already 12 days old', () => {
    // A backlog quote (auto follow-up switched on late): reminder 1 went out
    // yesterday. Day-of-send maths alone would fire reminder 2 this morning.
    const twelveDaysOld = quote({
      sentAtMs: NOW - 12 * DAY,
      acceptanceTokenCreatedAtMs: NOW - 1 * DAY,
      followUpCount: 1,
      lastFollowUpAtMs: NOW - 1 * DAY,
    });
    expect(select(twelveDaysOld)).toEqual([]);

    const fiveDaysLater = quote({ ...twelveDaysOld, lastFollowUpAtMs: NOW - MIN_GAP_MS });
    expect(select(fiveDaysLater).map((s) => s.followUpNumber)).toEqual([2]);
  });

  it('a count of 1 with no last-sent stamp is still owed the second reminder at 7 days', () => {
    const out = select(quote({ sentAtMs: NOW - 8 * DAY, acceptanceTokenCreatedAtMs: NOW - 8 * DAY, followUpCount: 1, lastFollowUpAtMs: null }));
    expect(out.map((s) => s.followUpNumber)).toEqual([2]);
  });

  it('never chases a quote the tradie sent to their own address', () => {
    const own = ['Tradie@Biz.com.au', null, undefined];
    expect(selectQuotesForFollowUp([quote({ customerEmail: ' tradie@biz.com.au ' })], NOW, { ownEmails: own })).toEqual([]);
    // The auth email counts too, and a real customer is unaffected.
    expect(selectQuotesForFollowUp([quote({ customerEmail: 'me@gmail.com' })], NOW, { ownEmails: ['x@biz.com', 'ME@gmail.com'] })).toEqual([]);
    expect(selectQuotesForFollowUp([quote()], NOW, { ownEmails: own })).toHaveLength(1);
  });

  it('chases the link up to and including day 30, and not a millisecond past it', () => {
    const onTheDay = quote({ sentAtMs: NOW - TOKEN_EXPIRATION_MS, acceptanceTokenCreatedAtMs: NOW - TOKEN_EXPIRATION_MS });
    expect(select(onTheDay)).toHaveLength(1);
    const justPast = quote({ sentAtMs: NOW - TOKEN_EXPIRATION_MS - 1, acceptanceTokenCreatedAtMs: NOW - TOKEN_EXPIRATION_MS - 1 });
    expect(select(justPast)).toEqual([]);
  });
});

describe('selectQuotesForFollowUp — one chase per customer per run', () => {
  it('sends a single reminder when one customer is sitting on three quotes', () => {
    // Three "still keen?" emails into one inbox in the same minute, all from
    // the same business, reads as a bot rather than as the tradie.
    const out = selectQuotesForFollowUp([
      quote({ id: 'newest', sentAtMs: NOW - 3 * DAY }),
      quote({ id: 'oldest', sentAtMs: NOW - 12 * DAY }),
      quote({ id: 'middle', sentAtMs: NOW - 6 * DAY }),
    ], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].quote.id).toBe('oldest');
  });

  it('matches customers case- and whitespace-insensitively', () => {
    const out = selectQuotesForFollowUp([
      quote({ id: 'a', customerEmail: 'Sarah@Somewhere.com', sentAtMs: NOW - 12 * DAY }),
      quote({ id: 'b', customerEmail: '  sarah@somewhere.com ', sentAtMs: NOW - 3 * DAY }),
    ], NOW);
    expect(out.map((s) => s.quote.id)).toEqual(['a']);
  });

  it('still chases every different customer in the same run', () => {
    const out = selectQuotesForFollowUp([
      quote({ id: 'a', customerEmail: 'a@somewhere.com' }),
      quote({ id: 'b', customerEmail: 'b@somewhere.com' }),
      quote({ id: 'c', customerEmail: 'c@somewhere.com' }),
    ], NOW);
    expect(out.map((s) => s.quote.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves the held-back quote chaseable on a later run', () => {
    // Nothing is dropped: the loser carries no reminder count, so the next run
    // picks it up once the winner has been stamped.
    const held = quote({ id: 'held', sentAtMs: NOW - 3 * DAY });
    const winner = quote({ id: 'winner', sentAtMs: NOW - 12 * DAY, followUpCount: 1, lastFollowUpAtMs: NOW });
    expect(selectQuotesForFollowUp([held, winner], NOW).map((s) => s.quote.id)).toEqual(['held']);
  });

  it('cannot starve a customer\'s other quotes — each one leaves after two', () => {
    // The winner is spent (two reminders), so it drops out of the running
    // entirely and the next-oldest takes the slot rather than waiting forever.
    const out = selectQuotesForFollowUp([
      quote({ id: 'spent', sentAtMs: NOW - 20 * DAY, acceptanceTokenCreatedAtMs: NOW - 2 * DAY, followUpCount: 2 }),
      quote({ id: 'waiting', sentAtMs: NOW - 4 * DAY }),
    ], NOW);
    expect(out.map((s) => s.quote.id)).toEqual(['waiting']);
  });
});

/**
 * Invoice chases. Everything is measured from the due date, not the send, and
 * every reason an unpaid invoice is left alone is pinned here — settled,
 * cancelled, never emailed, self-sent, muted, or a debt too old to open a
 * chase on.
 */
describe('selectInvoicesForFollowUp', () => {
  /**
   * An invoice that WOULD be chased: emailed, unpaid, five days past its due
   * date, no reminders yet. Each test overrides only what it needs.
   */
  function invoice(overrides: Partial<FollowUpInvoice> = {}): FollowUpInvoice {
    return {
      id: 'i1',
      customerEmail: 'customer@somewhere.com',
      sendMethod: 'email',
      status: 'sent',
      suppressAutoFollowUp: false,
      sentAtMs: NOW - 20 * DAY,
      dueAtMs: NOW - 5 * DAY,
      balanceDue: 1200,
      followUpCount: 0,
      ...overrides,
    };
  }

  function selectInv(i: FollowUpInvoice) {
    return selectInvoicesForFollowUp([i], NOW);
  }

  describe('timing', () => {
    it('does not chase an invoice due yesterday', () => {
      expect(selectInv(invoice({ dueAtMs: NOW - 1 * DAY }))).toEqual([]);
    });

    it('does not chase at 2 days 23 hours past due', () => {
      expect(selectInv(invoice({ dueAtMs: NOW - (3 * DAY - HOUR) }))).toEqual([]);
    });

    it('sends the first chase at exactly 3 days past due', () => {
      const out = selectInv(invoice({ dueAtMs: NOW - FIRST_INVOICE_FOLLOW_UP_MS }));
      expect(out).toHaveLength(1);
      expect(out[0].followUpNumber).toBe(1);
    });

    it('sends nothing at 9 days past due when the first chase already went out', () => {
      expect(selectInv(invoice({
        dueAtMs: NOW - 9 * DAY,
        followUpCount: 1,
        lastFollowUpAtMs: NOW - 6 * DAY,
      }))).toEqual([]);
    });

    it('sends the second chase at 10 days past due', () => {
      const out = selectInv(invoice({
        dueAtMs: NOW - SECOND_INVOICE_FOLLOW_UP_MS,
        followUpCount: 1,
        lastFollowUpAtMs: NOW - INVOICE_MIN_GAP_MS,
      }));
      expect(out).toHaveLength(1);
      expect(out[0].followUpNumber).toBe(2);
    });

    it('holds the second chase back until 7 days after the first', () => {
      // A backlog invoice: already 20 days past due when it was first chased
      // yesterday. Both boundaries are met, but the gap is not.
      expect(selectInv(invoice({
        dueAtMs: NOW - 21 * DAY,
        followUpCount: 1,
        lastFollowUpAtMs: NOW - 1 * DAY,
      }))).toEqual([]);
    });

    it('sends the second chase once the 7-day gap has passed', () => {
      const out = selectInv(invoice({
        dueAtMs: NOW - 21 * DAY,
        followUpCount: 1,
        lastFollowUpAtMs: NOW - INVOICE_MIN_GAP_MS,
      }));
      expect(out).toHaveLength(1);
      expect(out[0].followUpNumber).toBe(2);
    });

    it('never sends a third chase', () => {
      expect(selectInv(invoice({ dueAtMs: NOW - 30 * DAY, followUpCount: 2 }))).toEqual([]);
    });
  });

  describe('stale debts', () => {
    it('opens a chase on the last day of the window', () => {
      expect(selectInv(invoice({ dueAtMs: NOW - MAX_OVERDUE_AGE_MS }))).toHaveLength(1);
    });

    it('never opens a chase on a debt older than the window', () => {
      // The app's record is too likely to be stale — paid in cash, never
      // marked. This is the one that must not email the customer.
      expect(selectInv(invoice({ dueAtMs: NOW - (MAX_OVERDUE_AGE_MS + DAY) }))).toEqual([]);
    });

    it('still finishes a sequence that started inside the window', () => {
      const out = selectInv(invoice({
        dueAtMs: NOW - (MAX_OVERDUE_AGE_MS + 10 * DAY),
        followUpCount: 1,
        lastFollowUpAtMs: NOW - INVOICE_MIN_GAP_MS,
      }));
      expect(out).toHaveLength(1);
      expect(out[0].followUpNumber).toBe(2);
    });
  });

  describe('what is left alone', () => {
    it('skips an invoice with no customer email', () => {
      expect(selectInv(invoice({ customerEmail: null }))).toEqual([]);
    });

    it('skips a send that did not go by email', () => {
      expect(selectInv(invoice({ sendMethod: 'share' }))).toEqual([]);
    });

    it('chases a legacy invoice carrying no sendMethod', () => {
      expect(selectInv(invoice({ sendMethod: undefined }))).toHaveLength(1);
    });

    it('skips an invoice the tradie emailed to themselves', () => {
      const own = invoice({ customerEmail: 'Tradie@Example.com' });
      expect(selectInvoicesForFollowUp([own], NOW, {
        ownEmails: ['  tradie@example.com '],
      })).toEqual([]);
    });

    it('skips a draft', () => {
      expect(selectInv(invoice({ status: 'draft' }))).toEqual([]);
    });

    it('skips a paid invoice', () => {
      expect(selectInv(invoice({ status: 'paid' }))).toEqual([]);
    });

    it('skips a cancelled invoice', () => {
      expect(selectInv(invoice({ status: 'cancelled' }))).toEqual([]);
    });

    it('chases a part-paid invoice for the balance', () => {
      const out = selectInv(invoice({ status: 'partial', balanceDue: 400 }));
      expect(out).toHaveLength(1);
      expect(out[0].invoice.balanceDue).toBe(400);
    });

    it('chases an invoice already flipped to overdue', () => {
      expect(selectInv(invoice({ status: 'overdue' }))).toHaveLength(1);
    });

    it('skips a settled balance even while the status still says sent', () => {
      // A recorded payment can clear the money before anything rewrites status.
      expect(selectInv(invoice({ status: 'sent', balanceDue: 0 }))).toEqual([]);
    });

    it('skips an unusable balance rather than chasing for nothing', () => {
      expect(selectInv(invoice({ balanceDue: NaN }))).toEqual([]);
      expect(selectInv(invoice({ balanceDue: -50 }))).toEqual([]);
    });

    it('skips an invoice the tradie muted', () => {
      expect(selectInv(invoice({ suppressAutoFollowUp: true }))).toEqual([]);
    });

    it('skips an invoice that never actually went out', () => {
      expect(selectInv(invoice({ sentAtMs: null }))).toEqual([]);
    });

    it('skips an invoice with no due date to measure from', () => {
      expect(selectInv(invoice({ dueAtMs: null }))).toEqual([]);
    });
  });

  it('picks each due invoice out of a mixed batch exactly once', () => {
    const out = selectInvoicesForFollowUp([
      invoice({ id: 'first', customerEmail: 'a@somewhere.com' }),
      invoice({ id: 'settled', customerEmail: 'b@somewhere.com', balanceDue: 0 }),
      invoice({ id: 'too-soon', customerEmail: 'c@somewhere.com', dueAtMs: NOW - 1 * DAY }),
      invoice({ id: 'second', customerEmail: 'd@somewhere.com', followUpCount: 1, dueAtMs: NOW - 12 * DAY, lastFollowUpAtMs: NOW - 8 * DAY }),
    ], NOW);
    expect(out.map((s) => [s.invoice.id, s.followUpNumber])).toEqual([
      ['first', 1],
      ['second', 2],
    ]);
  });

  describe('one chase per customer per run', () => {
    it('sends a single email when one customer owes on three invoices', () => {
      // Three demands for money into one inbox in the same minute, over the
      // tradie's own business name, is the failure this prevents.
      const out = selectInvoicesForFollowUp([
        invoice({ id: 'newest', dueAtMs: NOW - 4 * DAY }),
        invoice({ id: 'oldest', dueAtMs: NOW - 20 * DAY }),
        invoice({ id: 'middle', dueAtMs: NOW - 9 * DAY }),
      ], NOW);
      expect(out).toHaveLength(1);
      expect(out[0].invoice.id).toBe('oldest');
    });

    it('matches customers case- and whitespace-insensitively', () => {
      const out = selectInvoicesForFollowUp([
        invoice({ id: 'a', customerEmail: 'Sarah@Somewhere.com', dueAtMs: NOW - 20 * DAY }),
        invoice({ id: 'b', customerEmail: '  sarah@somewhere.com ', dueAtMs: NOW - 5 * DAY }),
      ], NOW);
      expect(out.map((s) => s.invoice.id)).toEqual(['a']);
    });

    it('still chases every different customer in the same run', () => {
      const out = selectInvoicesForFollowUp([
        invoice({ id: 'a', customerEmail: 'a@somewhere.com' }),
        invoice({ id: 'b', customerEmail: 'b@somewhere.com' }),
        invoice({ id: 'c', customerEmail: 'c@somewhere.com' }),
      ], NOW);
      expect(out.map((s) => s.invoice.id)).toEqual(['a', 'b', 'c']);
    });

    it('leaves the held-back invoices chaseable on a later run', () => {
      // Nothing is dropped: the loser carries no reminder count, so tomorrow's
      // run picks it up once the winner has been stamped.
      const held = invoice({ id: 'held', dueAtMs: NOW - 4 * DAY });
      const winner = invoice({ id: 'winner', dueAtMs: NOW - 20 * DAY, followUpCount: 1, lastFollowUpAtMs: NOW });
      expect(selectInvoicesForFollowUp([held, winner], NOW).map((s) => s.invoice.id)).toEqual(['held']);
    });
  });
});

/**
 * The enrolment floor. Auto follow-up flipped from opt-in to opt-out, which
 * enrolled every account that had never touched the switch — each with a back
 * catalogue of silent quotes and unpaid invoices sitting behind it. Without a
 * floor the first run after that deploy emails all of it at once, on behalf of
 * tradies who never asked for any of it. This is the guard, and these are the
 * two things it has to get right: hold back the history, and don't break the
 * accounts that opted in on purpose.
 */
describe('openFromMs — the enrolment floor', () => {
  // Comfortably after the floor, so "recent" and "old" are unambiguous.
  const AFTER = DEFAULT_ON_FROM_MS + 10 * DAY;
  const BEFORE = DEFAULT_ON_FROM_MS - 10 * DAY;
  const LATER = AFTER + 5 * DAY;

  describe('quotes, dated by their send', () => {
    function q(over: Partial<FollowUpQuote> = {}): FollowUpQuote {
      const sentAtMs = over.sentAtMs ?? AFTER;
      return {
        id: 'q1',
        customerEmail: 'customer@somewhere.com',
        sendMethod: 'email',
        respondedAtMs: null,
        sentAtMs,
        acceptanceTokenCreatedAtMs: sentAtMs,
        followUpCount: 0,
        ...over,
      };
    }
    const floored = (quote: FollowUpQuote, now: number) =>
      selectQuotesForFollowUp([quote], now, { openFromMs: DEFAULT_ON_FROM_MS });

    it('holds back a quote sent before the flip', () => {
      expect(floored(q({ sentAtMs: BEFORE }), BEFORE + 5 * DAY)).toEqual([]);
    });

    it('chases a quote sent after the flip', () => {
      expect(floored(q({ sentAtMs: AFTER }), LATER)).toHaveLength(1);
    });

    it('chases a quote sent at the exact moment of the flip', () => {
      const sentAtMs = DEFAULT_ON_FROM_MS;
      expect(floored(
        q({ sentAtMs, acceptanceTokenCreatedAtMs: sentAtMs }),
        sentAtMs + 3 * DAY,
      )).toHaveLength(1);
    });

    it('still finishes a sequence opened before the flip', () => {
      // Reminder 1 already went out. Stranding this customer halfway through
      // is worse than finishing what we started.
      const now = BEFORE + 8 * DAY;
      const out = floored(q({
        sentAtMs: BEFORE,
        acceptanceTokenCreatedAtMs: now - 1 * DAY,
        followUpCount: 1,
        lastFollowUpAtMs: now - MIN_GAP_MS,
      }), now);
      expect(out).toHaveLength(1);
      expect(out[0].followUpNumber).toBe(2);
    });

    it('chases the same old quote when no floor is passed', () => {
      // An account that opted in explicitly: its history was always in scope
      // and the floor must not retroactively kill chases already running.
      const old = q({ sentAtMs: BEFORE });
      expect(selectQuotesForFollowUp([old], BEFORE + 5 * DAY)).toHaveLength(1);
    });
  });

  describe('invoices, dated by their due date', () => {
    function i(over: Partial<FollowUpInvoice> = {}): FollowUpInvoice {
      return {
        id: 'i1',
        customerEmail: 'customer@somewhere.com',
        sendMethod: 'email',
        status: 'sent',
        sentAtMs: BEFORE,
        dueAtMs: AFTER,
        balanceDue: 1200,
        followUpCount: 0,
        ...over,
      };
    }
    const floored = (inv: FollowUpInvoice, now: number) =>
      selectInvoicesForFollowUp([inv], now, { openFromMs: DEFAULT_ON_FROM_MS });

    it('holds back an invoice that fell due before the flip', () => {
      expect(floored(i({ dueAtMs: BEFORE }), BEFORE + 5 * DAY)).toEqual([]);
    });

    it('chases an invoice that falls due after the flip', () => {
      expect(floored(i({ dueAtMs: AFTER }), AFTER + 5 * DAY)).toHaveLength(1);
    });

    it('chases an invoice raised long before the flip but only now falling due', () => {
      // A live debt, not back catalogue — which is exactly why invoices are
      // dated by the due date and not by the send.
      const out = floored(
        i({ sentAtMs: BEFORE - 60 * DAY, dueAtMs: AFTER }),
        AFTER + 5 * DAY,
      );
      expect(out).toHaveLength(1);
    });

    it('still finishes a sequence opened before the flip', () => {
      const now = BEFORE + 12 * DAY;
      const out = floored(i({
        dueAtMs: BEFORE,
        followUpCount: 1,
        lastFollowUpAtMs: now - INVOICE_MIN_GAP_MS,
      }), now);
      expect(out).toHaveLength(1);
      expect(out[0].followUpNumber).toBe(2);
    });

    it('chases the same old invoice when no floor is passed', () => {
      const old = i({ dueAtMs: BEFORE });
      expect(selectInvoicesForFollowUp([old], BEFORE + 5 * DAY)).toHaveLength(1);
    });
  });
});
