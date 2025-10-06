# QuoteMate - Quick Start Guide

## Get Running in 5 Minutes

### 1. Install Dependencies

```bash
npm install
```

### 2. Get Bunnings API Credentials

**Option A: Use Sandbox (Recommended for Testing)**

1. Visit https://developer.bunnings.com.au/
2. Sign up for a developer account
3. Create a new application
4. Copy your Client ID and Client Secret

**Option B: Skip for Now (Mock Mode)**

The app will work without real credentials but won't fetch real prices.

### 3. Configure Environment

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your credentials (optional)
# If you skip this, the app will still work but won't fetch real prices
```

### 4. Start the App

```bash
npm start
```

### 5. Run on Your Phone

1. Install **Expo Go** from App Store (iOS) or Play Store (Android)
2. Scan the QR code shown in terminal with your phone camera
3. The app will open in Expo Go

**OR run in simulator:**

- Press `i` for iOS Simulator (macOS only)
- Press `a` for Android Emulator

## First Launch

1. **Onboarding Screen** will appear
   - Enter your business name (required)
   - Set default hourly rate (e.g., $85)
   - Set default markup (e.g., 20%)
   - Tap "Get Started"

2. **You're Ready!**
   - Tap "New Quote" to create your first quote
   - Select a template (try "Outdoor Timber Stairs")
   - Enter parameters (e.g., 10 steps)
   - Review materials
   - Tap "Fetch Bunnings Prices" (if API configured)
   - Set labor hours
   - Preview and export PDF

## What Works Without API Credentials?

✅ All app functionality (templates, materials, calculations, PDF export)
✅ Manual price entry
❌ Auto-fetch prices from Bunnings

## Troubleshooting

### "Cannot find expo command"

```bash
npm install -g expo-cli
```

### "Network Error"

- Make sure phone and computer are on same WiFi
- Check firewall settings

### "TypeScript Errors"

```bash
npm run build
```

## Next Steps

- Customize job templates in `src/data/jobTemplates.ts`
- Change theme colors in `src/theme.ts`
- Add your logo to assets folder
- Build for production: `expo build:ios` or `expo build:android`

## Need Help?

- Check README.md for detailed documentation
- Open an issue on GitHub
- Email support@quotemate.com.au

Happy Quoting! 🛠️
