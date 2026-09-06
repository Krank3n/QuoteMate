/**
 * Is the launch splash covering the app right now?
 *
 * Screens mount underneath the splash overlay, not after it — that is the whole
 * point of the overlay (see SplashOverlay), and it is why signing in doesn't
 * rebuild the React tree. The side effect is that a screen's mount effects run
 * while the user can't see the screen, and anything user-visible they trigger
 * happens over the top of the logo.
 *
 * Symptom that produced this module: NewOnboardingScreen's first field carried
 * `autoFocus`, so on an Android cold start the keyboard slid up while the
 * splash was still on screen — an app that looks like it is typing to itself,
 * measured on an API 36 emulator, 6 Sep 2026.
 *
 * Same shape as stickyFooterPresence: module state plus a subscription, so the
 * publisher (SplashOverlay) and the readers stay decoupled and neither has to
 * know a route name.
 *
 * Defaults to `true` — assume covered until SplashOverlay says otherwise, so a
 * screen that mounts before the overlay's first effect doesn't get a wrong
 * "clear" and fire anyway.
 */

let covering = true;
const listeners = new Set<() => void>();

/** SplashOverlay publishes its own visibility here. Nothing else should call this. */
export function setSplashCovering(next: boolean): void {
  if (covering === next) return;
  covering = next;
  listeners.forEach((l) => l());
}

export function isSplashCovering(): boolean {
  return covering;
}

export function subscribeSplash(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resolves once the splash is off the screen — immediately if it already is.
 *
 * For mount-time work that the user is meant to SEE happen: focusing a field,
 * opening the keyboard, playing an animation. Not for data loading, which
 * should absolutely run behind the splash.
 */
export function whenSplashClear(): Promise<void> {
  if (!covering) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeSplash(() => {
      if (covering) return;
      unsubscribe();
      resolve();
    });
  });
}

/** Test seam — module state would otherwise leak between cases. */
export function __resetSplashPresence(): void {
  covering = true;
  listeners.clear();
}
