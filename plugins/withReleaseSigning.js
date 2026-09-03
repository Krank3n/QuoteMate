const { withAppBuildGradle, createRunOncePlugin } = require("@expo/config-plugins");

/**
 * Sign local Android release builds with the upload key.
 *
 * Releases here are `./gradlew bundleRelease` on the prebuilt tree, and the
 * template app/build.gradle signs `release` with the debug keystore. The
 * signing block used to be a hand edit — which prebuild silently wiped, and
 * android/ is gitignored so nothing could pin it. This writes the same block
 * from `android/keystore.properties` (gitignored; see the build-android
 * skill) at prebuild, and falls back to the debug keystore when the file is
 * absent so `expo run:android` keeps working on a machine without the key.
 */
const LOADER = `
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
`;

const RELEASE_CONFIG = `        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
`;

const RELEASE_SIGNING =
  "signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug";

/**
 * Pure transform over app/build.gradle contents, so the result can be
 * asserted without running a prebuild. Idempotent.
 */
function addReleaseSigning(contents) {
  if (contents.includes("keystorePropertiesFile")) return contents;
  let out = contents.replace(/^android \{/m, `${LOADER}\nandroid {`);
  out = out.replace(/^(\s*)signingConfigs \{\n/m, (m) => `${m}${RELEASE_CONFIG}`);
  const buildTypes = out.indexOf("buildTypes {");
  const release = out.indexOf("release {", buildTypes);
  const target = out.indexOf("signingConfig signingConfigs.debug", release);
  if (buildTypes < 0 || release < 0 || target < 0) {
    throw new Error("withReleaseSigning: app/build.gradle no longer matches the template");
  }
  out =
    out.slice(0, target) +
    RELEASE_SIGNING +
    out.slice(target + "signingConfig signingConfigs.debug".length);
  return out;
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = addReleaseSigning(c.modResults.contents);
    return c;
  });

module.exports = createRunOncePlugin(withReleaseSigning, "withReleaseSigning", "1.0.0");
module.exports.addReleaseSigning = addReleaseSigning;
