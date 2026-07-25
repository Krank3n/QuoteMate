/**
 * Regression tests for the sendReEngagement eligibility split.
 *
 * The job used to hand permanently-unsendable addresses (Apple private relay,
 * test domains) straight to sendEmail every day: the 21-day cooldown stamp is
 * only written on a successful send, so those users never cooled down and each
 * daily run added another 'blocked' emailLog row (~870/month of pure noise).
 */
import { describe, it, expect } from 'vitest';
import {
  isUnreachableEmail,
  reEngagementVerdict,
  REENGAGE_INACTIVE_DAYS,
  REENGAGE_COOLDOWN_DAYS,
  REENGAGE_MAX_TOUCHES,
} from './reEngagement.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-14T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe('isUnreachableEmail', () => {
  it('flags Apple private relay addresses', () => {
    expect(isUnreachableEmail('x9zk2@privaterelay.appleid.com')).toBe(true);
  });

  it('flags test domains and missing emails', () => {
    expect(isUnreachableEmail('someone@example.com')).toBe(true);
    expect(isUnreachableEmail(null)).toBe(true);
    expect(isUnreachableEmail('')).toBe(true);
  });

  it('passes normal addresses', () => {
    expect(isUnreachableEmail('tradie@gmail.com')).toBe(false);
  });
});

describe('reEngagementVerdict', () => {
  const inactive = { lastActivityAt: daysAgo(REENGAGE_INACTIVE_DAYS + 3), lastReEngagementAt: null };

  it('never retries an unreachable address (the daily blocked-row regression)', () => {
    expect(
      reEngagementVerdict({ email: 'abc123@privaterelay.appleid.com', ...inactive }, NOW),
    ).toEqual({ send: false, reason: 'unreachable' });
  });

  it('skips users with no recorded activity', () => {
    expect(
      reEngagementVerdict({ email: 'tradie@gmail.com', lastActivityAt: null, lastReEngagementAt: null }, NOW),
    ).toEqual({ send: false, reason: 'no-activity' });
  });

  it('skips users active within the inactivity window', () => {
    expect(
      reEngagementVerdict(
        { email: 'tradie@gmail.com', lastActivityAt: daysAgo(REENGAGE_INACTIVE_DAYS - 1), lastReEngagementAt: null },
        NOW,
      ),
    ).toEqual({ send: false, reason: 'recently-active' });
  });

  it('respects the cooldown after a recent re-engagement send', () => {
    expect(
      reEngagementVerdict(
        {
          email: 'tradie@gmail.com',
          lastActivityAt: daysAgo(30),
          lastReEngagementAt: daysAgo(REENGAGE_COOLDOWN_DAYS - 1),
        },
        NOW,
      ),
    ).toEqual({ send: false, reason: 'cooldown' });
  });

  it('sends once the cooldown has elapsed', () => {
    expect(
      reEngagementVerdict(
        {
          email: 'tradie@gmail.com',
          lastActivityAt: daysAgo(40),
          lastReEngagementAt: daysAgo(REENGAGE_COOLDOWN_DAYS + 1),
        },
        NOW,
      ),
    ).toEqual({ send: true });
  });

  it('sends to an inactive user who has never been re-engaged', () => {
    expect(reEngagementVerdict({ email: 'tradie@gmail.com', ...inactive }, NOW)).toEqual({ send: true });
  });
});

describe('lifetime touch cap', () => {
  const inactive40d = { email: 'tradie@gmail.com', lastActivityAt: daysAgo(40), lastReEngagementAt: null };

  it('stops at the cap even when every other gate passes', () => {
    expect(reEngagementVerdict({ ...inactive40d, touchCount: REENGAGE_MAX_TOUCHES }, NOW)).toEqual({
      send: false,
      reason: 'max-touches',
    });
    expect(reEngagementVerdict({ ...inactive40d, touchCount: REENGAGE_MAX_TOUCHES + 5 }, NOW)).toEqual({
      send: false,
      reason: 'max-touches',
    });
  });

  it('sends below the cap', () => {
    expect(reEngagementVerdict({ ...inactive40d, touchCount: REENGAGE_MAX_TOUCHES - 1 }, NOW)).toEqual({
      send: true,
    });
  });

  it('missing count (pre-backfill state doc) behaves as zero', () => {
    expect(reEngagementVerdict(inactive40d, NOW)).toEqual({ send: true });
  });

  it('cap is 3 — past it the identical email is only spam-complaint risk', () => {
    expect(REENGAGE_MAX_TOUCHES).toBe(3);
  });
});
