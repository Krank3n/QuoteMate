/**
 * Service Report entitlement.
 *
 * Reports are available on trial and pro. A 'free' plan means the trial has
 * elapsed with no subscription — that state is locked to the paywall, matching
 * how the rest of the app gates create/premium actions once the trial ends.
 */
export function canUseServiceReports(plan: 'trial' | 'free' | 'pro'): boolean {
  return plan !== 'free';
}
