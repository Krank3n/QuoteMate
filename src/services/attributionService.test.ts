/**
 * @vitest-environment jsdom
 *
 * The website → account handoff. These cover the rules that make the join
 * trustworthy rather than merely present:
 *
 *  - browser storage is untrusted, so a hand-edited record must not land in
 *    Firestore;
 *  - first touch is written once and never overwritten by a later sign-in,
 *    token refresh or second campaign;
 *  - only a genuinely new account gets an origin, so a returning user is not
 *    retro-attributed to whatever they browsed today;
 *  - a failed write leaves the record in place for the next auth event;
 *  - the pre-existing paid `qm_attribution` contract behaves exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocMock = vi.fn(async () => ({ exists: () => false }));
const setDocMock = vi.fn(async () => undefined);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => segments.join('/')),
  getDoc: (...args: unknown[]) => getDocMock(...(args as [])),
  setDoc: (...args: unknown[]) => setDocMock(...(args as [])),
}));

import {
  captureAttributionFromUrl,
  persistAttributionIfNew,
  readAcquisitionContext,
} from './attributionService';
import { ACQUISITION_STORAGE_KEY, ATTRIBUTION_STORAGE_KEY } from '../utils/attribution';

const NOW = new Date('2026-09-07T02:00:00.000Z');
const JUST_CREATED = '2026-09-07T01:59:00.000Z';
const LONG_AGO = '2025-01-01T00:00:00.000Z';

const ORGANIC = {
  source: 'google',
  medium: 'organic',
  landingPage: '/articles/how-to-quote-concrete-driveway',
  referrerHost: 'www.google.com',
  landedAt: '2026-09-07T01:40:00.000Z',
};

function clearCookies() {
  for (const cookie of document.cookie.split('; ')) {
    const name = cookie.split('=')[0];
    if (name) document.cookie = `${name}=;path=/;max-age=0`;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sessionStorage.clear();
  localStorage.clear();
  clearCookies();
  getDocMock.mockReset();
  getDocMock.mockResolvedValue({ exists: () => false } as never);
  setDocMock.mockReset();
  setDocMock.mockResolvedValue(undefined as never);
});

function writtenDoc() {
  return setDocMock.mock.calls[0]?.[1] as Record<string, any>;
}

describe('readAcquisitionContext', () => {
  it('reads the same-tab session record', () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    expect(readAcquisitionContext()).toEqual(ORGANIC);
  });

  it('falls back to the same-origin cookie for a new-tab / noopener journey', () => {
    document.cookie = `${ACQUISITION_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(ORGANIC))};path=/`;
    expect(readAcquisitionContext()).toEqual(ORGANIC);
  });

  it('prefers the session record when both exist', () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    document.cookie = `${ACQUISITION_STORAGE_KEY}=${encodeURIComponent(
      JSON.stringify({ ...ORGANIC, landingPage: '/pricing' }),
    )};path=/`;
    expect(readAcquisitionContext()!.landingPage).toBe(ORGANIC.landingPage);
  });

  it('ignores a corrupt record in either store instead of throwing', () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, '{not json');
    expect(readAcquisitionContext()).toBeNull();
    document.cookie = `${ACQUISITION_STORAGE_KEY}=%7Bbroken;path=/`;
    expect(readAcquisitionContext()).toBeNull();
  });

  it('falls through to the cookie when a corrupt session record is present', () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, 'garbage');
    document.cookie = `${ACQUISITION_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(ORGANIC))};path=/`;
    expect(readAcquisitionContext()).toEqual(ORGANIC);
  });

  it('respects the owner opt-out and a declined cookie banner', () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    localStorage.setItem('qm_notrack', '1');
    expect(readAcquisitionContext()).toBeNull();
    localStorage.removeItem('qm_notrack');
    localStorage.setItem('qm_cookie_consent', 'declined');
    expect(readAcquisitionContext()).toBeNull();
  });
});

describe('persistAttributionIfNew — organic acquisition', () => {
  it('writes the first touch once for a genuinely new account', async () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock.mock.calls[0][0]).toBe('users/uid-1/profile/attribution');
    expect(writtenDoc().acquisition).toEqual({
      ...ORGANIC,
      channel: 'organic_search',
      recordedAt: NOW.toISOString(),
    });
    expect(writtenDoc().capturedOn).toBe('web');
    // Consumed: a second auth event must not re-evaluate or re-write it.
    expect(sessionStorage.getItem(ACQUISITION_STORAGE_KEY)).toBeNull();
  });

  it('never overwrites an existing first touch', async () => {
    getDocMock.mockResolvedValue({ exists: () => true } as never);
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ACQUISITION_STORAGE_KEY)).toBeNull();
  });

  it('is idempotent across repeated auth events for the same account', async () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT attribute a returning user who just signed in again', async () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-old', LONG_AGO);
    expect(setDocMock).not.toHaveBeenCalled();
    // The record is dropped rather than left to be picked up by whichever
    // account happens to sign in next in this browser.
    expect(sessionStorage.getItem(ACQUISITION_STORAGE_KEY)).toBeNull();
  });

  it('does NOT attribute when creation metadata is missing', async () => {
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1');
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('does NOT attribute a record that postdates account creation', async () => {
    sessionStorage.setItem(
      ACQUISITION_STORAGE_KEY,
      JSON.stringify({ ...ORGANIC, landedAt: '2026-09-07T01:59:59.000Z' }),
    );
    // Account created before that landing: this is a later visit, not a first touch.
    await persistAttributionIfNew('uid-1', '2026-09-07T01:50:00.000Z');
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('does NOT attribute a stale record from a tab left open for weeks', async () => {
    sessionStorage.setItem(
      ACQUISITION_STORAGE_KEY,
      JSON.stringify({ ...ORGANIC, landedAt: '2026-07-01T00:00:00.000Z' }),
    );
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('refuses a hand-edited record that names a private URL', async () => {
    sessionStorage.setItem(
      ACQUISITION_STORAGE_KEY,
      JSON.stringify({ ...ORGANIC, landingPage: '/admin/users' }),
    );
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('records an internal-referrer first touch as unknown, not organic', async () => {
    sessionStorage.setItem(
      ACQUISITION_STORAGE_KEY,
      JSON.stringify({ ...ORGANIC, source: '(unknown)', medium: '(not set)', referrerHost: '' }),
    );
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(writtenDoc().acquisition.channel).toBe('unknown');
  });

  it('writes nothing at all when there is no context of either kind', async () => {
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('does nothing while the visitor has opted out', async () => {
    localStorage.setItem('qm_notrack', '1');
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('persistAttributionIfNew — paid campaign contract', () => {
  const PAID = { utm_source: 'facebook', utm_content: 'qm-a1', landedAt: '2026-09-07T01:30:00.000Z', capturedOn: 'web' };

  it('writes campaign params at the top level exactly as before', async () => {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(PAID));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    const written = writtenDoc();
    expect(written.utm_source).toBe('facebook');
    expect(written.utm_content).toBe('qm-a1');
    expect(written.landedAt).toBe(PAID.landedAt);
    expect(written.capturedOn).toBe('web');
    expect(written.acquisition).toBeUndefined();
    expect(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  });

  it('still persists campaign params for a returning user, unchanged from before', async () => {
    // The new-account gate applies to the organic map only; touching the paid
    // path's behaviour would change a contract other reporting depends on.
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(PAID));
    await persistAttributionIfNew('uid-old', LONG_AGO);
    expect(writtenDoc().utm_source).toBe('facebook');
  });

  it('carries both kinds of context when a new account has both', async () => {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(PAID));
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    const written = writtenDoc();
    expect(written.utm_content).toBe('qm-a1');
    expect(written.acquisition.channel).toBe('organic_search');
    // The paid landedAt is the first touch of record; the organic one is kept
    // inside the map rather than overwriting it.
    expect(written.landedAt).toBe(PAID.landedAt);
  });

  it('never overwrites an existing campaign doc with a second campaign', async () => {
    getDocMock.mockResolvedValue({ exists: () => true } as never);
    sessionStorage.setItem(
      ATTRIBUTION_STORAGE_KEY,
      JSON.stringify({ ...PAID, utm_content: 'qm-b2-later' }),
    );
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('persistAttributionIfNew — retries and failures', () => {
  it('keeps the record for the next auth event when the read fails', async () => {
    getDocMock.mockRejectedValue(new Error('offline') as never);
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await expect(persistAttributionIfNew('uid-1', JUST_CREATED)).resolves.toBeUndefined();
    expect(sessionStorage.getItem(ACQUISITION_STORAGE_KEY)).not.toBeNull();
  });

  it('keeps the record for the next auth event when the write fails', async () => {
    setDocMock.mockRejectedValue(new Error('permission-denied') as never);
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await expect(persistAttributionIfNew('uid-1', JUST_CREATED)).resolves.toBeUndefined();
    expect(sessionStorage.getItem(ACQUISITION_STORAGE_KEY)).not.toBeNull();
  });

  it('succeeds on the retry after a transient failure', async () => {
    getDocMock.mockRejectedValueOnce(new Error('offline') as never);
    sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(ORGANIC));
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).not.toHaveBeenCalled();
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it('still works from the cookie when session storage is blocked', async () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage disabled');
      });
    try {
      document.cookie = `${ACQUISITION_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(ORGANIC))};path=/`;
      await persistAttributionIfNew('uid-1', JUST_CREATED);
      expect(writtenDoc().acquisition.channel).toBe('organic_search');
    } finally {
      getItem.mockRestore();
    }
  });

  it('clears the cookie copy too, so a new tab cannot replay it', async () => {
    document.cookie = `${ACQUISITION_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(ORGANIC))};path=/`;
    await persistAttributionIfNew('uid-1', JUST_CREATED);
    expect(document.cookie).not.toContain(ACQUISITION_STORAGE_KEY);
  });
});

describe('captureAttributionFromUrl', () => {
  it('leaves an existing first touch alone', () => {
    const first = { utm_source: 'facebook', landedAt: '2026-09-07T01:00:00.000Z', capturedOn: 'web' };
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(first));
    window.history.replaceState({}, '', '/app?utm_source=google&utm_content=later');
    captureAttributionFromUrl();
    expect(JSON.parse(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)!).utm_source).toBe('facebook');
  });

  it('does not create a record for an organic launch', () => {
    window.history.replaceState({}, '', '/app');
    captureAttributionFromUrl();
    expect(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  });
});
