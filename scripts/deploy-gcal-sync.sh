#!/usr/bin/env bash
# Deploy ONLY the Phase-14 Google Calendar sync functions + verify the
# Functions config they need. Safe to run against production — the three
# functions it deploys are inert against old clients (callables are
# user-triggered, onJobWriteSyncCal fires on a collection the old client
# doesn't write to).
#
# Usage:
#   ./scripts/deploy-gcal-sync.sh [--project <alias>]
#
# Prereqs:
#   - firebase CLI installed + logged in (`firebase login`)
#   - You know the web OAuth client's id + secret (GCP Console →
#     Credentials → click into the web OAuth 2.0 Client ID)

set -euo pipefail

PROJECT_FLAG=""
if [[ "${1:-}" == "--project" && -n "${2:-}" ]]; then
  PROJECT_FLAG="--project $2"
fi

say() {
  printf "\n\033[1;36m== %s ==\033[0m\n" "$*"
}
warn() {
  printf "\033[1;33m! %s\033[0m\n" "$*"
}
fail() {
  printf "\033[1;31mX %s\033[0m\n" "$*" >&2
  exit 1
}

command -v firebase >/dev/null 2>&1 || fail "firebase CLI not found. Install with: npm i -g firebase-tools"

say "1 / 3  Checking Functions config for google.web_client_id + google.web_client_secret"

# `firebase functions:config:get` prints the whole config tree; grep out
# the google node. Works without jq.
CURRENT_CONFIG=$(firebase functions:config:get $PROJECT_FLAG 2>/dev/null || true)
HAS_ID=$(printf '%s' "$CURRENT_CONFIG" | grep -E '"web_client_id"\s*:\s*"[^"]+"' || true)
HAS_SECRET=$(printf '%s' "$CURRENT_CONFIG" | grep -E '"web_client_secret"\s*:\s*"[^"]+"' || true)

if [[ -n "$HAS_ID" && -n "$HAS_SECRET" ]]; then
  echo "Both google.web_client_id and google.web_client_secret are already set. Skipping."
else
  warn "google.web_client_id or google.web_client_secret is missing."
  echo "Where to find them:"
  echo "  • Client ID: GCP Console → APIs & Services → Credentials →"
  echo "    the OAuth 2.0 Client ID of type 'Web application'."
  echo "  • Client secret: on that same page — click the client name,"
  echo "    then 'Client secret' in the sidebar."
  echo

  if [[ -z "$HAS_ID" ]]; then
    read -r -p "Paste google.web_client_id (ends in .apps.googleusercontent.com): " WEB_ID
  fi
  if [[ -z "$HAS_SECRET" ]]; then
    read -r -s -p "Paste google.web_client_secret (starts with GOCSPX-): " WEB_SECRET
    echo
  fi

  SET_CMD=(firebase functions:config:set $PROJECT_FLAG)
  [[ -n "${WEB_ID:-}" ]] && SET_CMD+=("google.web_client_id=$WEB_ID")
  [[ -n "${WEB_SECRET:-}" ]] && SET_CMD+=("google.web_client_secret=$WEB_SECRET")
  echo "Running: ${SET_CMD[*]//GOCSPX-*/GOCSPX-***REDACTED***}"
  "${SET_CMD[@]}"
fi

say "2 / 3  Deploying ONLY the three Phase-14 functions"

echo "These three are safe against the current production client:"
echo "  • storeGoogleCalendarToken (callable, user-triggered only)"
echo "  • disconnectGoogleCalendar (callable, user-triggered only)"
echo "  • onJobWriteSyncCal (trigger on users/{uid}/jobs — collection the"
echo "    old client doesn't write to)"
echo

read -r -p "Continue with deploy? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  fail "Aborted."
fi

firebase deploy $PROJECT_FLAG --only \
  functions:storeGoogleCalendarToken,functions:disconnectGoogleCalendar,functions:onJobWriteSyncCal

say "3 / 3  Done"

cat <<'MSG'
Deployed. Next:
  • Open the app (a build with the new refactor branch code, not the
    live TestFlight/Play build unless you've shipped this yet).
  • Settings → Integrations → Google Calendar → Connect.
  • Accept the Google prompt (grant calendar.events).
  • Schedule a Job with a specific time.
  • Within 5–10 seconds the event should land in your Google Calendar.

If nothing happens:
  • Firebase console → Functions → logs — filter to onJobWriteSyncCal.
    Look for: "[gcal] refresh failed" or "[gcal] sync failed".
  • Check users/{your-uid}/jobs/{jobId} in Firestore for a
    googleCalendarSyncError stamp.
  • Check users/{your-uid}/integrations/google.calendar for lastSyncError.

To roll back (disables sync without breaking anything else):
  firebase functions:delete onJobWriteSyncCal storeGoogleCalendarToken disconnectGoogleCalendar
MSG
