# Server-side pricing run

Mate's "Price it up" runs the materials + pricing pipeline inside a Cloud
Function instead of in the phone's JavaScript. Locking the phone or switching
apps no longer kills the run, and a push tells the tradie when the quote is
ready.

## How it fits together

| Piece | Where | Role |
| --- | --- | --- |
| Pipeline | `shared/pricing/pipeline.ts` | The one implementation: analyse → supplier book → Reece → Bunnings → estimate → reconcile → coverage sweeps. Takes its network and storage through `PipelineDeps`. |
| Phone binding | `src/services/materialsPipeline.ts` | Supplies React Native services, holds the screen awake. Still used by the wizard's Get Recommended Gear / Fetch Prices and by Mate's reprice, and as the fallback below. |
| Server binding | `functions/src/index.ts` (`serverPipelineDeps`, `onPricingRunCreated`) | Wires the same cores the HTTP handlers use (`analyzeJobDescriptionCore`, `reconcilePricedMaterialsCore`, `estimateMaterialPriceCore`, `searchReeceProductCore`, direct scraper calls). |
| Run document types | `shared/pricing/pricingRunDoc.ts` | The wire contract both sides import. |
| Run orchestration | `functions/src/pricingRun.ts` | Claims the run, streams progress, writes the quote with recomputed totals, decides whether to push. Pure apart from `firestorePricingRunStore`. |
| Phone watcher | `src/services/serverPricingRun.ts` | Creates the run document, mirrors progress into the working card, keeps the `foreground` flag honest, resolves with the priced quote. |
| Store | `src/store/useStore.ts` (`runScopePipeline`) | Tries the server first; prices on the phone when the server never claims the run. |
| Working card | `src/components/assistant/PricingNotifyLine.tsx` | "Lock your phone if you like" or "Tell me when it's done" while a server run is going. |

## The run document

`users/{uid}/pricingRuns/{runId}`

```
quoteId, kind: 'draft' | 'scope'
options: { stripLabour, labourOnly }      // the plan is NOT here — see below
status: 'queued' → 'running' → 'done' | 'failed' | 'cancelled'
progress: WorkingStatus            // what the chat card renders
foreground: boolean                // phone-maintained; false = backgrounded/locked
createdAt, startedAt, updatedAt, finishedAt   // ISO strings
result?: { generatedMaterialCount, fetchedCount, failedCount, skippedCount, missedSupplierTerms, reeceReauthNeeded }
error?: string
```

The server resolves the tradie's plan itself (`resolveServerPlan`, the
server-owned `isPro` flag) — a free-plan run fails with the same message
Mate's Apply path gives, and photo/plan vision follows the resolved plan, so
the document can't hand its author a tier.

The phone creates it as `queued`. The trigger claims it in a transaction
(`queued → running`), so a redelivered event or a phone that gave up and
cancelled can never price the quote twice. Progress writes are coalesced to
one per 600 ms. The priced quote lands on `users/{uid}/quotes/{quoteId}`
with totals recomputed by `recalculateQuoteTotals` and `draftStep:
'JobPreview'` (or `'MaterialsList'` on a snag), where the app's realtime
listener and the document mirror pick it up as they would any app write.

## The push

Sent through `sendAussiePush` as `quote_priced` (or `quote_pricing_snag`),
event-class so quiet hours and the daily nudge cap never hold it, on the
existing `quote-responses` Android channel. It goes out only when the phone
is away at completion: the run document's `foreground` is `false`, or its
`foregroundAt` stamp (re-written every 20 s while the app is in front) is
older than 45 s — so a lost "I'm away" write means a push, never silence.
Tapping it opens the job (`jobId` rides in the payload).

Permission is only ever requested from the card's "Tell me when it's done"
line, where the tap itself is the consent; it does not touch the send-time
prompt's "already asked" marker.

## Fallbacks and the kill switch

The phone prices the quote itself, exactly as before, when:

- `config/pipeline` has `serverRuns: false` (the kill switch; a missing
  document means on),
- the run document can't be written within 8 s (offline — the queued write is
  taken back with a delete so it never creates a run later),
- nothing claims the run within 25 s (function not deployed, cold start
  backlog) — the phone cancels it first, and keeps waiting if the server won
  that race.

A claimed run that stops writing progress for 6 minutes, or runs past 10
minutes, is reported as failed; the draft is parked on the Fetch Prices step
either way.

Each user is limited to 8 claimed runs per 10 minutes on the server (runs
the phone cancelled unclaimed cost nothing and don't count); the HTTP
handlers keep their own per-user rate limits for the phone path.

## Deploying

1. `firebase deploy --only functions` — the trigger must exist before clients
   start writing run documents (they'd fall back after 25 s otherwise, which
   works but wastes the wait).
2. Ship the client (OTA is enough; there is no native change).
3. To back out without a client release: set `config/pipeline.serverRuns`
   to `false`.

## Not moved yet

- Mate's reprice (`propose_reprice`) and the wizard's own Get Recommended
  Gear / Fetch Prices still run on the phone.
- A working card left "pricing" when the app was killed mid-run is not
  reconciled on relaunch; the quote itself is priced and the dashboard draft
  banner points at it.
