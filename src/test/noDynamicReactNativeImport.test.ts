/**
 * Guard: app source never does `await import('react-native')`.
 *
 * Metro's interop for a dynamic import enumerates every lazy getter on the
 * react-native index; the deprecated PushNotificationIOS getter throws
 * "`new NativeEventEmitter()` requires a non-null argument", so the import
 * itself rejects — on the device, never in vitest, where the mocked module
 * resolves fine. That took `propose_pick_contact` down on iOS while every
 * store test was green (3 Sep 2026). Import from 'react-native' statically;
 * test files may still lazy-import it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');
// Everything Metro bundles: the root component, app source, shared/, and
// the local Expo modules' JS wrappers.
const SCAN = ['App.tsx', 'src', 'shared', 'modules'];

// `import('react-native')` / `import("react-native")`, whole module or a
// sub-path — a sub-path goes through the same interop.
const DYNAMIC_RN_IMPORT = /\bimport\(\s*['"]react-native(?:\/[^'"]*)?['"]\s*\)/;
// Type positions are erased at compile time and never reach the interop:
// `typeof import('x')` and `import('x').SomeType` (but not `.then(...)`).
const TYPE_POSITION = /typeof\s+import\(\s*['"][^'"]+['"]\s*\)|import\(\s*['"][^'"]+['"]\s*\)\s*\.(?!then\b|catch\b|finally\b)[A-Za-z_$]/g;

function sources(entry: string): string[] {
  const full = resolve(ROOT, entry);
  if (statSync(full).isFile()) return [entry];
  return readdirSync(full, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !rel.includes('node_modules'))
    .map((rel) => join(entry, rel));
}

describe('no dynamic import of react-native in app source', () => {
  it('bundled source imports react-native statically', () => {
    expect(DYNAMIC_RN_IMPORT.test("await import('react-native')")).toBe(true);
    expect("let s: import('react-native').ViewStyle;".replace(TYPE_POSITION, '')).not.toMatch(DYNAMIC_RN_IMPORT);

    const files = SCAN.flatMap(sources);
    expect(files.length).toBeGreaterThan(100);

    const offending: string[] = [];
    for (const file of files) {
      readFileSync(resolve(ROOT, file), 'utf8').split('\n').forEach((raw, i) => {
        const line = raw
          .replace(/\/\*.*?\*\//g, '') // one-line block comments
          .replace(/(^|\s)\/\/.*$/, '') // line comments, not the // in a URL
          .replace(/^\s*\*.*$/, '') // docblock bodies
          .replace(TYPE_POSITION, '');
        if (DYNAMIC_RN_IMPORT.test(line)) offending.push(`${file}:${i + 1}: ${raw.trim()}`);
      });
    }
    expect(
      offending,
      `Dynamic import('react-native') rejects on the device (Metro's interop ` +
        `touches the throwing PushNotificationIOS getter). Import it statically.\n` +
        offending.join('\n'),
    ).toEqual([]);
  });
});
