# Setting Up Local Android Build with EAS Keystore

## Step 1: Download Keystore from EAS

Run the helper script:
```bash
./download-keystore.sh
```

Or manually run:
```bash
npx eas-cli credentials
```

Follow the prompts:
1. Select: **Android**
2. Select: **production**
3. Choose: **Keystore: Manage everything needed to build your project**
4. Select: **Download credentials**
5. Save the keystore to: `android/app/upload.keystore`

## Step 2: Get Keystore Information

After downloading, EAS will display:
- **Keystore password** (storePassword)
- **Key alias** (keyAlias)
- **Key password** (keyPassword)

**IMPORTANT:** Write these down! You'll need them for the next step.

## Step 3: Verify Keystore SHA1

Verify the downloaded keystore matches what Google Play expects:

```bash
keytool -list -v -keystore android/app/upload.keystore -alias <YOUR_KEY_ALIAS> -storepass <YOUR_STORE_PASSWORD>
```

Look for the SHA1 fingerprint. It should match:
```
SHA1: A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7
```

## Step 4: Create Keystore Properties File

Create `android/keystore.properties` with your credentials:

```properties
storePassword=<YOUR_STORE_PASSWORD>
keyPassword=<YOUR_KEY_PASSWORD>
keyAlias=<YOUR_KEY_ALIAS>
storeFile=upload.keystore
```

**IMPORTANT:** Add this file to `.gitignore` to keep credentials secure!

## Step 5: Update build.gradle

Update `android/app/build.gradle`:

```gradle
// Add this at the top of the file, before android {}
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    // ... existing config ...

    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }

    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            // ... rest of release config ...
        }
    }
}
```

## Step 6: Add to .gitignore

Add these lines to `.gitignore`:
```
# Keystore files
*.keystore
*.jks
keystore.properties
android/keystore.properties
android/app/upload.keystore
android/app/release.keystore
```

## Step 7: Build Locally

Now you can build locally:

```bash
cd android
./gradlew clean
./gradlew bundlePlayRelease
```

The signed AAB will be at:
```
android/app/build/outputs/bundle/playRelease/app-play-release.aab
```

## Troubleshooting

### Wrong SHA1 Fingerprint
If the SHA1 doesn't match, you may have downloaded the wrong keystore. Make sure you're selecting the **production** profile credentials.

### Build Fails with Signing Error
- Double-check `keystore.properties` values
- Ensure `upload.keystore` is in `android/app/` directory
- Verify file paths are correct in build.gradle

### Can't Find Credentials in EAS
- Check EAS web dashboard: https://expo.dev/accounts/krank3n/projects/quotemate/credentials
- Ensure you're logged into the correct Expo account

## Security Notes

⚠️ **NEVER commit these files to git:**
- `*.keystore`
- `keystore.properties`
- Any file containing passwords

✅ **DO:**
- Keep backups of your keystore in a secure location
- Use a password manager for keystore passwords
- Share credentials only through secure channels
