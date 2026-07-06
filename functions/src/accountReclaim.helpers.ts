// Account-reclaim helpers — restore surviving assets to users whose accounts
// were destroyed by the July 2026 cleanupUnverifiedEmailUsers incident.
//
// A one-off `accountReclaims/{email}` collection maps each deleted account's
// email to its old uid. When someone signs up again with a matching email,
// onUserCreated copies the old account's surviving Cloud Storage files
// (logo, quote photos) across to the new uid and marks the record claimed.
// Kept pure (no firebase-admin imports) so the matching/copy-plan logic is
// unit-testable without emulators.

export interface AccountReclaimRecord {
  /** Uid of the deleted account whose assets survive in Cloud Storage. */
  oldUid?: string;
  /** Set once a new signup has claimed this record; reclaim never runs twice. */
  claimedByUid?: string;
  /**
   * Present for accounts that were paying subscribers when deleted. Their
   * app-store billing (Apple/Google) kept running independently of Firebase,
   * so on re-registration they get Pro restored immediately — receipt
   * re-validation on device then takes over as the source of truth.
   */
  restorePro?: {
    platform?: string;
    plan?: string;
    /** ISO date until which Pro is guaranteed (paid period + goodwill). */
    proUntil?: string;
    /**
     * Alternative to proUntil: grant runs this many days from the moment the
     * account is reclaimed (used for goodwill grants where the re-registration
     * date is unknown in advance).
     */
    durationDays?: number;
  };
}

/** Resolve a grant's end date: absolute proUntil wins, else durationDays from now. */
export function grantEndDate(
  grant: NonNullable<AccountReclaimRecord['restorePro']> | undefined,
  now: Date,
): Date | null {
  if (!grant) return null;
  if (grant.proUntil) {
    const until = new Date(grant.proUntil);
    return isNaN(until.getTime()) ? null : until;
  }
  if (typeof grant.durationDays === 'number' && grant.durationDays > 0) {
    return new Date(now.getTime() + grant.durationDays * 24 * 60 * 60 * 1000);
  }
  return null;
}

/**
 * Build the users/{uid}/profile/subscription payload that restores a deleted
 * payer's Pro access. Returns null when the record carries no Pro grant or
 * the grant has already lapsed.
 */
export function buildProRestorePatch(
  record: AccountReclaimRecord | undefined,
  now: Date,
): Record<string, unknown> | null {
  const grant = record?.restorePro;
  const until = grantEndDate(grant, now);
  if (!until || until <= now) return null;
  return {
    isPro: true,
    platform: grant!.platform || 'unknown',
    plan: grant!.plan || null,
    currentPeriodEnd: until,
    // The floor trigger keys off this absolute date — durationDays grants
    // resolve to a fixed end the moment they are claimed.
    incidentProUntil: until.toISOString(),
    restoredFromIncident: 'incident-2026-07',
    quotesThisMonth: 0,
  };
}

/**
 * Grant floor for the subscription doc: the client's saveSubscriptionStatus
 * does a full setDoc, so a post-signup client write (or receipt sync on a
 * device with no purchases) can clobber a freshly-restored grant with
 * isPro:false. Given the doc state after any write, return the minimal merge
 * patch that re-asserts an unexpired incident grant — or null when the doc
 * is compliant, the grant has lapsed, or there is no grant.
 */
export function buildProFloorPatch(
  afterData: Record<string, unknown> | null,
  incidentProUntil: string | undefined,
  now: Date,
): Record<string, unknown> | null {
  if (!incidentProUntil) return null;
  const until = new Date(incidentProUntil);
  if (isNaN(until.getTime()) || until <= now) return null;
  if (afterData && afterData.isPro === true) return null;
  return {
    isPro: true,
    currentPeriodEnd: until,
    incidentProUntil,
    restoredFromIncident: 'incident-2026-07',
  };
}

/** Firestore doc id for an email's reclaim record (emails are stored lowercase). */
export function reclaimDocIdForEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether a new signup should trigger an asset reclaim.
 * Requires an unclaimed record pointing at a *different* uid — a record
 * already claimed (or somehow pointing at the new uid itself) is a no-op.
 */
export function shouldReclaim(
  record: AccountReclaimRecord | undefined,
  newUid: string,
): boolean {
  if (!record?.oldUid) return false;
  if (record.claimedByUid) return false;
  if (record.oldUid === newUid) return false;
  return true;
}

/**
 * Find the business-logo object among the reclaimed destination paths.
 * The app stores exactly one logo at users/{uid}/logo.{png|jpg} and reads it
 * via the logoUri stored in settings/business — copying the file alone does
 * not resurface it, so the reclaim also rewrites that pointer.
 */
export function pickLogoObject(destinationNames: string[]): string | null {
  return destinationNames.find(n => /^users\/[^/]+\/logo\.(png|jpe?g)$/i.test(n)) ?? null;
}

/**
 * Map the old account's Storage object names onto the new uid's tree.
 * Only objects under `users/{oldUid}/` are copied; anything else in the
 * listing (defensive — the prefix query shouldn't return others) is dropped.
 */
export function reclaimCopyPlan(
  oldUid: string,
  newUid: string,
  objectNames: string[],
): Array<{ from: string; to: string }> {
  const prefix = `users/${oldUid}/`;
  return objectNames
    .filter(name => name.startsWith(prefix) && name.length > prefix.length)
    .map(name => ({
      from: name,
      to: `users/${newUid}/${name.slice(prefix.length)}`,
    }));
}
