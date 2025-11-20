# QuoteMate Production Build Guide

Quick reference for building production releases locally.

## 🚀 Quick Start

### Android Production Build

Simply run:
```bash
./build-android-production.sh
```

The script will:
- ✅ Verify keystore is present
- ✅ Clean previous builds
- ✅ Build signed AAB
- ✅ Verify signature matches Google Play
- ✅ Copy to `app-production-v{VERSION}.aab`

### iOS Production Build

For iOS, use EAS Build (requires interactive credentials):
```bash
npx eas-cli build --platform ios --profile production
```

## 📋 Prerequisites (One-Time Setup)

### Android Keystore Setup

If you don't have the keystore yet:

1. Download from EAS:
   ```bash
   npx eas-cli credentials
   ```
   - Select: **Android** → **production**
   - Choose: **Keystore: Manage everything needed to build your project**
   - Select: **Download credentials**
   - Save to: `android/app/upload.keystore`

2. The keystore info will be displayed:
   ```
   Type: JKS
   Key Alias: 7b6e271d1dc6e297ea56b99c60f99de9
   SHA1: A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7

   Keystore password: a972771180746014d12061ddb640e25e
   Key password: 56df13fe00d211417077ca9ffc65b894
   ```

3. Keystore properties are already configured in:
   - `android/keystore.properties` (don't commit this!)
   - `android/app/build.gradle` (loads the properties)

## 🔑 Current Keystore Info

```
Location: android/app/upload.keystore
Type: JKS
Key Alias: 7b6e271d1dc6e297ea56b99c60f99de9
SHA1: A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7
SHA256: CE:C6:E2:85:61:E1:B3:43:A8:57:E2:39:D2:65:D5:8D:6A:8B:62:8A:A8:2B:7E:C6:8C:CC:21:73:31:E1:21:38
```

## 📦 Current Version

- **Version**: 1.0.31
- **Build Number**: 39
- **16 KB Page Size Support**: ✅ Enabled

## 🔧 Manual Build Commands

If you need to build manually:

```bash
# Android
cd android
./gradlew clean
./gradlew bundlePlayRelease
cd ..

# Output will be at:
# android/app/build/outputs/bundle/playRelease/app-play-release.aab
```

## ✅ Verification

Verify the AAB signature:
```bash
keytool -printcert -jarfile app-production-v1.0.15.aab | grep SHA1
```

Expected output:
```
SHA1: A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7
```

## 📤 Deployment

### Upload to Google Play

1. Go to: https://play.google.com/console
2. Select QuoteMate
3. Navigate to: **Production** → **Create new release**
4. Upload: `app-production-v{VERSION}.aab`

### Upload to App Store (iOS)

After EAS build completes:
```bash
npx eas-cli submit --platform ios
```

## 🔒 Security Notes

**NEVER commit these files:**
- `android/app/upload.keystore`
- `android/keystore.properties`
- `*.aab` files
- `*.apk` files

These are already in `.gitignore`.

## 📝 Updating Version

Before building a new release:

1. Update version in all files (automated script coming soon):
   - `package.json`
   - `app.config.js`
   - `android/app/build.gradle`
   - `ios/quotemate/Info.plist`

2. Increment both:
   - **Version name**: e.g., `1.0.15` → `1.0.16`
   - **Build/version code**: e.g., `22` → `23`

## 🆘 Troubleshooting

### Keystore not found
Run `npx eas-cli credentials` to download it from EAS.

### Wrong signature
Make sure you're using the correct keystore from EAS, not a locally generated one.

### Build fails
Try cleaning first:
```bash
cd android && ./gradlew clean && cd ..
```

### "Version code already used" error
Increment the version code in:
- `app.config.js` → `versionCode`
- `android/app/build.gradle` → `versionCode`
- `ios/quotemate/Info.plist` → `CFBundleVersion`

## 📚 Additional Resources

- [Keystore Setup Instructions](./keystore-setup-instructions.md)
- [Download Keystore Script](./download-keystore.sh)
- [EAS Ignore File](./.easignore)

## ✨ What's Configured

✅ Android signing with production keystore
✅ 16 KB memory page size support (Google requirement)
✅ Target SDK 35
✅ All API keys configured in `.env`
✅ React Native New Architecture enabled
✅ Hermes JavaScript engine

---

**Last Updated**: Version 1.0.31 (Build 39) - November 20, 2025
