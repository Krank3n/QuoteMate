# Admin CRM Plan

Turn the admin surface into a full CRM hosted at **quotemateapp.au/admin**, covering tradie users *and* supplier profiles.

## Current state (relevant bits)

- **Website** (`/QuoteMateAppWebsite`) is Next.js 15 App Router, statically exported (`output: 'export'`), Firebase client SDK wired (`lib/firebase.ts`), CSS modules, no API routes.
- **Backend** uses Firestore with:
  - `users/{uid}` + subcollections `quotes`, `invoices`, `settings/{business,emailPreferences,emailState,registrationInfo}`, `profile/referral`, `affiliateEarnings`
  - `subscriptions/{uid}`, `feedback/`, `referrals/`, `quoteAcceptanceTokens/`, `config/`
  - `suppliers/{supplierId}` top-level with `ownerUid`, `priceItems/{itemId}`, `subscribers/{tradieUid}` — a tradie's supplier book is the set of `subscribers` docs with `docId == tradieUid` across all suppliers (collection-group query).
- **Admin access** today is a hardcoded env-var key (`ADMIN_DASHBOARD_KEY`).
- **Email**: reusable `sendEmail()` helper in `functions/src/email.ts` + 17 named email functions. Drip campaigns already scheduled.

## Architecture

Keep the static export. Add a client-rendered `/admin/*` section. All reads/writes go through **new callable functions** gated by a Firebase **custom claim `admin: true`**, bootstrapped once via the existing env-var-key endpoint. `firestore.rules` stays strict — admin work is server-side via functions. Same domain; can later split to `admin.quotemateapp.au` using the same build.

## Phase 0 — Foundations

- `setAdminClaim(uid)` — one-shot callable, protected by `ADMIN_DASHBOARD_KEY`, sets `admin: true` on your uid.
- `requireAdmin()` helper in functions — guards every admin callable.
- `adminAuditLog/{id}` collection — every admin write logs `{action, targetType, targetId, adminUid, at, payload}`.

## Phase 1 — Data additions

### User CRM data

- `users/{uid}/adminNotes/{noteId}` — free-form CRM notes.
- `users/{uid}/emailHistory/{id}` — extend `sendEmail()` to log every send (type, subject, timestamp, openedAt).
- `users/{uid}/crmEvents/{id}` — logged calls, status changes, tags.
- Denormalize onto `users/{uid}` on write: `quoteCount`, `invoiceCount`, `lastQuoteAt`, `lifetimeRevenue`, `planTier`, `churnedAt`, `supplierBookCount`, `primarySupplierIds` (top 3).
- One-time backfill function to populate denormalized fields for existing users.

### Supplier CRM data

- `suppliers/{id}/adminNotes/{noteId}` — CRM notes on supplier profiles.
- `suppliers/{id}/emailHistory/{id}` — email log for supplier owner.
- Denormalize onto `suppliers/{id}` on write: `subscriberCount`, `priceItemCount`, `lastPriceUpdate`, `ownerEmail` (cached from owner's user doc for list-view speed).

## Phase 2 — Admin routes (on quotemateapp.au)

- `/admin/login` — email/password, redirects if no admin claim.
- `/admin` — dashboard: DAU/WAU, signups this week, trial → Pro conversion, MRR, churn, re-engagement queue, feedback inbox count, top suppliers by subscriber growth.
- `/admin/users` — searchable/sortable table (email, business, phone, plan, last active, quote count, lifetime $, supplier-book size). Bulk-select for broadcast.
- `/admin/users/[uid]` — **main CRM screen for a tradie**:
  - Header: name, email (`mailto:`), phone (`tel:`), plan, signup date, last active
  - Timeline: quotes, invoices, payments, emails sent/received, notes, feedback — merged reverse chrono
  - Right panel: notes composer, "Log call" button, tag picker (Hot Lead / At Risk / VIP)
  - **Supplier book panel**: chips for each supplier they subscribe to → click jumps to supplier
  - Email composer with template picker (reuses existing email templates) → sends via new callable, logs to `emailHistory`
  - Actions: grant Pro trial extension, flag account, trigger specific drip email, toggle unsubscribe
- `/admin/suppliers` — supplier table: name, owner, subscriber count, price-item count, last updated, kind (Bunnings/Reece/custom).
- `/admin/suppliers/[id]` — **main CRM screen for a supplier**:
  - Header: supplier name, owner contact (mailto/tel), kind, last price update
  - Subscriber list (clickable → tradie profiles)
  - Price-item stats + freshness
  - Notes, email composer (to owner), tags
- `/admin/campaigns` — one-off broadcasts: segment picker (all / Pro / inactive 7d / inactive 30d / new this week / subscribed to supplier X), preview, send.
- `/admin/feedback` — feedback inbox with reply-in-thread (emails user back, logs to their `emailHistory`).
- `/admin/pipeline` — kanban: Lead → Trial → Active → Pro → Churned; drag updates tags.
- `/admin/affiliates` — affiliate list + earnings + payouts.
- `/admin/subscriptions` — revenue view, cancellations, failed payments.

## Phase 3 — Callables

**Users**
- `adminListUsers(filters, pagination)`
- `adminGetUser(uid)` — profile + denormalized stats + recent activity
- `adminSendEmail({uid, templateKey | freeform, subject, body})`
- `adminBroadcast({segment, templateKey | freeform})`
- `adminAddNote({uid, note})`
- `adminLogCall({uid, outcome, duration, notes})`
- `adminSetTags({uid, tags})`
- `adminUpdateUserFlags({uid, flags})` — trial extension, ban, etc.
- `adminGetUserSupplierBook(uid)` — collection-group on `subscribers` where docId == uid

**Suppliers**
- `adminListSuppliers(filters)`
- `adminGetSupplier(id)` — profile + owner + subscriber uids + stats
- `adminSendSupplierEmail({supplierId, ...})`
- `adminAddSupplierNote({supplierId, note})`
- `adminSetSupplierTags({supplierId, tags})`

**Dashboard + export**
- `adminDashboardStats()`
- `adminReplyToFeedback({feedbackId, body})`
- `adminExportCSV({entity: 'users'|'suppliers'|'quotes'|'revenue', filters})`

## Phase 4 — Nice-to-haves

- CSV export (users, suppliers, quotes, revenue)
- Email open tracking (1px pixel via function)
- Saved segments
- Quick-filter chips on users list (inactive 7d, failed payment, no quotes yet, no suppliers beyond defaults)
- Keyboard shortcuts (j/k navigate, e email, n new note)

## CRM angles unlocked by suppliers

- Spot tradies stuck on default suppliers only → onboarding gap.
- Identify supplier owners as a separate sales/partnership pipeline (price-list tooling, affiliate deals, featured placement).
- Segment broadcast: "all users subscribed to supplier X" — e.g. push a Reece-specific tip.

## Tradeoffs

- Static export stays → admin is client-rendered; first paint shows a loading state while auth resolves. Fine for internal tool.
- Denormalized stats add write cost but make list screens instant. Worth it.
- Same domain as marketing site; Firebase Hosting serves both. Future split to `admin.quotemateapp.au` uses the same build.

## Scope estimate

- Phase 0–2 (users + suppliers): ~4–5 days.
- Phase 3–4: another 2–3 days.
