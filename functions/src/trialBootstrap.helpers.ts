/**
 * Server-side trial bootstrap (pure helpers).
 *
 * The 14-day trial starts on a user's first quote. Historically the CLIENT
 * stamped trialStartedAt (startTrialIfNeeded → saveSubscriptionStatus), but
 * the PAY-02 rules deploy (22 Jul 2026) rejects the pre-1.47 client payload
 * (it includes the server-owned `plan`/`platformFeeBps` keys), so old builds
 * silently fail to seed users/{uid}/profile/subscription and the trial clock
 * never starts. onQuoteCreatedBootstrapTrial (trialBootstrap.ts) closes that
 * gap server-side — and long-term makes trial start server-owned, closing the
 * "trialStartedAt stays client-writable" weakness noted in firestore.rules.
 */

export interface TrialBootstrapWrite {
  /** merge-set payload for users/{uid}/profile/subscription */
  payload: Record<string, unknown>;
}

/**
 * Given the current subscription doc (or undefined when missing) and the
 * quote's creation time, decide what — if anything — to write.
 *
 * Idempotent: returns null whenever a trial is already running/ran (any
 * trialStartedAt present) or the user is Pro. Never touches entitlement keys.
 */
export function deriveTrialBootstrapWrite(
  subData: Record<string, any> | undefined | null,
  quoteCreatedAtMs: number,
  nowMs: number,
): TrialBootstrapWrite | null {
  if (subData?.isPro === true) return null;
  if (subData?.trialStartedAt) return null;

  const startMs = Number.isFinite(quoteCreatedAtMs) ? quoteCreatedAtMs : nowMs;
  const trialStartedAt = new Date(startMs).toISOString();

  if (subData) {
    // Doc exists (e.g. seeded by a 1.47+ client with trialStartedAt: null):
    // just stamp the trial start.
    return { payload: { trialStartedAt, syncedAt: new Date(nowMs).toISOString() } };
  }

  // Doc missing entirely (pre-1.47 client whose seed write was denied):
  // create the same shape the client quota code seeds, minus entitlement keys.
  const now = new Date(nowMs);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return {
    payload: {
      isPro: false,
      quotesThisMonth: 1,
      currentPeriodStart: monthStart.toISOString(),
      currentPeriodEnd: monthEnd.toISOString(),
      freeQuotesLimit: 5,
      trialStartedAt,
      trialExpired: false,
      dismissedUpgradeBanner: false,
      syncedAt: now.toISOString(),
      trialBootstrappedBy: 'onQuoteCreatedBootstrapTrial',
    },
  };
}

/** Best-effort ms-epoch from a Firestore Timestamp | ISO string | Date | ms. */
export function toMillis(value: any): number {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const t = new Date(value).getTime();
  return t;
}
