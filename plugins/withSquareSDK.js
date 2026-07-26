/**
 * withSquareSDK
 *
 * Config plugin that wires Square's Mobile Payments SDK into the prebuilt
 * native projects. Re-applies on every `expo prebuild` so the native edits
 * stay in sync with `app.config.js`.
 *
 * Pass the production Square Application ID via plugin options:
 *   ["./plugins/withSquareSDK", { applicationId: "sq0idp-..." }]
 *
 * Idempotent: every modification checks for a marker before injecting.
 *
 * iOS:
 *   • AppDelegate.swift — import + initialize SQMPMobilePaymentsSDK
 *   • Info.plist — NFC, location, camera, microphone usage strings
 *   • Xcode project — add a Run Script build phase that runs the framework's
 *     setup script after frameworks are embedded
 *
 * Android:
 *   • android/build.gradle — Square maven repo + squareSdkVersion ext prop
 *   • android/app/build.gradle — Square SDK dependency + disable Proguard
 *     for release (per Square's docs)
 *   • MainApplication.kt — initialize MobilePaymentsSdk in
 *     onActivityPreCreated (API 29+): before the first Activity so Square's
 *     ActivityListener sees it (issue #66), but off the blocking
 *     process-start path (ANR — Sentry REACT-NATIVE-1); inline on API 28
 *   • AndroidManifest.xml — NFC + location permissions
 *
 * iOS Tap to Pay entitlement (proximity-reader.payment.acceptance) is added
 * automatically — Apple approved the entitlement for this account.
 */

const {
  withAppDelegate,
  withInfoPlist,
  withXcodeProject,
  withEntitlementsPlist,
  withDangerousMod,
  withMainApplication,
  withAndroidManifest,
  AndroidConfig,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SQUARE_ANDROID_SDK_VERSION = '2.4.0';

// ─── iOS ──────────────────────────────────────────────────────────────────

function withSquareIOSAppDelegate(config, applicationId) {
  return withAppDelegate(config, (config) => {
    let src = config.modResults.contents;

    // 1. Add import
    if (!src.includes('import SquareMobilePaymentsSDK')) {
      src = src.replace(
        /import Expo\n/,
        'import Expo\nimport SquareMobilePaymentsSDK\n'
      );
    }

    // 2. Initialize SDK at top of didFinishLaunchingWithOptions.
    if (!src.includes('MobilePaymentsSDK.initialize')) {
      const marker = 'let delegate = ReactNativeDelegate()';
      const init =
        `MobilePaymentsSDK.initialize(\n` +
        `      applicationLaunchOptions: launchOptions,\n` +
        `      squareApplicationID: "${applicationId}"\n` +
        `    )\n\n    `;
      src = src.replace(marker, init + marker);
    }

    config.modResults.contents = src;
    return config;
  });
}

// NFC / Bluetooth / Location strings are intentionally omitted while iOS
// payments are gated off in-app. Apple flags NFCReaderUsageDescription as a
// "needs hardware demo video" review issue (Guideline 2.1) — restore these
// when Tap to Pay is approved AND we can demo a Square reader on iOS.
const IOS_USAGE_STRINGS = {
  NSCameraUsageDescription:
    'QuoteMate uses the camera for site photos and supplier price-list capture.',
  NSMicrophoneUsageDescription:
    'QuoteMate uses the microphone for voice-to-text job descriptions.',
};

function withSquareIOSInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    for (const [key, value] of Object.entries(IOS_USAGE_STRINGS)) {
      // Only set if missing — don't clobber an existing app-specific string.
      if (!config.modResults[key]) {
        config.modResults[key] = value;
      }
    }
    return config;
  });
}

function withSquareIOSBuildPhase(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    // Square ships LCRCore/SquareReader/CorePaymentCard nested inside
    // SquareMobilePaymentsSDK.framework/Frameworks/. ASC rejects nested bundles
    // (`fd8d3fe2-...` validation), but dyld needs those frameworks at runtime
    // — so we hoist them up to the .app's top-level Frameworks/ instead of
    // deleting. We also strip the unsigned `setup` executable that ASC rejects
    // with `Invalid Signature ... not properly signed`.
    //
    // Runs before [CP] Embed Pods Frameworks. Source = XCFrameworkIntermediates,
    // which is what [CP] Embed rsyncs into the .app. Destination handling is a
    // safety net for builds where order differs.
    const SHELL_SCRIPT =
      'flatten_square() {\n' +
      '  local fw_dir="$1"\n' +
      '  local app_fw="$2"\n' +
      '  [ -d "$fw_dir" ] || return 0\n' +
      '  if [ -f "$fw_dir/setup" ]; then "$fw_dir/setup"; rm -f "$fw_dir/setup"; fi\n' +
      '  [ -d "$fw_dir/Frameworks" ] || return 0\n' +
      '  mkdir -p "$app_fw"\n' +
      '  for nested in "$fw_dir/Frameworks"/*; do\n' +
      '    [ -d "$nested" ] || continue\n' +
      '    local name; name=$(basename "$nested")\n' +
      '    rsync -a --delete "$nested/" "$app_fw/$name/"\n' +
      '    if [ -n "$EXPANDED_CODE_SIGN_IDENTITY" ]; then\n' +
      '      /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" --preserve-metadata=identifier,entitlements,flags "$app_fw/$name"\n' +
      '    fi\n' +
      '  done\n' +
      '  rm -rf "$fw_dir/Frameworks"\n' +
      '}\n' +
      'APP_FW="${BUILT_PRODUCTS_DIR}/${FRAMEWORKS_FOLDER_PATH}"\n' +
      'flatten_square "${BUILT_PRODUCTS_DIR}/XCFrameworkIntermediates/SquareMobilePaymentsSDK/SquareMobilePaymentsSDK.framework" "$APP_FW"\n' +
      'flatten_square "$APP_FW/SquareMobilePaymentsSDK.framework" "$APP_FW"\n';
    const PHASE_NAME = 'Square Mobile Payments SDK Setup';

    // Skip if already added.
    const buildPhases = xcodeProject.hash.project.objects.PBXShellScriptBuildPhase || {};
    for (const key of Object.keys(buildPhases)) {
      const phase = buildPhases[key];
      if (phase && typeof phase === 'object' && phase.name === `"${PHASE_NAME}"`) {
        return config;
      }
    }

    xcodeProject.addBuildPhase(
      [],
      'PBXShellScriptBuildPhase',
      PHASE_NAME,
      null,
      {
        shellPath: '/bin/sh',
        shellScript: SHELL_SCRIPT,
      }
    );
    return config;
  });
}

function withSquareIOSTapToPayEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.proximity-reader.payment.acceptance'] = true;
    return config;
  });
}

// ─── Android ──────────────────────────────────────────────────────────────

function withSquareAndroidRootGradle(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const buildGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        'build.gradle'
      );
      let contents = fs.readFileSync(buildGradlePath, 'utf-8');

      // 1. Add squareSdkVersion as a top-level ext property. The default
      //    Expo prebuild has no top-level `ext {}` block, so we prepend a
      //    fresh one before `buildscript {}` if needed.
      if (!contents.includes('squareSdkVersion')) {
        if (/^ext\s*{/m.test(contents)) {
          contents = contents.replace(
            /^ext\s*{/m,
            `ext {\n    squareSdkVersion = "${SQUARE_ANDROID_SDK_VERSION}"`
          );
        } else {
          contents =
            `ext {\n    squareSdkVersion = "${SQUARE_ANDROID_SDK_VERSION}"\n}\n\n` +
            contents;
        }
      }

      // 2. Add Square maven repo to allprojects.repositories{} block.
      if (!contents.includes('sdk.squareup.com/public/android')) {
        contents = contents.replace(
          /allprojects\s*{\s*repositories\s*{/,
          `allprojects {\n    repositories {\n        maven { url 'https://sdk.squareup.com/public/android/' }`
        );
      }

      fs.writeFileSync(buildGradlePath, contents);
      return config;
    },
  ]);
}

function withSquareAndroidAppGradle(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const appGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'build.gradle'
      );
      let contents = fs.readFileSync(appGradlePath, 'utf-8');

      // 1. Add SDK dependency.
      if (!contents.includes('com.squareup.sdk:mobile-payments-sdk')) {
        contents = contents.replace(
          /dependencies\s*{/,
          `dependencies {\n    implementation("com.squareup.sdk:mobile-payments-sdk:$squareSdkVersion")`
        );
      }

      // 2. Disable minify + shrinkResources in release per Square's docs.
      // The default RN release block enables minify; rewrite if present,
      // otherwise inject.
      if (contents.includes('minifyEnabled enableProguardInReleaseBuilds')) {
        contents = contents.replace(
          /minifyEnabled enableProguardInReleaseBuilds/,
          'minifyEnabled false'
        );
      }
      if (contents.includes('shrinkResources (findProperty')) {
        contents = contents.replace(
          /shrinkResources \(findProperty\([^)]+\)\)\.toBoolean\(\)/,
          'shrinkResources false'
        );
      }

      fs.writeFileSync(appGradlePath, contents);
      return config;
    },
  ]);
}

function injectSquareMainApplication(src, applicationId) {
  if (!src.includes('com.squareup.sdk.mobilepayments.MobilePaymentsSdk')) {
    src = src.replace(
      /^package\s+([\w.]+)\s*$/m,
      `package $1\n\nimport com.squareup.sdk.mobilepayments.MobilePaymentsSdk`
    );
  }

  // Migrate the 1.46+155-era idle-handler deferral (issue #66): idle fires
  // after MainActivity is created, so Square's ActivityListener missed the
  // activity and createdActivity stayed null. Strip it so the block below
  // re-injects the correct timing.
  src = src.replace(
    /\n\s*android\.os\.Looper\.myQueue\(\)\.addIdleHandler \{\n\s*MobilePaymentsSdk\.initialize\([^)]*\)\n\s*false\n\s*\}/,
    ''
  );
  // If an idle-handler init survives the whitespace-exact strip above, the
  // marker check below would silently keep the broken timing on this machine.
  if (src.includes('addIdleHandler') && src.includes('MobilePaymentsSdk.initialize')) {
    console.warn(
      'withSquareSDK: unrecognized idle-handler MobilePaymentsSdk.initialize block — ' +
        'migrate MainApplication.kt manually or the #66 crash timing ships again.'
    );
  }

  if (!src.includes('MobilePaymentsSdk.initialize')) {
    // Square's initialize() must (a) run on the main thread — it throws
    // off-main, (b) finish before the first Activity is created — its
    // ActivityListener only tracks activities created after init, and a
    // missed first activity is a fatal IllegalStateException in the payment
    // flow (issue #66) — and (c) stay off the blocking process-start path
    // (ANR, Sentry REACT-NATIVE-1). onActivityPreCreated runs synchronously
    // just before the first Activity's onCreate, after process start, and
    // never for background broadcast/service starts — the only hook that
    // satisfies all three. It requires API 29; on API 28 (minSdk) init runs
    // inline as the lesser risk.
    src = src.replace(
      /super\.onCreate\(\)/,
      `super.onCreate()\n` +
        `    if (android.os.Build.VERSION.SDK_INT >= 29) {\n` +
        `      registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {\n` +
        `        override fun onActivityPreCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {\n` +
        `          unregisterActivityLifecycleCallbacks(this)\n` +
        `          MobilePaymentsSdk.initialize("${applicationId}", this@MainApplication)\n` +
        `        }\n` +
        `        override fun onActivityCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {}\n` +
        `        override fun onActivityStarted(activity: android.app.Activity) {}\n` +
        `        override fun onActivityResumed(activity: android.app.Activity) {}\n` +
        `        override fun onActivityPaused(activity: android.app.Activity) {}\n` +
        `        override fun onActivityStopped(activity: android.app.Activity) {}\n` +
        `        override fun onActivitySaveInstanceState(activity: android.app.Activity, outState: android.os.Bundle) {}\n` +
        `        override fun onActivityDestroyed(activity: android.app.Activity) {}\n` +
        `      })\n` +
        `    } else {\n` +
        `      MobilePaymentsSdk.initialize("${applicationId}", this)\n` +
        `    }`
    );
  }

  return src;
}

function withSquareAndroidMainApplication(config, applicationId) {
  return withMainApplication(config, (config) => {
    config.modResults.contents = injectSquareMainApplication(
      config.modResults.contents,
      applicationId
    );
    return config;
  });
}

function withSquareAndroidPermissions(config) {
  return AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.NFC',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_CONNECT',
  ]);
}

// ─── Plugin entrypoint ────────────────────────────────────────────────────

function withSquareSDK(config, props = {}) {
  const applicationId = props.applicationId;
  if (!applicationId) {
    throw new Error(
      'withSquareSDK: applicationId is required. Set SQUARE_APP_ID_PRODUCTION in .env.'
    );
  }

  config = withSquareIOSAppDelegate(config, applicationId);
  config = withSquareIOSInfoPlist(config);
  config = withSquareIOSBuildPhase(config);
  // Re-enable once Apple approves the Tap to Pay on iPhone entitlement
  // request for team 5GHUTAV35B. Without approval, ASC rejects the upload.
  // config = withSquareIOSTapToPayEntitlement(config);

  config = withSquareAndroidRootGradle(config);
  config = withSquareAndroidAppGradle(config);
  config = withSquareAndroidMainApplication(config, applicationId);
  config = withSquareAndroidPermissions(config);

  return config;
}

module.exports = createRunOncePlugin(withSquareSDK, 'withSquareSDK', '1.0.0');
// Exported for tests — pure string transform behind withSquareAndroidMainApplication.
module.exports.injectSquareMainApplication = injectSquareMainApplication;
