# Upload Version 9 (1.0.6) to Google Play

## ✅ Build Complete

**AAB File**: `/Users/tom/Documents/GitHub/QuoteMate/android/app/build/outputs/bundle/playRelease/app-play-release.aab`
- **Version Code**: 9
- **Version Name**: 1.0.6
- **Size**: 47 MB
- **Built**: October 9, 2025
- **Signed with**: New local keystore

## Step 1: Update Upload Key in Google Play Console

Before you can upload this build, you need to register the new keystore with Google Play.

### 1.1 Access Google Play Console

1. Go to: https://play.google.com/console
2. Select: **QuoteMate** (com.quotemate.app)
3. Navigate to: **Setup** → **App signing** (in the left sidebar)

### 1.2 Upload New Certificate

On the App Signing page, you'll see three sections:
- App signing key certificate (managed by Google Play)
- **Upload key certificate** ← This is what we need to update
- Previous certificates

**Actions:**

1. Scroll to **"Upload key certificate"** section
2. Look for one of these options:
   - **"Request upload key reset"** button, OR
   - **"Add new upload key"** option

3. Click the button/option

4. You'll be prompted to upload a certificate file
   - Select file: `/Users/tom/Documents/GitHub/QuoteMate/upload_certificate.pem`
   - This is the certificate I exported from your new local keystore

5. Click **"Upload"** or **"Submit"**

### 1.3 Wait for Approval

- **Usually instant**: Most certificate updates are approved immediately
- **Maximum wait**: Up to 48 hours in rare cases
- **You'll receive**: Email confirmation when approved

### 1.4 Certificate Details (for reference)

If asked for certificate information:

**SHA-1 Fingerprint**:
```
6B:81:01:E7:94:7C:D5:0F:48:0D:52:38:77:C5:9C:B2:92:C5:BF:5B
```

**SHA-256 Fingerprint**:
```
0A:69:BC:9E:CA:AE:40:DA:68:E8:C6:5E:B3:F5:5F:A8:1B:4E:53:E5:D1:92:93:90:76:94:9A:B1:4E:11:27:7C
```

## Step 2: Upload the AAB

Once the certificate is approved:

### 2.1 Create Release

1. In Google Play Console, navigate to: **Production** → **Releases**
2. Click: **"Create new release"**

### 2.2 Upload AAB

1. Click **"Upload"** in the App bundles section
2. Select: `/Users/tom/Documents/GitHub/QuoteMate/android/app/build/outputs/bundle/playRelease/app-play-release.aab`
3. Wait for upload and processing (may take 5-10 minutes)

### 2.3 Add Release Notes

Example release notes:

```
Version 1.0.6 Release Notes:

Bug Fixes:
• Fixed Anthropic API integration for material list generation
• Fixed Bunnings API error messaging
• Improved PDF export text readability

Improvements:
• Updated environment variable handling for better reliability
• Enhanced error messages when APIs are unavailable
• General stability improvements
```

### 2.4 Review and Publish

1. Review the release summary
2. Click **"Review release"**
3. If everything looks good, click **"Start rollout to Production"**
4. Confirm rollout

### 2.5 Wait for Review

- **Typical review time**: 1-3 days
- **You'll receive**: Email when the release is live
- **Status updates**: Check **Production** tab in Google Play Console

## What's Included in Version 9

✅ **Fixed Issues:**
- Anthropic API now works properly (uses react-native-dotenv)
- Bunnings API error messages mention when API might be down
- PDF exports have readable dark text instead of light text

✅ **Technical Improvements:**
- Environment variables properly bundled at build time
- Local build system fully configured
- No dependency on EAS Build for environment variables

## Future Builds

Now that the keystore is registered, all future builds can be done locally:

```bash
# Update version in android/app/build.gradle
# Then run:
cd /Users/tom/Documents/GitHub/QuoteMate
./build-local.sh

# Upload the AAB from:
# android/app/build/outputs/bundle/playRelease/app-play-release.aab
```

No need to update the certificate again - it's a one-time setup!

## Troubleshooting

### "Upload key certificate doesn't match"

If you see this error after uploading the certificate:
- Make sure you uploaded `upload_certificate.pem` from the project root
- The certificate must be in PEM format (which it is)
- Try refreshing the page and uploading again

### "This APK/Bundle is already uploaded"

If you see this error:
- The AAB might have been uploaded in a previous attempt
- Check the **Releases** section for existing drafts
- Delete the draft and create a new release

### "Version code 9 has already been used"

If you see this error:
- Increment the version in `android/app/build.gradle`
- Change `versionCode` to 10
- Rebuild with `./gradlew clean && ./gradlew bundlePlayRelease`

## Certificate File Locations

For your records:

**Keystore**: `/Users/tom/Documents/GitHub/QuoteMate/android/app/release-new.keystore`
- Alias: `quotemate`
- Passwords stored in: `android/keystore.properties`

**Certificate (for Google Play)**: `/Users/tom/Documents/GitHub/QuoteMate/upload_certificate.pem`
- Only needed once for registration
- Can be regenerated anytime with:
  ```bash
  keytool -export -rfc \
    -keystore android/app/release-new.keystore \
    -alias quotemate \
    -storepass a972771180746014d12061ddb640e25e \
    -file upload_certificate.pem
  ```

---

**Ready to upload?** Start with Step 1.1 above! 🚀

