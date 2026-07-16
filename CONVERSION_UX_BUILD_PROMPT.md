# Build prompt: in-app conversion UX layer (trial→monetised engine, next phase)

You are working in the QuoteMate app repo (Expo/React Native app + Firebase functions). The website repo is a sibling at `../QuoteMateAppWebsite`.

**Read first — the source of truth for this work:** `../QuoteMateAppWebsite/marketing/high-intent-conversion-plan.md` (v2, 2026-07-17). This prompt is only the execution wrapper; where they disagree, the plan wins. Also skim `../QuoteMateAppWebsite/research/email-payment-audit-2026-07-16.md` for the blocker IDs referenced below.

## Context you should not rediscover

- North star: **20% of trials monetised** (billed Pro OR ≥1 real Square payment; `payments[].method==='square'` webhook-written, manual cash never counts). Live baseline 2026-07-16: 146 trials, 2.05% monetised. 5% gates marketing spend.
- Already shipped 2026-07-16 (PRs #43–#48) — **do not rebuild, extend**: event funnel (`src/services/analyticsService.ts` → `users/{uid}/events`; `functions/src/eventFunnel.helpers.ts` with `furthestStage`; `aggregateEventFunnel` cron), founding cap (`functions/src/foundingOffer.ts`, `config/foundingOffer`, cap-only, fail-closed display), 5-step lifecycle emails (`functions/src/lifecycleEmails.ts` + helpers, LIVE, dry-run via `functions/scripts/lifecycleDryRun.ts`), Square trial opt-in (`src/utils/quoteDeliveryGuard.ts`, `src/components/SendDocumentDialog.tsx`), Square nudges (`functions/src/squareNudge.helpers.ts`), cross-campaign email suppression (20h window).
- Key surfaces: `src/screens/PaywallScreen.tsx`, `src/components/TrialBanner.tsx` (dashboard shows it only in the final 3 days — deliberate), `src/screens/DashboardScreen.tsx`, `src/components/SendGateModal.tsx`, `src/components/TakePaymentSheet.tsx`, `src/components/CancellationReasonModal.tsx`.
- Trial: 14 days, starts on first quote (`trialStartedAt`), expiry recomputed live from `trialStartedAt + TRIAL_MS`; enforcement is the send gate only; creation stays unlimited on Free.
- Prices: $49/mo, $328/yr; next price $99/$658; fees Free 1.7% vs Pro 1.0% of Square volume.

## Hard rules

1. Never the word "AI" in user-facing copy. Aussie, gender-neutral (no blokes/guys/fancy/folks).
2. Every price, deadline, spot count, and stat comes from live server data; if it can't load, show nothing (fail closed). Never fabricate or infer income/margins.
3. **One primary commercial action at a time**, selected from behavioural state. Square and Pro never appear as competing primary CTAs.
4. Anything duplicated across the app/functions boundary gets a guard test on each side (pattern: `src/config/crossPackageMirrors.guard.test.ts` ↔ `functions/src/crossPackage.guard.test.ts`, which pin TRIAL_DAYS=14 and $49/$328).
5. Every phase ships real, named, passing Vitest tests; behaviour changes get a regression case. tsc-green is not enough.
6. Minimise UI options: reuse existing components/screens; no new toggles or screens unless the plan names one.
7. **No push dependencies** — all `fcmTokens` are Expo tokens; `sendAussiePush` delivers nothing until the Expo migration.
8. One phase per branch/PR. Never deploy functions or change `firestore.rules`/indexes without asking Tom first. Never commit secrets.

## Phase 0 — verify the release blockers (gate for everything below)

The plan forbids new conversion pressure while these are open. **Check current status first — do not assume they're still open, and do not silently start fixing them all.** Report what you find and agree scope with Tom:

- PAY-01 failed Apple/Google validation still writes `isPro:true` (`functions/src/index.ts`, `validateAppleReceipt`/`validateGoogleReceipt`)
- PAY-02 `firestore.rules` owner wildcard lets clients write `users/{uid}/profile/subscription`
- PAY-03 Square OAuth state unsigned + callback unauthenticated (`getSquareAuthUrl`/`squareCallback`)
- PAY-04 Square webhook returns 200 before reconciliation
- PAY-07 Stripe checkout accepts arbitrary price IDs
- PAY-08 duplicate Stripe customers / incomplete subscriptions
- EMAIL-01 documents marked sent before Brevo accepts; EMAIL-05 suppressed recipients retried; Brevo free-plan credits nearly exhausted

## Phase 1 — behavioural-state selector + pressure budget + exposure events (Intervention 0 + 8)

The orchestration layer everything else hangs off. One PR.

- Pure `nextBestAction(state)` selector in `src/` mirroring `furthestStage` in `functions/src/eventFunnel.helpers.ts` (guard test both sides). Inputs from local store: docs + stages, `squareConnection`, `payments[]`, trial state. Output: the single primary action per the state table in the plan.
- **Job progress guide:** one compact dashboard card — first quote drafted → sent → customer response recorded → deposit/payment enabled → next job started. All milestones are existing durable state; zero new tracking. Job framing, no artificial progress, completed steps disappear, no Pro pricing pre-outcome except user-initiated.
- **Pressure budget:** `users/{uid}/settings/promptState` (last commercial prompt at, per-offer dismissed-at) + pure helpers with injectable `now` (model on `lifecycleEmails.helpers.ts`). Rules: one primary ask/session; no unsolicited full-screen within ~20h of a lifecycle email; dismissed offer → cooldown, reappears only on cooldown expiry or new intent event; "happy on Free" → 30-day generic-ask suppression; user-initiated Pro opens bypass contextually.
- **Exposure events:** generalise `nudge_shown/tapped/dismissed` into `prompt_impression`/`prompt_dismissed` in `analyticsService.ts` with props: surface, variant, behavioural state, trial time remaining, user-initiated vs unsolicited, recommendation shown, suppression reason. Add `plan_selected` on the paywall toggle.

## Phase 2 — value receipt (Intervention 1)

- Reorder the recap evidence in `functions/src/lifecycleEmails.helpers.ts` FIRST (payments collected → accepted value → deposits requested → delivered → drafted → face value, labelled and secondary; keep `RECAP_MIN_*` thin-data degradation) so the day-7 email and the app inherit the same hierarchy. Mirror + guard test for the app copy of the math.
- Component renders on: post-send (two-stage, **non-modal**: reinforcement → one non-blocking next action; upgrade recommendation only later on the stable job screen), the Phase 1 dashboard card, and the paywall.
- Copy rules: "worth $X" = face value only, labelled; never "keep that value on Pro" after face-value-only data.

## Phase 3 — trial decision card + day-12 summary (Intervention 2)

⚠️ **Ask Tom for sign-off before building**: this loosens the deliberate ≤3-days `TrialBanner` dashboard gate. Recommended shape: early/mid trial shows value receipt + founding framing (no doom timer); countdown only in the final 3 days. Day-12 one-time full-screen summary fires after a natural task completion, never cold launch, and counts against the pressure budget. Annual first: "$328 charged yearly — equivalent to $27.33/month, save $260/year"; total charge at least as prominent as the equivalent.

## Phase 4 — expiry framing + lock previews (Intervention 3)

- "What stays / what changes" copy — verify each line against real gates before writing it (stays: unlimited creation, documents, sync, Square-link sending at 1.7%; changes: link-free sending, 1.0% fee, logo, premium templates, other `isTrialActive` unlocks).
- Post-expiry: preview the Pro result (branded PDF, real fee delta on their invoice amount) before the ask; work always visible, never deleted.
- Resolve `trial_expired_banner_shown`: wire a real persistent expired-state nudge or delete the dead event.

## Phase 5 — reason capture + routed recovery (Intervention 4)

- Fix `logCancellationFeedback` (validates but never persists) before anything that depends on captured reasons.
- Optional one-tap reason AFTER a natural decision moment (dismissed upgrade / changed feature / chose Free), visible Skip, copy: "Staying on Free is fine. What mattered most in that decision?" Routing per the plan; happy-on-Free → 30-day suppression via `promptState`. **No trial extensions — parked, don't re-propose.**
- Email half **extends `lifecycleEmails.ts`/`lifecycleVerdict`** with send-once `emailState` flags inside the existing cross-campaign suppression. Never a parallel sender. Win-back triggers on renewed intent, not calendar.

## Phase 6 — Square-first moments + cancellation save (Interventions 7 + 5)

- Accepted-quote in-app view: "Take a deposit" primary (reuse `TakePaymentSheet`/`StickyJobActionBar`; the hosted acceptance page already mints deposit links).
- Implementation-intention prompts wiring existing settings: "When they accept, request a 20% deposit?" (`requireDeposit`/`depositPercentage`); "Use this payment setting on future invoices?" after first payment.
- Cancellation (web/Stripe only): reason-routed save treatments per the plan; cancellation always completes in the same flow.

## Working style

Work one phase at a time on its own `feature/*` branch; open a focused PR with tests green (`npx vitest run` in both app and `functions/`); stop and ask at every decision gate marked above. After each phase, note what moved in the admin event funnel (`/admin/analytics`).
