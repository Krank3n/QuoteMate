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
  };
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
  if (!grant?.proUntil) return null;
  const until = new Date(grant.proUntil);
  if (isNaN(until.getTime()) || until <= now) return null;
  return {
    isPro: true,
    platform: grant.platform || 'unknown',
    plan: grant.plan || null,
    currentPeriodEnd: until,
    restoredFromIncident: 'incident-2026-07',
    quotesThisMonth: 0,
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
