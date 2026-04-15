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
 *   • MainApplication.kt — initialize MobilePaymentsSdk in onCreate
 *   • AndroidManifest.xml — NFC + location permissions
 *
 * iOS Tap to Pay capability + entitlement are NOT added here — they require
 * Apple approval and are added manually in Xcode once the entitlement lands.
 */

const {
  withAppDelegate,
  withInfoPlist,
  withXcodeProject,
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

const IOS_USAGE_STRINGS = {
  NSCameraUsageDescription:
    'QuoteMate uses the camera for site photos, supplier price-list capture, and to power Tap to Pay card-entry fallback.',
  NSMicrophoneUsageDescription:
    'QuoteMate uses the microphone for voice-to-text job descriptions.',
  NSLocationWhenInUseUsageDescription:
    'Square requires location access to take in-person card payments.',
  NFCReaderUsageDescription:
    'QuoteMate uses NFC to accept Tap to Pay contactless card payments.',
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
    const SHELL_SCRIPT =
      'SETUP_SCRIPT=${BUILT_PRODUCTS_DIR}/${FRAMEWORKS_FOLDER_PATH}"/SquareMobilePaymentsSDK.framework/setup"\n' +
      'if [ -f "$SETUP_SCRIPT" ]; then\n' +
      '  "$SETUP_SCRIPT"\n' +
      'fi\n';
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

function withSquareAndroidMainApplication(config, applicationId) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;

    if (!src.includes('com.squareup.sdk.mobilepayments.MobilePaymentsSdk')) {
      src = src.replace(
        /^package\s+([\w.]+)\s*$/m,
        `package $1\n\nimport com.squareup.sdk.mobilepayments.MobilePaymentsSdk`
      );
    }

    if (!src.includes('MobilePaymentsSdk.initialize')) {
      // Insert immediately after `super.onCreate()` in onCreate().
      src = src.replace(
        /super\.onCreate\(\)/,
        `super.onCreate()\n    MobilePaymentsSdk.initialize("${applicationId}", this)`
      );
    }

    config.modResults.contents = src;
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

  config = withSquareAndroidRootGradle(config);
  config = withSquareAndroidAppGradle(config);
  config = withSquareAndroidMainApplication(config, applicationId);
  config = withSquareAndroidPermissions(config);

  return config;
}

module.exports = createRunOncePlugin(withSquareSDK, 'withSquareSDK', '1.0.0');
