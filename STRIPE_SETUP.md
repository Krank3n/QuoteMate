# Stripe Test/Live Mode Setup

This project is configured to use **Stripe Test Mode** for development and **Live Mode** for production.

## Current Configuration

✅ **Development Mode is now active (Test Keys)**

Both the frontend and backend are now configured to use Stripe test keys, which means:
- No real money will be charged
- You can use Stripe's test credit cards
- Webhooks will use test mode events
- All transactions are in sandbox

## Test Credit Cards

When testing, use these Stripe test cards:

### Successful Payment
- **Card Number**: `4242 4242 4242 4242`
- **Expiry**: Any future date (e.g., `12/34`)
- **CVC**: Any 3 digits (e.g., `123`)
- **ZIP**: Any 5 digits (e.g., `12345`)

### Test 3D Secure Authentication
- **Card Number**: `4000 0027 6000 3184`
- Requires authentication step (simulates real 3D Secure flow)

### Declined Card
- **Card Number**: `4000 0000 0000 0002`
- Will always decline

More test cards: https://stripe.com/docs/testing#cards

## Environment Files Updated

### 1. Root `.env`
```bash
STRIPE_MODE=test  # Changed from 'live' to 'test'
```

### 2. `functions/.env`
```bash
STRIPE_MODE=test  # Changed from 'live' to 'test'
```

### 3. Firebase Functions Config
```bash
stripe.mode=test  # Updated via firebase functions:config:set
```

## Switching to Live Mode (Production Only)

⚠️ **WARNING**: Only switch to live mode when deploying to production!

### Before Switching
1. Ensure all test transactions are completed
2. Verify webhook endpoints are configured in Stripe Dashboard
3. Update webhook secrets in environment variables
4. Test thoroughly in test mode first

### Steps to Switch

1. **Update root `.env`**:
   ```bash
   STRIPE_MODE=live
   ```

2. **Update `functions/.env`**:
   ```bash
   STRIPE_MODE=live
   ```

3. **Update Firebase Functions config**:
   ```bash
   firebase functions:config:set stripe.mode="live"
   ```

4. **Deploy functions** (required after config change):
   ```bash
   firebase deploy --only functions
   ```

5. **Restart your development server** to pick up the new environment variables

## How It Works

### Frontend (stripeConfig.ts)
- Reads `STRIPE_MODE` from `.env`
- Defaults to `test` if not specified
- Loads appropriate publishable key and price IDs

### Backend (functions/src/index.ts)
- Reads `STRIPE_MODE` from environment or Firebase config
- Selects appropriate secret key (test or live)
- All Stripe API calls use the selected key

## Verifying Current Mode

When you run the app, check the console logs:

```
🔑 Stripe Mode: TEST
🔑 Using TEST keys
```

Or for live mode:
```
🔑 Stripe Mode: LIVE
🔑 Using LIVE keys
```

## Stripe Dashboard

- **Test Mode Dashboard**: https://dashboard.stripe.com/test/dashboard
- **Live Mode Dashboard**: https://dashboard.stripe.com/dashboard

Make sure you're viewing the correct mode in the Stripe Dashboard to see your test/live transactions.

## Testing Subscriptions

1. Start the app: `npm start` or `npm run web`
2. Navigate to the Paywall screen
3. Click "Subscribe"
4. Use a test credit card (see above)
5. Complete the checkout
6. Check the Stripe Test Dashboard for the subscription

## Troubleshooting

### "No such price" error
- Ensure the price IDs in `.env` match the prices created in your Stripe Test Dashboard
- Verify you're using test price IDs (start with `price_test_...`) in test mode

### Webhooks not working
- For local development, use Stripe CLI to forward webhooks:
  ```bash
  stripe listen --forward-to http://localhost:5001/hansendev/us-central1/stripeWebhook
  ```
- Update `STRIPE_WEBHOOK_SECRET` with the signing secret from the CLI output

### Functions config not updating
- After changing Firebase Functions config, you must redeploy:
  ```bash
  firebase deploy --only functions
  ```

## Migration Note

⚠️ Firebase is deprecating `functions.config()` API. The current setup already supports both:
- Environment variables (`.env` files) - **Recommended**
- Firebase Functions config - **Deprecated but still works**

The code prioritizes environment variables, so the `.env` files should work for local development without needing Firebase Functions config.
