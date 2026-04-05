---
name: build-android
description: Build a production Android AAB locally for Google Play Store upload
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Build Android Production AAB

Build a signed production Android App Bundle (AAB) locally using Gradle for upload to the Google Play Store.

## Steps

1. Read `android/app/build.gradle` and note the current `versionCode` and `versionName`.

2. Get the latest versionCode from the Play Store via EAS:
   ```
   eas build:version:get --platform android
   ```
   Parse the `Android versionCode` value from the output.

3. Set the new versions:
   - `versionCode` = max(current build.gradle value, EAS remote value) + 1
   - Bump the patch number in `versionName` by 1 (e.g. "1.0.70" → "1.0.71")
   - Use the Edit tool to update the values in `android/app/build.gradle`.

4. Run the Gradle release bundle build:
   ```
   cd android && ./gradlew bundleRelease
   ```
   Set the timeout to 600000ms (10 minutes) to allow for the full Gradle build.

5. After a successful build, copy the AAB to a consistent output location:
   ```
   mkdir -p builds/android
   cp android/app/build/outputs/bundle/release/app-release.aab builds/android/quotemate-v{versionName}-{versionCode}.aab
   ```
   Replace `{versionName}` and `{versionCode}` with the actual values (e.g. `quotemate-v1.0.71-90.aab`).

6. Report the following to the user:
   - The full path to the `.aab` file in `builds/android/`
   - The new `versionName` and `versionCode`

The build timeout should be set to 600000ms (10 minutes) to allow for the full Gradle build.
