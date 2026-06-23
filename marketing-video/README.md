# Marketing video pipeline — Mate Chat quote demos

Produces short marketing videos, one per trade/job, showing a person asking Mate Chat for a
quote and the app replying, asking a clarifying question, and producing a **finished quote with
real prices** (Bunnings/Reece). Outputs drop straight onto the website's per-trade landing pages.

Full design: `/Users/tom/.claude/plans/please-plan-out-a-swift-waterfall.md`.

## Pipeline

```
 scenarios/<slug>.json
        │
        ├─► [1] driver/generateQuote.ts ──► out/<slug>.quote.json   (real prices)
        │                                  └► out/<slug>.demo.json   (harness payload)
        │
        ├─► [2] capture/record.ts ─────────► out/<slug>.app.mp4      (chat replay, phone-framed)
        │
        ├─► [3] presenter/generatePresenter.ts ─► out/<slug>.{intro,answer,reaction}.mp4 (Veo 3)
        │
        └─► [4] compose/ ──────────────────► out/<slug>.mp4 / .webm / -poster.jpg
                                              │
                                              ▼
                 [5] copy into ../../QuoteMateAppWebsite/public/assets/videos/trades/
                     + add <slug> to TRADES_WITH_VIDEOS
```

## Quick start (pilot: fencers)

```bash
cd marketing-video
npm install            # tsx, playwright, etc. (see package.json)

# [1] Real-priced quote + harness payload (LOCAL mode needs no auth — uses the
#     live Bunnings scraper proxy + the app's own template formulas & calc).
npm run quote -- fencers

# [2] Record the app chat replay (builds/serves the gated demo web bundle).
npm run capture -- fencers

# [3] Presenter clips (needs Veo access — see below).
npm run presenter -- fencers

# [4] Compose the final video.
npm run compose -- fencers
```

`npm run all -- fencers` chains 1→4. The orchestrator (`run.ts`) also batches a manifest.

## Driver modes

- **local** (default): derive materials from `src/data/nicheTemplates.ts` formulas, price each via the
  live `bunningsScraperSearch` proxy (no auth), reconcile pack math locally, and total with the app's
  `calculateDocumentTotals`. Real prices, fully deterministic, zero credentials.
- **backend** (`--mode backend`, needs `FIREBASE_ID_TOKEN`): drive the real LLM pipeline —
  `analyzeJobDescription` → scraper → `reconcilePricedMaterials` — for full app fidelity. Mint a token
  for a dedicated marketing-bot account via Firebase Auth REST.

Both modes emit the identical `out/<slug>.quote.json` shape.

## Credentials / access needed

| Stage | Needs | Notes |
|-------|-------|-------|
| driver `local` | nothing | Bunnings scraper proxy is public. |
| driver `backend` | `FIREBASE_ID_TOKEN` | marketing-bot account id token. |
| capture | local web build | gated by `EXPO_PUBLIC_DEMO_CAPTURE=1` (see below). |
| presenter | Veo 3 API access | routed through the `generatePresenterClip` Firebase Function. |
| compose | ffmpeg | Remotion uses it under the hood. |

## Safety: the demo harness is double-gated

The app-side replay harness (`src/demo/demoPlayback.ts`) only activates when **both**:
1. the build sets `EXPO_PUBLIC_DEMO_CAPTURE=1` (capture builds only — never production), AND
2. `window.__QM_DEMO__` is present at runtime (injected by the capture script).

In any normal build the env is unset, the hook is a no-op, and nothing reaches real users.

The capture build also bypasses the login gate (so it can record without an account) — it is therefore written to an **isolated, gitignored `dist-web-demo/`** dir (never the normal `dist-web/`) and must never be deployed. Firebase Hosting serves `public/`, not either dist dir, so there's no deploy path for it.
