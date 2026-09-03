/**
 * Guard: app source never does `await import('react-native')`.
 *
 * Metro's interop for a dynamic import enumerates every lazy getter on the
 * react-native index. The deprecated PushNotificationIOS getter throws
 * "`new NativeEventEmitter()` requires a non-null argument", so the import
 * itself rejects — on the device, never in vitest (jsdom resolves the
 * mocked module fine). It took `propose_pick_contact` down on iOS while
 * every store test was green (3 Sep 2026). Import from 'react-native'
 * statically; test files may still lazy-import it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCAN_DIRS = ['src', 'shared'];

// `import('react-native')` and `import("react-native")`, whole module or a
// sub-path — sub-paths hit the same interop.
const DYNAMIC_RN_IMPORT = /\bimport\(\s*['"]react-native(?:\/[^'"]*)?['"]\s*\)/;

function isTestFile(path: string): boolean {
  return (
    /\.test\.tsx?$/.test(path) ||
    path.includes('/__tests__/') ||
    path.includes('/src/test/')
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !isTestFile(full)) out.push(full);
  }
  return out;
}

describe('no dynamic import of react-native in app source', () => {
  it('the matcher catches the line that broke the contact picker', () => {
    expect(DYNAMIC_RN_IMPORT.test("const { Platform } = await import('react-native');")).toBe(true);
    expect(DYNAMIC_RN_IMPORT.test('import { Platform } from "react-native";')).toBe(false);
    expect(DYNAMIC_RN_IMPORT.test("await import('expo-contacts')")).toBe(false);
  });

  it('src/ and shared/ import react-native statically', () => {
    const offending: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(resolve(ROOT, dir))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((raw, i) => {
          const line = raw.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (DYNAMIC_RN_IMPORT.test(line)) {
            offending.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${raw.trim()}`);
          }
        });
      }
    }
    expect(
      offending,
      `Dynamic import('react-native') rejects on the device (Metro interop ` +
        `touches the throwing PushNotificationIOS getter). Import statically.\n` +
        offending.join('\n'),
    ).toEqual([]);
  });
});
