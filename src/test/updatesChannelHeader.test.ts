/**
 * Guard: the app config carries the EAS Update channel header.
 *
 * u.expo.dev answers 400 to a manifest request without `expo-channel-name`.
 * `eas build` writes the header into the native project itself, but the
 * Android release here is `./gradlew bundleRelease` on the prebuilt tree, so
 * the only source is `updates.requestHeaders` in app.config.js — and without
 * it the shipped Android builds never picked up a single OTA (3 Sep 2026,
 * release 1.56/170 on the API 36 emulator: "Remote update request not
 * successful").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('EAS Update channel header', () => {
  it('app.config.js sends expo-channel-name: production with every update request', () => {
    const source = readFileSync(resolve(__dirname, '../../app.config.js'), 'utf8');
    expect(source).toMatch(/updates:\s*\{[\s\S]*?requestHeaders:\s*\{\s*"expo-channel-name":\s*"production"\s*\}/);
  });
});
