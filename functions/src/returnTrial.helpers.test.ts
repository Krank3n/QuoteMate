import { describe, it, expect } from 'vitest';
import {
  isRecentlyActive,
  planReturnPing,
  returnClockPriorMs,
  returnTrialVerdict,
  RETURN_TRIAL_DAYS,
  RETURN_TRIAL_INACTIVE_DAYS,
} from './returnTrial.helpers';
import { deriveSubFields, resolveServerPlan, TRIAL_DAYS } from './subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-17T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

// Trial started 60 days ago (ended 46 days ago); last seen 45 days ago.
const lapsed = {
  isPro: false,
  quotesThisMonth: 3,
  trialStartedAt: iso(NOW - 60 * DAY_MS),
  trialExpired: true,
};
const AWAY_45D = NOW - 45 * DAY_MS;

describe('returnTrialVerdict — who earns the one return trial', () => {
  it('grants a lapsed trial that has been away 30+ days, for RETURN_TRIAL_DAYS from now', () => {
    const v = returnTrialVerdict({ sub: lapsed, priorActivityMs: AWAY_45D, nowMs: NOW });
    expect(v.grant).toBe(true);
    if (!v.grant) return;
    expect(v.inactiveDays).toBe(45);
    expect(v.payload).toMatchObject({
      trialEndsAt: iso(NOW + RETURN_TRIAL_DAYS * DAY_MS),
      trialExpired: false,
      returnTrialGrantedAt: iso(NOW),
      returnTrialDays: RETURN_TRIAL_DAYS,
      returnTrialPriorTrialEndsAt: iso(NOW - 60 * DAY_MS + TRIAL_DAYS * DAY_MS),
      returnTrialPriorActivityAt: iso(AWAY_45D),
    });
    // The original clock is history and must survive the flip.
    expect(v.payload).not.toHaveProperty('trialStartedAt');
  });

  it('the granted payload reads as an active trial to every server reader', () => {
    const v = returnTrialVerdict({ sub: lapsed, priorActivityMs: AWAY_45D, nowMs: NOW });
    if (!v.grant) throw new Error('expected grant');
    const after = { ...lapsed, ...v.payload };
    expect(resolveServerPlan(after, NOW + 1)).toBe('trial');
    expect(resolveServerPlan(after, NOW + RETURN_TRIAL_DAYS * DAY_MS)).toBe('free');
    const f = deriveSubFields(after, NOW + 2 * DAY_MS);
    expect(f.tier).toBe('trialing');
    expect(f.trialDaysRemaining).toBe(RETURN_TRIAL_DAYS - 2);
    expect(f.trialEndsAt).toBe(NOW + RETURN_TRIAL_DAYS * DAY_MS);
    expect(f.trialStartedAt).toBe(NOW - 60 * DAY_MS);
    expect(f.returnTrialGrantedAt).toBe(NOW);
  });

  it('is exactly one per account: a granted doc is never granted again, even after it lapses', () => {
    const v = returnTrialVerdict({ sub: lapsed, priorActivityMs: AWAY_45D, nowMs: NOW });
    if (!v.grant) throw new Error('expected grant');
    const after = { ...lapsed, ...v.payload };
    const later = NOW + 120 * DAY_MS;
    expect(returnTrialVerdict({ sub: after, priorActivityMs: NOW, nowMs: later })).toEqual({
      grant: false,
      reason: 'already-granted',
    });
  });

  it('needs the full RETURN_TRIAL_INACTIVE_DAYS away — a day short is recently-active', () => {
    const shortBy1 = NOW - (RETURN_TRIAL_INACTIVE_DAYS - 1) * DAY_MS;
    expect(returnTrialVerdict({ sub: lapsed, priorActivityMs: shortBy1, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'recently-active',
    });
    const exactly = NOW - RETURN_TRIAL_INACTIVE_DAYS * DAY_MS;
    expect(returnTrialVerdict({ sub: lapsed, priorActivityMs: exactly, nowMs: NOW }).grant).toBe(true);
  });

  it('floors "last active" at the trial start when the account carries no activity stamp', () => {
    const recentTrial = { ...lapsed, trialStartedAt: iso(NOW - 20 * DAY_MS) }; // ended 6 days ago
    expect(returnTrialVerdict({ sub: recentTrial, priorActivityMs: null, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'recently-active',
    });
    // No stamp but the trial itself started 45 days ago → away 45 days.
    const v = returnTrialVerdict({ sub: { ...lapsed, trialStartedAt: iso(AWAY_45D) }, priorActivityMs: null, nowMs: NOW });
    expect(v.grant).toBe(true);
  });

  it('a stale activity stamp older than the trial start does not shorten the floor', () => {
    const v = returnTrialVerdict({ sub: lapsed, priorActivityMs: NOW - 400 * DAY_MS, nowMs: NOW });
    expect(v.grant && v.inactiveDays).toBe(60);
  });

  it('never re-opens a trial that is still running', () => {
    const active = { ...lapsed, trialStartedAt: iso(NOW - 3 * DAY_MS) };
    expect(returnTrialVerdict({ sub: active, priorActivityMs: AWAY_45D, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'trial-active',
    });
  });

  it('skips Pro, anyone with a real billing record, and accounts that never trialed', () => {
    expect(returnTrialVerdict({ sub: { ...lapsed, isPro: true }, priorActivityMs: AWAY_45D, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'pro',
    });
    // Cancelled Stripe subscriber — knows the product, could farm free weeks.
    expect(
      returnTrialVerdict({
        sub: { ...lapsed, platform: 'web', subscriptionId: 'sub_1', customerId: 'cus_1' },
        priorActivityMs: AWAY_45D,
        nowMs: NOW,
      }),
    ).toEqual({ grant: false, reason: 'paid-before' });
    expect(
      returnTrialVerdict({ sub: { ...lapsed, productId: 'quotemate_pro_monthly' }, priorActivityMs: AWAY_45D, nowMs: NOW }),
    ).toEqual({ grant: false, reason: 'paid-before' });
    // A sandbox receipt never paid anything.
    expect(
      returnTrialVerdict({
        sub: { ...lapsed, productId: 'quotemate_pro_monthly', environment: 'Sandbox' },
        priorActivityMs: AWAY_45D,
        nowMs: NOW,
      }).grant,
    ).toBe(true);
    expect(returnTrialVerdict({ sub: { isPro: false }, priorActivityMs: AWAY_45D, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'no-trial',
    });
    expect(returnTrialVerdict({ sub: undefined, priorActivityMs: null, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'no-trial',
    });
  });

  it('reads Firestore Timestamp-shaped fields as well as ISO strings', () => {
    const tsShaped = { ...lapsed, trialStartedAt: { toMillis: () => NOW - 60 * DAY_MS } };
    expect(returnTrialVerdict({ sub: tsShaped, priorActivityMs: AWAY_45D, nowMs: NOW }).grant).toBe(true);
  });
});

describe('planReturnPing — the return clock survives an unsupported bundle', () => {
  const emailStateAway = { lastActivityAt: iso(AWAY_45D) };

  it('grants when the bundle supports it, and advances the clock to now', () => {
    const plan = planReturnPing({ emailState: emailStateAway, sub: lapsed, consider: true, nowMs: NOW });
    expect(plan.result).toEqual({ granted: true, days: RETURN_TRIAL_DAYS });
    expect(plan.returnTrialClockAt).toBe(iso(NOW));
    expect(plan.subPatch).toMatchObject({ returnTrialGrantedAt: iso(NOW) });
  });

  it('a qualified account pinging from an old bundle is NOT granted and keeps its clock at the prior stamp', () => {
    // Launch 1 after a 45-day absence runs the pre-OTA bundle.
    const launch1 = planReturnPing({ emailState: emailStateAway, sub: lapsed, consider: false, nowMs: NOW });
    expect(launch1.result).toEqual({ granted: false, days: RETURN_TRIAL_DAYS, reason: 'client-unsupported' });
    expect(launch1.subPatch).toBeNull();
    expect(launch1.returnTrialClockAt).toBe(iso(AWAY_45D));

    // Launch 2, an hour later on the new bundle, measures the same absence —
    // even though lastActivityAt was stamped by launch 1.
    const emailStateAfterLaunch1 = { lastActivityAt: iso(NOW), returnTrialClockAt: launch1.returnTrialClockAt };
    const launch2 = planReturnPing({
      emailState: emailStateAfterLaunch1,
      sub: lapsed,
      consider: true,
      nowMs: NOW + 60 * 60 * 1000,
    });
    expect(launch2.result.granted).toBe(true);
    expect(launch2.subPatch).toMatchObject({ returnTrialPriorActivityAt: iso(AWAY_45D) });
  });

  it('an unqualified ping advances the clock to now whatever the bundle', () => {
    const recent = { lastActivityAt: iso(NOW - 2 * DAY_MS) };
    for (const consider of [true, false]) {
      const plan = planReturnPing({ emailState: recent, sub: lapsed, consider, nowMs: NOW });
      expect(plan.result).toEqual({ granted: false, days: RETURN_TRIAL_DAYS, reason: 'recently-active' });
      expect(plan.returnTrialClockAt).toBe(iso(NOW));
      expect(plan.subPatch).toBeNull();
    }
    const pro = planReturnPing({ emailState: emailStateAway, sub: { ...lapsed, isPro: true }, consider: true, nowMs: NOW });
    expect(pro.result.reason).toBe('pro');
    expect(pro.returnTrialClockAt).toBe(iso(NOW));
  });

  it('the clock, once written, beats lastActivityAt (which the quote/invoice triggers also stamp)', () => {
    // A deep-linked invoice edit stamped lastActivityAt seconds ago; the
    // ping's own clock still says 45 days.
    const es = { lastActivityAt: iso(NOW - 5_000), returnTrialClockAt: iso(AWAY_45D) };
    expect(returnClockPriorMs(es)).toBe(AWAY_45D);
    expect(isRecentlyActive(returnClockPriorMs(es), NOW)).toBe(false);
    expect(planReturnPing({ emailState: es, sub: lapsed, consider: true, nowMs: NOW }).result.granted).toBe(true);
    // No clock yet → lastActivityAt is the fallback.
    expect(returnClockPriorMs({ lastActivityAt: iso(NOW - DAY_MS) })).toBe(NOW - DAY_MS);
    expect(returnClockPriorMs({})).toBeNull();
    expect(isRecentlyActive(null, NOW)).toBe(false);
  });

  it('an incident-restored store payer counts as paid-before', () => {
    const restored = { ...lapsed, restoredFromIncident: true, platform: 'ios' };
    expect(returnTrialVerdict({ sub: restored, priorActivityMs: AWAY_45D, nowMs: NOW })).toEqual({
      grant: false,
      reason: 'paid-before',
    });
  });
});
