/**
 * Follow-up nudge picker.
 *
 * Grounded in the Jul 2026 send-behaviour audit: all paid conversions came
 * from users who sent a quote to a real customer (3/14); users who only
 * self-sent, test-sent, or never sent converted at 0%. The nudge exists to
 * push each doc across whichever gap it's stuck in, one banner at a time.
 */
import { describe, it, expect } from 'vitest';

import {
  pickFollowUpNudge,
  pruneSnoozes,
  toMs,
  QUOTE_FOLLOW_UP_MIN_DAYS,
  SELF_SEND_MIN_MS,
  UNSENT_QUOTE_MIN_MS,
} from './followUpNudge';
import type { Quote, Invoice } from '../types';

const NOW = new Date('2026-07-16T09:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const OWN = ['tradie@example.com'];

function quote(overrides: Partial<Quote>): Quote {
  return {
    id: 'q1',
    status: 'sent',
    customerEmail: 'customer@somewhere.com',
    sentAt: NOW - 5 * DAY,
    updatedAt: new Date(NOW - 5 * DAY).toISOString(),
    jobId: 'job-1',
    ...overrides,
  } as Quote;
}

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 'inv1',
    status: 'sent',
    dueDate: new Date(NOW - 2 * DAY),
    jobId: 'job-inv',
    ...overrides,
  } as Invoice;
}

function pick(args: {
  quotes?: Quote[];
  invoices?: Invoice[];
  ownEmails?: string[];
  snoozed?: Record<string, number>;
}) {
  return pickFollowUpNudge({
    quotes: args.quotes ?? [],
    invoices: args.invoices ?? [],
    ownEmails: args.ownEmails ?? OWN,
    snoozed: args.snoozed,
    now: NOW,
  });
}

describe('pickFollowUpNudge — priority order', () => {
  it('an overdue invoice beats every quote nudge', () => {
    const n = pick({
      invoices: [invoice({})],
      quotes: [
        quote({ id: 'self', customerEmail: 'tradie@example.com' }),
        quote({ id: 'aging' }),
        quote({ id: 'unsent', status: 'draft', draftStep: 'JobPreview' }),
      ],
    });
    expect(n?.type).toBe('invoice_overdue');
    expect(n?.docId).toBe('inv1');
  });

  it('a self-sent quote beats unsent and follow-up nudges', () => {
    const n = pick({
      quotes: [
        quote({ id: 'aging' }),
        quote({ id: 'self', customerEmail: 'Tradie@Example.com ' }), // case/space-insensitive
        quote({ id: 'unsent', status: 'draft', draftStep: 'JobPreview' }),
      ],
    });
    expect(n?.type).toBe('self_sent_quote');
    expect(n?.docId).toBe('self');
  });

  it('an unsent finished draft beats the follow-up nudge', () => {
    const n = pick({
      quotes: [
        quote({ id: 'aging' }),
        quote({ id: 'unsent', status: 'draft', draftStep: 'JobPreview' }),
      ],
    });
    expect(n?.type).toBe('unsent_quote');
    expect(n?.docId).toBe('unsent');
  });

  it('falls through to the oldest aging sent quote', () => {
    const n = pick({
      quotes: [
        quote({ id: 'newer', sentAt: NOW - 5 * DAY }),
        quote({ id: 'oldest', sentAt: NOW - 9 * DAY }),
      ],
    });
    expect(n?.type).toBe('quote_follow_up');
    expect(n?.docId).toBe('oldest');
    expect(n?.days).toBe(9);
  });

  it('returns null when nothing qualifies', () => {
    expect(pick({ quotes: [quote({ sentAt: NOW - DAY })] })).toBeNull();
  });
});

describe('invoice_overdue', () => {
  it('ignores paid, cancelled, draft, and not-yet-due invoices', () => {
    expect(pick({ invoices: [invoice({ status: 'paid' })] })).toBeNull();
    expect(pick({ invoices: [invoice({ status: 'cancelled' })] })).toBeNull();
    expect(pick({ invoices: [invoice({ status: 'draft' })] })).toBeNull();
    expect(pick({ invoices: [invoice({ dueDate: new Date(NOW + DAY) })] })).toBeNull();
  });

  it('picks the most-overdue invoice and reports days past due', () => {
    const n = pick({
      invoices: [
        invoice({ id: 'a', dueDate: new Date(NOW - 3 * DAY) }),
        invoice({ id: 'b', dueDate: new Date(NOW - 10 * DAY), status: 'partial' }),
      ],
    });
    expect(n?.docId).toBe('b');
    expect(n?.days).toBe(10);
  });
});

describe('self_sent_quote', () => {
  it('matches the business email as well as the account email', () => {
    const n = pick({
      quotes: [quote({ customerEmail: 'biz@business.com' })],
      ownEmails: ['tradie@example.com', 'biz@business.com'],
    });
    expect(n?.type).toBe('self_sent_quote');
  });

  it('gives a fresh self-send a day of grace', () => {
    const n = pick({
      quotes: [
        quote({ customerEmail: 'tradie@example.com', sentAt: NOW - SELF_SEND_MIN_MS + 60_000 }),
      ],
    });
    expect(n).toBeNull();
  });

  it('never classifies as self-sent when own emails are unknown', () => {
    const n = pick({
      quotes: [quote({ customerEmail: 'tradie@example.com', sentAt: NOW - 10 * DAY })],
      ownEmails: [],
    });
    expect(n?.type).toBe('quote_follow_up');
  });
});

describe('unsent_quote', () => {
  it('only fires for drafts parked at the preview step', () => {
    expect(
      pick({ quotes: [quote({ status: 'draft', draftStep: 'MaterialsList' })] }),
    ).toBeNull();
  });

  it('gives a fresh finished draft a day of grace', () => {
    const n = pick({
      quotes: [
        quote({
          status: 'draft',
          draftStep: 'JobPreview',
          updatedAt: new Date(NOW - UNSENT_QUOTE_MIN_MS + 60_000).toISOString(),
        }),
      ],
    });
    expect(n).toBeNull();
  });

  it('flags when a test send already went to the tradie', () => {
    const n = pick({
      quotes: [
        quote({
          status: 'draft',
          draftStep: 'JobPreview',
          acceptanceTokenCreatedAt: new Date(NOW - 2 * DAY),
        }),
      ],
    });
    expect(n?.type).toBe('unsent_quote');
    expect(n?.testSent).toBe(true);
  });

  it('prefers the newest finished draft (the one they still remember)', () => {
    const n = pick({
      quotes: [
        quote({ id: 'old', status: 'draft', draftStep: 'JobPreview', updatedAt: new Date(NOW - 20 * DAY).toISOString() }),
        quote({ id: 'recent', status: 'draft', draftStep: 'JobPreview', updatedAt: new Date(NOW - 2 * DAY).toISOString() }),
      ],
    });
    expect(n?.docId).toBe('recent');
  });
});

describe('quote_follow_up', () => {
  // The admin funnel moved this threshold from 4 days to 2: acceptances land
  // in a median of 20 hours, so a quote still silent at 48 hours is the one
  // worth chasing. These pin the two-day boundary from both sides.
  it('pins the threshold at 2 days', () => {
    expect(QUOTE_FOLLOW_UP_MIN_DAYS).toBe(2);
  });

  it('a quote sent 2 days ago fires the follow-up', () => {
    const n = pick({ quotes: [quote({ sentAt: NOW - 2 * DAY })] });
    expect(n?.type).toBe('quote_follow_up');
    expect(n?.days).toBe(2);
  });

  it('a quote sent 1 day ago does not fire yet', () => {
    expect(pick({ quotes: [quote({ sentAt: NOW - 1 * DAY })] })).toBeNull();
  });

  it(`waits ${QUOTE_FOLLOW_UP_MIN_DAYS} days before suggesting a follow-up`, () => {
    const n = pick({
      quotes: [quote({ sentAt: NOW - (QUOTE_FOLLOW_UP_MIN_DAYS - 1) * DAY })],
    });
    expect(n).toBeNull();
  });

  it('never nudges a quote the customer has already responded to', () => {
    // A responded quote leaves 'sent' (accepted/declined), so the status
    // filter drops it — no follow-up for a quote that's already answered.
    expect(pick({ quotes: [quote({ status: 'accepted', sentAt: NOW - 8 * DAY })] })).toBeNull();
    expect(pick({ quotes: [quote({ status: 'declined', sentAt: NOW - 8 * DAY })] })).toBeNull();
  });

  it('reports days since send so the copy can say how long it has been', () => {
    // Drives the banner subtitle "Sent N days ago, no reply yet".
    expect(pick({ quotes: [quote({ sentAt: NOW - 3 * DAY })] })?.days).toBe(3);
  });

  it('skips sent quotes with no sentAt audit stamp (legacy docs)', () => {
    expect(pick({ quotes: [quote({ sentAt: undefined })] })).toBeNull();
  });
});

describe('timestamp shapes (regression: silent nudge death)', () => {
  // The send cloud function writes sentAt as a Firestore serverTimestamp.
  // Before deserialization normalized it, a `typeof sentAt === 'number'`
  // check filtered out every cloud-sent quote — the self-send and
  // follow-up nudges never fired for real sends. These pin every shape
  // the storage layers produce.
  it('fires for a Firestore-Timestamp-shaped sentAt (live listener echo)', () => {
    const n = pick({
      quotes: [quote({ sentAt: { toMillis: () => NOW - 8 * DAY } as any })],
    });
    expect(n?.type).toBe('quote_follow_up');
    expect(n?.days).toBe(8);
  });

  it('fires for a JSON-round-tripped Timestamp ({seconds}) from the persisted store', () => {
    const n = pick({
      quotes: [
        quote({
          customerEmail: 'tradie@example.com',
          sentAt: { seconds: (NOW - 3 * DAY) / 1000, nanoseconds: 0 } as any,
        }),
      ],
    });
    expect(n?.type).toBe('self_sent_quote');
  });

  it('fires for Date and ISO-string dueDate/updatedAt shapes', () => {
    expect(
      pick({ invoices: [invoice({ dueDate: new Date(NOW - 2 * DAY).toISOString() as any })] })?.type,
    ).toBe('invoice_overdue');
    expect(
      pick({
        quotes: [
          quote({ status: 'draft', draftStep: 'JobPreview', updatedAt: new Date(NOW - 2 * DAY) as any }),
        ],
      })?.type,
    ).toBe('unsent_quote');
  });

  it('toMs rejects unusable shapes instead of nudging on garbage', () => {
    expect(toMs(undefined)).toBeNull();
    expect(toMs(null)).toBeNull();
    expect(toMs('not a date')).toBeNull();
    expect(toMs(NaN)).toBeNull();
    expect(toMs(new Date('invalid'))).toBeNull();
    expect(toMs({})).toBeNull();
  });
});

describe('snoozing', () => {
  it('a snoozed nudge yields to the next-priority item', () => {
    const n = pick({
      quotes: [
        quote({ id: 'self', customerEmail: 'tradie@example.com' }),
        quote({ id: 'aging', sentAt: NOW - 8 * DAY }),
      ],
      snoozed: { 'self_sent_quote:self': NOW + DAY },
    });
    expect(n?.type).toBe('quote_follow_up');
    expect(n?.docId).toBe('aging');
  });

  it('a snoozed follow-up stays hidden while the snooze is live', () => {
    const n = pick({
      quotes: [quote({ id: 'aging', sentAt: NOW - 3 * DAY })],
      snoozed: { 'quote_follow_up:aging': NOW + DAY },
    });
    expect(n).toBeNull();
  });

  it('an expired snooze no longer hides the nudge', () => {
    const n = pick({
      quotes: [quote({ id: 'self', customerEmail: 'tradie@example.com' })],
      snoozed: { 'self_sent_quote:self': NOW - 1 },
    });
    expect(n?.type).toBe('self_sent_quote');
  });

  it('pruneSnoozes drops expired entries and keeps live ones', () => {
    expect(
      pruneSnoozes({ live: NOW + DAY, dead: NOW - 1, junk: 'x' as any }, NOW),
    ).toEqual({ live: NOW + DAY });
  });
});
