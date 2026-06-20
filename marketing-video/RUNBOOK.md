# Runbook — finishing & testing the marketing video pipeline

Two tracks of steps, tagged so a browser/console agent and a terminal can split the work:

- 🖥️ **Terminal** — run in a shell at the repo root (or `marketing-video/`).
- 🌐 **Browser/Console** — a web UI task (Google AI Studio, Firebase Console, the
  marketing site). This is what "Claude browser" / a human does.

Project facts (already wired, no secrets here):
- Firebase project: **`hansendev`**  ·  Functions base: `https://us-central1-hansendev.cloudfunctions.net`
- Web API key (public): **`AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw`**
- Functions read `GEMINI_API_KEY` from `functions/.env` (same key the live app already uses).

---

## Track 0 — One-time local setup  🖥️

```bash
cd marketing-video
npm install
npx playwright install chromium          # records the app UI headlessly
ffmpeg -version >/dev/null || brew install ffmpeg   # compositor needs ffmpeg
```

---

## Track A — Test it NOW (screen-demo, no human presenter)  🖥️

This proves the whole rig end-to-end with **real prices** and the **real Mate UI** —
no Veo, no token, no browser needed. Produces a branded video without the talking head.

```bash
# From the REPO ROOT — build the capture bundle (auth-bypassed; isolated dir).
# --clear avoids a stale Metro env cache leaking the flag into other builds.
EXPO_PUBLIC_DEMO_CAPTURE=1 npx expo export -p web --output-dir dist-web-demo --clear

# Back in marketing-video/ — run the pipeline, skipping the Veo presenter step.
cd marketing-video
npm run all -- fencers --skip-presenter
```

Outputs in `marketing-video/out/`: `fencers.mp4`, `fencers.webm`, `fencers-poster.jpg`,
plus `fencers.quote.json` (open it — line items should be priced, with a sane total).
Open `fencers.mp4` to watch the brand intro → phone-framed chat replay → outro.

✅ If this plays, the driver + harness + capture + compositor all work. Everything below
just adds the human presenter and ships it to the site.

---

## Track B — Add the human presenter (Veo 3)

### B1 — Confirm Veo 3 access on the Gemini key  🌐
1. Go to **https://aistudio.google.com/** and sign in with the Google account that owns
   the `hansendev` Gemini API key.
2. Open **Get API key** → confirm the key is on a **paid tier** (Veo is **not** in the
   free tier — image/video generation needs billing enabled).
3. Open the **Veo** docs/playground and generate one test clip to confirm the account
   is entitled to model **`veo-3.0-generate-001`**. If it's gated/region-blocked, that's
   the blocker to resolve before B-anything.

> If Veo isn't available on this key, the pipeline still runs via Track A (screen-demo).
> The presenter is the only piece that needs Veo.

### B2 — Deploy the new Veo function  🖥️
```bash
cd functions
npm run build
firebase deploy --only functions:generatePresenterClip
```
(The function reads `GEMINI_API_KEY` from `functions/.env` automatically — same as the
existing `analyzeJobDescription`. No extra secret config.)

### B3 — Create a marketing-bot account + mint an ID token

**Create the account (once)**  🌐
- Firebase Console → **`hansendev`** → **Authentication → Users → Add user**.
- Email e.g. `marketing-bot@quotemate.app`, set a password. (No subscription needed —
  the functions we call gate on auth + rate-limit only, not quota.)

**Mint a 1-hour ID token**  🖥️  *(re-run whenever it expires)*
```bash
export FIREBASE_ID_TOKEN=$(curl -s \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw" \
  -H 'Content-Type: application/json' \
  -d '{"email":"marketing-bot@quotemate.app","password":"<the-password>","returnSecureToken":true}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])')
echo "${FIREBASE_ID_TOKEN:0:12}…  (token set)"
```

### B4 — (Optional) Provide a reference face for character consistency  🌐
Veo drifts between clips. To lock the "common human", drop a portrait at
`marketing-video/presenter/reference/qm-presenter-v1.png` and keep the fixed `seed` in
`presenter/character.json`. (Today the wrapper passes prompt + seed; wire the reference
image into `presenter/generatePresenter.ts` if you want image-conditioned generation.)

### B5 — Run the full pipeline (with presenter)  🖥️
```bash
cd marketing-video
# Token from B3 must be exported in this shell.
npm run all -- fencers
```
This adds Veo intro/answer/reaction clips and composes the talking-head + app cut-in video.
Veo is a long-running job (~1–3 min per clip), so expect a few minutes.

---

## Track C — Review & publish to the website  🖥️ + 🌐

1. **Review** `marketing-video/out/fencers.mp4`. Only proceed if it looks right.  🌐
2. **Publish** the media into the site and print the one-line code edit needed:  🖥️
   ```bash
   cd marketing-video
   npm run all -- fencers --publish      # or: --skip-presenter --publish
   ```
   This copies `fencers.{mp4,webm}` + `fencers-poster.jpg` into
   `QuoteMateAppWebsite/public/assets/videos/trades/`.
3. **Enable it on the trade page** — edit `QuoteMateAppWebsite/app/[tradeSlug]/page.tsx`:  🖥️
   ```diff
   - const TRADES_WITH_VIDEOS = new Set(['electricians', 'plumbers', 'carpenters']);
   + const TRADES_WITH_VIDEOS = new Set(['electricians', 'plumbers', 'carpenters', 'fencers']);
   ```
4. **Preview the site**:  🖥️
   ```bash
   cd ../QuoteMateAppWebsite && npm run dev
   ```
   Open the fencers trade page — `TradePromoVideo` should autoplay on scroll.

---

## Adding more trades

Each new video = one `marketing-video/scenarios/<slug>.json` (copy `fencers.json`, change
the trade/template/conversation; `<slug>` must match a website trade slug). Add the slug to
`marketing-video/manifest.json`, then `npm run all -- <slug>` (or `npm run manifest` for all).
Bunnings-stocked trades (painters, carpenters/decking) price best in `local` mode; for
trades with thin Bunnings catalogues (fencing infill/rails), use `--mode backend` so the
LLM reconciliation fills gaps.

---

## Safety notes (don't skip)

- The capture build **bypasses login** so it can record without an account. It is written
  ONLY to the gitignored **`dist-web-demo/`** — never the deployed `dist-web/`, and Firebase
  Hosting serves `public/`, not either. **Never deploy `dist-web-demo/`.**
- The bypass + replay are double-gated on `EXPO_PUBLIC_DEMO_CAPTURE=1` **and** an injected
  `window.__QM_DEMO__` payload (`isDemoCaptureActive()`), so a leaked build flag alone does
  nothing for real users. Verified: a normal build with a payload injected still shows the
  login screen.
- ID tokens expire after ~1 hour — re-run B3 if presenter/backend calls start returning 401.
```
