# Square Tap to Pay rollout

Phase 2 wires Square's Mobile Payments SDK into QuoteMate so tradies can take card payments on-device — Tap to Pay on iPhone (iOS 16.4+ on iPhone XS or later), contactless on NFC-capable Android, manual key-in everywhere, and Apple Pay / Google Pay through Square's native sheet.

## Status

- ✅ Backend: `getSquareMobileAuthCode`, `recordInAppSquarePayment`, `PAYMENTS_WRITE_IN_PERSON` scope
- ✅ Native install via `plugins/withSquareSDK.js` config plugin
- ✅ JS service: `src/services/squarePayments.ts` (`takeInAppPayment`)
- ✅ Feature-flag gate: `src/hooks/useTapToPayEnabled.ts` reads Firestore `config/squareTapToPay`
- ✅ UI: `TakePaymentSheet` Tap-to-Pay row enabled when flag + device capability allow
- ✅ Apple Tap-to-Pay entitlement — **granted 16 Apr 2026, development distribution only** (Case-ID 19476927)
- ⏳ Apple **publishing** entitlement — needs three flow videos + checklist (see below). This is the real gate.
- ⏳ App requirements from Apple's review guide v1.6 — most now met; outstanding: **3.1–3.3** (awareness moment, blocked on Apple's Marketing Toolkit), **5.5** (SF Symbol icon), **1.4** (osVersionNotSupported), **5.10** (receipt on decline), and the **AU surcharging** conflict

## Run the prebuild

The config plugin needs to apply to the existing `ios/` and `android/` folders.

```bash
npx expo prebuild --platform all --clean
cd ios && pod install && cd ..
```

`--clean` is safe because every native edit lives in a config plugin (`withKotlinVersion`, `withSquareSDK`, `expo-build-properties`, etc.) — nothing is hand-edited in `ios/` or `android/`.

After prebuild, sanity-check that:
- `ios/QuoteMate/AppDelegate.swift` contains `MobilePaymentsSDK.initialize(...)`
- `ios/QuoteMate/QuoteMate.entitlements` contains `com.apple.developer.proximity-reader.payment.acceptance`
- `ios/QuoteMate/Info.plist` contains `NSLocationWhenInUseUsageDescription` and does **not** contain `NFCReaderUsageDescription`
- `android/build.gradle` contains `squareSdkVersion` and the Square maven repo
- `android/app/build.gradle` contains `com.squareup.sdk:mobile-payments-sdk`
- `android/app/src/main/java/.../MainApplication.kt` contains `MobilePaymentsSdk.initialize(...)`

## Build a dev client

```bash
eas build --profile development --platform android  # ships first
eas build --profile development --platform ios      # or: npx expo run:ios --device <udid>
```

Tap to Pay cannot be tested on the iOS Simulator or Android emulator — you need a real iPhone XS+ on iOS 16.7+ or an NFC-capable Android device.
The iPhone must be **registered as a test device** on the developer account: the development entitlement signs for registered devices only.

## Enable the feature flag

Tap to Pay is OFF by default. Flip it on by writing to Firestore:

```
config/squareTapToPay
{
  "ios": false,        // flip only after the PUBLISHING entitlement lands and that build ships
  "android": true      // ship Android immediately
}
```

The hook re-reads this on every `TakePaymentSheet` mount so changes propagate without an app release.

## Apple entitlement: two stages, not one

Apple grants Tap to Pay in two steps, and it is easy to think you're blocked when you're
only half-blocked.

**Stage 1 — development entitlement. DONE.** Granted 16 Apr 2026 by Wallet Entitlements
(Case-ID 19476927) for team 5GHUTAV35B, PSP Square, Australia first. Distribution is
limited to registered test devices. The App ID carries the managed capability, so
`expo prebuild` + automatic signing produces a build that runs Tap to Pay on a registered
iPhone today.

**Stage 2 — publishing entitlement. OUTSTANDING.** Required for TestFlight and the App
Store. To get it, build the app to meet Apple's requirements, then **reply to the original
entitlement email** (`ttpoientitlements@apple.com`, quoting Case-ID 19476927) and upload to
Apple's File Uploader:

1. A video recording of the **Onboarding flow**
2. A video recording of the **Enabling Tap to Pay and Educating Merchants flow**
3. A video recording of the **Checkout flow**
4. A completed **App Review Requirements Checklist**

Both requirement documents live at <https://apple.box.com/v/ttpoirequirements> — currently
v1.6, refreshed 26 Aug 2026. Pull the live copy; don't work from a download.

> **The checkout video cannot be screen-recorded.** Apple: *"Use another device to record
> the Checkout flow video as the Tap to Pay on iPhone UI screens won't work for screen
> recordings."* The ProximityReader UI is excluded from screen capture and records as
> black. Film the phone with a second camera. Videos 1 and 2 screen-record fine over USB.

Only after the publishing entitlement lands do you submit to App Review — which is itself a
special review for entitlement-bearing apps.

### No Square reader needed

An earlier note in this repo said the demo was blocked on "no Square reader on hand". That
was a misread: with Tap to Pay the iPhone *is* the terminal. You need an eligible iPhone
(XS or later, iOS 16.7+), a connected AU Square seller account, and a contactless card or a
phone with Apple Pay.

### `NFCReaderUsageDescription` stays out

Square documents exactly three required privacy keys — Bluetooth, Location, Microphone.
NFC is not one of them, because Tap to Pay runs on ProximityReader rather than CoreNFC.
Setting the NFC key put us into the CoreNFC "needs a hardware demo video" review path
(Guideline 2.1) in Apr 2026. See the comment in `plugins/withSquareSDK.js`.

## What Apple still wants

Requirement numbers below are from the App Review Requirements Checklist v1.6. These have
to be true *before* the videos are shot, because the videos are the evidence.

| Req | Apple requires | State |
| --- | --- | --- |
| 1.4 | Handle `osVersionNotSupported` below iOS 17.6 | missing |
| 1.5 | Warm up the reader on launch and on foreground | ✅ `warmUpTapToPay()` on launch + AppState active (`App.tsx`) |
| 1.6 | Read T&C acceptance from Apple, not a local variable | ✅ every path reads `isAppleAccountLinked()` live |
| 3.1–3.3 | Awareness moment, splash modal, one push to all eligible users | **blocked** — must use Apple Marketing Toolkit assets/copy, which we don't have yet |
| 3.4 | Show how to enable at the end of onboarding | ✅ on the Payments step once Square connects |
| 3.5 | A clear action to accept the Tap to Pay T&Cs | ✅ `linkAppleAccountIfNeeded()` wired into all three paths |
| 3.7 / 5.3 | Button never greyed out; pressing it opens T&C acceptance | ✅ terms gate moved to press; row never disabled |
| 3.9.1 | Configuration progress indicator while the reader prepares | ✅ `observeTapToPayReadiness()` → `useTapToPayReadiness` |
| 4.1 | `ProximityReaderDiscovery` for merchant education on iOS 18+ | ✅ `modules/tap-to-pay-education` (local Expo module). Clears 4.4/4.6/4.7/4.8 |
| 4.2 / 4.3 | Education after T&Cs, findable again in Settings | ✅ on fresh acceptance; "How Tap to Pay works" row in Square settings |
| 5.2 | Button reachable without scrolling, top of the list | ✅ already |
| 5.4 / 5.5 | Approved copy; SF Symbol `wave.3.right.circle` | copy ✅ (`tapToPayRowTitle`); **icon still outstanding** — needs `expo-symbols` (native dep + rebuild) |
| 5.10 | Digital receipt on approve *and* decline | partial — confirm the decline path |

### Australia-specific

- **PIN entry in education** applies everywhere except JP and TW, so it applies here.
- **Surcharging** applies to AU and BR only, and it is a live conflict. Apple requires the
  surcharge be shown on its own Tap to Pay screen via the surcharge API. QuoteMate instead
  bakes `PASSTHROUGH_SURCHARGE_PCT` into `amountCents` and passes
  `allowCardSurcharge: false`, so Apple's screen shows a grossed-up total with no surcharge
  note. `mobile-payments-sdk-react-native` exposes no `surchargeAmount`. Resolve with Square
  before building anything else — the answer changes either `shared/pdf/squareFees.ts` or
  the in-person feature set.
- **Fallback payment method** is CA/GL/IE/IM/JE/UK only — not required here.

### Marketing is gated too

Requirements 6.1–6.3 make a launch email, an in-app splash and a push notification
mandatory at launch, all built from Apple's Marketing Toolkit templates — you may not write
your own Tap to Pay copy or art. And none of it may go live until the app is in full general
availability.

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
