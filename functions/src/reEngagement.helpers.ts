/**
 * Pure eligibility maths for the daily sendReEngagement job, split out of
 * index.ts so it is unit testable (same pattern as adminFunnel.helpers).
 *
 * The unreachable check matters because the 21-day cooldown stamp is only
 * written after a SUCCESSFUL send: permanently unsendable addresses (Apple
 * private relay, test domains) never cool down, so without it the job
 * re-attempts them — and logs a fresh 'blocked' emailLog row — every day.
 */
import { classifyUnsendable } from './email';

const DAY_MS = 24 * 60 * 60 * 1000;
export const REENGAGE_INACTIVE_DAYS = 7;
export const REENGAGE_COOLDOWN_DAYS = 21;

/** True when no email campaign can ever reach this address. */
export function isUnreachableEmail(email: string | null | undefined): boolean {
  return !email || classifyUnsendable(email) !== null;
}

export type ReEngagementVerdict =
  | { send: true }
  | { send: false; reason: 'unreachable' | 'no-activity' | 'recently-active' | 'cooldown' };

export function reEngagementVerdict(
  input: {
    email: string | null | undefined;
    lastActivityAt: Date | null;
    lastReEngagementAt: Date | null;
  },
  now: Date,
): ReEngagementVerdict {
  if (isUnreachableEmail(input.email)) return { send: false, reason: 'unreachable' };
  if (!input.lastActivityAt) return { send: false, reason: 'no-activity' };
  if (now.getTime() - input.lastActivityAt.getTime() < REENGAGE_INACTIVE_DAYS * DAY_MS) {
    return { send: false, reason: 'recently-active' };
  }
  if (
    input.lastReEngagementAt &&
    now.getTime() - input.lastReEngagementAt.getTime() < REENGAGE_COOLDOWN_DAYS * DAY_MS
  ) {
    return { send: false, reason: 'cooldown' };
  }
  return { send: true };
}
