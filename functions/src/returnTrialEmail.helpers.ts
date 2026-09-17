/**
 * Return-trial reclaim email (pure helpers).
 *
 * The one re-engagement email with a real offer: an expired-trial account
 * that has been away 30+ days gets its trial re-opened for RETURN_TRIAL_DAYS
 * the moment it comes back (returnTrial.helpers.ts). This tells them so.
 *
 * Rules:
 *   - The email promises only what the activity ping will grant, so its
 *     predicate IS the grant predicate (returnTrialVerdict on the same
 *     return clock). Never a promise the server won't keep.
 *   - One send per account, ever (emailState.returnTrialEmailAt). The grant
 *     is once per account; a second email would offer nothing.
 *   - Dispatched by trialLifecycleDaily after the lifecycle and Square
 *     nudge tracks, so one email per user per morning still holds, and only
 *     while config/returnTrialEmail.enabled is true — off by default,
 *     because a dormant device runs a pre-OTA bundle on its first launch and
 *     the welcome-back card only shows from the second (or from the first
 *     once the store build carrying #242 has auto-updated).
 *   - Daily cap (config/returnTrialEmail.dailyCap) so the first wave ramps
 *     instead of bursting: the eligible backlog is every account that
 *     lapsed since launch.
 */

import { returnClockPriorMs, returnTrialVerdict, ReturnTrialReason, RETURN_TRIAL_DAYS } from './returnTrial.helpers';

export const RETURN_TRIAL_EMAIL_SEND_ONCE_FIELD = 'returnTrialEmailAt' as const;

export interface ReturnTrialEmailConfig {
  enabled: boolean;
  dailyCap: number;
}

export const DEFAULT_RETURN_TRIAL_EMAIL_CONFIG: ReturnTrialEmailConfig = { enabled: false, dailyCap: 25 };

/** config/returnTrialEmail → a safe config: missing or malformed means OFF. */
export function parseReturnTrialEmailConfig(data: Record<string, any> | undefined | null): ReturnTrialEmailConfig {
  const cap = Number(data?.dailyCap);
  return {
    enabled: data?.enabled === true,
    dailyCap: Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : DEFAULT_RETURN_TRIAL_EMAIL_CONFIG.dailyCap,
  };
}

export type ReturnTrialEmailVerdict =
  | { send: true; inactiveDays: number }
  | { send: false; reason: ReturnTrialReason | 'already-emailed' };

/**
 * Should this account get the reclaim email this morning? Exactly the grant
 * predicate, plus send-once.
 */
export function returnTrialEmailVerdict(input: {
  sub: Record<string, any> | undefined | null;
  emailState: Record<string, any> | undefined | null;
  nowMs: number;
}): ReturnTrialEmailVerdict {
  if (input.emailState?.[RETURN_TRIAL_EMAIL_SEND_ONCE_FIELD]) return { send: false, reason: 'already-emailed' };
  const verdict = returnTrialVerdict({
    sub: input.sub,
    priorActivityMs: returnClockPriorMs(input.emailState),
    nowMs: input.nowMs,
  });
  if (!verdict.grant) return { send: false, reason: verdict.reason };
  return { send: true, inactiveDays: verdict.inactiveDays };
}

export interface ReturnTrialEmailCopy {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  /** What's new since they left — outcomes, never the word "AI". */
  whatsNew: string[];
  howItWorks: string;
  cta: string;
}

/** The words, kept pure so the copy rules are testable. HTML lives in email.ts. */
export function returnTrialEmailCopy(businessName: string, days: number = RETURN_TRIAL_DAYS): ReturnTrialEmailCopy {
  const name = (businessName || '').trim();
  return {
    subject: name ? `${name}, a fresh ${days} days of Pro is waiting` : `A fresh ${days} days of Pro is waiting`,
    preheader: `Open QuoteMate and it switches on the moment you're back. No card, one-off.`,
    heading: `A fresh ${days} days of Pro, on us`,
    intro:
      `Hi ${name || 'there'}. It's been a while, and QuoteMate has changed a fair bit since you last quoted with it. ` +
      `So we've set you up with a fresh ${days} days of Pro: open the app and it switches on the moment you're back.`,
    whatsNew: [
      'Mate: describe the job in your own words and it works up the materials, labour and price with you',
      'Job photos: before-and-after shots on the job, marked up and attached to the quote',
      'Statements: one account summary for a customer, straight to their accountant',
      'Get paid on the spot: Pay Now on every quote and invoice, and Tap to Pay on iPhone',
      'Follow-ups that chase for you: a quiet nudge to the customer when a quote sits unanswered',
    ],
    howItWorks:
      `Nothing to claim and no card needed. It's a one-off, though: this is the last free run, so if there's a job to quote this week, it's a good week to do it.`,
    cta: 'Open QuoteMate',
  };
}
