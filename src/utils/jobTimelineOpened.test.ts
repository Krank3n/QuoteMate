/**
 * "Quote opened" on the job timeline. The mirror reduces the acceptance-page
 * view and the email pixel to one `customerOpenedAt`; the timeline turns it
 * into a row between "Quote sent" and whatever came next, and the stage
 * chip reuses the same predicate. These pin when the row appears and what
 * it says.
 */
import { describe, it, expect } from 'vitest';

import { deriveTimelineEvents, quoteOpenedAfterSend } from './jobTimeline';

const HOUR = 60 * 60 * 1000;
const T = 1_760_000_000_000;

const job: any = { id: 'j1', stage: 'quoted', createdAt: T - 3 * HOUR, updatedAt: T, customerName: 'Jones', name: 'Deck' };

function quote(over: Record<string, any> = {}): any {
  return {
    id: 'q1',
    type: 'quote',
    stage: 'quote_sent',
    number: 'QU-001',
    customerName: 'Jones',
    total: 4200,
    createdAt: T - 2 * HOUR,
    updatedAt: T,
    sentAt: T - HOUR,
    payments: [],
    paidTotal: 0,
    balanceDue: 4200,
    ...over,
  };
}

const kinds = (docs: any[]) => deriveTimelineEvents(job, docs, T).map((e) => e.kind);

describe('quote_opened timeline event', () => {
  it('appears after the send with the customer and the channel', () => {
    const events = deriveTimelineEvents(job, [quote({ customerOpenedAt: T - HOUR / 2, customerOpenSource: 'email' })], T);
    const opened = events.find((e) => e.kind === 'quote_opened');
    expect(opened).toMatchObject({ id: 'q1:quote_opened', title: 'Quote opened', detail: 'by Jones · via email', at: T - HOUR / 2 });
    const sent = events.find((e) => e.kind === 'quote_sent');
    expect(sent).toBeDefined();
    expect(opened!.at).toBeGreaterThan(sent!.at);
  });

  it('names the link when the acceptance page was loaded', () => {
    const events = deriveTimelineEvents(job, [quote({ customerOpenedAt: T - 10, customerOpenSource: 'link', customerName: '' })], T);
    expect(events.find((e) => e.kind === 'quote_opened')?.detail).toBe('via the link');
  });

  it('is absent when nothing was opened', () => {
    expect(kinds([quote()])).not.toContain('quote_opened');
  });

  it('is absent when the open predates the send — a stale stamp from an earlier send', () => {
    expect(kinds([quote({ customerOpenedAt: T - 2 * HOUR, sentAt: T - HOUR })])).not.toContain('quote_opened');
  });

  it('judges staleness against the LATEST send, since the mirror sentAt is first-send only', () => {
    // Sent at T-2h, opened at T-90m, re-sent at T-1h: nothing has been opened since the re-send.
    expect(kinds([quote({ sentAt: T - 2 * HOUR, customerOpenedAt: T - 1.5 * HOUR, lastSentAt: T - HOUR })])).not.toContain('quote_opened');
    // …and an open after the re-send shows again.
    expect(kinds([quote({ sentAt: T - 2 * HOUR, customerOpenedAt: T - HOUR / 2, lastSentAt: T - HOUR })])).toContain('quote_opened');
  });

  it('is absent for an unsent draft and for an invoice', () => {
    expect(kinds([quote({ stage: 'draft', sentAt: undefined, customerOpenedAt: T })])).not.toContain('quote_opened');
    expect(kinds([quote({ type: 'invoice', stage: 'invoice_sent', customerOpenedAt: T })])).not.toContain('quote_opened');
  });
});

describe('quoteOpenedAfterSend', () => {
  it('returns the open instant only for a sent quote opened at or after the send', () => {
    expect(quoteOpenedAfterSend({ type: 'quote', sentAt: T, customerOpenedAt: T })).toBe(T);
    expect(quoteOpenedAfterSend({ type: 'quote', sentAt: T, customerOpenedAt: T - 1 })).toBeNull();
    expect(quoteOpenedAfterSend({ type: 'quote', sentAt: undefined, customerOpenedAt: T })).toBeNull();
    expect(quoteOpenedAfterSend({ type: 'invoice', sentAt: T, customerOpenedAt: T })).toBeNull();
  });
});
