/**
 * 22 Sep 2026: 27 tradies finished a trial this month and kept using the
 * app; the expired banner was shown to none of them, and the selling card
 * reached 2. These pin the rules that change that.
 */
import { describe, it, expect } from 'vitest';
import {
  HAPPY_ON_FREE_MS,
  isHappyOnFree,
  nextCardSlotTaken,
  nudgeYieldsToCard,
  parseHappyOnFree,
  showDashboardTrialBanner,
  TRIAL_ASK_LAST_DAYS,
} from '../trialAsk';

const base = {
  hasTrial: true,
  isPro: false,
  returnNoticeVisible: false,
  happyOnFree: false,
  trialExpired: false,
  daysRemaining: 10,
  sellingCardShown: false,
};

describe('showDashboardTrialBanner', () => {
  it('shows the expired banner — the case that was unreachable', () => {
    expect(showDashboardTrialBanner({ ...base, trialExpired: true, daysRemaining: 0 })).toBe(true);
  });

  it('keeps showing it even while a selling card is up (there is none after expiry, but the rule must not hide it)', () => {
    expect(showDashboardTrialBanner({ ...base, trialExpired: true, daysRemaining: 0, sellingCardShown: true })).toBe(true);
  });

  it('stays quiet early in the trial — the deliberate no-countdown window', () => {
    expect(showDashboardTrialBanner({ ...base, daysRemaining: 10 })).toBe(false);
    expect(showDashboardTrialBanner({ ...base, daysRemaining: TRIAL_ASK_LAST_DAYS + 1 })).toBe(false);
  });

  it('shows the countdown in the last 3 days, unless the selling card already carries the ask', () => {
    expect(showDashboardTrialBanner({ ...base, daysRemaining: 3 })).toBe(true);
    expect(showDashboardTrialBanner({ ...base, daysRemaining: 1 })).toBe(true);
    expect(showDashboardTrialBanner({ ...base, daysRemaining: 2, sellingCardShown: true })).toBe(false);
  });

  it('never shows for Pro, before a trial, under the welcome-back card, or after "fine on Free"', () => {
    expect(showDashboardTrialBanner({ ...base, trialExpired: true, isPro: true })).toBe(false);
    expect(showDashboardTrialBanner({ ...base, trialExpired: true, hasTrial: false })).toBe(false);
    expect(showDashboardTrialBanner({ ...base, trialExpired: true, returnNoticeVisible: true })).toBe(false);
    expect(showDashboardTrialBanner({ ...base, trialExpired: true, happyOnFree: true })).toBe(false);
    expect(showDashboardTrialBanner({ ...base, daysRemaining: 1, happyOnFree: true })).toBe(false);
  });
});

describe('happy on Free', () => {
  it('is 30 days of quiet, read back off storage', () => {
    const now = 1_800_000_000_000;
    expect(isHappyOnFree(now + HAPPY_ON_FREE_MS, now)).toBe(true);
    expect(isHappyOnFree(now - 1, now)).toBe(false);
    expect(isHappyOnFree(null, now)).toBe(false);
    expect(parseHappyOnFree(String(now + 5))).toBe(now + 5);
    expect(parseHappyOnFree('garbage')).toBeNull();
    expect(parseHappyOnFree(null)).toBeNull();
    expect(HAPPY_ON_FREE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('the dashboard slot', () => {
  it('a selling card outranks the follow-up nudge', () => {
    expect(nextCardSlotTaken({ draftActive: false, nudgeAvailable: true, snoozesLoaded: true, sellingAllowed: true })).toBe(false);
  });

  it('a non-selling card still yields to the nudge', () => {
    expect(nextCardSlotTaken({ draftActive: false, nudgeAvailable: true, snoozesLoaded: true, sellingAllowed: false })).toBe(true);
    expect(nextCardSlotTaken({ draftActive: false, nudgeAvailable: false, snoozesLoaded: true, sellingAllowed: false })).toBe(false);
  });

  it('a draft owns the slot outright, and nothing renders before snoozes load', () => {
    expect(nextCardSlotTaken({ draftActive: true, nudgeAvailable: false, snoozesLoaded: true, sellingAllowed: true })).toBe(true);
    expect(nextCardSlotTaken({ draftActive: false, nudgeAvailable: false, snoozesLoaded: false, sellingAllowed: true })).toBe(true);
  });

  it('the nudge steps aside only for a card that is a Pro ask', () => {
    expect(nudgeYieldsToCard({ route: { screen: 'Paywall' } })).toBe(true);
    expect(nudgeYieldsToCard({ route: { screen: 'ViewJob' } })).toBe(false);
    expect(nudgeYieldsToCard(null)).toBe(false);
  });
});
