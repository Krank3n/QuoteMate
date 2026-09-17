import { describe, expect, it } from 'vitest';
import {
  RETURN_TRIAL_DAYS,
  TRIAL_DAYS,
  TRIAL_MS,
  isTrialWindowExpired,
  trialDaysRemaining,
  trialEndMs,
  trialWindow,
} from './trialConfig';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-17T09:00:00.000Z');
const d = (ms: number) => new Date(ms);

describe('trialConfig window maths', () => {
  it('a normal trial ends TRIAL_DAYS after it started', () => {
    const started = d(NOW - 2 * DAY_MS);
    expect(trialEndMs({ trialStartedAt: started })).toBe(started.getTime() + TRIAL_MS);
    expect(trialDaysRemaining({ trialStartedAt: started }, NOW)).toBe(TRIAL_DAYS - 2);
    expect(isTrialWindowExpired({ trialStartedAt: started }, NOW)).toBe(false);
    expect(trialWindow({ trialStartedAt: started })).toEqual({
      startMs: started.getTime(),
      endMs: started.getTime() + TRIAL_MS,
      isReturnTrial: false,
    });
  });

  it('no trial started → no window, no days, not expired', () => {
    expect(trialEndMs({})).toBeNull();
    expect(trialEndMs(null)).toBeNull();
    expect(trialWindow({ trialStartedAt: undefined })).toBeNull();
    expect(trialDaysRemaining({}, NOW)).toBeNull();
    expect(isTrialWindowExpired({}, NOW)).toBe(false);
    // An explicit end with no start is not a trial that ever started.
    expect(trialEndMs({ trialEndsAt: d(NOW + DAY_MS) })).toBeNull();
  });

  it('a server-granted return trial re-opens a lapsed window from the grant, for its own length', () => {
    const firstStart = d(NOW - 60 * DAY_MS);
    const lapsed = { trialStartedAt: firstStart };
    expect(isTrialWindowExpired(lapsed, NOW)).toBe(true);
    expect(trialDaysRemaining(lapsed, NOW)).toBe(0);

    const granted = {
      trialStartedAt: firstStart,
      trialEndsAt: d(NOW + RETURN_TRIAL_DAYS * DAY_MS),
      returnTrialGrantedAt: d(NOW),
    };
    expect(isTrialWindowExpired(granted, NOW + 1)).toBe(false);
    expect(trialDaysRemaining(granted, NOW + 1)).toBe(RETURN_TRIAL_DAYS);
    expect(trialDaysRemaining(granted, NOW + 5 * DAY_MS)).toBe(RETURN_TRIAL_DAYS - 5);
    expect(trialWindow(granted)).toEqual({
      startMs: NOW,
      endMs: NOW + RETURN_TRIAL_DAYS * DAY_MS,
      isReturnTrial: true,
    });
    // …and it lapses again at its own end, with no third window.
    expect(isTrialWindowExpired(granted, NOW + RETURN_TRIAL_DAYS * DAY_MS)).toBe(true);
    expect(trialWindow(granted)?.isReturnTrial).toBe(true);
  });

  it('accepts ISO strings and ms numbers, and treats garbage as no trial', () => {
    const iso = new Date(NOW - DAY_MS).toISOString();
    expect(trialEndMs({ trialStartedAt: iso })).toBe(NOW - DAY_MS + TRIAL_MS);
    expect(trialEndMs({ trialStartedAt: NOW - DAY_MS })).toBe(NOW - DAY_MS + TRIAL_MS);
    expect(trialEndMs({ trialStartedAt: 'not a date' })).toBeNull();
    // A broken explicit end falls back to the default window, not to "expired".
    expect(trialEndMs({ trialStartedAt: iso, trialEndsAt: 'nope' })).toBe(NOW - DAY_MS + TRIAL_MS);
  });
});
