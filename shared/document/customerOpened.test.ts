/**
 * "Customer opened the quote" is derived in ONE place for the push trigger,
 * the documents projection and the app. These pin the rules: a page load is
 * always an open, a pixel hit is an open unless it landed inside the
 * proxy-prefetch window, a proxy that gets the FIRST stamp does not poison
 * the quote (the last open is consulted), only opens of the latest send
 * count, and the source names which signal spoke.
 */
import { describe, expect, it } from 'vitest';

import {
  LIKELY_PREFETCH_MS,
  customerOpenProjection,
  customerOpenSource,
  customerOpenedAtMs,
  deriveCustomerOpen,
  isLikelyPrefetch,
} from './customerOpened';

const T = 1_760_000_000_000;
const SENT = T - 3_600_000;
const fs = (ms: number) => ({ toDate: () => new Date(ms) });

describe('deriveCustomerOpen — page view', () => {
  it('is null with no signals at all', () => {
    expect(deriveCustomerOpen({})).toBeNull();
    expect(deriveCustomerOpen(null)).toBeNull();
  });

  it('trusts an acceptance-page view outright, even a very early one', () => {
    expect(deriveCustomerOpen({ sentAt: SENT, firstViewedAt: SENT + 2000 })).toEqual({ at: SENT + 2000, source: 'link' });
    expect(deriveCustomerOpen({ lastViewedAt: T })).toEqual({ at: T, source: 'link' });
  });

  it('prefers the page view over the pixel when both exist', () => {
    expect(customerOpenedAtMs({ sentAt: SENT, firstViewedAt: T, emailFirstOpenedAt: SENT + 600_000, emailFirstOpenAfterMs: 600_000 })).toBe(T);
  });

  it('falls back to lastViewedAt when firstViewedAt belongs to an earlier send', () => {
    expect(deriveCustomerOpen({ sentAt: SENT, firstViewedAt: SENT - 86_400_000, lastViewedAt: SENT + 5000 }))
      .toEqual({ at: SENT + 5000, source: 'link' });
  });
});

describe('deriveCustomerOpen — email pixel', () => {
  it('counts a first open that arrived after the prefetch window', () => {
    expect(customerOpenedAtMs({ sentAt: SENT, emailFirstOpenedAt: SENT + LIKELY_PREFETCH_MS, emailFirstOpenAfterMs: LIKELY_PREFETCH_MS }))
      .toBe(SENT + LIKELY_PREFETCH_MS);
  });

  it('ignores a first open inside the prefetch window — a proxy, not a person', () => {
    expect(customerOpenedAtMs({ sentAt: SENT, emailFirstOpenedAt: SENT + 4000, emailFirstOpenAfterMs: 4000 })).toBeNull();
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 0 })).toBeNull();
  });

  it('judges the first open by its distance from the send even when the stored delay is missing', () => {
    expect(customerOpenedAtMs({ sentAt: SENT, emailFirstOpenedAt: SENT + 10_000 })).toBeNull();
    expect(customerOpenedAtMs({ sentAt: SENT, emailFirstOpenedAt: SENT + 90_000 })).toBe(SENT + 90_000);
  });

  it('counts an open whose delay is unknown and whose send time is unknown — nothing says it was a prefetch', () => {
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T })).toBe(T);
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 'soon' })).toBe(T);
  });

  it('a proxy that got the first stamp does not poison the quote: the human open three hours later counts', () => {
    const doc = { sentAt: SENT, emailFirstOpenedAt: SENT + 4000, emailFirstOpenAfterMs: 4000, emailLastOpenedAt: SENT + 3 * 3_600_000, emailOpenCount: 2 };
    expect(deriveCustomerOpen(doc)).toEqual({ at: SENT + 3 * 3_600_000, source: 'email' });
  });

  it('a second proxy hit still inside the window does not count either', () => {
    const doc = { sentAt: SENT, emailFirstOpenedAt: SENT + 4000, emailFirstOpenAfterMs: 4000, emailLastOpenedAt: SENT + 50_000 };
    expect(deriveCustomerOpen(doc)).toBeNull();
  });

  it('reports the FIRST trustworthy open, not the latest, when the first was genuine', () => {
    const doc = { sentAt: SENT, emailFirstOpenedAt: SENT + 120_000, emailFirstOpenAfterMs: 120_000, emailLastOpenedAt: T };
    expect(customerOpenedAtMs(doc)).toBe(SENT + 120_000);
  });
});

describe('deriveCustomerOpen — re-send', () => {
  it('opens that predate the latest send are stale and yield null', () => {
    const doc = { sentAt: T, emailFirstOpenedAt: T - 86_400_000, emailFirstOpenAfterMs: 500_000, emailLastOpenedAt: T - 3_600_000, firstViewedAt: T - 7_200_000 };
    expect(deriveCustomerOpen(doc)).toBeNull();
  });

  it('re-arms on a fresh open after the re-send, via the last-open stamp', () => {
    const doc = { sentAt: T, emailFirstOpenedAt: T - 86_400_000, emailFirstOpenAfterMs: 500_000, emailLastOpenedAt: T + 900_000 };
    expect(deriveCustomerOpen(doc)).toEqual({ at: T + 900_000, source: 'email' });
  });

  it('a proxy prefetch of the re-send is ignored too', () => {
    const doc = { sentAt: T, emailFirstOpenedAt: T - 86_400_000, emailFirstOpenAfterMs: 500_000, emailLastOpenedAt: T + 5000 };
    expect(deriveCustomerOpen(doc)).toBeNull();
  });
});

describe('customerOpenSource', () => {
  it('names the link when the page was loaded, the email when only the pixel spoke, null otherwise', () => {
    expect(customerOpenSource({ firstViewedAt: T, emailFirstOpenedAt: T - 1 })).toBe('link');
    expect(customerOpenSource({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 120_000 })).toBe('email');
    expect(customerOpenSource({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 20_000 })).toBeNull();
    expect(customerOpenSource({})).toBeNull();
  });
});

describe('customerOpenProjection', () => {
  it('projects the raw stamps as ms plus the derived answer', () => {
    expect(customerOpenProjection({
      sentAt: fs(SENT), emailFirstOpenedAt: fs(SENT + 120_000), emailLastOpenedAt: fs(T), emailOpenCount: 3, emailFirstOpenAfterMs: 120_000,
    })).toEqual({
      firstViewedAt: undefined, lastViewedAt: undefined, viewCount: undefined,
      emailFirstOpenedAt: SENT + 120_000, emailLastOpenedAt: T, emailOpenCount: 3, emailFirstOpenAfterMs: 120_000,
      customerOpenedAt: SENT + 120_000, customerOpenSource: 'email',
    });
  });

  it('writes explicit nulls for the derived pair once any raw stamp exists, so a merge can clear a stale value', () => {
    const p = customerOpenProjection({ sentAt: T, emailFirstOpenedAt: T - 86_400_000, emailFirstOpenAfterMs: 500_000 });
    expect(p.customerOpenedAt).toBeNull();
    expect(p.customerOpenSource).toBeNull();
  });

  it('leaves the derived pair undefined when there are no stamps at all', () => {
    const p = customerOpenProjection({ sentAt: T });
    expect('customerOpenedAt' in p && p.customerOpenedAt !== undefined).toBe(false);
    expect(p.customerOpenSource).toBeUndefined();
  });

  it('reads the Firestore timestamp shapes the legacy doc actually carries', () => {
    expect(customerOpenProjection({ firstViewedAt: { seconds: T / 1000, nanoseconds: 0 } }).customerOpenedAt).toBe(T);
  });
});

describe('isLikelyPrefetch', () => {
  it('is true strictly inside the window and false at or past it, or when unknown', () => {
    expect(isLikelyPrefetch(LIKELY_PREFETCH_MS - 1)).toBe(true);
    expect(isLikelyPrefetch(LIKELY_PREFETCH_MS)).toBe(false);
    expect(isLikelyPrefetch(undefined)).toBe(false);
    expect(isLikelyPrefetch(NaN)).toBe(false);
  });
});
