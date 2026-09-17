// Must match functions/src/subscription.helpers.ts TRIAL_DAYS — update both together.
export const TRIAL_DAYS = 14;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

/**
 * The one return-triggered second trial. Mirror of RETURN_TRIAL_DAYS in
 * functions/src/returnTrial.helpers.ts, where the grant is decided: an
 * expired-trial account that comes back after 30+ days away gets this many
 * days of Pro again, once, granted server-side from the dashboard's
 * activity ping. Used here only for copy.
 */
export const RETURN_TRIAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

type DateLike = Date | string | number | null | undefined;

/** The trial fields every window read needs. A SubscriptionStatus satisfies it. */
export interface TrialWindowSource {
  trialStartedAt?: DateLike;
  /** Server-owned explicit end; when present it beats trialStartedAt + TRIAL_MS. */
  trialEndsAt?: DateLike;
  /** When the return trial was granted — the start of the CURRENT window. */
  returnTrialGrantedAt?: DateLike;
}

export interface TrialWindow {
  /** Start of the window the tradie is in now (the return-trial grant, else the first quote). */
  startMs: number;
  endMs: number;
  /** True while a server-granted return trial is the window in force. */
  isReturnTrial: boolean;
}

function toMs(value: DateLike): number | null {
  if (value == null || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When this account's trial ends (or ended), or null when no trial has
 * started. Every "is the trial still running" read on the client goes
 * through here (mirror of trialEndMs in functions/src/subscription.helpers.ts)
 * so a return trial's explicit trialEndsAt is honoured everywhere at once.
 */
export function trialEndMs(source: TrialWindowSource | null | undefined): number | null {
  const start = toMs(source?.trialStartedAt);
  if (start === null) return null;
  const explicitEnd = toMs(source?.trialEndsAt);
  return explicitEnd ?? start + TRIAL_MS;
}

/** The current trial window, or null when no trial has started. */
export function trialWindow(source: TrialWindowSource | null | undefined): TrialWindow | null {
  const endMs = trialEndMs(source);
  const firstStart = toMs(source?.trialStartedAt);
  if (endMs === null || firstStart === null) return null;
  const grantedAt = toMs(source?.returnTrialGrantedAt);
  const isReturnTrial = grantedAt !== null && toMs(source?.trialEndsAt) !== null && grantedAt < endMs;
  return { startMs: isReturnTrial ? grantedAt : firstStart, endMs, isReturnTrial };
}

/** True once the trial window has elapsed. False when no trial has started. */
export function isTrialWindowExpired(source: TrialWindowSource | null | undefined, now = Date.now()): boolean {
  const end = trialEndMs(source);
  return end !== null && now >= end;
}

/**
 * Whole days left (ceil, never negative) — the count the dashboard, the
 * TrialBanner, the paywall and nextBestAction all agree on. Null when no
 * trial has started.
 */
export function trialDaysRemaining(source: TrialWindowSource | null | undefined, now = Date.now()): number | null {
  const end = trialEndMs(source);
  if (end === null) return null;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}
