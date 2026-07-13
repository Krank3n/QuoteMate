/**
 * Regression tests for the MainApplication.kt injection in withSquareSDK.
 *
 * Background: injecting MobilePaymentsSdk.initialize() inline in onCreate()
 * blocked the main thread during the process-start ANR window (Sentry
 * REACT-NATIVE-1). The plugin now defers init to the first main-thread idle.
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

describe('injectSquareMainApplication', () => {
  it('adds the MobilePaymentsSdk import after the package line', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);
    expect(out).toMatch(
      /^package com\.quotemate\.app\n\nimport com\.squareup\.sdk\.mobilepayments\.MobilePaymentsSdk\n/
    );
  });

  it('defers initialize to a one-shot main-thread idle handler, not inline in onCreate', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);

    const idleBlock = out.match(
      /android\.os\.Looper\.myQueue\(\)\.addIdleHandler \{\n\s*MobilePaymentsSdk\.initialize\("sq0idp-test-app-id", this\)\n\s*false\n\s*\}/
    );
    expect(idleBlock).not.toBeNull();

    // The init must not run as a direct statement of onCreate() — that put
    // the SDK bootstrap inside the cold-start ANR window.
    expect(out).not.toMatch(/super\.onCreate\(\)\n\s*MobilePaymentsSdk\.initialize/);
  });

  it('injects after super.onCreate() and keeps the rest of onCreate intact', () => {
    const out = injectSquareMainApplication(TEMPLATE, APP_ID);
    const superIdx = out.indexOf('super.onCreate()');
    const idleIdx = out.indexOf('addIdleHandler');
    const soLoaderIdx = out.indexOf('SoLoader.init');
    expect(superIdx).toBeGreaterThan(-1);
    expect(idleIdx).toBeGreaterThan(superIdx);
    expect(soLoaderIdx).toBeGreaterThan(idleIdx);
    expect(out).toContain('ApplicationLifecycleDispatcher.onApplicationCreate(this)');
  });

  it('is idempotent — re-running the transform changes nothing', () => {
    const once = injectSquareMainApplication(TEMPLATE, APP_ID);
    const twice = injectSquareMainApplication(once, APP_ID);
    expect(twice).toBe(once);
  });

  it('never registers the idle handler twice (single initialize call survives)', () => {
    const out = injectSquareMainApplication(
      injectSquareMainApplication(TEMPLATE, APP_ID),
      APP_ID
    );
    expect(out.match(/MobilePaymentsSdk\.initialize/g)).toHaveLength(1);
    expect(out.match(/addIdleHandler/g)).toHaveLength(1);
  });

  it('does not re-inject over a legacy inline initialize (marker respected)', () => {
    const legacy = TEMPLATE.replace(
      'super.onCreate()',
      `super.onCreate()\n    MobilePaymentsSdk.initialize("${APP_ID}", this)`
    );
    const out = injectSquareMainApplication(legacy, APP_ID);
    expect(out.match(/MobilePaymentsSdk\.initialize/g)).toHaveLength(1);
    expect(out).not.toContain('addIdleHandler');
  });
});
