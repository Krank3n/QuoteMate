# Square Payments — integration notes

QuoteMate uses Square for on-site and remote customer payments. This doc
covers the runtime architecture, the env vars you need to set, and what is
still deferred (Phase 2).

## Current state — what ships in this branch

**Phase 0 — foundation**
- OAuth: `getSquareAuthUrl` / `squareCallback` / `squareDisconnect` /
  `checkSquareConnection` in `functions/src/index.ts`. Tokens live at
  `users/{uid}/settings/squareConnection` with `{ accessToken, refreshToken,
  tokenExpiresAt, merchantId, locationId, mode, ... }`. Auto-refresh on
  access-token expiry inside `getSquareTokens`.
- Hosted callback page: `public/square/callback/index.html` — set your Square
  app's redirect URI to `https://quotemateapp.au/square/callback`.
- Webhook: `squareWebhook` verifies `x-square-hmacsha256-signature` and
  reconciles `payment.updated` events by looking up
  `squarePaymentOrders/{orderId}` (written at pay-link mint or
  `recordInAppSquarePayment` time).
- Pay-link minting: `createSquarePaymentLink({ kind, targetId })` for
  `invoice` and `quote_deposit`. Idempotent on `amount + kind`.
- Firestore rules: `squarePaymentOrders/{orderId}` is backend-write, owner-read.
- Settings screen: `SquareIntegrationScreen` (parallel to Xero).

**Phase 1 — share pay link**
- `TakePaymentSheet` bottom sheet with three rows: Card Entry, Apple/Google
  Pay, Share Pay Link. Only the share row is active in this phase.
- "Take Payment" button on `ViewInvoiceScreen` (when invoice has a balance and
  Square is connected).
- "Take Deposit" button on `ViewQuoteScreen` (when quote is accepted,
  `depositPercent > 0`, and Square is connected).

## Env / config

Set these secrets on Firebase Functions (`firebase functions:secrets:set
NAME`):

| Name | Purpose |
|------|---------|
| `SQUARE_APPLICATION_ID` | OAuth app id from Square Developer dashboard. |
| `SQUARE_APPLICATION_SECRET` | OAuth app secret. |
| `SQUARE_MODE` | `sandbox` (default) or `production`. |
| `SQUARE_REDIRECT_URI` | Optional; defaults to `https://quotemateapp.au/square/callback`. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | HMAC key from the Square webhook config. |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Full https URL of the deployed `squareWebhook` function (used in the HMAC message). |

Square dashboard configuration:
1. **OAuth redirect URL**: `https://quotemateapp.au/square/callback`
2. **Webhook subscription**: `payment.updated` + `payment.created`, pointed at
   `https://us-central1-hansendev.cloudfunctions.net/squareWebhook` (or
   whatever `SQUARE_WEBHOOK_NOTIFICATION_URL` resolves to).
3. **Scopes**: `PAYMENTS_WRITE PAYMENTS_READ ORDERS_WRITE ORDERS_READ
   MERCHANT_PROFILE_READ PAYMENTS_WRITE_IN_PERSON`.

## Phase 2 — deferred

The UI rows for "Card Entry" and "Apple / Google Pay" in `TakePaymentSheet`
are present but disabled. To enable them:

### Phase 2a — Mobile Payments SDK (card / Apple Pay / Google Pay)

1. **Add the package**
   ```bash
   npm i mobile-payments-sdk-react-native
   ```

2. **Expo config plugin** — add to `app.config.js` `plugins` array:
   ```js
   [
     'mobile-payments-sdk-react-native',
     { /* plugin options — see Square's docs */ },
   ]
   ```
   Bump `expo-build-properties` iOS `deploymentTarget` to `16.4` if Square's
   minimum has moved.

3. **EAS dev-client rebuild** — first rebuild after adding the native module:
   ```bash
   eas build --profile development --platform all
   ```
   Around 30 min on EAS. Anyone pulling after this lands needs a fresh client.

4. **Wire the SDK in `squareService.ts`** — the helpers
   `getMobileAuthCode()` and `recordInAppPayment(...)` are already deployed.
   Replace the greyed-out method rows in `src/components/TakePaymentSheet.tsx`
   with live handlers that:
   - call `squareService.getMobileAuthCode()`
   - hand the authorization code to the SDK
   - open the SDK's payment sheet for `CARD`, `APPLE_PAY`, or `GOOGLE_PAY`
   - on success, call `squareService.recordInAppPayment({ kind, targetId,
     paymentId, orderId, amountCents })` so the webhook reconciles status
   - on failure, surface the error via `onError`.

### Phase 2b — Tap to Pay on iPhone

1. Apply for Apple's Tap-to-Pay-on-iPhone entitlement via App Store Connect
   **on day 1 of Phase 2b** — 1–5 business days.
2. Use the SDK's device-eligibility check before rendering the Tap to Pay row;
   hide it with the copy *"Tap to Pay isn't available on this device. Use
   card entry, Apple Pay, or share a link instead."* on ineligible devices.
3. App Store review notes: explain the app accepts payments for trade
   services and briefly describe Tap to Pay usage.

## Verification

**Phase 0**
- Connect Square in sandbox from Settings → Square Payments.
- POST to `createSquarePaymentLink` with `{ kind: 'invoice', targetId: <id> }`
  → get back a `paymentLinkUrl`. Complete sandbox payment in a browser.
- Confirm `squareWebhook` fires, `squarePaymentOrders/{orderId}` index is
  written, invoice `status` flips to `paid`, `paidAmount` updated.

**Phase 1**
- On a real device: invoice → Take Payment → Share Pay Link → share sheet
  shows `Pay $X for {job}: {url}`.
- Paste in a browser → complete sandbox payment → invoice auto-flips to paid.
- Repeat for a quote with `depositPercent > 0`.

**Phase 2a/2b**: see the plan file
`/root/.claude/plans/golden-giggling-wilkes.md`.

## Key files

| Path | Role |
|------|------|
| `functions/src/index.ts` (search for "Square Payments integration") | All backend functions. |
| `src/services/squareService.ts` | Client wrappers. |
| `src/screens/settings/SquareIntegrationScreen.tsx` | Connect / disconnect UI. |
| `src/components/TakePaymentSheet.tsx` | Payment-method picker (Phase 1 share-link live, Phase 2 rows greyed). |
| `src/screens/ViewInvoiceScreen.tsx` / `ViewQuoteScreen.tsx` | Entry points. |
| `public/square/callback/index.html` | OAuth redirect page. |
| `firestore.rules` | `squarePaymentOrders` rule. |
