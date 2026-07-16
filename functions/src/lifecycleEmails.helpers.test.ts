import { describe, it, expect } from 'vitest';
import {
  lifecycleVerdict,
  midTrialRecap,
  ENDED_WINDOW_MS,
  ENDING_THRESHOLD_DAYS,
  SEND_ONCE_FIELD,
  RECAP_MIN_QUOTES,
  RECAP_MIN_DOLLARS,
  CROSS_CAMPAIGN_WINDOW_MS,
  lastConversionSendMs,
  sentConversionEmailWithin,
  suppressedByOnboardingDrip,
} from './lifecycleEmails.helpers';
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

describe('lifecycleVerdict — gating', () => {
  it('sends nothing for users who never started a trial', () => {
    expect(lifecycleVerdict(null, undefined, NOW).send).toBeNull();
    expect(lifecycleVerdict({ isPro: false }, undefined, NOW).send).toBeNull();
  });

  it('any Pro signal short-circuits every step: billed, bare isPro flag, admin_grant comp', () => {
    for (const daysAgo of [0.5, 3.5, 7.5, 12, 15]) {
      expect(
        lifecycleVerdict(trialSub(daysAgo, { isPro: true, productId: 'quotemate_pro_yearly' }), undefined, NOW).send
      ).toBeNull();
      expect(lifecycleVerdict(trialSub(daysAgo, { isPro: true }), undefined, NOW).send).toBeNull();
      expect(
        lifecycleVerdict(trialSub(daysAgo, { isPro: true, platform: 'admin_grant' }), undefined, NOW).send
      ).toBeNull();
    }
  });

  it('sends nothing in the gaps between windows', () => {
    expect(lifecycleVerdict(trialSub(2.5), undefined, NOW).send).toBeNull();
    expect(lifecycleVerdict(trialSub(5.5), undefined, NOW).send).toBeNull();
    expect(lifecycleVerdict(trialSub(6.5), undefined, NOW).send).toBeNull();
    expect(lifecycleVerdict(trialSub(9.5), undefined, NOW).send).toBeNull();
  });
});

describe('trial_start_value (day 0–1)', () => {
  it('fires inside the window, once', () => {
    expect(lifecycleVerdict(trialSub(0.5), undefined, NOW).send).toBe('trial_start_value');
    expect(lifecycleVerdict(trialSub(1.9), undefined, NOW).send).toBe('trial_start_value');
    const state = { trialStartValueEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(0.5), state, NOW).send).toBeNull();
  });

  it('never sends stale — a user first seen on day 2+ skips it', () => {
    expect(lifecycleVerdict(trialSub(2.1), undefined, NOW).send).toBeNull();
  });
});

describe('trial_square_pitch (day 3–4, Path B)', () => {
  it('fires inside the window when Square is NOT connected', () => {
    expect(lifecycleVerdict(trialSub(3.5), undefined, NOW).send).toBe('trial_square_pitch');
    expect(lifecycleVerdict(trialSub(4.9), undefined, NOW).send).toBe('trial_square_pitch');
  });

  it('skipped entirely for already-connected users', () => {
    expect(
      lifecycleVerdict(trialSub(3.5), undefined, NOW, { hasSquareConnection: true }).send
    ).toBeNull();
  });

  it('send-once and never stale', () => {
    const state = { trialSquarePitchEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(3.5), state, NOW).send).toBeNull();
    expect(lifecycleVerdict(trialSub(5.1), undefined, NOW).send).toBeNull();
  });
});

describe('trial_mid_value (day 7–8)', () => {
  it('fires inside the window with trialStartedAt for the personalisation read', () => {
    const v = lifecycleVerdict(trialSub(7.5), undefined, NOW);
    expect(v.send).toBe('trial_mid_value');
    expect(v.trialStartedAt).toBe(NOW - 7.5 * DAY);
  });

  it('send-once and never stale', () => {
    const state = { trialMidValueEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(7.5), state, NOW).send).toBeNull();
    expect(lifecycleVerdict(trialSub(9.1), undefined, NOW).send).toBeNull();
  });
});

describe('trial_ending (≤3 days remaining)', () => {
  it('fires at the threshold and inside it (deriveSubFields Math.ceil convention)', () => {
    // 10.5 days in → ceil(3.5) = 4 days remaining → not yet.
    expect(lifecycleVerdict(trialSub(10.5), undefined, NOW).send).toBeNull();
    // 11.5 days in → ceil(2.5) = 3 → fires.
    const v = lifecycleVerdict(trialSub(11.5), undefined, NOW);
    expect(v.send).toBe('trial_ending');
    expect(v.daysRemaining).toBeLessThanOrEqual(ENDING_THRESHOLD_DAYS);
  });

  it('still fires late in the trial and prefers ending over ended while trialing', () => {
    expect(lifecycleVerdict(trialSub(13.9), undefined, NOW).send).toBe('trial_ending');
  });

  it('send-once', () => {
    const state = { trialEndingEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(12.5), state, NOW).send).toBeNull();
  });

  it('takes priority over stale earlier steps for a user with no flags at all', () => {
    expect(lifecycleVerdict(trialSub(11.5), undefined, NOW).send).toBe('trial_ending');
  });
});

describe('trial_ended (T+0..3d)', () => {
  it('fires shortly after expiry, once', () => {
    expect(lifecycleVerdict(trialSub(15), undefined, NOW).send).toBe('trial_ended');
    const state = { trialEndedEmailAt: iso(NOW - DAY) };
    expect(lifecycleVerdict(trialSub(15), state, NOW).send).toBeNull();
  });

  it('never backfills trials that expired before the window', () => {
    const daysAgo = (TRIAL_MS + ENDED_WINDOW_MS) / DAY + 1;
    expect(lifecycleVerdict(trialSub(daysAgo), undefined, NOW).send).toBeNull();
  });
});

describe('same-day cross-campaign suppression', () => {
  const HOUR = 60 * 60 * 1000;

  it('window is 20h: catches the same-morning pair (1.5h), never the next-day one (22.5h)', () => {
    expect(CROSS_CAMPAIGN_WINDOW_MS).toBe(20 * HOUR);
    expect(CROSS_CAMPAIGN_WINDOW_MS).toBeGreaterThan(1.5 * HOUR);
    expect(CROSS_CAMPAIGN_WINDOW_MS).toBeLessThan(22.5 * HOUR);
  });

  it('suppressedByOnboardingDrip: true within the window, false at/after it or when absent', () => {
    expect(suppressedByOnboardingDrip({ lastOnboardingTipAt: NOW - 1.5 * HOUR }, NOW)).toBe(true);
    expect(suppressedByOnboardingDrip({ lastOnboardingTipAt: NOW - CROSS_CAMPAIGN_WINDOW_MS }, NOW)).toBe(false);
    expect(suppressedByOnboardingDrip({}, NOW)).toBe(false);
    expect(suppressedByOnboardingDrip(undefined, NOW)).toBe(false);
  });

  it('handles every timestamp shape emailState can carry', () => {
    const t = NOW - HOUR;
    expect(suppressedByOnboardingDrip({ lastOnboardingTipAt: iso(t) }, NOW)).toBe(true);
    expect(suppressedByOnboardingDrip({ lastOnboardingTipAt: { _seconds: t / 1000 } }, NOW)).toBe(true);
    expect(suppressedByOnboardingDrip({ lastOnboardingTipAt: { toMillis: () => t } }, NOW)).toBe(true);
  });

  it('lastConversionSendMs takes the max across lifecycle AND nudge flags, ignoring drip fields', () => {
    expect(lastConversionSendMs(undefined)).toBeNull();
    expect(lastConversionSendMs({ lastOnboardingTipAt: NOW })).toBeNull();
    expect(
      lastConversionSendMs({
        trialEndingEmailAt: NOW - 5 * HOUR,
        squareIdleNudgeEmailAt: NOW - 2 * HOUR,
        lastOnboardingTipAt: NOW, // other campaign — never counted
      })
    ).toBe(NOW - 2 * HOUR);
  });

  it('sentConversionEmailWithin drives the drip-side skip on any of the seven flags', () => {
    expect(sentConversionEmailWithin({ squareNoPaylinkNudgeEmailAt: iso(NOW - HOUR) }, NOW)).toBe(true);
    expect(sentConversionEmailWithin({ trialStartValueEmailAt: NOW - 21 * HOUR }, NOW)).toBe(false);
    expect(sentConversionEmailWithin({}, NOW)).toBe(false);
  });
});

describe('SEND_ONCE_FIELD', () => {
  it('maps every step to a distinct emailState field', () => {
    const fields = Object.values(SEND_ONCE_FIELD);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toHaveLength(5);
  });
});

describe('midTrialRecap', () => {
  const T0 = NOW - 7 * DAY;
  const doc = (over: Record<string, unknown> = {}) => ({
    createdAt: T0 + DAY,
    total: 1000,
    stage: 'draft',
    ...over,
  });

  it('counts only documents created since the trial started', () => {
    const recap = midTrialRecap(
      [doc(), doc({ createdAt: T0 - DAY, total: 99999 }), doc({ createdAt: undefined })],
      T0
    );
    expect(recap.quotesBuilt).toBe(1);
    expect(recap.dollarsQuoted).toBe(1000);
  });

  it('counts sent via the activating-doc rule (stage or sentAt fallback)', () => {
    const recap = midTrialRecap(
      [doc({ stage: 'quote_sent' }), doc({ stage: 'draft', sentAt: T0 + DAY }), doc()],
      T0
    );
    expect(recap.sent).toBe(2);
  });

  it('survives garbage totals', () => {
    const recap = midTrialRecap([doc({ total: 'not-a-number' }), doc({ total: null })], T0);
    expect(recap.dollarsQuoted).toBe(0);
  });

  it('rich only when the numbers would actually impress', () => {
    // 2 quotes, $2000 → rich.
    expect(midTrialRecap([doc(), doc()], T0).rich).toBe(true);
    // 1 quote, $10k → thin (below RECAP_MIN_QUOTES).
    expect(midTrialRecap([doc({ total: 10000 })], T0).rich).toBe(false);
    // 3 quotes, $300 total → thin (below RECAP_MIN_DOLLARS).
    const cheap = [doc({ total: 100 }), doc({ total: 100 }), doc({ total: 100 })];
    expect(midTrialRecap(cheap, T0).rich).toBe(false);
    expect(RECAP_MIN_QUOTES).toBe(2);
    expect(RECAP_MIN_DOLLARS).toBe(500);
  });

  it('empty docs → thin recap with zeros', () => {
    expect(midTrialRecap([], T0)).toEqual({ quotesBuilt: 0, dollarsQuoted: 0, sent: 0, rich: false });
  });
});
