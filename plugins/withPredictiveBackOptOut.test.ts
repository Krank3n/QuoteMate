/**
 * Android 16 + targetSdk 36 enables predictive-back dispatch by default, which
 * stops Activity.onBackPressed being called. React Native 0.79's BackHandler is
 * fed from onBackPressed, so without this opt-out every back press finishes the
 * activity — the app exits from any screen (reproduced on an API 36 emulator
 * with the 1.56 release build). Prebuild regenerates the manifest, so the
 * attribute has to come from a plugin, and this pins what the plugin writes.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  disablePredictiveBack,
  ENABLE_ON_BACK_INVOKED_CALLBACK,
} = require('./withPredictiveBackOptOut');

const manifest = (applicationAttrs: Record<string, string> = {}) => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    'uses-permission': [{ $: { 'android:name': 'android.permission.RECORD_AUDIO' } }],
    application: [
      {
        $: {
          'android:name': '.MainApplication',
          'android:allowBackup': 'true',
          'android:theme': '@style/AppTheme',
          ...applicationAttrs,
        },
        activity: [{ $: { 'android:name': '.MainActivity' } }],
      },
    ],
  },
});

const application = (m: any) => m.manifest.application[0];

describe('disablePredictiveBack', () => {
  it('sets android:enableOnBackInvokedCallback="false" on <application>', () => {
    const out = disablePredictiveBack(manifest());
    expect(application(out).$[ENABLE_ON_BACK_INVOKED_CALLBACK]).toBe('false');
  });

  it('overrides an existing "true" — a template default or another plugin turning it on', () => {
    const out = disablePredictiveBack(manifest({ [ENABLE_ON_BACK_INVOKED_CALLBACK]: 'true' }));
    expect(application(out).$[ENABLE_ON_BACK_INVOKED_CALLBACK]).toBe('false');
  });

  it('keeps every other application attribute and child intact', () => {
    const out = disablePredictiveBack(manifest());
    expect(application(out).$['android:name']).toBe('.MainApplication');
    expect(application(out).$['android:allowBackup']).toBe('true');
    expect(application(out).$['android:theme']).toBe('@style/AppTheme');
    expect(application(out).activity[0].$['android:name']).toBe('.MainActivity');
    expect(out.manifest['uses-permission']).toHaveLength(1);
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = disablePredictiveBack(manifest());
    const twice = disablePredictiveBack(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('leaves a manifest with no <application> untouched rather than throwing', () => {
    const bare = { manifest: { $: {} } };
    expect(disablePredictiveBack(bare)).toEqual({ manifest: { $: {} } });
  });
});
