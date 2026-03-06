# QuoteMate - App Improvement TODO

## Critical - Business (This Week)

- [x] **Fix subscription quota enforcement** — added server-side atomic quota check via `checkAndIncrementQuota` Cloud Function + Firestore transactions
  - Files: `functions/src/index.ts`, `src/services/firestoreService.ts`, `src/store/useStore.ts`
- [x] **Implement real Apple/Google receipt validation** — added Apple verifyReceipt API validation and Google Play Developer API validation with fallback
  - File: `functions/src/index.ts`
- [x] **Fix quote acceptance token lookup** — added `quoteAcceptanceTokens` collection for O(1) lookup with legacy fallback + auto-migration
  - Files: `functions/src/index.ts`, `firestore.rules`
- [x] **Add rate limiting** to all Firebase Function endpoints — Firestore-based rate limiting with per-user (standard: 30/min, heavy: 10/min) and per-IP (public: 60/min) limits
  - File: `functions/src/index.ts`

---

## Critical - Security

- [x] **Whitelist CORS origins** — restricted to Firebase project domains + localhost dev; mobile apps bypass CORS naturally
  - File: `functions/src/index.ts`
- [x] **Add input validation** to all Firebase Function endpoints — type checks, length limits, URL validation, domain allowlisting for scraping, HTML escaping for user content
  - File: `functions/src/index.ts`
- [x] **Hash quote acceptance tokens** in Firestore — SHA-256 hashed before storage, with automatic migration of legacy unhashed tokens on access
  - File: `functions/src/index.ts`
- [ ] **Sanitize error messages** — internal details like "Reece API not configured" exposed to clients
- [ ] **Review web scraping legality** — user-agent spoofing may violate store ToS
  - File: `src/services/webScrapingPricing.ts` (lines ~74-95)

---

## High Priority - Revenue & Monetization

- [x] **Add usage counter to Dashboard** — progress bar with "X of Y quotes remaining" and upgrade CTA when limit reached
- [ ] **Reduce free quota from 5 to 3** quotes/month to drive faster conversion
- [ ] **Show early usage warnings** — display "2 of 3 remaining" starting at quote #2
- [ ] **Raise pricing to $29-39/month** — current $19/month is below industry benchmark ($29-99)
- [ ] **Adjust annual pricing** — current $190/year (17% off) is too steep; move to $279/year (20% off)
- [ ] **Implement 7-day free trial** as alternative to monthly quota (A/B test)
- [ ] **Add cancellation retention offers** — auto-offer 40% discount when reason is "too expensive"
- [ ] **Expand feature gating** beyond just quote count:
  - [ ] Custom branding/logo on quotes (Pro only)
  - [ ] PDF export with branding (Pro only)
  - [ ] Email sending from app (Pro only)
  - [ ] Invoice features (Pro only)
- [ ] **Add analytics tracking** (Mixpanel/Amplitude) for conversion funnel
- [ ] **Implement A/B testing** capability for pricing experiments

---

## High Priority - UX

- [ ] **Add loading states** to all async operations:
  - [ ] Paywall product loading
  - [ ] Quote creation/saving
  - [ ] Material price lookups
  - [ ] AI job analysis
  - [ ] Email/PDF generation
- [ ] **Add confirmation dialogs** for destructive actions:
  - [ ] Quote deletion
  - [ ] Invoice deletion
  - [ ] Quote-to-invoice conversion (prevent duplicates)
- [ ] **Implement auto-save** for in-progress quotes/invoices to prevent data loss
- [ ] **Add offline indicator** — banner when connection lost, warn before data-loss actions
- [ ] **Simplify Send Quote flow** — single action that generates PDF + opens email (not sequential)
- [ ] **Improve empty states** — actionable CTAs ("Create your first quote in 60 seconds") instead of passive messages

---

## Medium Priority - UX

- [ ] **Add real-time form validation** — show errors as user types, mark required fields clearly
- [ ] **Step the onboarding flow** — break single massive form into multi-step wizard
- [ ] **Unify material search** — single search bar with source badges ("Bunnings verified" vs "AI estimated")
- [ ] **Improve edit affordance** — make tappable sections more obvious (hint text on first use, explicit Edit buttons)
- [ ] **Add custom date picker** to RecordPaymentScreen — only has preset options currently
- [ ] **Implement Forgot Password** flow on AuthScreen
- [ ] **Add bulk invoice actions** — mark multiple as paid, send batch reminders
- [ ] **Add password visibility toggle** on AuthScreen
- [ ] **Show invoice number** before saving on InvoicePreviewScreen
- [ ] **Add "Cancel edit" option** on ViewInvoiceScreen — currently must save or navigate away
- [ ] **Show quote count per filter** on QuotesListScreen/InvoicesListScreen chips
- [ ] **Add clear search button** for quick reset on list screens

---

## Performance

- [ ] **Memoize overdue invoice calculations** — currently recalculates on every render
- [ ] **Add list pagination/virtualization** — will have memory issues at 100+ quotes/invoices
- [ ] **Reduce Firebase Function cold starts** — consider Cloud Run or min instances
- [ ] **Add price caching layer** — avoid re-scraping same products (Redis or Firestore TTL cache)
- [ ] **Parallelize Claude API calls** in backend — currently sequential
- [ ] **Optimize web scraping** — fetches 50KB+ HTML per store, Claude parses every request (no cache)
- [ ] **Add timeouts to all external API calls** — can currently hang indefinitely

---

## Technical Debt

- [ ] **Fix Stripe customer deduplication** — customers can be created multiple times
  - File: `functions/src/index.ts` (line ~78)
- [ ] **Move Reece OAuth token to Firestore** with TTL — currently cached in memory, lost on cold start
- [ ] **Add API versioning** to Firebase Functions — breaking changes will affect existing clients
- [ ] **Make notifications async** — email/FCM currently blocks response
  - Consider Cloud Tasks for async delivery
- [ ] **Fix `webSearchPricing` naming** — called "searchMaterialPrice" but uses training data, not web search
- [ ] **Add audit logging** — track who accessed what quotes (compliance)
- [ ] **Log cancellation feedback to Firestore** — currently only logged to console
- [ ] **Fix invoice number generation** — generated client-side, could have collisions with multi-device

---

## Accessibility

- [ ] Add screen reader announcements for loading states
- [ ] Add labels to all icon-only buttons
- [ ] Add text alongside color-only status indicators
- [ ] Increase helper text sizes for readability
- [ ] Validate minimum tap target sizes (44x44pt)

---

## Future Considerations

- [ ] Tiered pricing: Free / Basic ($29) / Pro ($59) / Agency ($99)
- [ ] Team/seats management for agency tier
- [ ] Usage-based pricing for high-volume users
- [ ] White-label/reseller partnerships
- [ ] Deep linking support
- [ ] Undo/redo functionality
- [ ] Version history for quotes
- [ ] Advanced reporting dashboard
- [ ] Regional pricing (AUD display)
