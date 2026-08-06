import { describe, it, expect } from 'vitest';
import {
  raceTimeout,
  failedLoaderNames,
  BOOTSTRAP_TIMEOUT_MS,
  SPLASH_MAX_MS,
  type LoaderName,
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
