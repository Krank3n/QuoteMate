// End-to-end regression for the Mate mint-storm fix: drives the AppState
// policy INTO the grace controller with fake timers — the exact wiring the
// screen uses — and asserts the session outcome. This is the test that fails
// against the pre-fix code (where 'background' stopped the session instantly,
// which the auto-start handler then re-opened, minting a token per cycle).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppStateStatus } from 'react-native';
import { voiceActionForAppState, VOICE_BACKGROUND_GRACE_MS, VOICE_INACTIVE_GRACE_MS } from '../voiceAppStatePolicy';
import { createGraceController } from '../voiceGraceController';

// A tiny harness mirroring AssistantScreen's AppState listener: a session
// that a grace-expiry stops, with the policy deciding each transition.
function makeHarness(initialHasSession = true) {
  let hasSession = initialHasSession;
  let stops = 0;
  const grace = createGraceController(() => {
    stops += 1;
    hasSession = false; // grace expiry tears the session down
  });
  const send = (nextState: AppStateStatus) => {
    const action = voiceActionForAppState({
      nextState,
      hasVoiceSession: hasSession,
      graceRunning: grace.isRunning(),
    });
    switch (action) {
      case 'stop':
        grace.clear();
        stops += 1;
        hasSession = false;
        break;
      case 'start-grace-short':
        grace.start(VOICE_BACKGROUND_GRACE_MS);
        break;
      case 'start-grace-long':
        grace.start(VOICE_INACTIVE_GRACE_MS);
        break;
      case 'cancel-grace':
        grace.clear();
        break;
      case 'ignore':
        break;
    }
  };
  return {
    send,
    graceRunning: () => grace.isRunning(),
    stops: () => stops,
    hasSession: () => hasSession,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Mate voice AppState behaviour (mint-storm regression)', () => {
  it('absorbs the Android audio-start bounce: background→active within the grace does NOT stop', () => {
    const h = makeHarness();
    h.send('background');
    expect(h.graceRunning()).toBe(true);
    // The bounce returns to active well within the 1.5s grace (~400ms live).
    vi.advanceTimersByTime(400);
    h.send('active');
    vi.advanceTimersByTime(5000); // let any stale timer fire if it could
    expect(h.stops()).toBe(0); // session survived → never re-opened → no re-mint
    expect(h.hasSession()).toBe(true);
    expect(h.graceRunning()).toBe(false);
  });

  it('stops a genuine background once the short grace elapses (mic released)', () => {
    const h = makeHarness();
    h.send('background');
    vi.advanceTimersByTime(VOICE_BACKGROUND_GRACE_MS - 1);
    expect(h.stops()).toBe(0); // not yet
    vi.advanceTimersByTime(1);
    expect(h.stops()).toBe(1);
    expect(h.hasSession()).toBe(false);
  });

  it('iOS foreground→inactive→background replaces the long grace with the short one', () => {
    const h = makeHarness();
    h.send('inactive'); // long 15s grace
    expect(h.graceRunning()).toBe(true);
    h.send('background'); // must override with the short grace
    // If the long grace still governed, no stop until 15s. Assert it stops at ~1.5s.
    vi.advanceTimersByTime(VOICE_BACKGROUND_GRACE_MS);
    expect(h.stops()).toBe(1);
  });

  it('iOS Control Center peek: inactive→active cancels the long grace, session survives', () => {
    const h = makeHarness();
    h.send('inactive');
    vi.advanceTimersByTime(3000); // overlay up for 3s
    h.send('active');
    vi.advanceTimersByTime(VOICE_INACTIVE_GRACE_MS);
    expect(h.stops()).toBe(0);
    expect(h.hasSession()).toBe(true);
  });

  it('a repeated inactive does not restart the running grace', () => {
    const h = makeHarness();
    h.send('inactive');
    vi.advanceTimersByTime(VOICE_INACTIVE_GRACE_MS - 100);
    h.send('inactive'); // must be ignored, not reset to a fresh 15s
    vi.advanceTimersByTime(100);
    expect(h.stops()).toBe(1); // fired on the ORIGINAL schedule
  });

  it('background with no session stops immediately (nothing to debounce)', () => {
    const h = makeHarness(false);
    h.send('background');
    expect(h.graceRunning()).toBe(false);
    // stop on a dead session is a harmless idempotent call; count it as handled.
    expect(h.stops()).toBe(1);
  });
});
