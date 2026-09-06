/**
 * The last of the four Android cold-start flashes.
 *
 * Firebase delivers the restored user and then, about a second later, a second
 * `null` with `auth.currentUser` also null (measured on an API 36 emulator,
 * 6 Sep 2026). App.tsx treated that as a sign-out, ran the whole teardown
 * branch and dropped the app to the sign-in screen for ~1.1s before the user
 * reappeared. It survived every fix aimed at the launch gate, because it lands
 * AFTER the session has already been restored.
 *
 * The flag is how the app says a null is real.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  markSignOutIntent,
  consumeSignOutIntent,
  __resetSignOutIntent,
} from './authIntent';

beforeEach(() => {
  __resetSignOutIntent();
});

describe('authIntent', () => {
  it('reports no intent by default — an unasked-for null is not a sign-out', () => {
    expect(consumeSignOutIntent()).toBe(false);
  });

  it('reports intent after the sign-out call site marks it', () => {
    markSignOutIntent();
    expect(consumeSignOutIntent()).toBe(true);
  });

  it('REGRESSION: a later spurious null cannot reuse an earlier sign-out', () => {
    // Reading clears. Without that, one sign-out would arm every subsequent
    // token-refresh null in the process for the rest of the session.
    markSignOutIntent();
    expect(consumeSignOutIntent()).toBe(true);
    expect(consumeSignOutIntent()).toBe(false);
  });

  it('is idempotent when marked twice before being read', () => {
    markSignOutIntent();
    markSignOutIntent();
    expect(consumeSignOutIntent()).toBe(true);
    expect(consumeSignOutIntent()).toBe(false);
  });

  it('re-arms for a second, genuine sign-out later in the same process', () => {
    markSignOutIntent();
    consumeSignOutIntent();

    markSignOutIntent();
    expect(consumeSignOutIntent()).toBe(true);
  });

  /**
   * The listener's rule, stated as the sequence that produced the bug.
   * `handled` = "App.tsx acts on this event rather than ignoring it".
   */
  it('ignores the mid-launch null but still acts on a real sign-out', () => {
    let sawUser = false;
    const handle = (user: boolean) => {
      if (!user && sawUser && !consumeSignOutIntent()) return false;
      if (user) sawUser = true;
      return true;
    };

    // Cold start: premature null (nothing seen yet), then the restored user,
    // then Firebase's spurious second null.
    expect(handle(false)).toBe(true); // nothing seen yet — falls through, harmless
    expect(handle(true)).toBe(true); // the real user
    expect(handle(false)).toBe(false); // the flash. Ignored.
    expect(handle(true)).toBe(true); // user re-delivered

    // The tradie taps Sign Out.
    markSignOutIntent();
    expect(handle(false)).toBe(true);
  });
});
