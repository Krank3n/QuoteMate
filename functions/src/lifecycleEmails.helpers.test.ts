import { describe, it, expect } from 'vitest';
import { lifecycleVerdict, ENDED_WINDOW_MS } from './lifecycleEmails.helpers';
import { TRIAL_MS } from './subscription.helpers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-16T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

// Client trial code stores trialStartedAt as an ISO string with isPro:false.
const trialSub = (startedDaysAgo: number, over: Record<string, unknown> = {}) => ({
  isPro: false,
  trialStartedAt: iso(NOW - startedDaysAgo * DAY),
  ...over,
});

describe('lifecycleVerdict', () => {
  it('sends nothing for users who never started a trial', () => {
    expect(lifecycleVerdict(null, undefined, NOW).send).toBeNull();
    expect(lifecycleVerdict({ isPro: false }, undefined, NOW).send).toBeNull();
  });

  it('sends nothing for converted (Pro) users, including comped admin grants', () => {
    expect(lifecycleVerdict(trialSub(13, { isPro: true }), undefined, NOW).send).toBeNull();
    expect(
      lifecycleVerdict({ isPro: true, platform: 'admin_grant' }, undefined, NOW).send
    ).toBeNull();
  });

  it('sends nothing mid-trial (more than 2 days remaining)', () => {
    expect(lifecycleVerdict(trialSub(5), undefined, NOW).send).toBeNull();
    expect(lifecycleVerdict(trialSub(11), undefined, NOW).send).toBeNull();
  });

  it('sends trial_ending when <= 2 days remain', () => {
    const v = lifecycleVerdict(trialSub(12.5), undefined, NOW);
    expect(v.send).toBe('trial_ending');
    expect(v.daysRemaining).toBeLessThanOrEqual(2);
  });

  it('sends trial_ending only once', () => {
    const state = { trialEndingEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(12.5), state, NOW).send).toBeNull();
  });

  it('sends trial_ended shortly after expiry', () => {
    const v = lifecycleVerdict(trialSub(15), undefined, NOW);
    expect(v.send).toBe('trial_ended');
  });

  it('sends trial_ended only once', () => {
    const state = { trialEndedEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(15), state, NOW).send).toBeNull();
  });

  it('never backfills trials that expired before the window', () => {
    const daysAgo = (TRIAL_MS + ENDED_WINDOW_MS) / DAY + 1;
    expect(lifecycleVerdict(trialSub(daysAgo), undefined, NOW).send).toBeNull();
  });

  it('prefers trial_ending over trial_ended at the boundary (still trialing)', () => {
    // 13.9 days in: still trialing with <1 day left.
    const v = lifecycleVerdict(trialSub(13.9), undefined, NOW);
    expect(v.send).toBe('trial_ending');
  });
});
