/**
 * Regression tests for the MainApplication.kt injection in withSquareSDK.
 *
 * Background — two production incidents pull this injection in opposite
 * directions:
 *   • Sentry REACT-NATIVE-1: initialize() inline in onCreate() blocked the
 *     main thread inside the process-start ANR window.
 *   • Sentry issue #66 (7632325790): deferring initialize() to the first
 *     main-thread idle ran it AFTER MainActivity was created — Square's
 *     ActivityListener only tracks activities created after init, so
 *     `createdActivity` stayed null and the payments path threw
 *     IllegalStateException.
 *
 * The contract now: on API 29+ initialize() runs in onActivityPreCreated —
 * after process start (so background broadcast/service starts never pay the
 * init cost) but synchronously before any Activity's onCreate (so the SDK
 * never misses the first activity). Below API 29 that hook doesn't exist and
 * init runs inline in onCreate() as the lesser risk.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { injectSquareMainApplication } = require('./withSquareSDK');

const APP_ID = 'sq0idp-test-app-id';

// Trimmed copy of the Expo prebuild MainApplication.kt template — the input
// the plugin sees on a fresh `expo prebuild`.
const TEMPLATE = `package com.quotemate.app

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication

class MainApplication : Application(), ReactApplication {

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

// What the plugin injected between the ANR fix (1.46+155) and the #66 fix —
// found in already-prebuilt android/ checkouts, must be migrated on re-run.
const LEGACY_IDLE_HANDLER = `package com.quotemate.app

import com.squareup.sdk.mobilepayments.MobilePaymentsSdk
import android.app.Application
import android.content.res.Configuration

class MainApplication : Application(), ReactApplication {

  override fun onCreate() {
    super.onCreate()
    android.os.Looper.myQueue().addIdleHandler {
      MobilePaymentsSdk.initialize("${APP_ID}", this)
      false
    }
    SoLoader.init(this, OpenSourceMergedSoMapping)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

describe('injectSquareMainApplication', () => {
  it('adds the MobilePaymentsSdk import after the package line', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);
    expect(out).toMatch(
      /^package com\.quotemate\.app\n\nimport com\.squareup\.sdk\.mobilepayments\.MobilePaymentsSdk\n/
    );
  });

  it('initializes inside onActivityPreCreated so init beats the first Activity (issue #66)', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);

    // Callbacks must be registered before any Activity can exist…
    const registerIdx = out.indexOf('registerActivityLifecycleCallbacks');
    const superIdx = out.indexOf('super.onCreate()');
    expect(registerIdx).toBeGreaterThan(superIdx);

    // …and initialize() must live inside onActivityPreCreated, scoped to the
    // Application (`this@MainApplication`, not the callback object).
    const preCreated = out.match(
      /override fun onActivityPreCreated\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/
    );
    expect(preCreated).not.toBeNull();
    expect(preCreated![1]).toContain(
      `MobilePaymentsSdk.initialize("${APP_ID}", this@MainApplication)`
    );
    // One-shot: unregister before init so a second activity can't re-init.
    expect(preCreated![1].indexOf('unregisterActivityLifecycleCallbacks')).toBeLessThan(
      preCreated![1].indexOf('MobilePaymentsSdk.initialize')
    );
  });

  it('falls back to inline init below API 29, where onActivityPreCreated does not exist', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);
    const guarded = out.match(
      /if \(android\.os\.Build\.VERSION\.SDK_INT >= 29\) \{[\s\S]*?\} else \{\s*\n\s*MobilePaymentsSdk\.initialize\("sq0idp-test-app-id", this\)\s*\n\s*\}/
    );
    expect(guarded).not.toBeNull();
  });

  it('never defers init to an idle handler — that ran after Activity creation (issue #66)', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);
    expect(out).not.toContain('addIdleHandler');
  });

  it('migrates the legacy idle-handler injection from an already-prebuilt checkout', () => {
    const out = injectSquareMainApplication(LEGACY_IDLE_HANDLER, APP_ID);
    expect(out).not.toContain('addIdleHandler');
    expect(out).toContain('onActivityPreCreated');
    expect(out.match(/MobilePaymentsSdk\.initialize/g)).toHaveLength(2); // pre-created + <29 fallback

    // Convergence: a migrated legacy checkout must end up byte-identical to a
    // fresh injection — the transform's output can't depend on prior state.
    const legacyTemplate = LEGACY_IDLE_HANDLER.replace(
      /\n    android\.os\.Looper\.myQueue\(\)\.addIdleHandler \{\n      MobilePaymentsSdk\.initialize\([^)]*\)\n      false\n    \}/,
      ''
    ).replace(/import com\.squareup\.sdk\.mobilepayments\.MobilePaymentsSdk\n/, '');
    expect(out).toBe(
      injectSquareMainApplication(
        injectSquareMainApplication(legacyTemplate, APP_ID),
        APP_ID
      )
    );

    // Migration is idempotent too.
    expect(injectSquareMainApplication(out, APP_ID)).toBe(out);
  });

  it('injects after super.onCreate() and keeps the rest of onCreate intact', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);
    const superIdx = out.indexOf('super.onCreate()');
    const initIdx = out.indexOf('onActivityPreCreated');
    const soLoaderIdx = out.indexOf('SoLoader.init');
    expect(superIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(superIdx);
    expect(soLoaderIdx).toBeGreaterThan(initIdx);
    expect(out).toContain('ApplicationLifecycleDispatcher.onApplicationCreate(this)');
  });

  it('is idempotent — re-running the transform changes nothing', () => {
    const once = injectSquareMainApplication(TEMPLATE, APP_ID);
    const twice = injectSquareMainApplication(once, APP_ID);
    expect(twice).toBe(once);
  });

  it('does not re-inject over a legacy inline initialize (marker respected)', () => {
    const legacy = TEMPLATE.replace(
      'super.onCreate()',
      `super.onCreate()\n    MobilePaymentsSdk.initialize("${APP_ID}", this)`
    );
    const out = injectSquareMainApplication(legacy, APP_ID);
    expect(out.match(/MobilePaymentsSdk\.initialize/g)).toHaveLength(1);
    expect(out).not.toContain('registerActivityLifecycleCallbacks');
  });
});
