/**
 * Pure decision logic for the trial lifecycle emails (lifecycleEmails.ts).
 * Kept dependency-free (no firebase imports) so it unit-tests like the other
 * *.helpers modules.
 *
 * Five steps on the TRIAL clock (trialStartedAt), each with a send-once flag
 * in users/{uid}/settings/emailState and its own window — a user who enters
 * the campaign late never receives stale steps:
 *
 *   day 0–1   trial_start_value   value framing + "send that quote today"
 *   day 3–4   trial_square_pitch  Path B: turn on payments (skipped if
 *                                 Square is already connected)
 *   day 7–8   trial_mid_value     personalised recap of the user's own real
 *                                 numbers (thin data → figures dropped)
 *   ≤3 days   trial_ending        what changes + real founding-spots count
 *   T+0..3d   trial_ended         free-plan reassurance + churn question
 *
 * The never-activated cohort is deliberately NOT here: sendOnboardingDrip's
 * tip 5 (Tom's first-quote note, day 14 post-signup) owns it — anyone with a
 * trial has already built a quote, so the two campaigns can't overlap.
 */
import { deriveSubFields, TRIAL_MS, ts } from './subscription.helpers';
import { isActivatingDoc } from './adminFunnel.helpers';
import { NUDGE_SEND_ONCE_FIELD } from './squareNudge.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
// How long after trial expiry the trial_ended email may still go out. Going
// live never backfills users whose trials lapsed before this window.
export const ENDED_WINDOW_MS = 3 * DAY_MS;
// trial_ending moved T-2 → T-3 (2026-07-16) so the founding-spots pitch has
// room to land before the last-day scramble.
export const ENDING_THRESHOLD_DAYS = 3;

export type LifecycleSend =
  | 'trial_start_value'
  | 'trial_square_pitch'
  | 'trial_mid_value'
  | 'trial_ending'
  | 'trial_ended';

export interface LifecycleEmailState {
  trialStartValueEmailAt?: unknown;
  trialSquarePitchEmailAt?: unknown;
  trialMidValueEmailAt?: unknown;
  trialEndingEmailAt?: unknown;
  trialEndedEmailAt?: unknown;
}

/** emailState field stamped (send-once) for each step. */
export const SEND_ONCE_FIELD: Record<LifecycleSend, keyof LifecycleEmailState> = {
  trial_start_value: 'trialStartValueEmailAt',
  trial_square_pitch: 'trialSquarePitchEmailAt',
  trial_mid_value: 'trialMidValueEmailAt',
  trial_ending: 'trialEndingEmailAt',
  trial_ended: 'trialEndedEmailAt',
};

/**
 * Same-day cross-campaign suppression window. The two marketing campaigns —
 * this trial/nudge cron (07:30 Brisbane) and the signup-anchored onboarding
 * drip (09:00 Sydney) — must never both email one user on the same morning.
 * 20h suppresses the same-day pair (1.5h apart) but never the next-day one
 * (22.5h apart). Steps deferred by suppression follow their normal window
 * rules — if the window passes meanwhile, the step is skipped, not sent
 * stale; fewer emails beats more.
 */
export const CROSS_CAMPAIGN_WINDOW_MS = 20 * 60 * 60 * 1000;

/** ms epoch of the most recent conversion-campaign send, or null. */
export function lastConversionSendMs(emailState: Record<string, unknown> | undefined): number | null {
  if (!emailState) return null;
  const fields = [...Object.values(SEND_ONCE_FIELD), ...Object.values(NUDGE_SEND_ONCE_FIELD)];
  let latest: number | null = null;
  for (const field of fields) {
    const at = ts(emailState[field]);
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/** Drip-side check: did the conversion campaign email this user today? */
export function sentConversionEmailWithin(
  emailState: Record<string, unknown> | undefined,
  now: number,
  windowMs: number = CROSS_CAMPAIGN_WINDOW_MS
): boolean {
  const last = lastConversionSendMs(emailState);
  return last !== null && now - last < windowMs;
}

/** Conversion-side check: did the onboarding drip email this user today? */
export function suppressedByOnboardingDrip(
  emailState: { lastOnboardingTipAt?: unknown } | undefined,
  now: number,
  windowMs: number = CROSS_CAMPAIGN_WINDOW_MS
): boolean {
  const at = ts(emailState?.lastOnboardingTipAt);
  return at !== null && now - at < windowMs;
}

export interface LifecycleDecision {
  send: LifecycleSend | null;
  daysRemaining?: number;
  /** ms epoch — present whenever send !== null (personalisation reads need it). */
  trialStartedAt?: number;
}

/** Which lifecycle email (if any) this user should get right now. */
export function lifecycleVerdict(
  sub: any,
  emailState: LifecycleEmailState | undefined,
  now: number,
  extras: { hasSquareConnection?: boolean } = {}
): LifecycleDecision {
  const f = deriveSubFields(sub, now);

  // Converted, comped (admin_grant sets isPro), bare isPro flags, or never
  // trialed → nothing. Anyone the app treats as Pro is never nagged.
  if (f.isPro || f.trialStartedAt === null) return { send: null };

  if (f.tier === 'trialing') {
    const elapsedDays = (now - f.trialStartedAt) / DAY_MS;

    // Most time-critical first; the day windows themselves are disjoint.
    if (
      f.trialDaysRemaining !== null &&
      f.trialDaysRemaining <= ENDING_THRESHOLD_DAYS &&
      !emailState?.trialEndingEmailAt
    ) {
      return {
        send: 'trial_ending',
        daysRemaining: f.trialDaysRemaining,
        trialStartedAt: f.trialStartedAt,
      };
    }
    // trial_mid_value (day 7–8) was retired 2026-08-04: 42 sends, 7% open,
    // 0% click. Every step after trial_start_value earned zero clicks, and this
    // was the weakest of them — the send-once field and template are kept so it
    // can be reinstated if the copy is reworked, but nothing selects it now.
    if (
      elapsedDays >= 3 &&
      elapsedDays < 5 &&
      !extras.hasSquareConnection &&
      !emailState?.trialSquarePitchEmailAt
    ) {
      return { send: 'trial_square_pitch', trialStartedAt: f.trialStartedAt };
    }
    if (elapsedDays < 2 && !emailState?.trialStartValueEmailAt) {
      return { send: 'trial_start_value', trialStartedAt: f.trialStartedAt };
    }
    return { send: null };
  }

  if (f.tier === 'trial_expired' && !emailState?.trialEndedEmailAt) {
    const endedAt = f.trialStartedAt + TRIAL_MS;
    if (now - endedAt <= ENDED_WINDOW_MS) {
      return { send: 'trial_ended', trialStartedAt: f.trialStartedAt };
    }
  }

  return { send: null };
}

export type TrialEndingVariant = 'standard' | 'skip';

/**
 * Which trial_ending email to send, if any.
 *
 * Trial starters who never SENT a quote used to get a personal "what got in the
 * way?" nudge here instead of the pricing pitch. The reasoning was sound —
 * sending is the activation event, and a pricing email lands wrong on someone
 * who hasn't seen the payoff — but it measured 20 sends, 0 opens, 0 clicks.
 * Retired 2026-08-04: they now get nothing at this step rather than a second
 * unread email. They still receive trial_ended after expiry, which is the
 * better-performing of the two (10% vs 0%) and reads correctly for them.
 *
 * When the documents scan fails the sent-signal is unknowable, so fall back to
 * the standard email rather than silently skip someone who did activate.
 */
export function trialEndingVariant(hasSentDoc: boolean, docsScanOk: boolean): TrialEndingVariant {
  return docsScanOk && !hasSentDoc ? 'skip' : 'standard';
}

export interface MidTrialRecap {
  quotesBuilt: number;
  dollarsQuoted: number;
  sent: number;
  /** False → the email drops the figures (never pad thin numbers). */
  rich: boolean;
}

// Below either bound the recap reads as sad rather than impressive — the
// email falls back to non-numeric copy instead.
export const RECAP_MIN_QUOTES = 2;
export const RECAP_MIN_DOLLARS = 500;

/**
 * The user's OWN real numbers for the day-7 email, from their documents
 * created since the trial started. Field names verified against the live
 * writers: documents carry `createdAt` (ms) and `total` (documentHandlers.ts
 * payment math uses Number(doc.total)); "sent" reuses isActivatingDoc.
 */
export function midTrialRecap(
  docs: Array<{ createdAt?: unknown; total?: unknown; stage?: unknown; sentAt?: unknown }>,
  trialStartedAt: number
): MidTrialRecap {
  let quotesBuilt = 0;
  let dollarsQuoted = 0;
  let sent = 0;
  for (const d of docs) {
    if (typeof d.createdAt !== 'number' || d.createdAt < trialStartedAt) continue;
    quotesBuilt++;
    dollarsQuoted += Number(d.total) || 0;
    if (isActivatingDoc(d)) sent++;
  }
  dollarsQuoted = Math.round(dollarsQuoted);
  const rich = quotesBuilt >= RECAP_MIN_QUOTES && dollarsQuoted >= RECAP_MIN_DOLLARS;
  return { quotesBuilt, dollarsQuoted, sent, rich };
}
