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
 *
 * With one exception, learned on an emulator (5 Sep 2026): NOT inside a
 * react-native <Modal>. A Modal is its own Dialog window. React Native sets
 * SOFT_INPUT_ADJUST_RESIZE on it unconditionally, and the keyboard provider
 * listens to the ACTIVITY's window, not the Dialog's — so a controller
 * KeyboardAvoidingView in there is driven by a window it isn't in. On the send
 * modal it left the content squeezed into the top half of the screen with a
 * dead black band below it: the padding went on when the keyboard opened and
 * never came off. Modals use hooks/useKeyboardHeight instead, which reads
 * react-native's own Keyboard events — those do fire inside a Modal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // Tests are skipped the way the other guards in this repo skip them: a
    // fixture is allowed to render whatever it needs to.
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

/** A react-native import block that pulls in KeyboardAvoidingView. */
const RN_KAV_IMPORT = /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*['"]react-native['"]/s;

/**
 * A react-native <Modal> — its own window. Matches `Modal` or `Modal as
 * RNModal` in a react-native import block. Paper's Modal comes from
 * 'react-native-paper' and is a different thing entirely.
 */
const RN_MODAL_IMPORT = /import\s*\{[^}]*\bModal\b(?:\s+as\s+\w+)?[^}]*\}\s*from\s*['"]react-native['"]/s;

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

  it('no react-native <Modal> wraps its content in a KeyboardAvoidingView', () => {
    // Only react-native's Modal is a separate window. A react-native-paper
    // <Modal> renders through <Portal> into the app's own tree — same window,
    // so the provider reaches it and a KeyboardAvoidingView is correct there.
    // Telling them apart matters: banning both would forbid the right fix on
    // half these files.
    const offenders = sources
      .filter((f) => RN_MODAL_IMPORT.test(f.text) && /<KeyboardAvoidingView/.test(f.text))
      .map((f) => f.path);
    expect(offenders, 'a react-native Modal must use useKeyboardHeight instead').toEqual([]);
  });

  it('the modals that used to disable Android avoidance now read the keyboard themselves', () => {
    for (const path of [
      'components/DocumentEmailPreviewModal.tsx',
      'components/InvoiceReviewModal.tsx',
      'components/SpreadsheetColumnMapperModal.tsx',
      'components/SupplierListReviewModal.tsx',
    ]) {
      const file = sources.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(file!.text, path).toMatch(/keyboardHeight|useKeyboardHeight/);
    }
  });

  it('the patterns it bans are the ones that actually shipped', () => {
    expect(RN_KAV_IMPORT.test("import { View, KeyboardAvoidingView, Platform } from 'react-native';")).toBe(true);
    expect(RN_KAV_IMPORT.test("import { KeyboardAvoidingView } from 'react-native-keyboard-controller';")).toBe(false);
    expect(IOS_ONLY_BEHAVIOR.test("behavior={Platform.OS === 'ios' ? 'padding' : undefined}")).toBe(true);
    expect(IOS_ONLY_BEHAVIOR.test('behavior="padding"')).toBe(false);
  });
});

/**
 * The gap this guard originally missed.
 *
 * The first pass banned the OLD spelling — `behavior={ios ? 'padding' :
 * undefined}` — on the assumption that a surface with no wrapper at all was
 * fine. It was not. A screen without a KeyboardAvoidingView also used to work,
 * for exactly the same reason: adjustResize shrank the window and its
 * ScrollView followed. Edge-to-edge broke those too, and they carry no
 * tell-tale for a regex to find.
 *
 * Proven on an emulator (6 Sep 2026): Settings -> Business Details -> Brand
 * Colour, tap the Hex field. The keyboard docks, the page does not move a
 * pixel, and the field being typed into is behind it.
 *
 * So: any top-level surface with a text input needs a handler, and new ones
 * have to say why if they don't.
 */
describe('every surface with a text input handles the keyboard', () => {
  /** Anything that lifts content clear of the keyboard, by any mechanism. */
  const HANDLED =
    /KeyboardAvoidingView|useKeyboardHeight|KeyboardAwareScrollView|KeyboardStickyView|keyboardHeight|Keyboard\.addListener|keyboardOffset/;

  /**
   * Surfaces that need no handler of their own, with the reason. A new entry
   * here should be a fact about the layout, not a shrug.
   */
  const EXEMPT: Record<string, string> = {
    'screens/DiscoverSuppliersScreen.tsx':
      'the only input is a search bar pinned above the list, which the keyboard opens below',
    'screens/NewQuote/AddMaterial/ManualEntrySection.tsx':
      'not a surface — a form rendered by AddMaterialScreen, both inside its BottomSheet and in the screen body, and both of those handle the keyboard',
  };

  /** Renders inside <BottomSheet>, which translates itself by the keyboard height. */
  const INSIDE_SAFE_PARENT = /<BottomSheet\b/;

  it('no screen or modal has an unhandled text input', () => {
    const offenders = sources
      .filter((f) => /TextInput/.test(f.text))
      .filter((f) => !HANDLED.test(f.text))
      .filter((f) => !INSIDE_SAFE_PARENT.test(f.text))
      .filter((f) => f.path.startsWith('screens/') || /<(RN)?Modal\b/.test(f.text))
      .filter((f) => !(f.path in EXEMPT))
      .map((f) => f.path);
    expect(offenders, 'add a handler, or an EXEMPT entry saying why none is needed').toEqual([]);
  });

  it('every exemption names a real file, so the list cannot rot', () => {
    for (const path of Object.keys(EXEMPT)) {
      expect(sources.some((f) => f.path === path), path).toBe(true);
    }
  });

  it('the settings screens that were proven broken on device now handle it', () => {
    for (const name of [
      'BusinessProfile', 'BusinessDefaults', 'AccountSettings', 'PaymentMethods',
      'JobTemplateEditor', 'EditSupplier', 'Feedback', 'CallKatie',
    ]) {
      const file = sources.find((f) => f.path === `screens/settings/${name}Screen.tsx`);
      expect(file, name).toBeDefined();
      expect(HANDLED.test(file!.text), name).toBe(true);
    }
  });

  it('the three surfaces called out by name are covered', () => {
    for (const path of [
      'screens/NewQuote/MaterialsListScreen.tsx',  // materials list
      'components/DocumentEmailPreviewModal.tsx',  // send screen
      'screens/AssistantScreen.tsx',               // Mate
    ]) {
      const file = sources.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(HANDLED.test(file!.text), path).toBe(true);
    }
  });
});
