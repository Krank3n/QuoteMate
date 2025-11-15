# How to Reload Environment Variables in QuoteMate

## The Problem
React Native/Expo caches environment variables from `.env` during the Metro bundler process. When you change `.env` values, the app continues using the old cached values until you clear the cache and restart.

## Current Issue
The app is still using:
```
http://localhost:3002  ❌ (old value)
```

Instead of:
```
http://165.22.151.190  ✅ (new production value)
```

## Solution: Clear Cache and Restart

### Option 1: Quick Restart with Cache Clear
```bash
# Stop the current Expo server (Ctrl+C in the terminal)

# Clear all caches
npm start -- --clear

# Or if using Expo CLI directly
npx expo start --clear
```

### Option 2: Full Clean Restart (Recommended)
```bash
# Stop the current Expo server (Ctrl+C)

# Clear all possible caches
rm -rf node_modules/.cache
rm -rf .expo
watchman watch-del-all  # If you have watchman installed

# Restart with clean cache
npm start -- --clear
```

### Option 3: Nuclear Option (If above don't work)
```bash
# Stop Expo server

# Clear everything
rm -rf node_modules
rm -rf .expo
rm -rf node_modules/.cache
watchman watch-del-all

# Reinstall and restart
npm install
npm start -- --clear
```

## Verify It Worked

After restarting, check the console logs when you click "Fetch Prices":

### Before (Wrong):
```
💡 Pricing method settings: {
  "scraperUrl": "http://localhost:3002",  ❌
  ...
}
```

### After (Correct):
```
💡 Pricing method settings: {
  "scraperUrl": "http://165.22.151.190",  ✅
  ...
}
```

## Why This Happens

React Native uses several layers of caching:
1. **Metro Bundler** - JavaScript bundler cache
2. **Babel Cache** - Transpilation cache (includes `@env` module)
3. **Watchman** - File watching cache (macOS)
4. **Expo Cache** - Expo-specific caches

The `react-native-dotenv` plugin reads `.env` during the Babel transformation step, so it gets baked into the bundle and cached.

## Quick Reference

| Action | Command |
|--------|---------|
| Start with cache clear | `npm start -- --clear` |
| Clear watchman | `watchman watch-del-all` |
| Clear Metro cache | `rm -rf node_modules/.cache` |
| Clear Expo cache | `rm -rf .expo` |
| Full reinstall | `rm -rf node_modules && npm install` |

## For Production Builds

For production builds (not development), you also need to:

### iOS
```bash
cd ios
pod install
cd ..
npx expo run:ios --configuration Release
```

### Android
```bash
cd android
./gradlew clean
cd ..
npx expo run:android --variant release
```

## Troubleshooting

### Still showing old values?
1. Make sure you saved the `.env` file
2. Verify the `.env` file contains the correct values:
   ```bash
   grep BUNNINGS_SCRAPER .env
   ```
3. Try the Nuclear Option above
4. Check if there's a `.env.local` file overriding values

### Getting 403 errors?
This is expected right now - the scraper API is being blocked by bot detection. The issue is not with loading the environment variables, but with the scraper itself being blocked by Bunnings.

Once the environment variables are loaded correctly, you'll see:
```
✅ scraperUrl: "http://165.22.151.190"
❌ 403: Access forbidden - possible bot detection
```

This is progress! It means the URL is correct, but the scraper needs to be updated to bypass bot detection.
