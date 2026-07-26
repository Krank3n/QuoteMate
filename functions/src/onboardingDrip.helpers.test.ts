import { describe, it, expect } from 'vitest';
import { onboardingTipDue } from './onboardingDrip.helpers';

describe('onboardingTipDue — consolidated 3-send ladder', () => {
  it('fresh user: voice tip on day 1, nothing on day 0', () => {
    expect(onboardingTipDue(0, 0)).toBe(0);
    expect(onboardingTipDue(1, 0)).toBe(1);
    expect(onboardingTipDue(3, 1)).toBe(0);
  });

  it('send-it tip fires from day 4, personal note from day 14', () => {
    expect(onboardingTipDue(4, 1)).toBe(4);
    expect(onboardingTipDue(13, 4)).toBe(0);
    expect(onboardingTipDue(14, 4)).toBe(5);
  });

  it('retired tips 2 and 3 are never selected at any day/state combination', () => {
    for (let day = 0; day <= 20; day++) {
      for (let last = 0; last <= 5; last++) {
        expect([0, 1, 4, 5]).toContain(onboardingTipDue(day, last));
      }
    }
  });

  it('legacy mid-drip states (lastTip 2 or 3) advance straight to the send-it tip', () => {
    expect(onboardingTipDue(6, 2)).toBe(4);
    expect(onboardingTipDue(10, 3)).toBe(4);
  });

  it('late first-seen users skip straight to the highest due tip, never stale ones', () => {
    expect(onboardingTipDue(9, 0)).toBe(4);
    expect(onboardingTipDue(20, 0)).toBe(5);
  });

  it('completed drip sends nothing', () => {
    expect(onboardingTipDue(30, 5)).toBe(0);
  });
});
