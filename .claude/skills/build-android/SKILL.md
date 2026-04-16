---
name: build-android
description: Build a production Android AAB locally for Google Play Store upload
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Build Android Production AAB

Build a signed production Android App Bundle (AAB) locally using Gradle for upload to the Google Play Store.

## Prerequisites

Before the build can run, the upload keystore must be in place:

- **Keystore file:** `android/app/upload.keystore` (JKS format)
- **Credentials file:** `android/keystore.properties` with contents:
  ```
  storePassword=a972771180746014d12061ddb640e25e
  keyPassword=56df13fe00d211417077ca9ffc65b894
  keyAlias=7b6e271d1dc6e297ea56b99c60f99de9
  storeFile=upload.keystore
  ```
- **Expected SHA1 fingerprint:** `A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7`

Both files are gitignored. If either is missing, tell the user to run `npx eas credentials` interactively, choose Android → production → Keystore → Download, then copy the `.jks` file to `android/app/upload.keystore`.

The release signing config in `android/app/build.gradle` reads from `keystore.properties` automatically — do NOT use `signingConfigs.debug` for release builds.

## Steps

1. **Verify signing prerequisites exist.** Check that both `android/app/upload.keystore` and `android/keystore.properties` exist. If either is missing, stop and tell the user (see Prerequisites above).

2. Read `android/app/build.gradle` and note the current `versionCode` and `versionName`.

3. **Ask the user** what versionCode and versionName the Play Store currently has. The EAS remote value (`eas build:version:get`) is often stale and behind the actual Play Store. Do NOT rely on it alone.

4. Set the new versions:
   - `versionCode` = max(current build.gradle value, user-provided Play Store value) + 1
   - `versionName` = bump the patch number by 1 from the higher of build.gradle or Play Store (e.g. "1.0.85" → "1.0.86")
   - Use the Edit tool to update the values in `android/app/build.gradle`.

5. Run the Gradle release bundle build (**do NOT run `clean` first** — it wipes native CMake caches and causes prefab errors):
   ```
   cd android && ./gradlew bundleRelease
   ```
   Set the timeout to 600000ms (10 minutes) to allow for the full Gradle build.

6. After a successful build, copy the AAB to a consistent output location:
   ```
   mkdir -p builds/android
   cp android/app/build/outputs/bundle/release/app-release.aab builds/android/quotemate-v{versionName}-{versionCode}.aab
   ```
   Replace `{versionName}` and `{versionCode}` with the actual values (e.g. `quotemate-v1.0.71-90.aab`).

7. **Verify the signature** matches the Play Store expected fingerprint:
   ```
   keytool -printcert -jarfile builds/android/quotemate-v{versionName}-{versionCode}.aab 2>&1 | grep "SHA1:"
   ```
   Expected: `SHA1: A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7`

8. Report the following to the user:
   - The full path to the `.aab` file in `builds/android/`
   - The new `versionName` and `versionCode`
   - Whether the SHA1 fingerprint matched

The build timeout should be set to 600000ms (10 minutes) to allow for the full Gradle build.
