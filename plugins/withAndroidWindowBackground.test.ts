/**
 * The Android cold start flashed a full-screen white (light mode) or Material
 * dark grey (dark mode) frame between the navy native splash and React's first
 * frame — 0.8s on an API 36 emulator with the 1.56 release build. Cause:
 * MainActivity swaps from Theme.App.SplashScreen to AppTheme in onCreate, and
 * AppTheme declares no windowBackground, so the window falls through to
 * ?android:colorBackground. Prebuild regenerates styles.xml, so the item has to
 * come from a plugin, and this pins what the plugin writes.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  setAppThemeWindowBackground,
  WINDOW_BACKGROUND,
  SPLASH_COLOR_REF,
} = require('./withAndroidWindowBackground');

/** Shape Expo hands a withAndroidStyles mod — the generated styles.xml. */
const styles = (appThemeItems: Array<{ $: { name: string }; _: string }> = []) => ({
  resources: {
    style: [
      {
        $: { name: 'AppTheme', parent: 'Theme.EdgeToEdge' },
        item: [
          { $: { name: 'android:editTextBackground' }, _: '@drawable/rn_edit_text_material' },
          { $: { name: 'colorPrimary' }, _: '@color/colorPrimary' },
          ...appThemeItems,
        ],
      },
      {
        $: { name: 'Theme.App.SplashScreen', parent: 'AppTheme' },
        item: [{ $: { name: 'android:windowBackground' }, _: '@drawable/ic_launcher_background' }],
      },
    ],
  },
});

const group = (out: any, name: string) =>
  out.resources.style.find((s: any) => s.$.name === name);

const itemValue = (out: any, styleName: string, itemName: string) =>
  group(out, styleName)?.item.find((i: any) => i.$.name === itemName)?._;

describe('setAppThemeWindowBackground', () => {
  it('adds android:windowBackground to AppTheme so the post-splash window is navy', () => {
    const out = setAppThemeWindowBackground(styles());
    expect(itemValue(out, 'AppTheme', WINDOW_BACKGROUND)).toBe(SPLASH_COLOR_REF);
  });

  it('points at the same colour as the splash drawable, not a literal', () => {
    // splashscreen_background is #1E293B in colors.xml, matching the iOS
    // colorset and SplashOverlay. A literal here would drift from those.
    expect(SPLASH_COLOR_REF).toBe('@color/splashscreen_background');
  });

  it('overrides an inherited windowBackground already present on AppTheme', () => {
    const out = setAppThemeWindowBackground(
      styles([{ $: { name: WINDOW_BACKGROUND }, _: '@android:color/white' }]),
    );
    const items = group(out, 'AppTheme').item.filter(
      (i: any) => i.$.name === WINDOW_BACKGROUND,
    );
    expect(items).toHaveLength(1);
    expect(items[0]._).toBe(SPLASH_COLOR_REF);
  });

  it('keeps AppTheme’s other items intact', () => {
    const out = setAppThemeWindowBackground(styles());
    expect(itemValue(out, 'AppTheme', 'colorPrimary')).toBe('@color/colorPrimary');
    expect(itemValue(out, 'AppTheme', 'android:editTextBackground')).toBe(
      '@drawable/rn_edit_text_material',
    );
  });

  it('leaves the splash theme alone — its drawable is still what launches', () => {
    const out = setAppThemeWindowBackground(styles());
    expect(itemValue(out, 'Theme.App.SplashScreen', 'android:windowBackground')).toBe(
      '@drawable/ic_launcher_background',
    );
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = setAppThemeWindowBackground(styles());
    const twice = setAppThemeWindowBackground(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});
