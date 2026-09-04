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
- ⏳ App requirements from Apple's review guide v1.6 — the app side is now complete except **3.1–3.3** (awareness moment, blocked on Apple's Marketing Toolkit) and the **AU surcharging** conflict (blocked on Square)

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

1. A video recording of the **New User Flow**
2. A video recording of the **Existing User Flow**
3. A video recording of the **Checkout Flow**
4. A completed **App Review Requirements Checklist**

Those are Apple's exact names — use them on the uploaded files. "Existing User
Flow" is the one that costs work: it means a merchant *already using the app*
discovering Tap to Pay, which is the awareness moment (reqs 3.1–3.3) and needs
Marketing Toolkit assets. Upload to Apple's File Uploader:
Apple's File Uploader — the tokenised link is in the 16 Apr 2026 entitlement email from
`ttpoientitlements@apple.com` (Case-ID 19476927). It is deliberately not
reproduced here — it is a bearer token and this repo is public.

Both requirement documents live at <https://apple.box.com/v/ttpoirequirements> — currently
v1.6, refreshed 26 Aug 2026. Pull the live copy; don't work from a download.

> **The checkout video cannot be screen-recorded.** Apple: *"Use another device to record
> the Checkout flow video as the Tap to Pay on iPhone UI screens won't work for screen
> recordings."* The ProximityReader UI is excluded from screen capture and records as
> black. Film the phone with a second camera. Videos 1 and 2 screen-record fine over USB.

Only after the publishing entitlement lands do you submit to App Review — which is itself a
special review for entitlement-bearing apps.

### Both Apple documents are PUBLIC — read them, don't guess

Earlier notes in this file claimed the requirement documents needed an Apple sign-in.
They do not. Both are marked **TIER 4 - PUBLIC** on Box and open in any browser:

- App Requirements and Review — <https://apple.box.com/v/ttpoiappreviewpdf>
- App Review Requirements Checklist — <https://apple.box.com/v/ttpoichecklist>

The trap is that Box renders client-side, so anything that fetches HTML without running
JavaScript sees an empty shell and looks like a login wall. Open them in a real browser.

**Current version is v1.7 (August 2026)**, which supersedes the v1.6 an earlier pass in
this file was written against. Differences worth knowing:

- There is a whole **section 2 (Onboarding Merchants)**, 2.1–2.3, all Required —
  including "digital onboarding should take less than 15 minutes".
- **3.2 (splash screen) is Recommended**, not Required — but **6.2 makes an equivalent
  splash Required at launch**, so it lands as mandatory anyway.
- **5.5 is Conditional** ("when using iconography"), and either `wave.3.right.circle`
  or `wave.3.right.circle.fill` is acceptable.
- **Screen recording is acceptable for all three videos.** Apple: "a video recording
  from another iPhone is best… Otherwise, screen recording from the same device will
  suffice." A second device is preferred for Checkout, not mandated.
- There is an official way to **unlink your Apple Account to re-accept the T&Cs** for
  re-recording, linked from the checklist. Useful for reshoots.

Still open on the checklist, needing an answer rather than code:

- **3.8 / 3.8.1** — the T&Cs may only be accepted by an admin or otherwise authorised
  party, and an unauthorised user must be told to contact an admin. QuoteMate is
  single-user per account, so this is arguably satisfied inherently — but it needs a
  stated answer, not silence.
- **Section 6 (6.1, 6.2, 6.3)** — launch email, in-app splash and push, all Required
  and all explicitly requiring Marketing Guide assets. This is the real toolkit
  dependency; it is not 3.1–3.3 as earlier notes claimed.

### Shooting them: `scripts/record-tap-to-pay.sh`

```bash
scripts/record-tap-to-pay.sh check                  # is the phone connected + capturable?
scripts/record-tap-to-pay.sh shotlist               # what to tap, per video, per requirement
scripts/record-tap-to-pay.sh record 1-onboarding    # capture until you press q
```

Output lands in `recordings/` (gitignored — these show a real Square seller account
and real customer data, and this repo is public).

**The capture is scriptable; the tapping is not.** A trusted, unlocked iPhone on USB
appears as an AVFoundation source — the same one QuickTime's *Movie Recording →
iPhone* uses — so `ffmpeg` can grab the screen. Driving it cannot be automated:
`idb ui tap` needs a companion attached to a CoreSimulator target, and a physical
iPhone exposes no such HID surface. So a person taps while the script records.

**If the Mac refuses to see the phone's screen, record on the phone.** Diagnosed
3 Sep 2026 on Thomas's iPhone (11, iOS 18.6.2): paired, Developer Mode on, on USB,
unlocked, development-signed build installed — and macOS still published no capture
device. QuickTime Player, with camera access confirmed working, reported exactly two
video recording devices (both Mac cameras); an `AVCaptureDeviceDiscoverySession`
including `.external` agreed. That rules out ffmpeg, permissions and app choice: the
screen simply was not on offer.

Don't burn time on it. iOS Control Centre → Screen Recording captures at native
resolution, needs no Mac, and is what Apple's own reviewers expect to see. AirDrop or
Image Capture pulls the file off afterwards. Worth one try first: plug straight into
the Mac rather than through a hub (this one was two deep).

**The Simulator is not a shortcut.** `TapToPaySettings.isDeviceCapable()` is false
there, so `useTapToPayEnabled` resolves to `unsupported_device` and the app correctly
hides the onboarding setup button and disables the payment row. A simulator recording
is evidence that the feature is *absent*. Faking capability to film it would be
misrepresenting the app to App Review.

`scripts/record-tap-to-pay.test.sh` covers the device-discovery parsing — ffmpeg lists
the iPhone under both video and audio devices at different indexes, and xctrace prints
connected and offline phones under separate headers. Both are easy to read wrong in a
way that only shows up with a phone in your hand.


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


## Submission pack

Everything needed to reply to Apple, in one place. Nothing here has been sent.

### Reply email (to `ttpoientitlements@apple.com`)

> **Subject:** Re: [Thomas Hansen] Request Access to the ProximityReader APIs
>
> Hi Avinash,
>
> QuoteMate now meets the requirements in the App Requirements and Review document.
> I have uploaded the three flow recordings and the completed App Review Requirements
> Checklist to the File Uploader.
>
> Team ID: 5GHUTAV35B · PSP: Square · First region: Australia
> App: https://apps.apple.com/au/app/quotemate/id6754000046
>
> Case-ID: 19476927
>
> Thanks,
> Thomas Hansen

Upload the four files here, not as attachments:
Apple's File Uploader — the tokenised link is in the 16 Apr 2026 entitlement email from
`ttpoientitlements@apple.com` (Case-ID 19476927). It is deliberately not
reproduced here — it is a bearer token and this repo is public.

### Requirement → where a reviewer sees it

| Req | Implementation | Visible in |
| --- | --- | --- |
| 1.4 | `isTapToPayOsSupported()` blocks below iOS 17.6 with "Update to iOS 17.6 or later"; `classifyPaymentFailure` maps the SDK error to the same message | not filmable on a current device — cite code |
| 1.5 | `warmUpTapToPay()` on launch and on AppState active (`App.tsx`) | New User Flow (reader is ready without a wait) |
| 1.6 | every path reads `isAppleAccountLinked()` live, never a cached flag | New User Flow |
| 3.1–3.3 | **awareness moment — Marketing Toolkit assets required** | Existing User Flow |
| 3.4 | setup offered on the onboarding Payments step once Square connects | New User Flow |
| 3.5 | `linkAppleAccountIfNeeded()` — accepting Apple's T&Cs is a deliberate action | New User Flow |
| 3.7 / 5.3 | row is never greyed out; the terms gate runs on press, not via `disabled` | Existing User Flow |
| 3.9.1 / 5.7 | `observeTapToPayReadiness()` → spinner + "Getting Tap to Pay ready" | Existing User Flow |
| 4.1 / 4.4 / 4.6–4.8 | `ProximityReaderDiscovery` (Apple's Merchant Education API) via `modules/tap-to-pay-education` | New User Flow |
| 4.2 | education plays immediately after a fresh T&C acceptance | New User Flow |
| 4.3 | "How Tap to Pay works" in Settings → Square | Existing User Flow |
| 5.2 | row sits at the top of the payment list, no scrolling | Existing User Flow |
| 5.4 | `tapToPayRowTitle()` returns exactly "Tap to Pay on iPhone" on iOS | all three |
| 5.5 | SF Symbol `wave.3.right.circle` via `expo-symbols` | all three |
| 5.10 | Square's receipt on approval; `buildDeclineRecord()` offers a shareable record on decline | Checkout Flow (film a decline too) |

### Answers for the checklist's free-text cells

- **Distribution type:** Public
- **Existing or New app:** Existing
- **PSP:** Square · **Team ID:** 5GHUTAV35B · **Region:** Australia
- **3.8 / 3.8.1 / 3.8.2** — see the table above: single-user accounts, so the
  authorised-party requirement is structural rather than implemented.
- **Supported schemes / refunds / receipt methods** — the "Other Information" tab.
  Receipt methods to tick include **"using iOS Share (ie with AirDrop and other
  apps)"**, which is exactly how `buildDeclineRecord` delivers the req 5.10 record.

### Prerequisites that are not code

1. **Marketing Toolkit assets** — blocks reqs 3.1–3.3, and therefore the entire Existing
   User Flow video. The only remaining app-side blocker.
2. **A connected AU Square seller account** with Tap to Pay enabled, plus a real
   contactless card. The account used for the videos must genuinely be able to take money.
3. **AU surcharging** — Apple wants the surcharge disclosed on its own screen via a
   surcharge API. `mobile-payments-sdk-react-native` exposes none, and QuoteMate instead
   grosses up `amountCents` and sets `allowCardSurcharge: false`. Ask Square whether the
   RN SDK will expose `surchargeAmount`; if it will not, the honest answer on the
   checklist is that surcharging is off for in-person payments in AU.

## Marketing is gated on GA — and the guidelines are public

<https://developer.apple.com/tap-to-pay/marketing-guidelines/> is readable without a
login, unlike the Box requirement docs. It says plainly:

- **Full general availability in your app before launching any marketing.** This is why
  `quotemateapp.au/get-paid/tap-to-pay-iphone-tradies` was pulled on 3 Sep 2026 — it
  marketed the feature months before we could ship it. Restore it (`draft: false` in the
  website repo's `seo/data.json`) only once the publishing entitlement lands AND the
  feature is live for users.
- **Only Apple-approved assets** from the Marketing Toolkit. No custom videos,
  illustrations, photography, stock imagery, or custom icons depicting iPhone or the
  feature. Templates allow brand colours, fonts, card art and your logo — nothing more.
- **Never shorten the name.** Always "Tap to Pay on iPhone", and never with "Apple" in
  it. `tapToPayRowTitle()` already returns exactly that on iOS.
- **Use the Merchant Education API** for in-app education — that is
  `ProximityReaderDiscovery`, already shipped in `modules/tap-to-pay-education`.
- PR, blog posts and investor material need Apple's approval before publishing, and that
  review takes **several weeks**. Worth starting early if a launch post is planned.

Toolkit (needs Tom's Apple partner sign-in):
Apple's Marketing Toolkit — the tokenised link is in the 16 Apr 2026 entitlement email from
`ttpoientitlements@apple.com` (Case-ID 19476927). It is deliberately not
reproduced here — it is a bearer token and this repo is public.

## What Apple still wants

Requirement numbers below are from the App Review Requirements Checklist v1.6. These have
to be true *before* the videos are shot, because the videos are the evidence.

| Req | Apple requires | State |
| --- | --- | --- |
| 1.4 | Handle `osVersionNotSupported` below iOS 17.6 | ✅ `isTapToPayOsSupported()` gates the row up front; `classifyPaymentFailure` maps the SDK error to "update iOS" rather than "payment failed" |
| 1.5 | Warm up the reader on launch and on foreground | ✅ `warmUpTapToPay()` on launch + AppState active (`App.tsx`) |
| 1.6 | Read T&C acceptance from Apple, not a local variable | ✅ every path reads `isAppleAccountLinked()` live |
| 3.1 | Highly visible, discoverable communication for Tap to Pay on iPhone | ✅ `TapToPayAwarenessBanner` on the dashboard — plain text plus Apple's own SF Symbol, no custom artwork |
| 3.2 | Full-screen splash modal | **Recommended only** in v1.7. The equivalent is Required via 6.2, which needs Toolkit assets |
| 3.3 | Communicate to all eligible users at least once | ✅ same banner — shown until they accept the terms or dismiss it. v1.7 says a push "can" be used, not must |
| 6.1 / 6.2 / 6.3 | Launch email, in-app splash, launch push | **blocked** — all three explicitly require Marketing Guide assets |
| 2.1 | New user can discover account creation and how to access Tap to Pay on iPhone | ✅ sign-up → onboarding → Payments step (always last) → setup button |
| 2.2 | Fully digital onboarding, in-app, completed on iPhone | ✅ every step in-app; Square OAuth opens in `SFSafariViewController` via `WebBrowser.openBrowserAsync`, not a kick-out to Safari |
| 2.3 | Onboarding under 15 minutes for most users | ⚠️ **unverified** — 7–8 steps, every one skippable. Needs timing on a real device, not a code read |
| 3.8 | T&Cs accepted only by an admin or authorised party | ✅ **inherently satisfied** — one Firebase user per account. `firestore.rules` scopes every document with `isOwner(userId)`; there is no team, role or membership model, so the only person who can reach the button is the account holder |
| 3.8.1 | Tell an unauthorised user to contact an admin | **N/A** — no unauthorised-user state can exist (see 3.8) |
| 3.8.2 | Enterprise / Custom / Unlisted: accept T&Cs via Apple Business Connect | **N/A** — public App Store distribution only |
| 3.4 | Show how to enable at the end of onboarding | ✅ on the Payments step once Square connects |
| 3.5 | A clear action to accept the Tap to Pay T&Cs | ✅ `linkAppleAccountIfNeeded()` wired into all three paths |
| 3.7 / 5.3 | Button never greyed out; pressing it opens T&C acceptance | ✅ terms gate moved to press; row never disabled |
| 3.9.1 | Configuration progress indicator while the reader prepares | ✅ `observeTapToPayReadiness()` → `useTapToPayReadiness` |
| 4.1 | `ProximityReaderDiscovery` for merchant education on iOS 18+ | ✅ `modules/tap-to-pay-education` (local Expo module). Clears 4.4/4.6/4.7/4.8 |
| 4.2 / 4.3 | Education after T&Cs, findable again in Settings | ✅ on fresh acceptance; "How Tap to Pay works" row in Square settings |
| 5.2 | Button reachable without scrolling, top of the list | ✅ already |
| 5.4 / 5.5 | Approved copy; SF Symbol `wave.3.right.circle` | ✅ copy via `tapToPayRowTitle`; icon via `expo-symbols` `SymbolView`, whose own `fallback` covers Android/web |
| 5.10 | Digital receipt on approve *and* decline | ✅ both halves offer a shareable record via the native share sheet ("Activity views", which v1.7 names as accepted): `buildPaymentReceipt` on approve, `buildDeclineRecord` on decline. **Square shows no receipt screen of its own** — an earlier note here assumed it did, and the checkout footage disproved it |
| 5.12 | Notify the user when a transaction isn't approved and they closed the app first | ✅ `tapToPayOutcomeNotice` — a local notification armed before the tap (survives app termination) plus an immediate one when the outcome is known and the app is backgrounded |

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

## Location permission

Square refuses an in-person payment without location permission on **both**
platforms — a card-network rule, not a Square quirk: the transaction has to be
placed in a supported country. Square checks the authorisation status and
errors if it isn't already granted; it never raises the prompt itself, so we do
it in `ensureLocationPermission()` (`src/services/squarePayments.ts`) before
`authorize()`.

- **Android** — `PermissionsAndroid.request(ACCESS_FINE_LOCATION)`.
- **iOS** — `expo-location`'s `getForegroundPermissionsAsync` /
  `requestForegroundPermissionsAsync`. Without it, iOS showed the tradie
  *"location settings have not been granted, please request access"* — an error
  message where a permission dialog should have been. When `canAskAgain` is
  false we point at Settings rather than firing a request iOS will no-op.

`expo-location` is a **dependency only — deliberately NOT in `plugins`**. Its
config plugin would write generic `NSLocationAlways*` usage strings into
Info.plist, which tells App Review we want always-on location we never use. The
one string we need, `NSLocationWhenInUseUsageDescription`, is set by
`withSquareSDK.js`, and the Android permissions come from expo-location's own
bundled manifest. Adding the plugin buys nothing and costs review questions.

Because it's a native module, this ships in a **build, not an OTA**.

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
