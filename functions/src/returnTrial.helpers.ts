/**
 * Return-triggered second trial (pure helpers).
 *
 * 91% of trial accounts never come back after their first hour, and the ones
 * who do come back weeks later land on an expired trial and bounce again.
 * The trial is a Firestore window, not a store product, so re-opening it for
 * a tradie who returns after a long absence is a server flip with no store
 * review: RETURN_TRIAL_DAYS of full Pro from the moment they walk back in,
 * granted exactly once per account.
 *
 * Trigger: the activity ping the dashboard sends once per app session
 * (updateActivityTimestamp in index.ts). "How long were they away" is a
 * server-side fact, not a client claim: the ping keeps its own return
 * clock, emailState.returnTrialClockAt, written by this handler alone.
 * lastActivityAt is only the fallback for accounts that predate the clock.
 * (Until 21 Sep 2026 the quote/invoice triggers also wrote it on every
 * server-side write, so it could say "now" for a tradie a month gone; the
 * ping is its only writer now, but the clock stays the primary source.)
 *
 * Only a client that declares `supportsReturnTrial` is granted one — an
 * older bundle computes the trial from trialStartedAt + 14 days, would show
 * the re-trial as expired, and would burn the account's one shot without
 * ever showing it. And a returning tradie's FIRST launch is always on the
 * older bundle (the OTA applies at launch two), so a ping from an
 * unsupported bundle that WOULD have qualified leaves the return clock
 * where it was: launch two, on the new bundle, still sees the real absence.
 *
 * The grant leaves trialStartedAt alone (cohort dates, lifecycle-email clock)
 * and sets an explicit trialEndsAt that every trial-window reader honours
 * (trialEndMs in subscription.helpers.ts, trialConfig.ts on the client).
 */

import { subEnvironment, trialEndMs, ts } from './subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Length of the second trial. Mirror of RETURN_TRIAL_DAYS in src/utils/trialConfig.ts. */
export const RETURN_TRIAL_DAYS = 7;
export const RETURN_TRIAL_MS = RETURN_TRIAL_DAYS * DAY_MS;
/** How long an expired-trial account must have been away to earn it. */
export const RETURN_TRIAL_INACTIVE_DAYS = 30;
export const RETURN_TRIAL_INACTIVE_MS = RETURN_TRIAL_INACTIVE_DAYS * DAY_MS;

export type ReturnTrialReason =
  | 'pro'
  | 'paid-before'
  | 'no-trial'
  | 'trial-active'
  | 'already-granted'
  | 'recently-active'
  /** Qualified, but this bundle can't render it — the return clock is held. */
  | 'client-unsupported';

export type ReturnTrialVerdict =
  | {
      grant: true;
      payload: Record<string, unknown>;
      inactiveDays: number;
      /** The activity stamp the absence was measured from (after the trial-start floor). */
      lastActiveMs: number;
    }
  | { grant: false; reason: ReturnTrialReason };

/**
 * The stamp the absence is measured from: the ping's own return clock, or
 * lastActivityAt for an account the clock hasn't been written on yet.
 */
export function returnClockPriorMs(emailState: Record<string, any> | undefined | null): number | null {
  return ts(emailState?.returnTrialClockAt) ?? ts(emailState?.lastActivityAt);
}

/** True when the prior stamp alone already rules the return out — no need to read the sub doc. */
export function isRecentlyActive(priorMs: number | null, nowMs: number): boolean {
  return priorMs !== null && nowMs - priorMs < RETURN_TRIAL_INACTIVE_MS;
}

/**
 * A store or Stripe purchase identifier that was not a sandbox purchase —
 * or an incident-restored store payer, whose identifiers were lost in the
 * Jul 2026 rebuild but who certainly paid.
 */
function hasBillingRecord(sub: Record<string, any>): boolean {
  if (sub.restoredFromIncident) return true;
  if (!(sub.productId || sub.subscriptionId || sub.priceId)) return false;
  return (subEnvironment(sub) || '').toLowerCase() !== 'sandbox';
}

/**
 * Decide whether this return earns the second trial, and what to merge onto
 * users/{uid}/profile/subscription if it does.
 *
 * `priorActivityMs` is the last activity stamp BEFORE this return (null when
 * the account has none). The trial start is always a floor on it: a tradie
 * was certainly active when their first quote started the clock, so an
 * account with no activity stamp at all cannot look "away" for longer than
 * it has existed.
 */
export function returnTrialVerdict(input: {
  sub: Record<string, any> | undefined | null;
  priorActivityMs: number | null;
  nowMs: number;
}): ReturnTrialVerdict {
  const { sub, nowMs } = input;
  if (!sub) return { grant: false, reason: 'no-trial' };
  if (sub.isPro === true) return { grant: false, reason: 'pro' };
  // Anyone who has ever carried a real billing record knows the product and
  // could otherwise cancel, wait a month and farm free weeks. Sandbox receipts
  // (TestFlight / test accounts) don't count — nothing was ever paid.
  if (hasBillingRecord(sub)) return { grant: false, reason: 'paid-before' };
  const trialStartedAt = ts(sub.trialStartedAt);
  if (trialStartedAt === null) return { grant: false, reason: 'no-trial' };
  if (ts(sub.returnTrialGrantedAt) !== null) return { grant: false, reason: 'already-granted' };
  const endMs = trialEndMs(sub);
  if (endMs === null || nowMs < endMs) return { grant: false, reason: 'trial-active' };

  const lastActiveMs = Math.max(trialStartedAt, input.priorActivityMs ?? -Infinity);
  const awayMs = nowMs - lastActiveMs;
  if (awayMs < RETURN_TRIAL_INACTIVE_MS) return { grant: false, reason: 'recently-active' };

  const now = new Date(nowMs);
  return {
    grant: true,
    inactiveDays: Math.floor(awayMs / DAY_MS),
    lastActiveMs,
    payload: {
      trialEndsAt: new Date(nowMs + RETURN_TRIAL_MS).toISOString(),
      trialExpired: false,
      returnTrialGrantedAt: now.toISOString(),
      returnTrialDays: RETURN_TRIAL_DAYS,
      // Forensics: what the window looked like before the flip, and how long
      // they were gone. Never read by the app.
      returnTrialPriorTrialEndsAt: new Date(endMs).toISOString(),
      returnTrialPriorActivityAt: new Date(lastActiveMs).toISOString(),
      syncedAt: now.toISOString(),
    },
  };
}

export interface ReturnPingPlan {
  /** New value of emailState.returnTrialClockAt (ISO). Held at the prior stamp when qualified-but-unsupported. */
  returnTrialClockAt: string;
  /** Merge onto users/{uid}/profile/subscription, or null when nothing is granted. */
  subPatch: Record<string, unknown> | null;
  result: { granted: boolean; days: number; reason?: ReturnTrialReason };
}

/**
 * Everything one ping decides, as data: what the return clock becomes, and
 * whether the sub doc gets the grant. The Firestore transaction in
 * returnTrial.ts only applies this.
 */
export function planReturnPing(input: {
  emailState: Record<string, any> | undefined | null;
  sub: Record<string, any> | undefined | null;
  consider: boolean;
  nowMs: number;
}): ReturnPingPlan {
  const nowIso = new Date(input.nowMs).toISOString();
  const priorMs = returnClockPriorMs(input.emailState);
  const verdict = returnTrialVerdict({ sub: input.sub, priorActivityMs: priorMs, nowMs: input.nowMs });
  const days = RETURN_TRIAL_DAYS;
  if (!verdict.grant) {
    return { returnTrialClockAt: nowIso, subPatch: null, result: { granted: false, days, reason: verdict.reason } };
  }
  if (!input.consider) {
    // Hold the clock at the pre-return stamp so the supporting bundle's
    // ping (next launch) measures the same absence.
    return {
      returnTrialClockAt: new Date(verdict.lastActiveMs).toISOString(),
      subPatch: null,
      result: { granted: false, days, reason: 'client-unsupported' },
    };
  }
  return { returnTrialClockAt: nowIso, subPatch: verdict.payload, result: { granted: true, days } };
}
