# ⚠️ Important: New Keystore Created - Action Required

## What Happened

A **new production keystore** has been generated for local builds:
- Location: `/Users/tom/Documents/GitHub/QuoteMate/android/app/release-new.keystore`
- Alias: `quotemate`
- **SHA1 Fingerprint**: `6B:81:01:E7:94:7C:D5:0F:48:0D:52:38:77:C5:9C:B2:92:C5:BF:5B`

## ⚠️ Google Play Will Reject This Build

**Problem**: Google Play expects the app to be signed with the **original keystore** (SHA1: `A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7`).

The new keystore has a different fingerprint, so Google Play will reject it with:
> "Your Android App Bundle is signed with the wrong key"

## Solutions

### Option 1: Update Upload Key in Google Play Console (Recommended if continuing local builds)

You can update the upload key in Google Play Console:

1. **Export the certificate from the new keystore:**
   ```bash
   keytool -export -rfc \
     -keystore /Users/tom/Documents/GitHub/QuoteMate/android/app/release-new.keystore \
     -alias quotemate \
     -storepass a972771180746014d12061ddb640e25e \
     -file upload_certificate.pem
   ```

2. **Go to Google Play Console:**
   - Navigate to: **Setup** → **App signing**
   - Find: **Upload key certificate**
   - Click: **Request upload key reset**  OR **Add upload key** (if available)
   - Upload `upload_certificate.pem`

3. **Wait for approval** (usually instant, but can take up to 48 hours)

4. **Upload the new AAB** once approved

### Option 2: Continue Using EAS Build (Easiest)

If you prefer not to manage keystores:

```bash
eas build --platform android --profile production
```

This uses the original keystore automatically and handles all signing.

### Option 3: Get the Original Keystore from EAS

To build locally with the original keystore:

1. Run in terminal:
   ```bash
   cd /Users/tom/Documents/GitHub/QuoteMate
   eas credentials
   ```

2. Select: Android → production → Keystore → Download
3. Save as: `android/app/release-original.keystore`
4. Update `android/keystore.properties` with the downloaded credentials
5. Rebuild with `./gradlew bundlePlayRelease`

## Current Build Status

✅ **Local build successful**:
- **Location**: `/Users/tom/Documents/GitHub/QuoteMate/android/app/build/outputs/bundle/playRelease/app-play-release.aab`
- **Size**: 47 MB
- **Version**: 7 (1.0.4)
- **Signed with**: NEW keystore (will be rejected by Google Play)

⚠️ **Cannot upload to Google Play** until you either:
- Update the upload key in Google Play Console (Option 1)
- Or use the original keystore (Option 2/3)

## Why API Keys Now Work in Local Builds

✅ **Fixed**: Environment variables are now properly bundled using `react-native-dotenv`:
- `.env` file is read at compile time
- Variables are available via `import { ANTHROPIC_API_KEY } from '@env'`
- No need for EAS Build to handle environment variables

## Next Steps

**For immediate upload to Google Play:**
1. Use EAS Build (Option 2) for this release
2. Then decide if you want to switch to local builds permanently

**For local builds going forward:**
1. Follow Option 1 to update the upload key in Google Play
2. Use `./build-local.sh` for all future builds

## Build Configuration

All future local builds will:
- ✅ Bundle environment variables from `.env`
- ✅ Sign with the local keystore
- ✅ Build completely offline (no EAS required)
- ✅ Version numbers managed in `android/app/build.gradle`

