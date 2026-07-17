import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS, TRIAL_MS } from '../utils/trialConfig';
import { NBA_ENDING_THRESHOLD_DAYS } from '../utils/nextBestAction';
import { ACTUAL_PRICE_AUD, REGULAR_PRICE_AUD } from './pricingConfig';

/**
 * Cross-package mirror guards. These constants are duplicated across the
 * RN/functions boundary (no shared module is possible), so each side pins the
 * agreed literal and drift fails CI on whichever side moved.
 *
 * Mirrors: functions/src/crossPackage.guard.test.ts — update BOTH together,
 * along with the store/Stripe products for prices.
 */

describe('trial length mirror (functions/src/subscription.helpers.ts TRIAL_DAYS)', () => {
  it('is 14 days', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe('trial-ending threshold mirror (functions/src/lifecycleEmails.helpers.ts ENDING_THRESHOLD_DAYS)', () => {
  it('is 3 days, so the in-app continuity_choice state flips the same day the trial_ending email fires', () => {
    expect(NBA_ENDING_THRESHOLD_DAYS).toBe(3);
  });
});

describe('price mirror (functions SUB_PRICE_AUD + live store/Stripe products)', () => {
  it('charged prices are $49/mo, $328/yr AUD', () => {
    expect(ACTUAL_PRICE_AUD).toEqual({ monthly: 49, yearly: 328 });
  });

  it('display-only anchor prices are $99/mo, $658/yr AUD (never charged)', () => {
    expect(REGULAR_PRICE_AUD).toEqual({ monthly: 99, yearly: 658 });
  });
});
