/**
 * Did the app ask to end this session, or did Firebase just hiccup?
 *
 * `onAuthStateChanged` fires with `null` in two very different situations and
 * gives no way to tell them apart:
 *
 *   1. The tradie tapped Sign Out.
 *   2. Firebase's React Native persistence is mid-token-refresh (or still
 *      loading the persisted session at launch) and briefly has no user.
 *
 * App.tsx used to distinguish them with `auth.currentUser` — the reasoning
 * being that it stays populated through a refresh. It does not. Measured on an
 * API 36 emulator, 6 Sep 2026: on a cold start Firebase delivers the restored
 * user and then, about a second later, a second `null` with `auth.currentUser`
 * also null. That null ran the entire sign-out branch mid-launch, which
 * unmounted the app to the sign-in screen for ~1.1s before the user came back.
 * It is the last of the four cold-start flashes, and the one that survived
 * every fix aimed at the launch gate itself, because it happens AFTER the
 * session has already been restored.
 *
 * So the app states its intent rather than inferring it. There is exactly one
 * sign-out call site (AccountSettingsScreen), which marks this immediately
 * before `signOut()`.
 *
 * Deliberately NOT covered: a session revoked server-side (password changed on
 * another device, account deleted remotely). That arrives as an unrequested
 * null and is now ignored, so the app keeps running until the next launch —
 * where Firebase produces no user, the restore deadline lapses, and the
 * sign-in screen appears normally. Staying put beats yanking a tradie out of a
 * half-written quote on a signal Firebase sends spuriously anyway.
 */

let signOutRequested = false;

/** Call immediately before `signOut(auth)`. */
export function markSignOutIntent(): void {
  signOutRequested = true;
}

/**
 * True exactly once per marked sign-out — reading it clears the flag, so a
 * later spurious null can't reuse someone's earlier intent.
 */
export function consumeSignOutIntent(): boolean {
  const requested = signOutRequested;
  signOutRequested = false;
  return requested;
}

/** Test seam — module state would otherwise leak between cases. */
export function __resetSignOutIntent(): void {
  signOutRequested = false;
}
