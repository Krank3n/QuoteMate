/**
 * Safety net for the two first-paint gates in App.tsx.
 *
 * Both gates (`isLoading` from initialize(), `userDataLoaded` from the
 * onAuthStateChanged handler) used to await an unbounded `Promise.all` of
 * Firestore + AsyncStorage loads. Every one of those loaders swallows its own
 * errors, so the batch can never REJECT — but a try/catch does not rescue a
 * promise that never SETTLES, and the Firestore SDK applies no default read
 * timeout. A single hung read left the user staring at the logo splash
 * indefinitely.
 *
 * It was unrecoverable as well as invisible: App claimed the uid in
 * `initialisedForUidRef` *before* awaiting, so a re-fired auth event
 * short-circuited instead of retrying.
 *
 * Measured fallout (2026-08-03): 57 accounts authenticated, wrote
 * settings/registrationInfo from the client, and then never wrote another
 * document — no profile/onboarding, no profile/settings, no quote. 20-26% of
 * June-July signups, ~1.7x worse on web. GA4 independently showed 8 of 23 web
 * signups never firing a single onboarding_step_viewed.
 */

/** Max wait for the critical load batch before the splash lifts anyway. */
export const BOOTSTRAP_TIMEOUT_MS = 8_000;

/**
 * How long the splash waits on the signed-in bootstrap batch before coming
 * down anyway.
 *
 * Much shorter than BOOTSTRAP_TIMEOUT_MS because it answers a different
 * question. Every critical loader now reads the device before it asks the
 * network, and the realtime listeners keep the result current — so past this
 * point the splash is hiding an app that already has the tradie's data on it.
 * The 8s ceiling stays where it is for the "did the batch actually finish"
 * decision (retry + Sentry), which must not fire just because someone opened
 * the app in a basement.
 */
export const FIRST_PAINT_TIMEOUT_MS = 1_500;

/**
 * Absolute ceiling on the splash overlay, covering the dimensions the batch
 * timeout can't (font loading, a throw before either flag is set). A user
 * looking at a motionless logo does not come back, so showing them a
 * half-ready app is strictly better than showing them nothing.
 */
export const SPLASH_MAX_MS = 12_000;

export type GateOutcome = 'settled' | 'timeout';

/**
 * Resolve as soon as `work` settles, or after `timeoutMs`, whichever is first.
 *
 * Never rejects: a rejected `work` still counts as 'settled', because the only
 * question this answers is "may the gate open yet?" — and the answer after the
 * work has failed is yes. Callers that care about individual failures should
 * pass a `Promise.allSettled` and inspect it themselves.
 */
export function raceTimeout(work: Promise<unknown>, timeoutMs: number): Promise<GateOutcome> {
  return new Promise<GateOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: GateOutcome, timer?: ReturnType<typeof setTimeout>) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    work.then(() => finish('settled', timer), () => finish('settled', timer));
  });
}

/** Names of the loaders in the critical batch, in call order. */
export type LoaderName =
  | 'quotes'
  | 'businessSettings'
  | 'onboarding'
  | 'subscription'
  | 'nextQuoteNumber';

/**
 * Turn `Promise.allSettled` results into a compact analytics prop naming the
 * loaders that rejected — so a partial failure is diagnosable from the event
 * stream instead of requiring a repro. Empty string when everything succeeded,
 * because GA4 drops undefined params but keeps empty strings.
 */
export function failedLoaderNames(
  names: readonly LoaderName[],
  results: ReadonlyArray<{ status: 'fulfilled' | 'rejected' }>,
): string {
  return names.filter((_, i) => results[i]?.status === 'rejected').join(',');
}

/**
 * How long to wait for Firebase to restore a session the device says exists,
 * before concluding it is gone and showing the sign-in screen.
 *
 * Only ever applies to a device that has actually been signed in, so the
 * normal cost is zero — the user arrives in well under a second and the gate
 * opens then. The case it bounds is a session revoked server-side (password
 * change, deleted account), where no user is ever coming.
 */
export const SESSION_RESTORE_TIMEOUT_MS = 5_000;

/**
 * Do we yet know whether anybody is signed in?
 *
 * Firebase cannot answer this on React Native. `onAuthStateChanged` fires with
 * `null` before the persisted session has been read off AsyncStorage, and
 * `auth.currentUser` is null at that moment too, so the transient-null guard
 * can't catch it. `authStateReady()` is no better — it resolves on that same
 * first emission. Both were tried against a real Android cold start and both
 * still produced ~1.1s of sign-in screen in front of a signed-in tradie.
 *
 * So the device answers instead. It records whether a session was live when the
 * app was last used, which is something Firebase's first `null` cannot
 * contradict: if a session should be there, the null is the SDK still loading,
 * not a sign-out.
 */
export interface AuthKnownInput {
  /** Firebase has produced an actual user. */
  signedIn: boolean;
  /** Firebase has said anything at all yet (user or null). */
  firebaseReported: boolean;
  /** Device's record of a live session. null while the read is in flight. */
  hadSession: boolean | null;
  /** SESSION_RESTORE_TIMEOUT_MS elapsed with no user. */
  restoreDeadlinePassed: boolean;
}

export function isAuthKnown(input: AuthKnownInput): boolean {
  // A real user is unambiguous, whatever else is outstanding.
  if (input.signedIn) return true;
  // Nothing has been said yet.
  if (!input.firebaseReported) return false;
  // Still reading the device's record — the null is not yet interpretable.
  if (input.hadSession === null) return false;
  // No session to restore, so Firebase's null is the real answer.
  if (!input.hadSession) return true;
  // A session should be here. Keep waiting for it, up to the deadline.
  return input.restoreDeadlinePassed;
}

/**
 * What the launch sequence should be showing right now.
 *
 * Lifted out of App.tsx's render body so the screen ordering can be asserted
 * without mounting the app. It exists because the ordering was wrong in four
 * separate ways at once, and every one of them was only visible as a flash on a
 * real Android cold start (measured on an API 36 emulator, 6 Sep 2026):
 *
 *   splash → sign-in screen → splash → onboarding wizard → dashboard
 *
 * for a tradie who was signed in and onboarded the entire time.
 *
 * The rule the flashes all violated: the splash comes down when we can show the
 * RIGHT screen, not as soon as we can show A screen. Every input below is a
 * question, and `false`/`null` means "haven't been told yet" — never "no".
 */
export interface LaunchGateInput {
  /** Marketing capture build with an injected payload — bypasses the lot. */
  demoCapture: boolean;
  /** SPLASH_MAX_MS elapsed. Forces a decision with whatever we know. */
  splashExpired: boolean;
  /** The on-device hydration pass is still running. */
  localLoading: boolean;
  fontsLoaded: boolean;
  /** Firebase has restored (or ruled out) a persisted session. */
  authResolved: boolean;
  signedIn: boolean;
  /** The signed-in bootstrap batch has settled or timed out. */
  userDataLoaded: boolean;
  /** null = neither the device nor the server has said yet. */
  isOnboarded: boolean | null;
  /** Saved business name — evidence they have been here before. */
  hasLocalBusiness: boolean;
}

export interface LaunchGate {
  splashVisible: boolean;
  showAuthScreen: boolean;
  showMainApp: boolean;
}

export function resolveLaunchGate(input: LaunchGateInput): LaunchGate {
  const {
    demoCapture,
    splashExpired,
    localLoading,
    fontsLoaded,
    authResolved,
    signedIn,
    userDataLoaded,
    isOnboarded,
    hasLocalBusiness,
  } = input;

  const splashVisible =
    !demoCapture &&
    !splashExpired &&
    (localLoading ||
      !fontsLoaded ||
      // Guessing "signed out" here showed the sign-in screen to a signed-in user.
      !authResolved ||
      // Guessing "not onboarded" here opened the wizard over a live business.
      (signedIn && isOnboarded === null) ||
      (signedIn && !userDataLoaded));

  return {
    splashVisible,
    showAuthScreen: !demoCapture && authResolved && !signedIn,
    // The ?? only bites on the splash-expiry path: a first launch on a device
    // that has never synced, with no connection. A saved business name means
    // the wizard is the wrong guess.
    showMainApp: demoCapture || (isOnboarded ?? hasLocalBusiness),
  };
}
