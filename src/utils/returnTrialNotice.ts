/**
 * Return trial welcome-back card — the pure parts (visibility + copy), so
 * the dashboard's decision and the words are testable without React.
 *
 * The server re-opens a lapsed trial once for a tradie who comes back after
 * a month away (functions/src/returnTrial.helpers.ts). This card is the
 * in-app half: shown on the dashboard while that window runs, until the
 * tradie closes it or taps through to quote a job. It says plainly that this
 * is the last one — no third act to hold out for.
 */

import { RETURN_TRIAL_DAYS, trialDaysRemaining, trialWindow, type TrialWindowSource } from './trialConfig';

export interface ReturnTrialNoticeSource extends TrialWindowSource {
  isPro?: boolean;
  returnTrialDays?: number;
  returnTrialNoticeSeenAt?: Date | string | number | null;
}

/** Show the card: a return trial is in force, the tradie isn't Pro, and it hasn't been closed. */
export function returnTrialNoticeVisible(
  status: ReturnTrialNoticeSource | null | undefined,
  now = Date.now(),
): boolean {
  if (!status || status.isPro) return false;
  if (status.returnTrialNoticeSeenAt) return false;
  const window = trialWindow(status);
  return !!window?.isReturnTrial && now < window.endMs;
}

export interface ReturnTrialNoticeCopy {
  title: string;
  body: string;
  cta: string;
}

export function returnTrialNoticeCopy(
  status: ReturnTrialNoticeSource | null | undefined,
  now = Date.now(),
): ReturnTrialNoticeCopy {
  const days = trialDaysRemaining(status, now) ?? status?.returnTrialDays ?? RETURN_TRIAL_DAYS;
  const dayWord = days === 1 ? 'day' : 'days';
  return {
    title: "Welcome back — Pro's on again",
    body:
      `We've switched your trial back on: ${days} ${dayWord} of full Pro from today. ` +
      "It's the last free run, so make it count.",
    cta: 'Quote a job',
  };
}
