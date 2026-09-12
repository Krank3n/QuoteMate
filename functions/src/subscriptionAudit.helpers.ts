/**
 * The nightly subscription audit's classifier, kept dependency-free so it can
 * be unit-tested without firebase. See subscriptionAudit.ts for the scan.
 */
import { isBilledSub, isRestoredStorePro, subEnvironment, subPeriodEnded } from './subscription.helpers';

export type AuditReason =
  | 'restored_awaiting_receipt'
  | 'restored_unknown_platform'
  | 'restored_expired'
  | 'admin_grant_lapsed'
  | 'sandbox'
  | 'bare_ispro';

/**
 * Why an isPro doc is not a paying subscriber, or null when it is (or isn't
 * Pro at all). Order matters: a billed sub is never an issue; an admin comp
 * is only an issue once its end date has passed (named the night it lapses —
 * the expiry sweep clears it after its grace); an incident restore is
 * classified by whether its grant is still running; App Review's sandbox
 * purchase is named as such rather than falling through to `bare_ispro`.
 */
export function classify(sub: any, nowMs: number): AuditReason | null {
  if (!sub?.isPro) return null;
  if (isBilledSub(sub)) return null;
  if (sub.platform === 'admin_grant') {
    return subPeriodEnded(sub, nowMs) ? 'admin_grant_lapsed' : null;
  }

  if (sub.restoredFromIncident) {
    if (isRestoredStorePro(sub, nowMs)) return 'restored_awaiting_receipt';
    const until = typeof sub.incidentProUntil === 'string' ? Date.parse(sub.incidentProUntil) : NaN;
    if (Number.isFinite(until) && until <= nowMs) return 'restored_expired';
    return 'restored_unknown_platform';
  }
  if ((subEnvironment(sub) || '').toLowerCase() === 'sandbox') return 'sandbox';
  return 'bare_ispro';
}
