/**
 * The ONLY payload the client may write to users/{uid}/profile/subscription
 * (PAY-02).
 *
 * Entitlement fields (isPro, plan, platformFeeBps, platform, productId,
 * appleValidated, …) are server-owned: they are written exclusively by the
 * receipt/Stripe/admin backends, and firestore.rules denies any client write
 * that touches them. Before Jul 2026 the client mirrored its whole local
 * SubscriptionStatus with a non-merge setDoc — which both let a client grant
 * itself Pro and, for real Pro users, clobbered the server's billing fields
 * (the source of the "bare isPro" records in the live pull).
 *
 * Mirror of the allow-list in firestore.rules (users/{uid}/profile/
 * subscription match) — update both together.
 */
import { SubscriptionStatus } from '../types';

export const CLIENT_SUBSCRIPTION_WRITABLE_KEYS = [
  'quotesThisMonth',
  'currentPeriodStart',
  'currentPeriodEnd',
  'freeQuotesLimit',
  'trialStartedAt',
  'trialExpired',
  'dismissedUpgradeBanner',
  'syncedAt',
] as const;

export function clientSubscriptionWritePayload(status: SubscriptionStatus): Record<string, unknown> {
  return {
    quotesThisMonth: status.quotesThisMonth,
    currentPeriodStart: new Date(status.currentPeriodStart).toISOString(),
    currentPeriodEnd: new Date(status.currentPeriodEnd).toISOString(),
    freeQuotesLimit: status.freeQuotesLimit,
    trialStartedAt: status.trialStartedAt ? new Date(status.trialStartedAt).toISOString() : null,
    trialExpired: status.trialExpired || false,
    dismissedUpgradeBanner: status.dismissedUpgradeBanner || false,
    syncedAt: new Date().toISOString(),
  };
}
