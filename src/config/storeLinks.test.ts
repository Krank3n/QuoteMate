import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANDROID_PACKAGE,
  APPLE_APP_ID,
  APP_STORE_URL,
  IOS_BUNDLE_ID,
  PLAY_STORE_URL,
  storeUrlForPlatform,
} from './storeLinks';

const repoRoot = resolve(__dirname, '../..');
const appConfig = readFileSync(resolve(repoRoot, 'app.config.js'), 'utf8');

describe('store identifiers', () => {
  it('pins the App Store id that actually resolves', () => {
    // The dead ids that were live in the codebase: 6740091464 (AppUpdateSheet,
    // sent updating iOS users to a 404) and 6738030590 (a join page).
    expect(APPLE_APP_ID).toBe('6754000046');
    expect(APPLE_APP_ID).not.toBe('6740091464');
    expect(APPLE_APP_ID).not.toBe('6738030590');
  });

  it('mirrors the native identifiers in app.config.js', () => {
    expect(appConfig).toContain(`bundleIdentifier: "${IOS_BUNDLE_ID}"`);
    expect(appConfig).toContain(`package: "${ANDROID_PACKAGE}"`);
  });

  it('builds well-formed store URLs', () => {
    expect(APP_STORE_URL).toBe('https://apps.apple.com/au/app/quotemate/id6754000046');
    expect(PLAY_STORE_URL).toBe('https://play.google.com/store/apps/details?id=com.quotemate.app');
  });

  it('resolves per platform', () => {
    expect(storeUrlForPlatform('ios')).toBe(APP_STORE_URL);
    expect(storeUrlForPlatform('android')).toBe(PLAY_STORE_URL);
    expect(storeUrlForPlatform('web')).toBe('https://quotemateapp.au');
  });
});

describe('no stale App Store ids remain in shipped source', () => {
  it('does not build store URLs from the dead ids anywhere in src/', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const DEAD_IDS = ['id6740091464', 'id6738030590'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        // This spec names the dead ids deliberately — it IS the guard.
        if (entry === 'storeLinks.test.ts') continue;
        const body = readFileSync(full, 'utf8');
        if (DEAD_IDS.some((id) => body.includes(`apps.apple.com`) && body.includes(id))) {
          offenders.push(full.replace(repoRoot, ''));
        }
      }
    };
    walk(resolve(repoRoot, 'src'));

    expect(offenders).toEqual([]);
  });
});
