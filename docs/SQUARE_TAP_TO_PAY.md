# Square Tap to Pay rollout

Phase 2 wires Square's Mobile Payments SDK into QuoteMate so tradies can take card payments on-device — Tap to Pay on iPhone (iOS 16.4+ on iPhone XS or later), contactless on NFC-capable Android, manual key-in everywhere, and Apple Pay / Google Pay through Square's native sheet.

## Status

- ✅ Backend: `getSquareMobileAuthCode`, `recordInAppSquarePayment`, `PAYMENTS_WRITE_IN_PERSON` scope
- ✅ Native install via `plugins/withSquareSDK.js` config plugin
- ✅ JS service: `src/services/squarePayments.ts` (`takeInAppPayment`)
- ✅ Feature-flag gate: `src/hooks/useTapToPayEnabled.ts` reads Firestore `config/squareTapToPay`
- ✅ UI: `TakePaymentSheet` Tap-to-Pay row enabled when flag + device capability allow
- ⏳ Apple Tap-to-Pay entitlement (manual; see below)

## Run the prebuild

The config plugin needs to apply to the existing `ios/` and `android/` folders.

```bash
npx expo prebuild --platform all --clean
cd ios && pod install && cd ..
```

`--clean` is safe because every native edit lives in a config plugin (`withKotlinVersion`, `withSquareSDK`, `expo-build-properties`, etc.) — nothing is hand-edited in `ios/` or `android/`.

After prebuild, sanity-check that:
- `ios/QuoteMate/AppDelegate.swift` contains `MobilePaymentsSDK.initialize(...)`
- `ios/QuoteMate/Info.plist` contains `NFCReaderUsageDescription`
- `android/build.gradle` contains `squareSdkVersion` and the Square maven repo
- `android/app/build.gradle` contains `com.squareup.sdk:mobile-payments-sdk`
- `android/app/src/main/java/.../MainApplication.kt` contains `MobilePaymentsSdk.initialize(...)`

## Build a dev client

```bash
eas build --profile development --platform android  # ships first
eas build --profile development --platform ios      # waits on Apple entitlement for Tap to Pay
```

Tap to Pay cannot be tested on the iOS Simulator or Android emulator — you need a real iPhone XS+ on iOS 16.4+ or an NFC-capable Android device.

## Enable the feature flag

Tap to Pay is OFF by default. Flip it on by writing to Firestore:

```
config/squareTapToPay
{
  "ios": false,        // flip to true once Apple approval lands and the build with the entitlement ships
  "android": true      // ship Android immediately
}
```

The hook re-reads this on every `TakePaymentSheet` mount so changes propagate without an app release.

## Apple Tap-to-Pay entitlement (iOS only)

1. Sign in at https://developer.apple.com → Identifiers → `com.hansendev.quotemate` → enable **Tap to Pay on iPhone** capability. This requires requesting access from Apple via the linked form.
2. Apple reviews (1–4 weeks). They contact you if they need more info about the use case.
3. After approval:
   - Open `ios/QuoteMate/QuoteMate.entitlements` and add:
     ```xml
     <key>com.apple.developer.proximity-reader.payment.acceptance</key>
     <true/>
     ```
   - Or add a `withEntitlementsPlist` step inside `withSquareSDK.js` so prebuild applies it automatically.
4. Bump the iOS build, ship via TestFlight, then flip `config/squareTapToPay.ios = true`.

Until step 3 lands, the iOS row in `TakePaymentSheet` says *"Coming soon on iPhone — pending Apple approval"*.

## OAuth scope migration

The new `PAYMENTS_WRITE_IN_PERSON` scope is required for Tap to Pay. Existing connected sellers will need to **disconnect and reconnect** Square once to re-grant scopes — the Square Integration screen will surface this as a `disconnectedReason: 'scope_mismatch'` if Square refuses to refresh. Plan a one-line in-app banner before flipping `android: true` for existing tradies.

## Auth flow at runtime

1. `takeInAppPayment` checks `getAuthorizationState()`.
2. If `NOT_AUTHORIZED`, calls our `getSquareMobileAuthCode` Cloud Function — that returns a **short-lived** authorization code scoped to the seller's location (NEVER the long-lived OAuth access token).
3. Passes the code to the SDK's `authorize(code, locationId)`. SDK stores the resulting session.
4. Calls `startPayment(...)` with `idempotencyKey = qm-<kind>-<id>-<ts>`.
5. On success, calls `recordInAppSquarePayment` to prime the `squarePaymentOrders/{orderId}` index used by the existing Square webhook. The webhook is the source of truth for status flips.

## Failure modes worth knowing

- **`NOT_AUTHORIZED` after long idle** — the SDK auto-deauths if the session expires. `ensureAuthorized()` re-mints transparently.
- **User cancels at the payment sheet** — surfaces as an error with `cancel` in the message; `TakePaymentSheet` swallows it silently.
- **Webhook didn't fire** — `recordInAppSquarePayment` ensures the orderId index is populated even if the webhook is delayed; once it arrives, the existing handler reconciles.
- **Seller disconnected Square mid-payment** — `getMobileAuthCode` returns 401, surfaced as *"Square is not connected. Reconnect from Settings."*

## Sandbox testing without a card

The SDK supports mock readers in sandbox. We're shipping production-only per the agreed scope, so sandbox testing requires temporarily switching `SQUARE_APP_ID_PRODUCTION` in `.env` to the sandbox app ID and rebuilding. Don't forget to switch back.
