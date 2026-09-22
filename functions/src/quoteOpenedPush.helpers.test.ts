/**
 * The "Quote opened 👀" push decision, pinned per signal. The trigger in
 * index.ts is a thin wrapper around decideQuoteOpenedPush, so every branch
 * that decides whether a tradie's phone buzzes lives here.
 */
import { describe, expect, it } from 'vitest';

import { LIKELY_PREFETCH_MS } from './shared/document/customerOpened';
import {
  QUOTE_OPENED_PUSH_COOLDOWN_MS,
  decideQuoteOpenedPush,
  emailOpenBecameKnown,
  pageViewMoved,
} from './quoteOpenedPush.helpers';

const NOW = 1_760_000_000_000;
const ts = (ms: number) => ({ toDate: () => new Date(ms) });

describe('decideQuoteOpenedPush — email open', () => {
  it('pushes on the first trustworthy email open', () => {
    const before = { status: 'sent' };
    const after = { status: 'sent', emailFirstOpenedAt: ts(NOW - 1000), emailFirstOpenAfterMs: 5 * 60_000 };
    expect(decideQuoteOpenedPush(before, after, NOW)).toEqual({ push: true, signal: 'email' });
  });

  it('never pushes on a repeat email open — the count moved, the first stamp did not', () => {
    const before = { status: 'sent', emailFirstOpenedAt: ts(NOW - 3600_000), emailFirstOpenAfterMs: 90_000, emailOpenCount: 1 };
    const after = { ...before, emailOpenCount: 2, emailLastOpenedAt: ts(NOW) };
    expect(decideQuoteOpenedPush(before, after, NOW)).toEqual({ push: false, reason: 'repeat-open' });
  });

  it('never pushes on an open inside the proxy-prefetch window', () => {
    const before = { status: 'sent' };
    const after = { status: 'sent', emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: LIKELY_PREFETCH_MS - 1 };
    expect(decideQuoteOpenedPush(before, after, NOW)).toEqual({ push: false, reason: 'no-open' });
  });

  it('pushes on an open with an unknown delay — nothing says it was a prefetch', () => {
    expect(decideQuoteOpenedPush({ status: 'sent' }, { status: 'sent', emailFirstOpenedAt: ts(NOW) }, NOW))
      .toEqual({ push: true, signal: 'email' });
  });

  it('stays quiet once the quote is settled', () => {
    for (const status of ['accepted', 'rejected', 'completed']) {
      const after = { status, emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 120_000 };
      expect(decideQuoteOpenedPush({ status }, after, NOW)).toEqual({ push: false, reason: 'settled' });
    }
  });

  it('respects the 24 h cooldown shared with the page-view push', () => {
    const after = { status: 'sent', emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 120_000, viewNotifiedAt: ts(NOW - QUOTE_OPENED_PUSH_COOLDOWN_MS + 1) };
    expect(decideQuoteOpenedPush({ status: 'sent' }, after, NOW)).toEqual({ push: false, reason: 'cooldown' });
    const later = { ...after, viewNotifiedAt: ts(NOW - QUOTE_OPENED_PUSH_COOLDOWN_MS) };
    expect(decideQuoteOpenedPush({ status: 'sent' }, later, NOW)).toEqual({ push: true, signal: 'email' });
  });

  it('does not treat an email open as new when a page view was already known', () => {
    const before = { status: 'sent', lastViewedAt: ts(NOW - 60_000) };
    const after = { ...before, emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 120_000 };
    expect(decideQuoteOpenedPush(before, after, NOW)).toEqual({ push: false, reason: 'repeat-open' });
  });
});

describe('decideQuoteOpenedPush — acceptance page (unchanged behaviour)', () => {
  it('pushes each time lastViewedAt moves', () => {
    const before = { status: 'sent', lastViewedAt: ts(NOW - 2 * 3600_000) };
    const after = { status: 'sent', lastViewedAt: ts(NOW) };
    expect(decideQuoteOpenedPush(before, after, NOW)).toEqual({ push: true, signal: 'link' });
  });

  it('ignores an update where lastViewedAt did not change', () => {
    const doc = { status: 'sent', lastViewedAt: ts(NOW), customerName: 'Jones' };
    expect(decideQuoteOpenedPush(doc, { ...doc, customerName: 'Jones B' }, NOW)).toEqual({ push: false, reason: 'repeat-open' });
  });

  it('ignores updates with no open signal at all', () => {
    expect(decideQuoteOpenedPush({ status: 'draft' }, { status: 'sent' }, NOW)).toEqual({ push: false, reason: 'no-open' });
  });

  it('still honours the cooldown and settled guards for page views', () => {
    const before = { status: 'sent' };
    expect(decideQuoteOpenedPush(before, { status: 'sent', lastViewedAt: ts(NOW), viewNotifiedAt: ts(NOW - 1000) }, NOW))
      .toEqual({ push: false, reason: 'cooldown' });
    expect(decideQuoteOpenedPush(before, { status: 'accepted', lastViewedAt: ts(NOW) }, NOW))
      .toEqual({ push: false, reason: 'settled' });
  });
});

describe('signal detectors', () => {
  it('pageViewMoved compares the instant, across timestamp shapes', () => {
    expect(pageViewMoved({ lastViewedAt: ts(NOW) }, { lastViewedAt: { seconds: NOW / 1000 } })).toBe(false);
    expect(pageViewMoved({}, { lastViewedAt: ts(NOW) })).toBe(true);
    expect(pageViewMoved({ lastViewedAt: ts(NOW) }, {})).toBe(false);
  });

  it('emailOpenBecameKnown is a rising edge on the derived open, not on the raw stamp', () => {
    expect(emailOpenBecameKnown({}, { emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 20_000 })).toBe(false);
    expect(emailOpenBecameKnown({}, { emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 200_000 })).toBe(true);
    expect(emailOpenBecameKnown({ emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 200_000 }, { emailFirstOpenedAt: ts(NOW), emailFirstOpenAfterMs: 200_000 })).toBe(false);
  });
});
