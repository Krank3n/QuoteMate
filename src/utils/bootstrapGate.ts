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
