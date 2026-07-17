import { describe, expect, it } from 'vitest';
import { SUB_PRICE_AUD, TRIAL_DAYS, TRIAL_MS } from './subscription.helpers';
import { ENDING_THRESHOLD_DAYS } from './lifecycleEmails.helpers';

/**
 * Cross-package mirror guards. TRIAL_DAYS and the charged prices are
 * duplicated across the functions/RN boundary (no shared module is possible),
 * so each side pins the agreed literal and drift fails CI on whichever side
 * moved.
 *
 * Mirrors: src/config/crossPackageMirrors.guard.test.ts (app side) — update
 * BOTH together, along with the live store/Stripe products for prices.
 */

describe('trial length mirror (src/utils/trialConfig.ts TRIAL_DAYS)', () => {
  it('is 14 days', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe('price mirror (app ACTUAL_PRICE_AUD + live store/Stripe products)', () => {
  it('charged prices are $49/mo, $328/yr AUD', () => {
    expect(SUB_PRICE_AUD).toEqual({ monthly: 49, yearly: 328 });
  });
});

describe('trial-ending threshold mirror (app src/utils/nextBestAction.ts NBA_ENDING_THRESHOLD_DAYS)', () => {
  it('is 3 days — the in-app continuity_choice state mirrors when trial_ending fires', () => {
    expect(ENDING_THRESHOLD_DAYS).toBe(3);
  });
});
