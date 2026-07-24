# Sentry → autofix → PR → deploy pipeline

A new production error in Sentry automatically becomes a fixed, tested PR; merging that PR automatically redeploys what it touched.

```
Sentry issue alert (new issue, production)
  └─▶ sentryAutofix function (verify sig, dedupe, daily cap)
        └─▶ GitHub issue [sentry-autofix, agent-working] + dispatch agent.yml
              └─▶ Claude pipeline: explore → implement (+regression test) → 3 audits → QA → PR
                    └─▶ HUMAN reviews & merges  ◀── the only gate
                          └─▶ deploy-on-merge.yml:
                                functions/** → firebase deploy --only functions
                                src/**       → eas update (production channel, iOS+Android OTA)
                                native touch → PR comment: run EAS Pipeline build+submit
```

## One-time setup

### 1. GitHub

- Create the `sentry-autofix` label on Krank3n/QuoteMate (any colour).
- Create a **fine-grained PAT** scoped to Krank3n/QuoteMate with **Issues: Read/write** and **Actions: Read/write** (Contents: Read). This is `GITHUB_AGENT_TOKEN` below.
- Repo secrets already in place from the existing pipelines: `ANTHROPIC_API_KEY`, `EXPO_TOKEN`, `FIREBASE_SERVICE_ACCOUNT`.
- `FIREBASE_SERVICE_ACCOUNT` was provisioned for Hosting previews — functions deploys additionally need **Cloud Functions Admin**, **Cloud Run Admin**, **Artifact Registry Writer**, **Service Account User**, and **Firebase Extensions Viewer** on `hansendev` (or just grant it Editor).

### 2. Sentry (org `hansendev-0p`, project `react-native`)

1. **Settings → Developer Settings → New Internal Integration**
   - Name: `QuoteMate Autofix`
   - Webhook URL: `https://us-central1-hansendev.cloudfunctions.net/sentryAutofix`
   - Enable **Alert Rule Action**. Permissions: Issue & Event = Read.
   - Save, then copy the **Client Secret** — this is `SENTRY_WEBHOOK_SECRET`.
2. **Alerts → Create Alert → Issues** on the `react-native` project:
   - When: **A new issue is created**
   - Filter: environment = `production` (skip dev noise)
   - Action: **Send a notification via QuoteMate Autofix**

### 3. Functions env (`functions/.env`, never committed)

```
SENTRY_AUTOFIX_ENABLED=true
SENTRY_WEBHOOK_SECRET=<internal integration client secret>
GITHUB_AGENT_TOKEN=<fine-grained PAT>
# optional overrides
# SENTRY_AUTOFIX_DAILY_CAP=3
# SENTRY_ORG_SLUG=hansendev-0p
# GITHUB_AUTOFIX_REPO=Krank3n/QuoteMate
```

Then `cd functions && npm run deploy`.

## Guard rails

- **Human merge is mandatory** — the agent never merges, never pushes to main, never deploys (agent-task.md hard rules). Merging the PR is the deploy approval.
- **Dedupe forever**: one dispatch per Sentry issue id (`sentryAutofixDispatches` collection). A regression alert on the same issue won't re-dispatch; delete the doc to force a re-run.
- **Daily cap** (default 3): an alert storm can't queue dozens of agent runs. Over-cap alerts are logged in the function logs.
- **Kill switch**: set `SENTRY_AUTOFIX_ENABLED=false` and redeploy functions.
- **Native-safe OTA**: if the fix touches `android/`, `ios/`, `plugins/`, `patches/`, `package.json`, or `app.config.js`, the OTA is skipped and the PR gets a comment asking for a store build — a JS bundle mismatched against old native code is how you crash everyone.
- Ordinary (non-autofix) merges to main are untouched — no deploy behaviour changes outside this flow.

## Ops notes

- Dispatch audit trail: `sentryAutofixDispatches/{sentryIssueId}` docs (status: `dispatching` → `dispatched` / `skipped-daily-cap`; failed dispatches delete the doc so Sentry's retry works).
- If the agent can't confidently root-cause (native crash, third-party dep), it comments on the GitHub issue and stops — check open `sentry-autofix` issues without linked PRs.
- Store-build releases (native changes) still go through the existing EAS Pipeline workflow / Tasks board buttons.
