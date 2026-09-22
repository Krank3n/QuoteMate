/**
 * "Customer opened the quote" is derived in ONE place for the push trigger,
 * the documents projection and the app. These pin the rules: a page load is
 * always an open, a pixel hit is an open unless it landed inside the
 * proxy-prefetch window, and the source names which one spoke.
 */
import { describe, expect, it } from 'vitest';

import {
  LIKELY_PREFETCH_MS,
  customerOpenSource,
  customerOpenedAtMs,
  isLikelyPrefetch,
} from './customerOpened';

const T = 1_760_000_000_000;

describe('customerOpenedAtMs', () => {
  it('is null with no signals at all', () => {
    expect(customerOpenedAtMs({})).toBeNull();
    expect(customerOpenedAtMs(null)).toBeNull();
  });

  it('trusts an acceptance-page view outright, even a very early one', () => {
    expect(customerOpenedAtMs({ firstViewedAt: T })).toBe(T);
    expect(customerOpenedAtMs({ lastViewedAt: T + 5 })).toBe(T + 5);
  });

  it('prefers the page view over the pixel when both exist', () => {
    expect(customerOpenedAtMs({ firstViewedAt: T + 1000, emailFirstOpenedAt: T })).toBe(T + 1000);
  });

  it('counts an email open that arrived after the prefetch window', () => {
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: LIKELY_PREFETCH_MS })).toBe(T);
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 5 * 60_000 })).toBe(T);
  });

  it('ignores an email open inside the prefetch window — a proxy, not a person', () => {
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: LIKELY_PREFETCH_MS - 1 })).toBeNull();
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 0 })).toBeNull();
  });

  it('counts an email open whose delay is unknown — nothing says it was a prefetch', () => {
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T })).toBe(T);
    expect(customerOpenedAtMs({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 'soon' })).toBe(T);
  });

  it('reads the Firestore timestamp shapes the legacy doc actually carries', () => {
    expect(customerOpenedAtMs({ emailFirstOpenedAt: { toDate: () => new Date(T) }, emailFirstOpenAfterMs: 90_000 })).toBe(T);
    expect(customerOpenedAtMs({ firstViewedAt: { seconds: T / 1000, nanoseconds: 0 } })).toBe(T);
  });
});

describe('customerOpenSource', () => {
  it('names the link when the page was loaded', () => {
    expect(customerOpenSource({ firstViewedAt: T, emailFirstOpenedAt: T - 1 })).toBe('link');
  });

  it('names the email when only the pixel fired past the window', () => {
    expect(customerOpenSource({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 120_000 })).toBe('email');
  });

  it('is null for a prefetch-only pixel hit and for no signals', () => {
    expect(customerOpenSource({ emailFirstOpenedAt: T, emailFirstOpenAfterMs: 20_000 })).toBeNull();
    expect(customerOpenSource({})).toBeNull();
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
