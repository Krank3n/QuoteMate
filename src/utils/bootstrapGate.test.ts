import { describe, it, expect } from 'vitest';
import {
  raceTimeout,
  failedLoaderNames,
  resolveLaunchGate,
  isAuthKnown,
  BOOTSTRAP_TIMEOUT_MS,
  FIRST_PAINT_TIMEOUT_MS,
  SESSION_RESTORE_TIMEOUT_MS,
  SPLASH_MAX_MS,
  type LoaderName,
  type LaunchGateInput,
  type AuthKnownInput,
} from './bootstrapGate';

/**
 * Regression tests for the Jun-Aug 2026 stranded-signup bug: App.tsx gated the
 * splash on an unbounded `await Promise.all([...5 loaders])`. Every loader
 * swallows its own errors, so the batch could never reject — but a try/catch
 * does not rescue a promise that never SETTLES, and Firestore reads have no
 * default timeout. One hung read held the splash open forever, and because the
 * uid was claimed before the await, no retry was possible for the session.
 *
 * 57 accounts authenticated, wrote settings/registrationInfo, then never wrote
 * another document. GA4 corroborated: 8 of 23 web signups never fired a single
 * onboarding_step_viewed.
 */
describe('raceTimeout', () => {
  const never = () => new Promise<void>(() => {});

  it('resolves "settled" as soon as the work finishes', async () => {
    const outcome = await raceTimeout(Promise.resolve('done'), 1000);
    expect(outcome).toBe('settled');
  });

  it('resolves "timeout" when the work never settles — THE bug', async () => {
    const outcome = await raceTimeout(never(), 30);
    expect(outcome).toBe('timeout');
  });

  it('treats a rejected batch as settled rather than hanging or throwing', async () => {
    // The gate's only question is "may the splash lift yet". After a failure,
    // the answer is yes.
    await expect(raceTimeout(Promise.reject(new Error('boom')), 1000)).resolves.toBe('settled');
  });

  it('never rejects, so the caller can always await it un-guarded', async () => {
    const results = await Promise.all([
      raceTimeout(Promise.reject(new Error('x')), 50),
      raceTimeout(never(), 20),
      raceTimeout(Promise.resolve(1), 50),
    ]);
    expect(results).toEqual(['settled', 'timeout', 'settled']);
  });

  it('resolves once — a late settle after a timeout changes nothing', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const outcome = await raceTimeout(slow, 20);
    expect(outcome).toBe('timeout');
    release();
    await slow;
    expect(outcome).toBe('timeout');
  });

  it('wins the race for work that beats the deadline', async () => {
    const quick = new Promise<void>((r) => setTimeout(r, 5));
    expect(await raceTimeout(quick, 200)).toBe('settled');
  });
});

describe('failedLoaderNames', () => {
  const NAMES: readonly LoaderName[] = [
    'quotes', 'businessSettings', 'onboarding', 'subscription', 'nextQuoteNumber',
  ];
  const ok = { status: 'fulfilled' as const };
  const bad = { status: 'rejected' as const };

  it('returns empty string when everything succeeded', () => {
    // Empty rather than undefined: GA4 drops undefined params but keeps "".
    expect(failedLoaderNames(NAMES, [ok, ok, ok, ok, ok])).toBe('');
  });

  it('names the loaders that rejected, positionally', () => {
    expect(failedLoaderNames(NAMES, [ok, bad, ok, bad, ok])).toBe('businessSettings,subscription');
  });

  it('handles a short results array (timeout fired before the batch resolved)', () => {
    // On timeout the caller's `settled` is still [], and the event must still
    // be emittable rather than throwing inside telemetry.
    expect(failedLoaderNames(NAMES, [])).toBe('');
  });

  it('names every loader when all fail', () => {
    expect(failedLoaderNames(NAMES, [bad, bad, bad, bad, bad])).toBe(NAMES.join(','));
  });
});

describe('gate budgets', () => {
  it('lifts the splash before the ceiling, so the batch timeout is what normally fires', () => {
    expect(BOOTSTRAP_TIMEOUT_MS).toBeLessThan(SPLASH_MAX_MS);
  });

  it('keeps both inside a plausible human patience window', () => {
    expect(BOOTSTRAP_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(SPLASH_MAX_MS).toBeLessThanOrEqual(15_000);
  });
});

describe('resolveLaunchGate', () => {
  /**
   * A signed-in, onboarded tradie on a normal cold start. Every field starts at
   * the value it actually holds at t=0 on a real launch: nothing is known yet.
   */
  const coldStart = (over: Partial<LaunchGateInput> = {}): LaunchGateInput => ({
    demoCapture: false,
    splashExpired: false,
    localLoading: true,
    fontsLoaded: false,
    authResolved: false,
    signedIn: false,
    userDataLoaded: false,
    isOnboarded: null,
    hasLocalBusiness: false,
    ...over,
  });

  it('shows the splash on the first frame, before anything has been determined', () => {
    const gate = resolveLaunchGate(coldStart());
    expect(gate.splashVisible).toBe(true);
  });

  describe('the sign-in flash', () => {
    /**
     * Regression for the measured 1.1s of "Welcome back" on an API 36 emulator:
     * AsyncStorage and the fonts finished before Firebase restored the session,
     * so `user` was still null, the splash lifted, and the sign-in screen showed
     * to somebody who was signed in the whole time.
     */
    it('keeps the splash up when local data and fonts are ready but auth is not', () => {
      const gate = resolveLaunchGate(
        coldStart({ localLoading: false, fontsLoaded: true, authResolved: false }),
      );
      expect(gate.splashVisible).toBe(true);
    });

    it('never shows the sign-in screen before Firebase has ruled a session out', () => {
      const gate = resolveLaunchGate(
        coldStart({ localLoading: false, fontsLoaded: true, authResolved: false }),
      );
      expect(gate.showAuthScreen).toBe(false);
    });

    it('shows the sign-in screen once auth resolves to nobody', () => {
      const gate = resolveLaunchGate(
        coldStart({ localLoading: false, fontsLoaded: true, authResolved: true, signedIn: false }),
      );
      expect(gate.showAuthScreen).toBe(true);
      expect(gate.splashVisible).toBe(false);
    });
  });

  describe('the onboarding flash', () => {
    /**
     * Regression for the wizard appearing over a live business: isOnboarded
     * started at `false`, so the moment the splash lifted the app rendered
     * NewOnboardingScreen — measured at ~0.8s online, and permanently offline.
     */
    it('keeps the splash up while onboarding is undetermined for a signed-in user', () => {
      const gate = resolveLaunchGate(
        coldStart({
          localLoading: false,
          fontsLoaded: true,
          authResolved: true,
          signedIn: true,
          userDataLoaded: true,
          isOnboarded: null,
        }),
      );
      expect(gate.splashVisible).toBe(true);
    });

    it('goes straight to the app once onboarding is known to be done', () => {
      const gate = resolveLaunchGate(
        coldStart({
          localLoading: false,
          fontsLoaded: true,
          authResolved: true,
          signedIn: true,
          userDataLoaded: true,
          isOnboarded: true,
        }),
      );
      expect(gate.splashVisible).toBe(false);
      expect(gate.showMainApp).toBe(true);
      expect(gate.showAuthScreen).toBe(false);
    });

    it('shows the wizard when the server confirms they have never onboarded', () => {
      const gate = resolveLaunchGate(
        coldStart({
          localLoading: false,
          fontsLoaded: true,
          authResolved: true,
          signedIn: true,
          userDataLoaded: true,
          isOnboarded: false,
        }),
      );
      expect(gate.showMainApp).toBe(false);
      expect(gate.splashVisible).toBe(false);
    });

    it('does not hold the splash on onboarding for a signed-OUT user', () => {
      // Nothing to onboard yet — the sign-in screen is the right answer, and
      // waiting on a per-user flag would strand them on the logo.
      const gate = resolveLaunchGate(
        coldStart({
          localLoading: false,
          fontsLoaded: true,
          authResolved: true,
          signedIn: false,
          isOnboarded: null,
        }),
      );
      expect(gate.splashVisible).toBe(false);
      expect(gate.showAuthScreen).toBe(true);
    });
  });

  describe('splash expiry — the forced guess', () => {
    it('lifts the splash after SPLASH_MAX_MS even with everything unknown', () => {
      const gate = resolveLaunchGate(coldStart({ splashExpired: true }));
      expect(gate.splashVisible).toBe(false);
    });

    it('guesses "already onboarded" for a device with a saved business name', () => {
      // Offline on a device that has never synced. Re-running the wizard would
      // invite an established tradie to overwrite their own profile.
      const gate = resolveLaunchGate(
        coldStart({
          splashExpired: true,
          authResolved: true,
          signedIn: true,
          isOnboarded: null,
          hasLocalBusiness: true,
        }),
      );
      expect(gate.showMainApp).toBe(true);
    });

    it('guesses "needs onboarding" for a device with nothing on it', () => {
      const gate = resolveLaunchGate(
        coldStart({
          splashExpired: true,
          authResolved: true,
          signedIn: true,
          isOnboarded: null,
          hasLocalBusiness: false,
        }),
      );
      expect(gate.showMainApp).toBe(false);
    });

    it('lets a determined answer beat the local-business guess in both directions', () => {
      const base = {
        splashExpired: true,
        authResolved: true,
        signedIn: true,
        hasLocalBusiness: true,
      };
      expect(resolveLaunchGate(coldStart({ ...base, isOnboarded: false })).showMainApp).toBe(false);
      expect(
        resolveLaunchGate(coldStart({ ...base, isOnboarded: true, hasLocalBusiness: false }))
          .showMainApp,
      ).toBe(true);
    });
  });

  describe('demo capture builds', () => {
    it('never splashes, never asks for auth, and lands on the navigator', () => {
      const gate = resolveLaunchGate(coldStart({ demoCapture: true }));
      expect(gate).toEqual({ splashVisible: false, showAuthScreen: false, showMainApp: true });
    });
  });

  it('holds the splash for a signed-in user whose bootstrap batch is still running', () => {
    const gate = resolveLaunchGate(
      coldStart({
        localLoading: false,
        fontsLoaded: true,
        authResolved: true,
        signedIn: true,
        isOnboarded: true,
        userDataLoaded: false,
      }),
    );
    expect(gate.splashVisible).toBe(true);
  });

  it('holds the splash until the fonts land, so the app does not reflow into another face', () => {
    const gate = resolveLaunchGate(
      coldStart({
        localLoading: false,
        fontsLoaded: false,
        authResolved: true,
        signedIn: true,
        userDataLoaded: true,
        isOnboarded: true,
      }),
    );
    expect(gate.splashVisible).toBe(true);
  });

  /**
   * The whole point, stated once: replay the launch as a sequence of states and
   * assert the user is never shown a screen that later turns out to be wrong.
   */
  it('never shows sign-in or onboarding to a signed-in, onboarded tradie', () => {
    const timeline: LaunchGateInput[] = [
      coldStart(),
      coldStart({ fontsLoaded: true }),
      coldStart({ fontsLoaded: true, localLoading: false }),
      coldStart({ fontsLoaded: true, localLoading: false, authResolved: true, signedIn: true }),
      coldStart({
        fontsLoaded: true,
        localLoading: false,
        authResolved: true,
        signedIn: true,
        isOnboarded: true,
      }),
      coldStart({
        fontsLoaded: true,
        localLoading: false,
        authResolved: true,
        signedIn: true,
        isOnboarded: true,
        userDataLoaded: true,
      }),
    ];

    const visible = timeline.map((state) => {
      const gate = resolveLaunchGate(state);
      if (gate.splashVisible) return 'splash';
      if (gate.showAuthScreen) return 'auth';
      return gate.showMainApp ? 'app' : 'onboarding';
    });

    expect(visible).not.toContain('auth');
    expect(visible).not.toContain('onboarding');
    expect(visible[visible.length - 1]).toBe('app');
  });
});

describe('FIRST_PAINT_TIMEOUT_MS', () => {
  it('is well under the batch ceiling — it answers a different question', () => {
    // The 8s ceiling decides "did the batch finish" (retry + Sentry). The
    // first-paint deadline decides "may the splash come down", and after the
    // loaders went device-first there is nothing left behind the logo worth
    // waiting on. Collapsing the two is what made a weak connection cost the
    // tradie a six-second launch.
    expect(FIRST_PAINT_TIMEOUT_MS).toBeLessThan(BOOTSTRAP_TIMEOUT_MS);
  });

  it('lifts the splash well inside the absolute ceiling', () => {
    expect(FIRST_PAINT_TIMEOUT_MS).toBeLessThan(SPLASH_MAX_MS);
  });

  it('is short enough to read as a launch rather than a wait', () => {
    expect(FIRST_PAINT_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });
});

describe('isAuthKnown', () => {
  const base: AuthKnownInput = {
    signedIn: false,
    firebaseReported: false,
    hadSession: null,
    restoreDeadlinePassed: false,
  };

  it('is unknown before Firebase has said anything', () => {
    expect(isAuthKnown(base)).toBe(false);
  });

  it('is known the moment a real user arrives, whatever else is outstanding', () => {
    expect(isAuthKnown({ ...base, signedIn: true })).toBe(true);
    expect(isAuthKnown({ signedIn: true, firebaseReported: false, hadSession: null, restoreDeadlinePassed: false })).toBe(true);
  });

  it('is unknown while the device record is still being read', () => {
    // Firebase said null, but we cannot interpret that null yet.
    expect(isAuthKnown({ ...base, firebaseReported: true, hadSession: null })).toBe(false);
  });

  it('trusts a null when the device has no session to restore', () => {
    // Fresh install, or a deliberate sign-out. The sign-in screen is correct
    // and should come up immediately — no restore wait.
    expect(isAuthKnown({ ...base, firebaseReported: true, hadSession: false })).toBe(true);
  });

  it('REGRESSION: distrusts a null when the device says a session exists', () => {
    // This is the whole fix. Firebase's RN persistence emits null before it has
    // read the persisted session, and treating that as "signed out" is what put
    // the sign-in screen in front of a signed-in tradie for ~1.1s on every
    // Android cold start.
    expect(isAuthKnown({ ...base, firebaseReported: true, hadSession: true })).toBe(false);
  });

  it('gives up on a session that never arrives, so a revoked login still reaches sign-in', () => {
    expect(
      isAuthKnown({
        signedIn: false,
        firebaseReported: true,
        hadSession: true,
        restoreDeadlinePassed: true,
      }),
    ).toBe(true);
  });

  it('bounds the wait well inside the absolute splash ceiling', () => {
    expect(SESSION_RESTORE_TIMEOUT_MS).toBeLessThan(SPLASH_MAX_MS);
  });

  /** The measured launch, replayed. */
  it('never reports "signed out" during a real session restore', () => {
    const timeline: AuthKnownInput[] = [
      // t=0: nothing known.
      { signedIn: false, firebaseReported: false, hadSession: null, restoreDeadlinePassed: false },
      // Device record lands: a session should be here.
      { signedIn: false, firebaseReported: false, hadSession: true, restoreDeadlinePassed: false },
      // Firebase's premature null — the frame that used to show "Welcome back".
      { signedIn: false, firebaseReported: true, hadSession: true, restoreDeadlinePassed: false },
      // Persistence read completes; the real user arrives.
      { signedIn: true, firebaseReported: true, hadSession: true, restoreDeadlinePassed: false },
    ];

    const wouldShowSignIn = timeline.map((s) => isAuthKnown(s) && !s.signedIn);

    expect(wouldShowSignIn).toEqual([false, false, false, false]);
  });
});
