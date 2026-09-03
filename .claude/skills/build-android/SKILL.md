---
name: build-android
description: Build a production Android AAB locally for Google Play Store upload
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

3. **Default to bumping from `build.gradle`.** The local `build.gradle` value is usually in sync with Play Store because the last successful build wrote it. Unless the user says otherwise, bump from there. Only ask if you have a specific reason to suspect drift (e.g. prior build failed, user mentions an out-of-band release). Never trust the EAS remote value (`eas build:version:get`) — it is often stale.

4. Set the new versions:
   - `versionCode` = current build.gradle value + 1 (or max with a user-supplied Play Store value, if given)
   - `versionName` = bump the patch number by 1 (e.g. "1.0.87" → "1.0.88")
   - Use the Edit tool to update the values in `android/app/build.gradle`, and set `android.versionCode` in `app.config.js` to the same value — the prebuild in step 5 rewrites `build.gradle` from it.

5. Regenerate `android/` from the config, then run the Gradle release bundle build (**do NOT run `clean` first** — it wipes native CMake caches and causes prefab errors). The prebuild is what puts the EAS Update channel header (`updates.requestHeaders` in `app.config.js`) into the manifest; a build without it never receives an OTA:
   ```
   npx expo prebuild --platform android --no-install && cd android && ./gradlew bundleRelease
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

9. **Remind the user of the post-release step.** Once the build is actually live
   on both stores (not before — see `docs/RELEASE.md`), the in-app update sheet
   has to be told about it:

   ```
   npm run release:announce -- --version <store version> --whats-new "..."        # dry run
   npm run release:announce -- --version <store version> --whats-new "..." --write
   ```

   Skipping this is invisible: `config/appUpdate` went stale at `1.0.74` while
   the app shipped `1.54`, and no user saw an update prompt for months. Do NOT
   run it as part of the build — announcing a version still in review points
   people at a download that doesn't exist yet.

The build timeout should be set to 600000ms (10 minutes) to allow for the full Gradle build.
