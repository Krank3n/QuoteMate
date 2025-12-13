# How to Enable Reece API from Settings

## Quick Steps

1. **Open Settings**
   - Navigate to the Settings screen in QuoteMate

2. **Find Hardware Store Section**
   - Scroll down to the "Hardware Store" section
   - You'll see "More Accurate Pricing" at the top

3. **Enable Reece**
   - Look for "Reece Plumbing" with a green "NEW" badge
   - Tap on the Reece option
   - If not already enabled, you'll see a dialog asking if you want to enable it
   - Tap "Enable" to turn on Reece API integration

4. **Save Settings**
   - Scroll to the bottom
   - Tap "Save Settings"

5. **Done!**
   - Reece API is now active
   - Your material searches will now include Reece plumbing supplies
   - You can access quotes, pricing, and branch information

## What You'll See

### Before Enabling
- **Reece Plumbing** appears with:
  - Dimmed/disabled appearance
  - "API Integration (Tap to Enable)" text
  - Green "NEW" badge

### After Enabling
- **Reece Plumbing** appears with:
  - Normal appearance
  - "API Integration ✓" text
  - Green checkmark icon
  - Radio button selected if Reece is your choice

### Info Box
When Reece is selected, you'll see:
> "Reece Plumbing is selected. Real prices will be fetched using the Reece API for plumbing supplies, quotes, and invoices."

## What Happens Next

Once enabled and saved, Reece API will be used for:

1. **Material Price Lookups**
   - When adding materials to quotes
   - Real pricing from Reece catalogue
   - Product search with actual SKUs

2. **Quote Access**
   - View your existing Reece quotes
   - Get quote details
   - See line items and pricing

3. **Branch Information**
   - Find nearest Reece branches
   - Get contact details
   - See opening hours

4. **Order Creation**
   - Create orders from quotes
   - Choose pickup or delivery
   - Track order status

5. **Invoice Access**
   - View invoice history
   - Download invoice PDFs
   - Track payments

## Visual Guide

```
┌─────────────────────────────────────┐
│     Hardware Store Settings         │
├─────────────────────────────────────┤
│                                     │
│ ✓ More Accurate Pricing             │
│                                     │
│ ○ Bunnings                          │
│   Web Search                    ✓   │
│                                     │
│ ○ Reece Plumbing              [NEW] │  ← Tap this!
│   API Integration (Tap to Enable)   │
│                                     │
├─────────────────────────────────────┤
│                                     │
│ ≈ Guestimates                       │
│                                     │
│ ○ Mitre 10                          │
│ ○ Home Timber & Hardware            │
│ ...                                 │
│                                     │
└─────────────────────────────────────┘
```

## After Enabling

```
┌─────────────────────────────────────┐
│     Hardware Store Settings         │
├─────────────────────────────────────┤
│                                     │
│ ✓ More Accurate Pricing             │
│                                     │
│ ○ Bunnings                          │
│   Web Search                    ✓   │
│                                     │
│ ● Reece Plumbing                ✓   │  ← Selected!
│   API Integration ✓                 │
│                                     │
├─────────────────────────────────────┤
│  ℹ️  Reece Plumbing is selected.    │
│      Real prices will be fetched    │
│      using the Reece API.           │
└─────────────────────────────────────┘
```

## Features Available

Once enabled, you have access to:

### Product Search
- Search 40,000+ plumbing products
- Get real-time pricing
- View product images
- See available units of measure

### Quote Management
- View all your Reece quotes
- Filter by date and status
- Get detailed line items
- See pricing breakdown

### Order Creation
- Create orders from quotes
- Choose delivery or pickup
- Add order notes
- Attach documents

### Invoice Access
- View invoice history
- Download PDFs
- See payment status
- Filter by date

### Branch Information
- Find nearest branches
- Get contact details
- View opening hours
- See branch services

## Test Credentials

The implementation uses test credentials, so you can start testing immediately:
- Test environment API access
- No production charges
- Full feature access
- Safe for development

## Production Use

To use in production:
1. Contact Reece: ConnectingCustomers@reece.com.au
2. Get production API credentials
3. Update .env file
4. Deploy your app

## Troubleshooting

### "Reece is dimmed/disabled"
- Tap on it once to see the enable dialog
- Tap "Enable" to turn it on
- Make sure to save settings

### "Changes not saving"
- Make sure you tap "Save Settings" at the bottom
- Wait for the success message
- Reload the settings screen to verify

### "API not working"
- Check your internet connection
- Verify test credentials in .env
- Check console for errors
- See REECE_API_USAGE.md for debugging

## Need Help?

- **Quick Start**: See `REECE_QUICK_START.md`
- **Full Docs**: See `REECE_API_USAGE.md`
- **Integration**: See `REECE_INTEGRATION_GUIDE.md`
- **Support**: ConnectingCustomers@reece.com.au

## Summary

1. ✅ Open Settings
2. ✅ Find "Reece Plumbing" in Hardware Store section
3. ✅ Tap to enable (shows dialog)
4. ✅ Tap "Enable" button
5. ✅ Tap "Save Settings"
6. ✅ Done! Reece API is now active

The integration is fully functional and ready to use with test credentials!
