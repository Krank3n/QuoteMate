# QuoteMate Firebase Functions

Backend functions for managing subscriptions across all platforms.

## Functions

### 1. `createCheckoutSession`
**Purpose:** Creates a Stripe Checkout session for web subscriptions

**Called by:** Web app when user clicks "Subscribe"

**Parameters:**
- `priceId` - Stripe price ID (monthly or yearly)
- `userId` - Firebase user ID
- `successUrl` - Redirect URL after successful payment
- `cancelUrl` - Redirect URL if user cancels

**Returns:** `{ sessionId }` for redirecting to Stripe

---

### 2. `createPortalSession`
**Purpose:** Creates a Stripe billing portal session for managing subscriptions

**Called by:** Web app when user wants to manage subscription

**Parameters:**
- `userId` - Firebase user ID
- `returnUrl` - URL to return to after portal

**Returns:** `{ url }` to billing portal

---

### 3. `getSubscriptionStatus`
**Purpose:** Gets current subscription status for a user

**Called by:** App on startup and when checking subscription

**Parameters:**
- `userId` - Firebase user ID

**Returns:**
```json
{
  "isPremium": true/false,
  "subscriptionId": "sub_xxx",
  "expiryDate": "2024-12-31T23:59:59.000Z",
  "platform": "web"
}
```

---

### 4. `stripeWebhook`
**Purpose:** Handles events from Stripe (payment succeeded, subscription updated, etc.)

**Called by:** Stripe when events occur

**Handles Events:**
- `checkout.session.completed` - Payment successful, save customer ID
- `customer.subscription.created` - New subscription created
- `customer.subscription.updated` - Subscription renewed/changed
- `customer.subscription.deleted` - Subscription cancelled
- `invoice.payment_succeeded` - Payment processed
- `invoice.payment_failed` - Payment failed

**Updates:** Firestore `subscriptions` collection with current status

---

## Firestore Collections

### `users/{userId}`
```json
{
  "stripeCustomerId": "cus_xxx"
}
```

### `subscriptions/{userId}`
```json
{
  "subscriptionId": "sub_xxx",
  "status": "active",
  "currentPeriodStart": "2024-01-01T00:00:00.000Z",
  "currentPeriodEnd": "2024-12-31T23:59:59.000Z",
  "cancelAtPeriodEnd": false,
  "platform": "web",
  "updatedAt": "2024-01-15T12:00:00.000Z"
}
```

---

## Development

### Install Dependencies
```bash
npm install
```

### Build
```bash
npm run build
```

### Test Locally
```bash
npm run serve
```

### Deploy
```bash
npm run deploy
```

### View Logs
```bash
npm run logs
```

---

## Configuration

Set environment variables:

```bash
# Stripe secret key
firebase functions:config:set stripe.secret_key="sk_test_xxx"

# Stripe webhook secret
firebase functions:config:set stripe.webhook_secret="whsec_xxx"
```

View current config:
```bash
firebase functions:config:get
```

---

## Security

- Functions use CORS to accept requests from your app
- Webhook signature verification ensures events are from Stripe
- Firestore rules prevent direct writes to subscription data
- Only authenticated users can read their own subscription status

---

## Testing

### Test Webhook Locally

1. Install Stripe CLI:
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. Login to Stripe:
   ```bash
   stripe login
   ```

3. Forward webhooks to local functions:
   ```bash
   stripe listen --forward-to http://localhost:5001/hansendev/us-central1/stripeWebhook
   ```

4. Trigger test events:
   ```bash
   stripe trigger checkout.session.completed
   ```

### Test Functions Locally

1. Start emulators:
   ```bash
   npm run serve
   ```

2. Call functions:
   ```bash
   curl -X POST http://localhost:5001/hansendev/us-central1/getSubscriptionStatus \
     -H "Content-Type: application/json" \
     -d '{"userId":"test-user-123"}'
   ```

---

## Troubleshooting

### Function won't deploy
- Check Node.js version (should be 18)
- Run `npm install` in functions directory
- Check `firebase.json` configuration

### Webhook not receiving events
- Verify webhook URL in Stripe Dashboard
- Check webhook secret is correct
- View function logs: `firebase functions:log`
- Test with Stripe CLI

### Subscription status not updating
- Check Firestore rules are deployed
- Verify webhook is receiving events
- Check function logs for errors
- Ensure Stripe customer ID is saved

---

## Resources

- [Firebase Functions Documentation](https://firebase.google.com/docs/functions)
- [Stripe API Documentation](https://stripe.com/docs/api)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
