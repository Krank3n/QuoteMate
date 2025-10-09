# Quick Upload Checklist for Google Play

## ✅ Prerequisites Ready
- [x] AAB file built: `android/app/build/outputs/bundle/playRelease/app-play-release.aab` (47 MB)
- [x] Certificate file ready: `upload_certificate.pem` (1.3 KB)
- [x] Version: 9 (1.0.6)

## Step-by-Step Checklist

### Part 1: Update Upload Certificate (One-time setup)

**Open Google Play Console:**
1. [ ] Go to: https://play.google.com/console
2. [ ] Log in with your Google account
3. [ ] Select app: **QuoteMate** (com.quotemate.app)

**Navigate to App Signing:**
4. [ ] Click **"Setup"** in left sidebar
5. [ ] Click **"App signing"**

**Upload Certificate:**
6. [ ] Scroll to **"Upload key certificate"** section
7. [ ] Look for button: **"Request upload key reset"** OR **"Add new upload key"**
8. [ ] Click the button
9. [ ] Upload file: `upload_certificate.pem` from project root
10. [ ] Submit/Confirm

**Wait for Approval:**
11. [ ] Check for confirmation (usually instant)
12. [ ] Look for email notification
13. [ ] Refresh page to verify certificate is registered

### Part 2: Upload Version 9

**Create Release:**
14. [ ] Click **"Production"** in left sidebar
15. [ ] Click **"Releases"** or **"Create new release"**

**Upload AAB:**
16. [ ] Click **"Upload"** in App bundles section
17. [ ] Select file: `android/app/build/outputs/bundle/playRelease/app-play-release.aab`
18. [ ] Wait for processing (5-10 minutes)

**Add Release Notes:**
19. [ ] Fill in release notes (see template below)
20. [ ] Review all information

**Submit:**
21. [ ] Click **"Review release"**
22. [ ] Click **"Start rollout to Production"**
23. [ ] Confirm submission
24. [ ] Wait for review (1-3 days)

---

## Release Notes Template

Copy and paste this:

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

---

## Certificate Info (if needed)

**SHA-1 Fingerprint:**
```
6B:81:01:E7:94:7C:D5:0F:48:0D:52:38:77:C5:9C:B2:92:C5:BF:5B
```

**SHA-256 Fingerprint:**
```
0A:69:BC:9E:CA:AE:40:DA:68:E8:C6:5E:B3:F5:5F:A8:1B:4E:53:E5:D1:92:93:90:76:94:9A:B1:4E:11:27:7C
```

---

## Troubleshooting

**"No option to add upload key":**
- Look for "Request upload key reset" instead
- Or contact Google Play support

**"Certificate format error":**
- Make sure you're uploading `upload_certificate.pem`
- File should start with `-----BEGIN CERTIFICATE-----`

**"Version code already used":**
- Edit `android/app/build.gradle`
- Change `versionCode` to 10
- Rebuild: `./gradlew clean && ./gradlew bundlePlayRelease`

**"Upload failed":**
- Check file size (should be ~47 MB)
- Try uploading again after clearing browser cache

---

## After Upload

Once submitted:
- Check email for review updates
- Monitor **Production** tab in Google Play Console
- Typical review: 1-3 days
- You'll get email when app is live

**Future builds:**
- Just run `./build-local.sh`
- Upload the AAB
- No need to update certificate again!

