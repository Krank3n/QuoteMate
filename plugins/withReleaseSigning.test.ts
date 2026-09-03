/**
 * Local Android releases are signed with the upload key from
 * android/keystore.properties. The template app/build.gradle signs release
 * with the debug keystore, and prebuild rewrites that file, so the release
 * signing block has to come from a plugin; this pins what it writes.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { addReleaseSigning } = require('./withReleaseSigning');

const TEMPLATE = `apply plugin: "com.android.application"

android {
    namespace 'com.quotemate.app'
    defaultConfig {
        applicationId 'com.quotemate.app'
        versionCode 171
        versionName "1.56"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            shrinkResources false
            minifyEnabled false
        }
    }
}
`;

describe('withReleaseSigning', () => {
  const out = addReleaseSigning(TEMPLATE);

  it('loads android/keystore.properties above the android block', () => {
    expect(out.indexOf('rootProject.file("keystore.properties")')).toBeGreaterThan(-1);
    expect(out.indexOf('keystorePropertiesFile')).toBeLessThan(out.indexOf('android {'));
  });

  it('adds a release signingConfig fed from the properties file', () => {
    expect(out).toMatch(/signingConfigs \{\n\s*release \{\n\s*if \(keystorePropertiesFile\.exists\(\)\) \{\n\s*storeFile file\(keystoreProperties\['storeFile'\]\)/);
    expect(out).toContain("keyAlias keystoreProperties['keyAlias']");
  });

  it('signs the release build type with it, and leaves debug on the debug key', () => {
    const buildTypes = out.slice(out.indexOf('buildTypes {'));
    const debug = buildTypes.slice(buildTypes.indexOf('debug {'), buildTypes.indexOf('release {'));
    const release = buildTypes.slice(buildTypes.indexOf('release {'));
    expect(debug).toContain('signingConfig signingConfigs.debug');
    expect(release).toContain('signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug');
    expect(release).not.toMatch(/^\s*signingConfig signingConfigs\.debug\s*$/m);
  });

  it('is idempotent', () => {
    expect(addReleaseSigning(out)).toBe(out);
  });

  it('refuses a file that no longer looks like the template', () => {
    expect(() => addReleaseSigning('android {\n}\n')).toThrow(/no longer matches/);
  });
});
