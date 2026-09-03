import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppOpenProps,
  PUSH_GRACE_MS,
  createAppOpenTracker,
  pushTapKey,
  pushTypeOf,
} from './appOpenTracker';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-03T08:00:00.000Z');

function make(over: { previous?: number | null; loadFails?: boolean; saveFails?: boolean } = {}) {
  let clock = T0;
  const track = vi.fn<(props: AppOpenProps) => void>();
  const saved: number[] = [];
  const tracker = createAppOpenTracker({
    track,
    now: () => clock,
    loadLastOpenedAt: over.loadFails
      ? () => Promise.reject(new Error('storage down'))
      : () => Promise.resolve(over.previous ?? null),
    saveLastOpenedAt: over.saveFails
      ? () => Promise.reject(new Error('storage down'))
      : (ms) => {
          saved.push(ms);
          return Promise.resolve();
        },
  });
  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  const settle = () => vi.advanceTimersByTimeAsync(0);
  return { tracker, track, saved, advance, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAppOpenTracker', () => {
  it('a cold open flushes after the grace window, with no gap the first time a device opens', async () => {
    const { tracker, track, saved, advance } = make();
    tracker.noteOpen('cold');
    expect(track).not.toHaveBeenCalled();

    await advance(PUSH_GRACE_MS);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({ source: 'cold', hours_since_last_open: null });
    expect(saved).toEqual([T0]);
  });

  it('a push tap inside the window claims the open: one event, source push, typed', async () => {
    const { tracker, track, advance, settle } = make();
    tracker.noteOpen('cold');
    await advance(50);
    tracker.notePushTap('quote_viewed', 'default:abc');
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      source: 'push',
      push_type: 'quote_viewed',
      hours_since_last_open: null,
    });

    // The claimed open must not ALSO fire as cold when its timer would have run.
    await advance(PUSH_GRACE_MS);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('a tap with nothing pending is attributed as already_active, not as an open', async () => {
    const { tracker, track, settle } = make();
    tracker.notePushTap('invoice_paid');
    await settle();

    expect(track).toHaveBeenCalledWith({
      source: 'push',
      push_type: 'invoice_paid',
      hours_since_last_open: null,
      already_active: true,
    });
  });

  it('measures the gap against the stored previous open, to one decimal hour', async () => {
    const { tracker, track, advance } = make({ previous: T0 - 26.04 * HOUR });
    tracker.noteOpen('cold');
    await advance(PUSH_GRACE_MS);

    expect(track).toHaveBeenCalledWith({ source: 'cold', hours_since_last_open: 26 });
  });

  it('the same tap reported by the listener and the launch lookup counts once', async () => {
    const { tracker, track, advance, settle } = make();
    tracker.noteOpen('cold');
    tracker.notePushTap('quote_accepted', 'default:same');
    tracker.notePushTap('quote_accepted', 'default:same');
    await settle();
    await advance(PUSH_GRACE_MS);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0].source).toBe('push');
  });

  it('a cold open is counted once per process, however often sign-in re-runs', async () => {
    const { tracker, track, advance } = make();
    tracker.noteOpen('cold');
    await advance(PUSH_GRACE_MS);
    tracker.noteOpen('cold');
    await advance(PUSH_GRACE_MS);

    expect(track).toHaveBeenCalledTimes(1);
  });

  it('background → active is a foreground open; inactive → active is not', async () => {
    const { tracker, track, advance } = make();
    tracker.handleAppStateChange('inactive');
    tracker.handleAppStateChange('active');
    await advance(PUSH_GRACE_MS);
    expect(track).not.toHaveBeenCalled();

    tracker.handleAppStateChange('background');
    tracker.handleAppStateChange('active');
    await advance(PUSH_GRACE_MS);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0].source).toBe('foreground');

    // Active again without a background in between is the same sitting.
    tracker.handleAppStateChange('active');
    await advance(PUSH_GRACE_MS);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('later opens in the same process measure against the one before, not the stale store', async () => {
    const { tracker, track, saved, advance } = make({ previous: T0 - 48 * HOUR });
    tracker.noteOpen('cold');
    await advance(PUSH_GRACE_MS);

    await advance(3 * HOUR);
    tracker.handleAppStateChange('background');
    tracker.handleAppStateChange('active');
    await advance(PUSH_GRACE_MS);

    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.calls[0][0].hours_since_last_open).toBe(48);
    expect(track.mock.calls[1][0].hours_since_last_open).toBe(3);
    // The second open sits one grace window past the first, then three hours on.
    expect(saved).toEqual([T0, T0 + PUSH_GRACE_MS + 3 * HOUR]);
  });

  it('a push tap that resumes the app from the background is a push open with the real gap', async () => {
    const { tracker, track, advance, settle } = make({ previous: T0 - 20 * HOUR });
    tracker.handleAppStateChange('background');
    tracker.handleAppStateChange('active');
    tracker.notePushTap('quote_viewed');
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      source: 'push',
      push_type: 'quote_viewed',
      hours_since_last_open: 20,
    });
    await advance(PUSH_GRACE_MS);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('a blank or missing push type is left off rather than sent as an empty string', async () => {
    const { tracker, track, settle } = make();
    tracker.notePushTap('   ');
    tracker.notePushTap(undefined);
    await settle();

    expect(track).toHaveBeenCalledTimes(2);
    for (const [props] of track.mock.calls) {
      expect('push_type' in props).toBe(false);
    }
  });

  it('storage failures never block the event', async () => {
    const failingLoad = make({ loadFails: true });
    failingLoad.tracker.noteOpen('cold');
    await failingLoad.advance(PUSH_GRACE_MS);
    expect(failingLoad.track).toHaveBeenCalledWith({ source: 'cold', hours_since_last_open: null });

    const failingSave = make({ saveFails: true, previous: T0 - HOUR });
    failingSave.tracker.noteOpen('cold');
    await failingSave.advance(PUSH_GRACE_MS);
    expect(failingSave.track).toHaveBeenCalledWith({ source: 'cold', hours_since_last_open: 1 });
  });

  it('a previous open in the future (clock skew) reads as no gap, not a negative one', async () => {
    const { tracker, track, advance } = make({ previous: T0 + HOUR });
    tracker.noteOpen('cold');
    await advance(PUSH_GRACE_MS);
    expect(track).toHaveBeenCalledWith({ source: 'cold', hours_since_last_open: null });
  });
});

describe('pushTapKey / pushTypeOf', () => {
  const response = {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: { request: { identifier: 'req-1', content: { data: { type: 'quote_viewed', jobId: 'j1' } } } },
  };

  it('keys a response by action + request id and reads the push type off its data', () => {
    expect(pushTapKey(response)).toBe('expo.modules.notifications.actions.DEFAULT:req-1');
    expect(pushTypeOf(response)).toBe('quote_viewed');
  });

  it('is undefined for shapes it cannot key, so those taps still count (once each)', () => {
    expect(pushTapKey(null)).toBeUndefined();
    expect(pushTapKey({ notification: { request: {} } })).toBeUndefined();
    expect(pushTypeOf(undefined)).toBeUndefined();
  });
});
