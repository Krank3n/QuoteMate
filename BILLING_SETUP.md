# Google Play Billing Setup Guide

## Step 1: Create Subscription Products in Google Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Select your app (QuoteMate)
3. Navigate to **Monetize** → **Subscriptions**
4. Click **Create subscription**

### Monthly Subscription
- **Product ID**: `quotemate_premium_monthly`
- **Name**: QuoteMate Pro Monthly
- **Description**: Unlimited quotes with AI-powered material suggestions and live Bunnings pricing
- **Billing period**: 1 month
- **Price**: $19.99 AUD (or your preferred price)
- **Free trial**: Optional (recommend 7 days)
- **Grace period**: 3 days (recommended)

### Yearly Subscription
- **Product ID**: `quotemate_premium_yearly`
- **Name**: QuoteMate Pro Yearly
- **Description**: Unlimited quotes with AI-powered material suggestions and live Bunnings pricing - Save 20%!
- **Billing period**: 1 year
- **Price**: $199.99 AUD (20% discount vs monthly)
- **Free trial**: Optional (recommend 7 days)
- **Grace period**: 3 days (recommended)

## Step 2: Configure Base Plans

For each subscription, create a **Base Plan**:
1. Select **Auto-renewing**
2. Set renewal type to **Prepaid**
3. Configure the billing period
4. Set the price

## Step 3: Add Test Users (for testing)

1. Go to **Setup** → **License testing**
2. Add test email addresses
3. Test users can purchase subscriptions without being charged

## Step 4: Integration Complete!

The app is already integrated with:
- ✅ React Native IAP (Google Play Billing Library 7+)
- ✅ Subscription store with local state management
- ✅ Paywall screen with 5 quote limit
- ✅ Purchase flow with receipt validation
- ✅ Subscription status checking

## How It Works

### Free Tier
- Users get 5 free quotes
- Counter increments each time a quote is created
- When limit is reached, paywall screen appears

### Premium Tier
- Unlimited quotes
- All premium features unlocked
- Subscription managed through Google Play

## Testing

### In Development
1. Use test emails added in Play Console
2. Install app on device (not simulator)
3. Make test purchase (won't be charged)
4. Verify subscription activates

### Test Purchase Flow
```bash
# Build and install test version
eas build --platform android --profile preview
# Install on device
# Try creating 6th quote
# Verify paywall appears
# Complete test purchase
# Verify unlimited quotes unlocked
```

## Important Product IDs

These must match exactly in Google Play Console:
- Monthly: `quotemate_premium_monthly`
- Yearly: `quotemate_premium_yearly`

## Files Modified

- `src/services/billingService.ts` - Billing integration
- `src/store/subscriptionStore.ts` - Subscription state management
- `src/screens/PaywallScreen.tsx` - Updated UI with real billing
- `package.json` - Added react-native-iap

## Next Steps

1. Create the subscription products in Google Play Console (follow Step 1 above)
2. Add test users for testing
3. Build and test the app
4. Submit for review with billing enabled

## Support

If users have billing issues, they can:
- Manage subscription in Google Play Store
- Contact support at developer@quotemate.app
- View subscription status in app settings
