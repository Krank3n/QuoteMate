/**
 * withModularHeaders
 *
 * Config plugin that marks specific CocoaPods dependencies with
 * `:modular_headers => true` in the prebuilt ios/Podfile.
 *
 * Why: the GoogleSignIn iOS SDK (via @react-native-google-signin/google-signin)
 * pulls in the Swift pod `AppCheckCore`, which depends on `GoogleUtilities`
 * and `RecaptchaInterop`. Those are Objective-C pods that don't define
 * modules, so `pod install` fails with "The following Swift pods cannot yet
 * be integrated as static libraries" unless they opt into module-map
 * generation. Scoped per-pod on purpose — a global `use_modular_headers!`
 * changes header semantics for every pod and risks breaking others.
 *
 * Idempotent: skips pods already declared in the Podfile.
 */

const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DEFAULT_PODS = ['GoogleUtilities', 'RecaptchaInterop'];

/**
 * Pure transform: insert `pod '<name>', :modular_headers => true` lines right
 * after the target's `use_expo_modules!` marker. Returns the Podfile unchanged
 * if every pod is already declared (idempotency for repeated prebuilds).
 */
function injectModularHeaders(podfile, pods = DEFAULT_PODS) {
  const missing = pods.filter(
    (name) => !new RegExp(`^\\s*pod\\s+['"]${name}['"]`, 'm').test(podfile)
  );
  if (missing.length === 0) return podfile;

  const marker = /^([ \t]*)use_expo_modules!.*$/m;
  if (!marker.test(podfile)) {
    throw new Error(
      'withModularHeaders: could not find `use_expo_modules!` in ios/Podfile — Expo template changed?'
    );
  }
  const lines = (indent) =>
    missing.map((name) => `${indent}pod '${name}', :modular_headers => true`).join('\n');
  return podfile.replace(marker, (line, indent) => `${line}\n${lines(indent)}`);
}

function withModularHeaders(config, props = {}) {
  const pods = props.pods || DEFAULT_PODS;
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf-8');
      fs.writeFileSync(podfilePath, injectModularHeaders(contents, pods));
      return config;
    },
  ]);
}

module.exports = createRunOncePlugin(withModularHeaders, 'withModularHeaders', '1.0.0');
// Exported for tests — pure string transform.
module.exports.injectModularHeaders = injectModularHeaders;
