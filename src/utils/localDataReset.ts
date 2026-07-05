// Decides whether a change of signed-in account should wipe locally-cached
// data (quotes, business settings, favourites in AsyncStorage).
//
// History: the original guard wiped whenever the uid changed — including on
// sign-out (`newUid === null`). After the July 2026 deletion incident that
// behaviour was destroying the ONLY surviving copy of affected users' data:
// their deleted account's next token refresh fired a null auth state and the
// launch-time wipe ran. It also blocked recovery — a user re-registering
// with the same email gets a new uid, and the wipe discarded the local data
// that would otherwise re-upload to their new account.
//
// Rules now: wiping is reserved for a *different identity signing in*.
// Sign-out never wipes. A same-email re-registration never wipes. A device
// whose stored last-email predates this file can still be recognised via the
// accountReclaims lookup (old uid of the deleted account for the new email).
// Kept pure (no RN/firebase imports) so it is unit-testable.

export interface LocalDataResetInput {
  /** Uid stored from the previous session, if any. */
  lastUid: string | null;
  /** Email stored from the previous session — null on devices that predate the email key. */
  lastEmail: string | null;
  /** Uid of the account that just signed in; null when signed out. */
  newUid: string | null;
  /** Email of the account that just signed in. */
  newEmail: string | null;
  /**
   * oldUid from accountReclaims/{newEmail} — the deleted account this email
   * used to own. null/undefined when there is no record or lookup failed.
   */
  reclaimOldUid?: string | null;
}

function emailsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function shouldClearLocalData(input: LocalDataResetInput): boolean {
  const { lastUid, lastEmail, newUid, newEmail, reclaimOldUid } = input;

  // Sign-out (or launch while signed out) never wipes — the data may be the
  // only surviving copy for a deleted account, and a signed-out app shows
  // the auth screen anyway.
  if (!newUid) return false;

  // Fresh device / no previous session — nothing to protect against.
  if (!lastUid) return false;

  // Same account as last time.
  if (lastUid === newUid) return false;

  // Same person, new uid — the re-registration path. Preserve so local data
  // re-uploads to the new account.
  if (emailsMatch(lastEmail, newEmail)) return false;

  // Server-verified same person: the new email's deleted account is exactly
  // this device's previous account. Covers devices without a stored email.
  if (reclaimOldUid && reclaimOldUid === lastUid) return false;

  // Genuinely different identity signing in on a used device — wipe, so the
  // new user never sees (or re-uploads) the previous user's data.
  return true;
}
