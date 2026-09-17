import { describe, expect, it } from 'vitest';
import { returnTrialNoticeCopy, returnTrialNoticeVisible } from './returnTrialNotice';
import { RETURN_TRIAL_DAYS } from './trialConfig';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-17T09:00:00.000Z');

const granted = {
  isPro: false,
  trialStartedAt: new Date(NOW - 60 * DAY_MS),
  trialEndsAt: new Date(NOW + RETURN_TRIAL_DAYS * DAY_MS),
  returnTrialGrantedAt: new Date(NOW),
  returnTrialDays: RETURN_TRIAL_DAYS,
};

describe('returnTrialNoticeVisible', () => {
  it('shows while the return trial runs and the card has not been closed', () => {
    expect(returnTrialNoticeVisible(granted, NOW + 1)).toBe(true);
    expect(returnTrialNoticeVisible(granted, NOW + 6 * DAY_MS)).toBe(true);
  });

  it('hides once dismissed, once the window ends, for Pro, and for an ordinary trial', () => {
    expect(returnTrialNoticeVisible({ ...granted, returnTrialNoticeSeenAt: new Date(NOW) }, NOW + 1)).toBe(false);
    expect(returnTrialNoticeVisible(granted, NOW + RETURN_TRIAL_DAYS * DAY_MS)).toBe(false);
    expect(returnTrialNoticeVisible({ ...granted, isPro: true }, NOW + 1)).toBe(false);
    expect(returnTrialNoticeVisible({ isPro: false, trialStartedAt: new Date(NOW - DAY_MS) }, NOW)).toBe(false);
    expect(returnTrialNoticeVisible(null, NOW)).toBe(false);
    expect(returnTrialNoticeVisible(undefined, NOW)).toBe(false);
  });
});

describe('returnTrialNoticeCopy', () => {
  it('states the days left and that this is the last one', () => {
    const copy = returnTrialNoticeCopy(granted, NOW + 1);
    expect(copy.title).toBe("Welcome back — Pro's on again");
    expect(copy.body).toContain(`${RETURN_TRIAL_DAYS} days of full Pro`);
    expect(copy.body).toContain('last free run');
    expect(copy.cta).toBe('Quote a job');
  });

  it('counts down as the window runs, with a singular last day', () => {
    expect(returnTrialNoticeCopy(granted, NOW + 4 * DAY_MS).body).toContain('3 days of full Pro');
    expect(returnTrialNoticeCopy(granted, NOW + 6 * DAY_MS + 1).body).toContain('1 day of full Pro');
  });

  it('never says "AI", and stays gender-neutral', () => {
    const copy = returnTrialNoticeCopy(granted, NOW);
    const all = `${copy.title} ${copy.body} ${copy.cta}`;
    expect(all).not.toMatch(/\bAI\b/);
    expect(all).not.toMatch(/\b(blokes?|guys|folks|fancy)\b/i);
  });
});
