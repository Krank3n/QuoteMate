/**
 * Pure decision logic for the trial lifecycle emails (lifecycleEmails.ts).
 * Kept dependency-free (no firebase imports) so it unit-tests like the other
 * *.helpers modules.
 */
import { deriveSubFields, TRIAL_MS } from './subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
// How long after trial expiry the trial_ended email may still go out. Going
// live never backfills users whose trials lapsed before this window.
export const ENDED_WINDOW_MS = 3 * DAY_MS;

export interface LifecycleDecision {
  send: 'trial_ending' | 'trial_ended' | null;
  daysRemaining?: number;
}

/** Which lifecycle email (if any) this user should get right now. */
export function lifecycleVerdict(
  sub: any,
  emailState: { trialEndingEmailAt?: unknown; trialEndedEmailAt?: unknown } | undefined,
  now: number
): LifecycleDecision {
  const f = deriveSubFields(sub, now);

  // Converted, comped (admin_grant sets isPro) or never trialed → nothing.
  if (f.isPro || f.trialStartedAt === null) return { send: null };

  if (
    f.tier === 'trialing' &&
    f.trialDaysRemaining !== null &&
    f.trialDaysRemaining <= 2 &&
    !emailState?.trialEndingEmailAt
  ) {
    return { send: 'trial_ending', daysRemaining: f.trialDaysRemaining };
  }

  if (f.tier === 'trial_expired' && !emailState?.trialEndedEmailAt) {
    const endedAt = f.trialStartedAt + TRIAL_MS;
    if (now - endedAt <= ENDED_WINDOW_MS) return { send: 'trial_ended' };
  }

  return { send: null };
}
