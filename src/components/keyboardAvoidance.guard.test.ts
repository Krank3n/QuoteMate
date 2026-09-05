/**
 * The Android keyboard covers the screen, silently, app-wide.
 *
 * React Native's own KeyboardAvoidingView only ever did anything on Android
 * because the WINDOW shrank underneath it: `android:windowSoftInputMode`
 * is "adjustResize", the layout got smaller, and the content moved up on its
 * own. So `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` was the
 * documented, correct spelling, and it is all over this codebase.
 *
 * Two changes ended that and neither one touched these files:
 *   - edge-to-edge (targetSdk 35+, `edgeToEdgeEnabled` in app.config.js). The
 *     window now extends under the system bars and is NOT resized for the IME.
 *   - the app-wide KeyboardProvider, which takes over insets besides.
 *
 * With the resize gone, `behavior: undefined` means exactly what it says: do
 * nothing. The keyboard sits on top of the text field it was opened by. There
 * is no error and nothing to see on iOS, which is how this reached sign-in,
 * onboarding and the send modal at once.
 *
 * react-native-keyboard-controller's KeyboardAvoidingView is driven by the same
 * provider and takes `padding` on both platforms, so these two patterns are
 * banned outright rather than fixed one screen at a time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const SELF = basename(__filename);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && entry !== SELF) out.push(full);
  }
  return out;
}

const sources = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

/** A react-native import block that pulls in KeyboardAvoidingView. */
const RN_KAV_IMPORT = /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*['"]react-native['"]/s;

/** The Android no-op: padding on iOS, nothing on Android. */
const IOS_ONLY_BEHAVIOR = /behavior=\{\s*Platform\.OS\s*===\s*['"]ios['"]\s*\?\s*['"](?:padding|height|position)['"]\s*:\s*undefined\s*\}/;

describe('Android keyboard avoidance', () => {
  it('finds the source files to check', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('no screen imports KeyboardAvoidingView from react-native', () => {
    const offenders = sources.filter((f) => RN_KAV_IMPORT.test(f.text)).map((f) => f.path);
    expect(offenders, 'import from react-native-keyboard-controller instead').toEqual([]);
  });

  it('no screen disables keyboard avoidance on Android', () => {
    const offenders = sources.filter((f) => IOS_ONLY_BEHAVIOR.test(f.text)).map((f) => f.path);
    expect(offenders, 'use behavior="padding" — Android no longer resizes the window').toEqual([]);
  });

  it('every KeyboardAvoidingView in the app comes from the controller', () => {
    const users = sources.filter((f) => /<KeyboardAvoidingView/.test(f.text));
    expect(users.length).toBeGreaterThan(0);
    for (const f of users) {
      expect(f.text, f.path).toMatch(/from ['"]react-native-keyboard-controller['"]/);
    }
  });

  it('the patterns it bans are the ones that actually shipped', () => {
    expect(RN_KAV_IMPORT.test("import { View, KeyboardAvoidingView, Platform } from 'react-native';")).toBe(true);
    expect(RN_KAV_IMPORT.test("import { KeyboardAvoidingView } from 'react-native-keyboard-controller';")).toBe(false);
    expect(IOS_ONLY_BEHAVIOR.test("behavior={Platform.OS === 'ios' ? 'padding' : undefined}")).toBe(true);
    expect(IOS_ONLY_BEHAVIOR.test('behavior="padding"')).toBe(false);
  });
});
