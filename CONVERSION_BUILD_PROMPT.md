# BUILD: QuoteMate trial→monetised conversion engine

You are implementing a conversion system for QuoteMate (React Native/Expo app +
Firebase Functions backend + Next.js admin site at ../QuoteMateAppWebsite).
The full technical spec — exact files, line numbers, helpers to reuse, and per-file
test lists — is in `/Users/tom/.claude/plans/plan-please-plan-a-quiet-cat.md`.
READ THAT FILE FIRST and treat it as the source of truth. This prompt is the
authoritative addendum: the confirmed decisions, the final copy, the build order,
and the definition of done.

## Goal
Move trial→**monetised** from ~1–2% toward 20%, where "monetised" = a Pro subscriber
**OR** a free tradie collecting payments through Square (the ~1.7% cut). Two revenue
paths, both count.

## SET THESE FIRST (values + one manual prerequisite)
- FOUNDING_CAP = 100        (founding members before the price rises)
- FOUNDING_GRACE = 72h      (post-trial window to lock the founding price)
- NEXT_PRICE = $99/mo ($658/yr)   (= the existing REGULAR_PRICE_AUD anchor)
- Per-user pricing mechanism = **store introductory offer** (base product price set to
  $99, $49 delivered as a founding offer to in-window users) for iOS/Android, and a
  per-user Stripe Price on web.
  ⚠ MANUAL PREREQUISITE (not code): configure the $99 base + $49 founding/intro offer in
  App Store Connect + Play Console, and the $99 + $49 Prices in Stripe, with existing
  subscribers grandfathered. If this isn't done, build Phase 2 as **cap-only** (one
  global price rise when the cap fills — no per-user 72h enforcement) and omit the 72h
  deadline from all copy.

## HARD CONSTRAINTS (non-negotiable)
- NEVER use the word "AI" in user-facing copy (code naming is fine).
- Copy is authentically Aussie + gender-neutral; no "blokes/guys/fancy/folks".
- Founding/scarcity numbers must be REAL (computed from Firestore) and ENFORCED. No fake
  or resetting timers, no invented "spots left", no fabricated social proof.
- "No via QuoteMate" applies to the tradie's CUSTOMER-facing artifacts; our own emails to
  the tradie may carry QuoteMate branding.
- Minimise UI: reuse existing screens/controls; no new screens/toggles unless unavoidable.
- EVERY change ships with real, named, passing Vitest tests (functions/ and app both use
  Vitest). tsc-green is NOT enough. Each behaviour change gets a regression test.
- Skip anyone the app treats as Pro in the lifecycle campaign: gate on
  `isBilled || isPro-flag || admin_grant` (the live pull found bare-isPro + comp accounts
  that must NOT get "upgrade" nudges).

## BUILD ORDER (each step = its own PR, tests green before the next)

**Step 1 — Make both funnel paths visible (do first; everything proves lift against it).**
- Add events to `src/services/analyticsService.ts`: paywall_viewed, paywall_dismissed,
  checkout_started, purchase_completed, purchase_failed, trial_started, square_connected.
  Wire at the call sites named in the plan (PaywallScreen, useStore, SendDocumentDialog,
  TrialBanner, DashboardScreen). first_payment_collected is server-derived.
- New `functions/src/eventFunnel.helpers.ts` (mirror adminFunnel.helpers.ts): `isMonetized`
  = billed Pro OR ≥1 Square payment; two-path funnel + `furthestStage` classifier.
- New cron `aggregateEventFunnel` (copy sendOnboardingDrip skeleton) → `adminStats/eventFunnel`;
  add the `events.ts` collection-group index to firestore.indexes.json.
- New callable `adminEventFunnelStats` (serve-cache-only) + surface in the admin site
  (adminApi.ts + app/admin/analytics/page.tsx: trial→monetised %, both paths, furthest-stage
  histogram).
- Cross-cutting guard tests: TRIAL_DAYS===14 both sides; price mirror; verify FCM-vs-Expo
  push token type before any push work.

**Step 2 — Founding Member scarcity (cap + 72h window).**
- New `functions/src/foundingOffer.ts`: FOUNDING_CAP, NEXT_PRICE, FOUNDING_GRACE_MS;
  `foundingMembersCount` (reuse isBilledSub scan); write `adminStats/foundingOffer`
  {taken,cap,spotsLeft,capActive}; `foundingWindowEndsAt(trialStartedAt)` =
  trialStartedAt+TRIAL_MS+GRACE; `foundingEligible(now,trialStartedAt,taken)`.
- Extend `src/config/pricingConfig.ts`: `yearlyVsMonthlySavingsPercent()` (=44, replaces the
  hardcoded "Save 44%"), `foundingCountdownLabel(now,trialStartedAt)` (trial→grace→expired,
  never resets), `weeklyFeeBleed(collectedPerWeek)`.
- PaywallScreen: real "X of 100 spots left", the founding countdown, locked-for-life +
  price-rise line, and the Square fee-bleed line. Suppress founding framing when
  `foundingEligible` is false. Note it's enforced via the store offer, not a UI timer.

**Step 3 — Trial lifecycle campaign (email + push).**
- New `functions/src/trialLifecycle.helpers.ts` (mirror draftNudge.helpers.ts): `dueTrialAction`
  with send-once flags in emailState; steps + a separate never-activated branch; gate on any
  Pro signal + marketing opt-out.
- New cron `trialLifecycleCampaign` (copy sendOnboardingDrip). New email builders in
  `functions/src/email.ts` next to sendReEngagementEmail. New push events in aussieNotifications.ts
  (map to an existing notificationPreferences key — no new toggle).

**Step 4 — Path B: Square activation (biggest lever for 20%).**
- Opt-in "get paid on this quote" at send DURING the trial (reuse TakePaymentSheet/SendGateModal —
  no new screen); fire square_connected on OAuth success.
- Nudge track (sibling helper) for "connected, never collected" and "sent, no pay link".
- Fee-saving Pro upsell for high-volume Square users (real collected total × (170−100)bps only).

## FINAL COPY (drop-in — Aussie, no "AI", real numbers substituted at send)

### Paywall (Founding Member — post-trial/grace state shown)
Eyebrow "Founding Member · trial ended" · Title "Claim your spot" ·
Sub "$49 for life — held 72h after your trial" ·
Live "63 of 100 founding spots left" (real count) ·
Square users: "On your recent volume, the lower fee would keep you about $52/mo" (real) ·
Yearly $̶6̶5̶8̶ $328 (Save 44%) · Monthly $̶9̶9̶ $49 ·
"⏳ Founding price expires in 68 hours" · "Miss it and it's $99/mo for good — lock in now and
yours stays $49 for life." · CTA "Lock in $49 for life" · "Locked for life · cancel anytime."

### Emails — Path A (Pro)
1. Day 0 (trial starts, on first quote) — subj "Your 14 days of Pro start now":
   "Good on ya — your first quote's in, and that kicks off 14 days with everything unlocked.
   No card, no catch. [unlimited sending / one-tap invoice / your logo / full materials list].
   Have a proper go — the tradies who send a few quotes that first week never look back."
   CTA "Build your next quote".
2. Day 7 (personalised, real numbers) — subj "You've quoted $14,200 this week":
   "One week in — 6 quotes built · $14,200 quoted · 2 sent. That's real work off your plate.
   7 days left on Pro; after that you can keep going free, but you'll add a pay link to each job
   and the fee's a touch higher." CTA "See what Pro keeps". (Thin numbers → drop the figures.)
3. 3 days left — subj "3 days left — and 63 founding spots to go":
   "Trial wraps in 3 days. After that you drop to free — each job needs a pay link and the fee
   goes 1%→1.7%. Lock in as a founding member and keep $49/mo (goes to $99 once the 100 fill);
   right now there are 63 left." CTA "Claim your founding spot".
4. Trial ended +72h window — subj "You're on free now — your founding price is held for 72 hours":
   "Your trial's up, you're on free now — it works. But we've held your founding price ($49/mo,
   locked for life) for another 72 hours. Miss that and it's $99. If you send more than the odd
   quote, Pro pays for itself in the lower fee alone." CTA "Lock in $49 before it's gone".

### Emails — Path B (Square)
5. During trial (day 3–4) — subj "Want to get paid the second the job's done?":
   "You're sending tidy quotes — here's the other half: getting paid without chasing. Hook up
   Square (a minute) and every quote/invoice carries a Pay Now button. Yours to use on the free
   plan too — no need to be on Pro." CTA "Turn on payments".
6. Connected, never collected — subj "Your Pay Now button's ready — put it to work":
   "You've hooked up Square — nice one, but nothing's come through yet. Next quote, flick on 'add
   a pay link'. Most tradies who switch it on take their first payment inside a week."
   CTA "Send a quote with a pay link".
7. Fee-saving upsell (high-volume Square, real figures only) — subj "You paid $126 in fees last
   month — Pro would've kept $52": "You collected $7,400 through QuoteMate last month. Processing
   was ~$126. On Pro the fee drops 1.7%→1%, so the same month runs ~$74 — you'd keep ~$52. Plus
   one-tap invoicing." CTA "See if Pro pays for itself".

### Email — Both paths
8. Never-activated (signed up, no first quote — sells nothing) from "Tom at QuoteMate" —
   subj "Your first quote's the hard part — let's knock it over":
   "You signed up but haven't built a quote yet — that first one's the only tricky bit. Give us a
   job, even rough, and QuoteMate prices materials, works out labour, hands you a quote your
   customer can accept on their phone. ~5 minutes. Stuck? Just reply — comes straight to me. — Tom"
   CTA "Build your first quote".

### Pushes
- Square: "Get paid on the spot — turn on payments in a tap."
- Square: "Your Pay Now button's ready. Add it to your next quote."
- 3 days left: "3 days left on your trial — and 63 founding spots to go. Lock in $49 for life."
- Last day: "Trial ends today — then 72 hours to lock $49 for life before it's $99."
- Founding window: "Your $49-for-life founding price expires in 24 hours. Lock it in?"

## DEFINITION OF DONE
- All new Vitest files pass (functions/ + app). tsc clean on touched packages.
- Admin analytics shows trial→monetised %, both paths, and the furthest-stage histogram.
- Founding count/countdown/fee-bleed render from REAL data and suppress cleanly when
  ineligible or thin. No fabricated numbers anywhere.
- Lifecycle sends fire once, respect marketing opt-out, and skip any Pro-signal user.
- Nothing user-facing contains the word "AI".
- Push work only after the FCM-vs-Expo token type is verified.

---
_Source strategy + live baseline: the plan file above, plus the visual brief published this session._
_Numbers in the copy (63 spots, $14,200, $52/mo) are illustrative placeholders — real values are
computed from Firestore at render/send time._