# Jobs refactor — full plan

## Decisions confirmed

1. Quote wizard creates Job implicitly on save.
2. Single-active-quote confirmed. Schema stays lean. No Option A/B quoting; no true revisions yet. Tradies who need options today use line items or separate jobs.
3. Calendar: in-app view (Phase 13) ships in scope. **GCal sync (Phase 14) and customer self-scheduling (Phase 15) are deferred** until after Phase 13 is live and stable. Get the core Jobs tab shipped faster; treat GCal sync as a later release.
4. Remove Quotes / Invoices / Documents tabs.
5. No classic mode.
6. **Stage machine is strict in the backend, flexible in the UI.** Keep the full `inquiry → quoted → accepted → scheduled → in_progress → completed → paid → closed` machine server-side for correctness, but the UI lets tradies jump states freely. Tradies collapse `accepted` / `scheduled` / `in_progress` in their heads — don't force sequential clicks. The StageSheet on the Jobs screen shows all non-terminal, non-current stages as tap targets.

---

## Data model (concrete)

```ts
// shared/job/types.ts
interface Job {
  id: string;
  userId: string;                      // denormalised for indexing
  customerId?: string;                 // link to Contacts if picked from there
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress: string;

  name: string;                        // "Jones pergola"
  description?: string;

  stage: JobStage;                     // see machine below
  archivedAt?: number;

  // Attached documents
  documentIds: string[];               // every quote + invoice ever attached
  primaryQuoteId?: string;             // current active quote
  primaryInvoiceId?: string;           // current active invoice

  // Schedule
  scheduledStartDate?: number;         // ms epoch
  scheduledEndDate?: number;
  estimatedDurationDays?: number;      // for gap/duration calc
  actualStartDate?: number;
  completedDate?: number;

  // Calendar sync (Phase 14)
  googleCalendarEventId?: string;
  googleCalendarId?: string;

  // Customer self-scheduling (Phase 15)
  allowCustomerScheduling?: boolean;
  customerAvailableSlots?: Array<{ start: number; end: number }>;
  customerPickedSlot?: { start: number; end: number; pickedAt: number };

  // Aggregates (computed by server trigger, never written by client directly)
  totalQuoted: number;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;

  // Media & notes
  photos?: JobPhoto[];                 // migrated from quote.photos
  notes?: string;

  createdAt: number;
  updatedAt: number;
}

type JobStage =
  | 'inquiry'        // job created, no quote yet
  | 'quoted'         // quote sent
  | 'accepted'       // quote accepted (deposit may or may not be paid)
  | 'scheduled'      // scheduledStartDate is set
  | 'in_progress'    // actualStartDate set, completedDate not set
  | 'completed'      // work done, may still be awaiting payment
  | 'paid'           // invoice paid in full
  | 'closed'         // terminal — archived
  | 'cancelled';     // terminal — job killed
```

**Job stage machine:**

```
inquiry      → quoted | cancelled
quoted       → accepted | cancelled | inquiry
accepted     → scheduled | in_progress | cancelled
scheduled    → in_progress | accepted | cancelled
in_progress  → completed | cancelled
completed    → paid | cancelled
paid         → closed
closed       → (terminal)
cancelled    → (terminal)
```

**Document ↔ Job relationship:**

- Every Document has `doc.jobId` (already on type, currently unused).
- Job has `documentIds[]` + `primaryQuoteId` / `primaryInvoiceId`.
- Trigger keeps both sides consistent.

**Aggregation rules** (server trigger, not client):

- `totalQuoted = sum(doc.total where doc.jobId === job.id AND doc.type === 'quote' AND doc.id === job.primaryQuoteId)` — only primary, not versions
- `totalInvoiced = sum(doc.total where doc.jobId === job.id AND doc.type === 'invoice')`
- `totalPaid = sum(doc.paidTotal where doc.jobId === job.id AND doc.type === 'invoice')`
- `balanceDue = totalInvoiced - totalPaid`

---

## Backfill heuristic

One-shot admin callable `backfillJobsFromDocuments`:

```
For each user:
  group docs by key = hash(customerEmail || customerPhone, jobAddress, job.name)
  for each group:
    create Job with:
      stage = max(doc.stage) projected to JobStage (see mapping below)
      scheduledStartDate = earliest doc.createdAt
      primaryQuoteId = latest quote in group (or null)
      primaryInvoiceId = latest invoice in group (or null)
      documentIds = all doc ids in group
      photos = union of photos from quotes in group
    for each doc in group:
      set doc.jobId = new Job.id
```

**Document-stage → Job-stage mapping for backfill:**

| Document stages in group | Derived Job stage |
|---|---|
| All `draft` | `inquiry` |
| Any `quote_sent`, no invoice | `quoted` |
| Any `quote_accepted`, no invoice | `accepted` |
| Any `invoice_sent`, not paid | `in_progress` |
| Any `partially_paid` | `in_progress` |
| All relevant invoices `paid` | `paid` |
| Any `cancelled`, nothing else active | `cancelled` |

**Merge rule for hash collisions:** if the user had two genuinely separate jobs at the same address, backfill will group them incorrectly. Mitigation: backfill produces a dry-run report first showing proposed groupings. User reviews, confirms, then we run the real one.

---

## Phased plan

Each phase lands on `refactor/document-unification` as cumulative commits. Each is independently testable. No phase depends on a later phase.

### Phase 8 — Jobs data model + backend *(1 agent run, ~4 hrs)*

- `shared/job/{types,stage,adapter}.ts` — Job type, stage machine, pure converter helpers
- `functions/src/jobHandlers.ts` — `onDocumentWritten` trigger that materialises/updates the attached job, keeps aggregates correct
- `firestore.rules` for `users/{uid}/jobs/{jobId}`
- `backfillJobsFromDocuments` admin callable with **dry-run mode** (default) and **commit mode** (explicit flag)
- Jest tests for adapter, stage machine, aggregation math, backfill grouping
- **Verification:** run dry-run backfill on prod, eyeball output

### Phase 9 — Client store + creation flow *(1 run, ~3 hrs)*

- `useJobStore` — `loadJobs`, `listenToJobs`, `saveJob`, `createJob`, `getJobById`, `getJobByDocumentId`
- Quote wizard entry point: "New Quote" now opens a compact `JobSetupStep` first (customer + address + job name) then enters the existing wizard, creating the Job on save
- Document save path updated: `saveQuote`/`saveInvoice` stamps `jobId`, triggers Job aggregate update
- Existing Convert-to-Invoice attaches the new invoice to the same Job
- **Verification:** create a new quote end-to-end, confirm Firestore shows both Document + Job with correct links

### Phase 10 — Jobs tab UI *(1 run, ~6 hrs — biggest phase)*

- `<JobCard>` — customer, address, dates, job-stage chip, compact summary of attached docs
- `<JobStageSheet>` — driven by the job state machine
- `JobsListScreen` — replaces current tabs. Filters: All / Active / Scheduled / Completed / Archived. Search by customer or job name.
- `ViewJobScreen` — detail view: header, dates, attached documents list (each as a `<DocumentRow>` with its own stage + payment chips), action row ("Add Revision", "Create Invoice", "Schedule", "Mark Complete"), notes, photos
- Creation flow: "+" on Jobs tab → 3-field sheet (customer / address / name) → quote wizard
- **No calendar view in this phase** — just date fields on the job card
- **Verification:** full flow — new job → quote → accept → convert → invoice → paid — all visible on Jobs tab

### Phase 11 — Two-chip split on documents *(1 run, ~2 hrs)*

- `<PaymentChip>` + `<PaymentSheet>` components
- `DocumentRow` inside `ViewJobScreen` renders both chips
- Server: audit + tighten `applyPaymentToDocument` so deposit payment auto-flips stage `quote_sent → quote_accepted` AND also flips Job.stage `quoted → accepted`
- Add stage transitions: `rejected → accepted`, `draft → accepted`, `quote_sent → paid`
- **Verification:** deposit-paid flow visibly promotes the job to "accepted" automatically

### Phase 12 — Decomm legacy tabs *(1 run, ~2 hrs)*

- Delete `QuotesListScreen.tsx`, `InvoicesListScreen.tsx`, `DocumentsListScreen.tsx` + their nav routes
- Bottom nav becomes: Dashboard / Jobs / Settings
- Dashboard "Recent Quotes" card → "Recent Jobs" reading from `useJobStore`
- Delete unused types and store slices (keep `useDocumentStore` — ViewJob still needs it)
- **Verification:** nav + dashboard look clean; no orphan screens; no broken deep links

### Phase 13 — In-app calendar view *(1 run, ~4 hrs)*

- Dependency: `@react-native-community/datetimepicker` already installed; add `react-native-calendars` for the grid
- New `CalendarScreen` accessible from Jobs tab (top-right toggle between List / Calendar views)
- Month view: jobs dotted on their `scheduledStartDate`. Tap date → list of jobs that day. Tap job → `ViewJobScreen`.
- Drag-to-reschedule NOT in this phase. Tap-to-edit-date modal instead. Keeps scope honest.
- **Verification:** toggle between views, pick a date, see the job

### Phase 14 — Google Calendar sync *(1 run, ~6 hrs — highest complexity)*

- **Auth:** extend existing Firebase Google sign-in to request `calendar.events` scope. Store the refresh token server-side in `users/{uid}/integrations/google.calendar` — NEVER in client.
- **Direction:** one-way, app → Google Calendar. Jobs become events. Not two-way — avoid conflict hell.
- **Event shape:** `summary = job.name`, `description = customer + address + job description + app deeplink`, `start/end = scheduledStart/End`, `colorId` by job.stage.
- **Trigger:** `onJobWritten` Firestore trigger (server-side, uses stored refresh token) creates/updates/deletes the matching GCal event. Event id stored as `job.googleCalendarEventId`.
- **Failure handling:** calendar failure does not fail the job save. Surface `googleCalendarSyncError` on the job if sync fails; user sees a small warning banner.
- **Disconnect:** settings toggle "Connected to Google Calendar" — disconnecting revokes token and leaves events in GCal (doesn't mass-delete).
- **Verification:** connect GCal, schedule a job, event appears; reschedule job, event updates; disconnect, events stay.

### Phase 15 — Customer self-scheduling *(1 run, ~5 hrs)*

- Tradie enables on a per-job basis via a toggle in `ViewJobScreen` → "Let customer pick a date"
- Tradie configures `customerAvailableSlots: Array<{start, end}>` via a simple picker UI (add / remove slots)
- Acceptance email includes "Pick a date" button alongside / replacing the generic "Accept" button when scheduling is enabled
- Quote acceptance page (existing `quoteAcceptancePage` Cloud Function) gets a date-picker step showing available slots
- On pick: `job.customerPickedSlot = {start, end, pickedAt}`, `job.scheduledStartDate = start`, triggers GCal sync (Phase 14) if enabled
- Tradie gets email notification "Jones picked Tuesday 10am"
- **Verification:** end-to-end customer flow in incognito browser

### Phase 16 — Backfill run + full smoke test *(~1 hr, manual)*

- Dry-run `backfillJobsFromDocuments` → review output together
- Commit backfill
- Open prod build, walk through every tab and flow
- Merge `refactor/document-unification` to `main`

---

## Dependency graph

```
Phase 8  ──→  Phase 9  ──→  Phase 10 ──→  Phase 11 ──→  Phase 12
                              │               │
                              ↓               ↓
                           Phase 13 ──→  Phase 14 ──→  Phase 15
                                                          │
                                                          ↓
                                                       Phase 16
```

Phases 11 and 12 can run in parallel with 13 — different files, no conflicts. Everything else is serial.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Backfill groups two genuinely separate jobs at one address into one | Dry-run mode, eyeball review, explicit commit step |
| Aggregate drift (`Job.totalPaid` ≠ actual) | Aggregation is a pure function run inside the trigger; tested; re-runnable via a `resyncJobAggregates` callable |
| GCal OAuth token expiry / revocation | Server-side refresh token with renewal; fall-through to "sync disconnected" banner on failure |
| Customer-facing acceptance page breaks during refactor | Phase 15 includes a feature flag `allowCustomerScheduling` per-job; default off; opt in per job |
| Native build regression (web-only testing so far) | Phase 16 includes native smoke test; if it fails, revert Phase 12 only (tabs come back) |
| One paying user sees the switch | Phase 10 makes the new tab visible alongside legacy; Phase 12 removes legacy. They get one dramatic UX change at that moment — brief them or test on their account first. |

---

## Scope boundaries (what's NOT in this plan)

- **Labour tracking / time sheets.** Would be a Phase 17+ thing.
- **Materials ordering from Jobs view.** Already in Documents layer; don't cross the streams.
- **Multi-user / team access.** QuoteMate is single-user today; keep it that way.
- **Two-way GCal sync.** Skipped deliberately — conflict resolution is a rabbit hole.
- **SMS/push notifications on customer scheduling.** Email only; SMS later.
- **Job templates / recurring jobs.** Later feature.

---

## Status

Plan approved. Work paused — resuming after the unrelated production hotfixes are pushed and deployed:

- Logo compression on upload
- Sent-status auto-update on email send
- Acceptance link expiry fix

When those are shipped, dispatch Phase 8 first.
