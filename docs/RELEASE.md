# Releasing QuoteMate

## The version that matters

`app.config.js` → `expo.version` is the **only** authoritative app version. It's
what `Constants.expoConfig.version` returns at runtime, and what the in-app
update sheet compares against.

`package.json` carries a copy purely so tooling doesn't trip over a missing
field. Keep it in step, but never treat it as the source. It drifted to
`1.0.74` while the app shipped `1.54`, and that stale value is what got written
into `config/appUpdate` and silently killed the update prompt for months (see
below).

Native build numbers are separate and per-platform: `android/app/build.gradle`
(`versionCode`) and the iOS build number. See the `build-android` skill.

## Steps

1. **Bump the version.** `app.config.js` → `expo.version`, and mirror it into
   `package.json`. Bump `versionCode` / iOS build number too.

   Because `runtimeVersion.policy` is `appVersion`, changing the version means
   an OTA can no longer reach the previous build. JS-only fixes that should
   reach the *current* release must ship as an OTA on the **unchanged** version.

2. **Build and submit.** Android via the `build-android` skill; iOS per the
   local build procedure. Commit as `chore(release): <version> — Android
   versionCode <n>, iOS build <n>`.

3. **Wait for the stores.** Do not proceed until the build is actually
   downloadable on both platforms.

4. **Announce it to the update sheet:**

   ```bash
   npm run release:announce -- --version 1.55 --whats-new "One or two plain sentences."
   # review the plan, then:
   npm run release:announce -- --version 1.55 --whats-new "One or two plain sentences." --write
   ```

   This writes `config/appUpdate`, which `src/services/appUpdateService.ts`
   reads to decide whether to show `AppUpdateSheet`. `--version` is the version
   **live in the stores** and is always explicit: nothing in the repo holds
   that number. `app.config.js` is bumped ahead of the store as soon as the
   next build needs its own OTA runtime (it read 1.56 while 1.55 was what
   people could download), so reading it would announce a version nobody can
   install. The script still reads `app.config.js` as a sanity check and
   refuses a `--version` the source has never been built at.

   Soft prompts snooze: "Maybe later" keeps that version quiet for three days,
   a newer `latestVersion` resets the snooze, and a version below
   `minimumVersion` is never snoozed.

   **Run this only after step 3.** Announcing a version that's still in review
   tells everyone to update to something they can't download.

   Dry run is the default; `--write` performs the write.

## Why step 4 exists

`config/appUpdate` sat at `latestVersion: "1.0.74"` while the app shipped
`1.54`. The client compares versions positionally, so `1.54` → `[1,54]` and
`1.0.74` → `[1,0,74]`; at index 1, `54 > 0`, meaning every client read as
*newer* than "latest". `behindLatest` was always false and the sheet never
rendered. `whatsNew` was empty too.

A dead update prompt is invisible — it looks exactly like everyone already
being up to date. `announceRelease.helpers.ts` now refuses to write a
`latestVersion` that sorts below the shipping version, and warns on a
version-scheme change, so this can't recur silently.

## Force updates

`minimumVersion` blocks everyone below it from using the app at all. It's never
set automatically — only via `--minimum <version>`, which prints a warning. Use
it only for genuinely breaking releases. The script refuses a floor above the
released version, which would lock every user out with nothing to update to.

## What does *not* need a release

- **JS-only changes** ship over-the-air via EAS Update on the same version.
- **Cloud Functions** deploy independently:
  `npx firebase deploy --project hansendev --only "functions:<name>,..."`.
  Prefer naming the changed functions — a bare `--only functions` redeploys all
  246. A deleted export needs `firebase functions:delete <name>` as well; a
  selective deploy won't notice it's gone.
- **Push notification copy and send policy** are entirely server-side
  (`functions/src/aussieNotifications.ts`, `functions/src/pushPolicy.ts`).
