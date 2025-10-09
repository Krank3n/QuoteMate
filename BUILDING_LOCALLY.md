# Building QuoteMate Locally (Without EAS)

This guide explains how to build the Android app locally using Gradle, without relying on EAS Build.

## Prerequisites

1. ✅ Android SDK installed
2. ✅ Java JDK installed
3. ✅ `.env` file with API keys
4. ⚠️  Production keystore file

## Current Status

- **Environment Variables**: ✅ Configured via `react-native-dotenv`
- **Build Configuration**: ✅ Set up in `android/app/build.gradle`
- **Production Keystore**: ⚠️  Needs to be downloaded from EAS

## Getting the Production Keystore

The production keystore is currently managed by EAS and must be downloaded once for local builds:

### Option 1: Download from EAS (One-time Setup)

Run this command in your terminal (requires interactive input):

```bash
cd /Users/tom/Documents/GitHub/QuoteMate
eas credentials
```

Then follow these prompts:
1. Select: **Android**
2. Select: **production**
3. Choose: **Keystore: Manage everything needed to build your project**
4. Select: **Download keystore**
5. Save to: `android/app/release.keystore`

The credentials will be displayed - you'll need:
- Keystore password
- Key alias
- Key password

Update `/Users/tom/Documents/GitHub/QuoteMate/android/keystore.properties`:
```properties
storePassword=YOUR_KEYSTORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=YOUR_KEY_ALIAS
storeFile=release.keystore
```

### Option 2: Continue Using EAS Build

If you prefer not to manage keystores locally, you can continue using:

```bash
eas build --platform android --profile production
```

This handles signing automatically and downloads the AAB when complete.

## Building Locally

Once you have the keystore set up:

```bash
# Using the convenience script
./build-local.sh

# Or manually
cd android
./gradlew clean
./gradlew bundlePlayRelease
```

The AAB will be at:
```
android/app/build/outputs/bundle/playRelease/app-play-release.aab
```

## Why the Anthropic API Doesn't Work in Test Builds

**Root Cause**: Environment variables from `.env` are bundled at compile time using `react-native-dotenv`.

**Solution**: Make sure you:
1. Have a valid `.env` file with `ANTHROPIC_API_KEY=your_key`
2. Rebuild the app after changing `.env` (environment vars are baked in at build time)
3. Clear Metro cache if needed: `npm start -- --clear`

## Current Build Configuration

- **Version Code**: 7
- **Version Name**: 1.0.4
- **Package**: com.quotemate.app
- **Environment Variables**: Loaded via `@env` module (react-native-dotenv)

## Troubleshooting

### "Keystore file not found"
- Download the keystore from EAS using `eas credentials`
- Place it at `android/app/release.keystore`

### "API key not working"
- Check `.env` file exists in project root
- Rebuild the app (environment vars are compile-time only)
- Check build logs for "env: export ANTHROPIC_API_KEY"

### "Wrong signing key"
- You must use the production keystore from EAS
- Debug keystore will be rejected by Google Play

## Next Steps

To build version 7 (1.0.4) locally:

1. Download the production keystore (see above)
2. Run `./build-local.sh`
3. Upload the AAB to Google Play Console

