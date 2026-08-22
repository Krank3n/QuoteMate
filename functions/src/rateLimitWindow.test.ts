// The sliding-window decision behind checkRateLimit. These pin the exact
// prune/deny/append behaviour the Firestore transaction relies on.

import { describe, it, expect } from 'vitest';
import { decideRateLimitWindow } from './rateLimitWindow';

const CFG = { maxRequests: 3, windowMs: 60_000 };

describe('decideRateLimitWindow', () => {
  it('prunes timestamps outside the window', () => {
    const now = 100_000;
    // Window is (now - windowMs, now]: 40_000 sits exactly on the boundary
    // and must be pruned (the filter is strict >), 30_000 is long gone.
    const decision = decideRateLimitWindow([30_000, 40_000, 50_000, 90_000], now, CFG);
    expect(decision.allowed).toBe(true);
    expect(decision.timestamps).toEqual([50_000, 90_000, now]);
  });

  it('denies at maxRequests within window', () => {
    const now = 100_000;
    const decision = decideRateLimitWindow([70_000, 80_000, 90_000], now, CFG);
    expect(decision.allowed).toBe(false);
    // Pruned only — now is NOT appended on deny, so a hammering client
    // can't extend its own lockout.
    expect(decision.timestamps).toEqual([70_000, 80_000, 90_000]);
  });

  it('allows again once the oldest timestamp ages out', () => {
    const stamps = [70_000, 80_000, 90_000];
    expect(decideRateLimitWindow(stamps, 100_000, CFG).allowed).toBe(false);
    // 70_000 falls out of the window at 130_001.
    const later = decideRateLimitWindow(stamps, 130_001, CFG);
    expect(later.allowed).toBe(true);
    expect(later.timestamps).toEqual([80_000, 90_000, 130_001]);
  });

  it('appends now on allow', () => {
    const empty = decideRateLimitWindow(undefined, 5_000, CFG);
    expect(empty.allowed).toBe(true);
    expect(empty.timestamps).toEqual([5_000]);

    const partial = decideRateLimitWindow([4_000], 5_000, CFG);
    expect(partial.allowed).toBe(true);
    expect(partial.timestamps).toEqual([4_000, 5_000]);
  });
});
