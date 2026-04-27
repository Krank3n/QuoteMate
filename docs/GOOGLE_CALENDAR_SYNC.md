# Google Calendar Sync — test & rollout checklist

Phase 14 of the jobs refactor. One-way sync: Job schedules in QuoteMate → events on the tradie's Google Calendar. Reschedules inside Google Calendar don't flow back (deliberate — two-way sync is a conflict-resolution rabbit hole).

This doc is the playbook for taking it from "deployed" to "confident enough to ship".

---

## 0 · Preflight

- [ ] Google Calendar API is enabled on the Firebase project.
      (GCP Console → APIs & Services → Library → search "Google Calendar API" → Enable.)
- [ ] OAuth consent screen is configured (Internal is fine for now).
- [ ] A **Web application** OAuth 2.0 Client ID exists in the project.
      The client secret for this same web client is what the server uses to exchange refresh tokens.

Verify Functions config:

```bash
firebase functions:config:get | grep -A2 google
```

Expected output includes:

```
  "web_client_id": "…apps.googleusercontent.com",
  "web_client_secret": "GOCSPX-…",
```

If not, run `./scripts/deploy-gcal-sync.sh` — it'll prompt for the values and `config:set` them for you.

## 1 · Deploy the three Phase-14 functions

```bash
./scripts/deploy-gcal-sync.sh
# or manually:
firebase deploy --only \
  functions:storeGoogleCalendarToken,\
functions:disconnectGoogleCalendar,\
functions:onJobWriteSyncCal
```

Why only these three: they're all new. Callables only fire when the new client calls them. The Firestore trigger only fires on `users/{uid}/jobs/{jobId}` writes — a collection the live production client doesn't write to. Zero blast radius on existing tradies.

## 2 · Happy-path smoke test

Using a dev build of the refactor branch:

- [ ] **Settings → Integrations → Google Calendar → Connect**. The Google OAuth prompt opens.
- [ ] Grant the `calendar.events` scope.
- [ ] Back in the app, the hero card reads **"Connected"** with your email below.
- [ ] Open a Job, tap **Schedule**, pick a date + 9am, duration 2h/day.
- [ ] Wait ~5–10s. Open Google Calendar — the event is there, summary matches the job name + customer, location is the job address.
- [ ] Reschedule the job to 10am. Check calendar — event moves to 10am within ~10s.
- [ ] Clear the scheduled date on the job. Event vanishes from the calendar.
- [ ] Delete the job entirely. Any remaining calendar event is cleaned up.

## 3 · Disconnect path

- [ ] Reschedule the job again, confirm event lands.
- [ ] Settings → Google Calendar → Disconnect. Confirm the prompt.
- [ ] Integration doc in Firestore (`users/{uid}/integrations/google.calendar`) should be gone.
- [ ] Reschedule the same job. Nothing should land in the calendar (the trigger bails when there's no integration).
- [ ] Existing events from before the disconnect **stay in Google Calendar** — we don't mass-delete. Manually remove them if you want a clean slate.

## 4 · Error-path coverage

- [ ] Revoke the grant from the Google side:
      https://myaccount.google.com/permissions → QuoteMate → Remove access.
- [ ] Back in the app, reschedule a job. Trigger should:
      - Attempt the refresh token call, get `invalid_grant` from Google.
      - **Delete** the integration doc automatically.
      - The Settings screen re-renders with **"Connect Google Calendar"** (disconnected state).
      - The Job doc gets a `googleCalendarSyncError` stamp: *"Calendar connection expired — reconnect in Settings."*

## 5 · Log inspection

While testing, keep a tab on Firebase Functions logs:

```bash
firebase functions:log --only onJobWriteSyncCal,storeGoogleCalendarToken,disconnectGoogleCalendar
```

What you should see:

- `onJobWriteSyncCal` fires on every Job write. On notes-only edits it should early-return (no API calls) — confirm by the quick execution time (~< 200ms vs ~1–2s when it's actually pushing).
- `[gcal] refresh failed` with `status=400` means the grant is dead — triggers the auto-disconnect cleanup.
- `[gcal] sync failed` with anything else means the event push itself failed. Message included.

## 6 · Rollback (zero-data-loss)

If anything goes sideways, delete the three functions:

```bash
firebase functions:delete \
  onJobWriteSyncCal storeGoogleCalendarToken disconnectGoogleCalendar
```

Nothing on the client crashes — the Settings screen will just show connection errors, and scheduling still works (the deeplink fallback kicks in automatically when the integration doc is absent).

## 7 · Before shipping to real tradies

- [ ] Run steps 2–4 on a fresh test account (not your admin one).
- [ ] Confirm the app's build channel is pulling the refactor branch (so `useGoogleCalendarAuth` hook ships).
- [ ] Confirm the OAuth consent screen's app name + logo match QuoteMate (tradies see "QuoteMate wants to access your calendar").
- [ ] If rolling out progressively, leave the `gcalUrl` deeplink fallback in place — disconnected users still get a "Open in Google Calendar" button in the schedule sheet, so the UX never dead-ends.

---

## Known limits / deferred

- **One-way only.** Rescheduling inside Google Calendar does **not** update the Job. Open the Job in QuoteMate to change the schedule.
- **Per-job opt-out.** Current behaviour: if you're connected, every scheduled job syncs. No per-job "don't push this one" toggle today — could be added as a `doNotSync?: boolean` on Job later.
- **Customer self-scheduling (Phase 15).** Not on this branch.
- **Web platform.** OAuth via `expo-auth-session`'s web path doesn't reliably surface refresh tokens. The Settings screen will show a friendly "connect from mobile" error if a user tries to connect from web. Mobile (iOS / Android) works.
