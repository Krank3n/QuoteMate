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
  type FollowUpQuote,
  FIRST_FOLLOW_UP_MS,
  MIN_GAP_MS,
  SECOND_FOLLOW_UP_MS,
  TOKEN_EXPIRATION_MS,
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
  it('returns one selection per due quote and leaves the rest alone', () => {
    const out = selectQuotesForFollowUp(
      [
        quote({ id: 'first', sentAtMs: NOW - 3 * DAY, acceptanceTokenCreatedAtMs: NOW - 3 * DAY }),
        quote({ id: 'second', sentAtMs: NOW - 8 * DAY, followUpCount: 1, acceptanceTokenCreatedAtMs: NOW - 6 * DAY }),
        quote({ id: 'too-fresh', sentAtMs: NOW - 1 * DAY }),
        quote({ id: 'answered', respondedAtMs: NOW - 1 * HOUR }),
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
