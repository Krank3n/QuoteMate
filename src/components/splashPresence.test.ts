/**
 * The splash covers screens that are already mounted underneath it, so a
 * screen's mount effects fire while nobody can see the screen. Anything
 * user-visible they trigger then happens over the top of the logo —
 * NewOnboardingScreen's `autoFocus` opened the keyboard mid-splash on every
 * Android cold start (API 36 emulator, 6 Sep 2026).
 *
 * This module is how a screen asks "can they see me yet?".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  isSplashCovering,
  setSplashCovering,
  subscribeSplash,
  whenSplashClear,
  __resetSplashPresence,
} from './splashPresence';

beforeEach(() => {
  __resetSplashPresence();
});

describe('splashPresence', () => {
  it('assumes the splash is covering before anyone has said otherwise', () => {
    // The safe default: a screen mounting before SplashOverlay's first effect
    // must not get a wrong "clear" and pop the keyboard anyway.
    expect(isSplashCovering()).toBe(true);
  });

  it('tracks what SplashOverlay publishes', () => {
    setSplashCovering(false);
    expect(isSplashCovering()).toBe(false);

    setSplashCovering(true);
    expect(isSplashCovering()).toBe(true);
  });

  it('notifies subscribers when the splash clears', () => {
    const listener = vi.fn();
    subscribeSplash(listener);

    setSplashCovering(false);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify on a no-op re-publish of the same value', () => {
    // SplashOverlay's effect re-runs on every `visible` change, and App
    // re-renders often during launch. A wake-up per render would be noise.
    setSplashCovering(false);
    const listener = vi.fn();
    subscribeSplash(listener);

    setSplashCovering(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSplash(listener);
    unsubscribe();

    setSplashCovering(false);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('whenSplashClear', () => {
  it('resolves immediately when the splash is already gone', async () => {
    setSplashCovering(false);

    await expect(whenSplashClear()).resolves.toBeUndefined();
  });

  it('waits while the splash is up, then resolves when it lifts', async () => {
    let resolved = false;
    const pending = whenSplashClear().then(() => {
      resolved = true;
    });

    // Still covered — a focus() here would open the keyboard over the logo.
    await Promise.resolve();
    expect(resolved).toBe(false);

    setSplashCovering(false);
    await pending;
    expect(resolved).toBe(true);
  });

  it('does not resolve on a splash that goes up rather than down', async () => {
    let resolved = false;
    void whenSplashClear().then(() => {
      resolved = true;
    });

    setSplashCovering(true); // no-op, already covering
    await Promise.resolve();

    expect(resolved).toBe(false);
  });

  it('releases its subscription once resolved, so waiters do not accumulate', async () => {
    const pending = whenSplashClear();
    setSplashCovering(false);
    await pending;

    // A later cover/uncover cycle must not try to resolve it again.
    expect(() => {
      setSplashCovering(true);
      setSplashCovering(false);
    }).not.toThrow();
  });

  it('resolves every waiter, not just the first', async () => {
    const results: number[] = [];
    const all = Promise.all([
      whenSplashClear().then(() => results.push(1)),
      whenSplashClear().then(() => results.push(2)),
    ]);

    setSplashCovering(false);
    await all;

    expect(results).toHaveLength(2);
  });
});
