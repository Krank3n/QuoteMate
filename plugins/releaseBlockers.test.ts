/**
 * Guards for the two config-level mistakes that each blocked a store release on
 * 2 Sep 2026. Both were silent in tests, tsc and lint — they only surfaced at
 * the very end of a ~40 minute build, at upload or export time.
 *
 *   • Android: Play has required targetSdk 36 since 31 Aug 2026. An API 35
 *     artifact is refused with "Target SDK of artifact is too low: 170" — where
 *     170 is the versionCode, not an SDK level, so the message misdirects.
 *
 *   • iOS: commit 10a2b26 re-enabled the Tap to Pay entitlement, which Apple has
 *     granted for DEVELOPMENT distribution only. No App Store profile carries it,
 *     so `xcodebuild -exportArchive` fails and the whole iOS release is blocked —
 *     not just Tap to Pay. Entitlements bake in at archive time, so it cannot be
 *     stripped at export; the archive has to be rebuilt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Android target SDK (Play upload requirement)', () => {
  // Read rather than import: app.config.js pulls in dotenv and the whole plugin
  // list, none of which this assertion needs.
  const source = readFileSync(join(__dirname, '..', 'app.config.js'), 'utf8');

  const numeric = (key: string): number => {
    const m = source.match(new RegExp(`${key}:\\s*(\\d+)`));
    if (!m) throw new Error(`${key} not found in app.config.js`);
    return Number(m[1]);
  };

  it('targets API 36 or higher, which Play has required since 31 Aug 2026', () => {
    expect(numeric('targetSdkVersion')).toBeGreaterThanOrEqual(36);
  });

  it('compiles against at least the target, or the build cannot see the APIs', () => {
    expect(numeric('compileSdkVersion')).toBeGreaterThanOrEqual(numeric('targetSdkVersion'));
  });

  it('declares edgeToEdgeEnabled, because targetSdk 36 ignores the opt-out', () => {
    // Leaving this unset does NOT keep the old look — Android 16 enforces
    // edge-to-edge regardless and Expo emits an opt-out the OS discards, so the
    // app draws under the system bars with no theme behind them.
    expect(source).toMatch(/edgeToEdgeEnabled:\s*true/);
  });
});

describe('iOS Tap to Pay entitlement (App Store export blocker)', () => {
  const source = readFileSync(join(__dirname, 'withSquareSDK.js'), 'utf8');

  it('defines the entitlement mod but does not apply it', () => {
    expect(source).toContain('function withSquareIOSTapToPayEntitlement');

    const applied = source
      .split('\n')
      .filter((line) => line.includes('withSquareIOSTapToPayEntitlement(config)'))
      .filter((line) => !line.trimStart().startsWith('//'))
      .filter((line) => !line.includes('function '));

    expect(applied).toEqual([]);
  });

  it('still records why, so re-enabling is a decision and not an accident', () => {
    expect(source).toMatch(/publishing entitlement/i);
  });
});
