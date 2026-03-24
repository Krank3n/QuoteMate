---
name: build-android
description: Build a production Android AAB locally for Google Play Store upload
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Build Android Production AAB

Build a signed production Android App Bundle (AAB) locally using EAS for upload to the Google Play Store.

## Steps

1. Run the EAS local production build:
   ```
   eas build --platform android --profile production --local
   ```
   This will auto-increment the `versionCode` from the EAS remote version.

2. Wait for the build to complete (typically ~2-3 minutes).

3. Check the build output for success and report the following to the user:
   - The full path to the `.aab` file
   - The version name (from `app.config.js` version field)
   - The version code used in the build

The build timeout should be set to 600000ms (10 minutes) to allow for the full Gradle build.