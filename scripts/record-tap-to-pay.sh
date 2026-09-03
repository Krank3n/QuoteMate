#!/usr/bin/env bash
#
# Capture the Apple Tap to Pay submission videos off a USB-connected iPhone.
#
# Apple grants the Tap to Pay *publishing* entitlement only after reviewing three
# screen recordings (Onboarding, Enabling/Educating, Checkout) plus the App Review
# Requirements Checklist — see docs/SQUARE_TAP_TO_PAY.md.
#
# Why not idb: idb's `ui tap` / `video` need a companion attached to the target, and
# a physical iPhone exposes no CoreSimulator HID surface — so taps stay a human job.
# What IS scriptable is the capture: a trusted, unlocked iPhone on USB shows up as an
# AVFoundation source (the same one QuickTime's "Movie Recording → iPhone" uses), and
# ffmpeg can grab it. That is what this does.
#
# The Simulator is not an option at all: TapToPaySettings.isDeviceCapable() is false
# there, so the app correctly hides every Tap to Pay affordance. A simulator recording
# would be evidence of the feature's absence.
#
# Usage:
#   scripts/record-tap-to-pay.sh check
#   scripts/record-tap-to-pay.sh record 1-onboarding [seconds]
#   scripts/record-tap-to-pay.sh shotlist
#
set -euo pipefail

OUT_DIR="${TTP_OUT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/recordings/tap-to-pay}"
BUNDLE_ID="com.hansendev.quotemate"

# ffmpeg prints its device list to stderr and then exits non-zero by design.
avf_devices() {
  if [ -n "${TTP_FAKE_AVF:-}" ]; then cat "$TTP_FAKE_AVF"; return 0; fi
  ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1 || true
}

# The iPhone's AVFoundation index. Matches on "iPhone" among the *video* devices only —
# the phone appears in the audio list too, under a different index.
iphone_index() {
  avf_devices | awk '
    /AVFoundation video devices:/ { section = "video"; next }
    /AVFoundation audio devices:/ { section = "audio"; next }
    section == "video" && /iPhone/ && !/MacBook/ {
      if (match($0, /\[[0-9]+\]/)) {
        print substr($0, RSTART + 1, RLENGTH - 2)
        exit
      }
    }'
}


# Devices in one xctrace section. xctrace emits "== Devices ==" (connected),
# "== Devices Offline ==" and "== Simulators ==", so a plain sed range over
# /== Devices/ swallows the offline block too.
xctrace_section() {
  { if [ -n "${TTP_FAKE_XCTRACE:-}" ]; then cat "$TTP_FAKE_XCTRACE"; else xcrun xctrace list devices 2>/dev/null; fi; } | awk -v want="$1" '
    /^== / { section = $0; next }
    section == want && NF { print }'
}

connected_iphones() { xctrace_section "== Devices ==" | grep -i iPhone || true; }
offline_iphones()   { xctrace_section "== Devices Offline ==" | grep -i iPhone || true; }

device_udid() {
  connected_iphones | head -1 | sed -n 's/.*(\([0-9A-Za-z-]\{20,\}\)).*/\1/p'
}

# macOS hands an iPhone's screen only to a process with Camera permission, and a
# "notDetermined" terminal fails at open time with a bare I/O error.
camera_tcc_status() {
  if ! command -v swift >/dev/null 2>&1; then echo "unknown (no swift)"; return; fi
  swift -e 'import AVFoundation
let s = AVCaptureDevice.authorizationStatus(for: .video)
print([AVAuthorizationStatus.notDetermined: "notDetermined — never asked",
       .restricted: "restricted", .denied: "denied", .authorized: "authorized"][s] ?? "?")' 2>/dev/null \
    || echo "unknown"
}

# Only a development-signed build carries the Tap to Pay entitlement — Apple's Apr
# 2026 grant is development-distribution only. An App Store copy of the same version
# looks identical in every listing except `builtByDeveloper`, and fails at
# authorize() rather than at install, which is a rotten way to find out mid-shoot.
check_installed_build() {
  local udid json
  udid=$(device_udid)
  [ -z "$udid" ] && return 0
  json=$(mktemp)
  if ! xcrun devicectl device info apps --device "$udid" --json-output "$json" >/dev/null 2>&1; then
    echo "⚠️  Could not read the installed apps."
    rm -f "$json"; return 0
  fi
  BUNDLE_ID="$BUNDLE_ID" python3 - "$json" <<'PYEOF'
import json, os, sys
bundle = os.environ["BUNDLE_ID"]
apps = json.load(open(sys.argv[1])).get("result", {}).get("apps", [])
app = next((a for a in apps if a.get("bundleIdentifier") == bundle), None)
if not app:
    print(f"❌ {bundle} is not installed. Build it with: npx expo run:ios --device")
elif app.get("builtByDeveloper"):
    print(f"✅ {app['name']} {app.get('version')} ({app.get('bundleVersion')}) — development-signed, carries the entitlement")
else:
    print(f"❌ {app['name']} {app.get('version')} is the App Store copy — NO Tap to Pay entitlement.")
    print("   Delete it on the phone, then: npx expo run:ios --device")
PYEOF
  rm -f "$json"
}

cmd_check() {
  local idx connected offline
  connected=$(connected_iphones)
  offline=$(offline_iphones)

  echo "== iPhones Xcode can see =="
  if [ -n "$connected" ]; then
    echo "$connected" | sed 's/^/  connected: /'
  fi
  if [ -n "$offline" ]; then
    echo "$offline" | sed 's/^/  offline:   /'
  fi
  [ -z "$connected$offline" ] && echo "  (none)"
  echo

  echo "== Build installed on the device =="
  check_installed_build
  echo

  echo "== Screen capture =="
  idx=$(iphone_index)

  if [ -n "$idx" ]; then
    echo "✅ iPhone is an AVFoundation capture source at index [$idx] — ready to record."
  elif [ -z "$connected" ]; then
    echo "❌ No iPhone connected."
    [ -n "$offline" ] && echo "   Xcode sees one, but offline. Plug it in over USB and unlock it."
    return 1
  else
    # Connected but not publishing a capture device. Being paired and trusted is
    # not enough: iOS only offers its screen over USB while the phone is UNLOCKED,
    # and macOS only hands the stream to a process holding Camera permission.
    echo "❌ Connected, but not offering its screen as a capture device."
    echo "   1. Unlock the iPhone and leave it awake — locked phones publish nothing."
    echo "   2. Grant Camera access to whatever runs this (System Settings →"
    echo "      Privacy & Security → Camera). Currently:"
    echo "      $(camera_tcc_status)"
    echo "   3. Try a direct port, not a hub — yours is behind two."
    echo
    echo "   If QuickTime also lists no iPhone, macOS is not publishing the screen"
    echo "   at all and nothing on this Mac can capture it. Record on the phone"
    echo "   instead — Control Centre → Screen Recording. It is native resolution,"
    echo "   needs no Mac at all, and Apple accepts it. Pull the file off with"
    echo "   AirDrop or Image Capture afterwards."
    echo "   (Video 3 still needs a second camera either way — the ProximityReader"
    echo "   UI is excluded from capture on-device too.)"
    return 1
  fi

}


cmd_record() {
  local name="${1:?usage: record <name> [seconds]}"
  local secs="${2:-}"
  local idx stamp out

  idx=$(iphone_index)
  if [ -z "$idx" ]; then
    echo "No iPhone capture source. Run: $0 check" >&2
    exit 1
  fi

  mkdir -p "$OUT_DIR"
  stamp=$(date +%Y%m%d-%H%M%S)
  out="$OUT_DIR/${name}-${stamp}.mov"

  echo "Recording iPhone [$idx] → $out"
  [ -n "$secs" ] && echo "Stopping after ${secs}s." || echo "Press q (or Ctrl-C) to stop."
  echo

  # -pix_fmt yuv420p so Apple's uploader and QuickTime both play it back.
  ffmpeg -hide_banner -loglevel warning -stats \
    -f avfoundation -i "$idx" \
    ${secs:+-t "$secs"} \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
    "$out"

  echo
  echo "Saved: $out"
}

cmd_shotlist() {
  cat <<'SHOTS'
Apple names these three exactly as below (entitlement email, 16 Apr 2026,
Case-ID 19476927). Use Apple's names on the uploaded files — the reviewer is
matching them against the checklist. Requirement numbers are from the App
Review Requirements Checklist v1.6.

1-new-user-flow — "New User Flow"          [screen record: OK]
   A merchant who has never used the app. Fresh install, signed out.
   -> Sign up / sign in
   -> Business details
   -> Payments step: connect the AU Square seller account
   -> req 3.4: "Set up Tap to Pay on this phone" appears on that same step
   -> tap it; Apple's Terms and Conditions open (req 3.5)
   -> accept; Apple's education plays immediately (req 4.2)
   Let the education run to the end. Do not cut it.

2-existing-user-flow — "Existing User Flow"   [screen record: OK]
   A merchant ALREADY using the app, who has not yet enabled Tap to Pay.
   This is the awareness moment: reqs 3.1-3.3 are the substance of this
   video, and they need Apple Marketing Toolkit banner assets. Without them
   this video cannot be shot -- it is the only remaining app blocker.
   -> open the app as an existing user
   -> the awareness moment appears (3.1 / 3.2)
   -> from it, enable Tap to Pay -> T&Cs (3.5) -> education (4.2)
   -> Settings -> Square -> "How Tap to Pay works" proves it is findable
      again later (4.3)
   -> open a quote -> Take Payment: the row is NOT greyed out (3.7 / 5.3)
      and shows the configuring state (3.9.1)

3-checkout-flow — "Checkout Flow"   [!! CANNOT BE SCREEN RECORDED !!]
   Apple excludes the ProximityReader UI from screen capture; it records
   black. Film the phone with a second camera, whole flow uncut:
   -> open a quote with money owed -> Take Payment
   -> Tap to Pay on iPhone -> amount shown
   -> present a real contactless card (or a phone with Apple Pay)
   -> approval -> digital receipt
   -> req 5.10 also wants the DECLINED path: a declined card must still
      offer the customer a record. Worth filming a decline too.

Where they go
   Reply to ttpoientitlements@apple.com quoting Case-ID: 19476927, then
   upload the three videos plus the completed checklist to Apple's File
   Uploader:
   (tokenised link — see the 16 Apr 2026 entitlement email)

Prerequisites that are not code
   * Apple Marketing Toolkit assets (blocks video 2 -- see reqs 3.1-3.3):
     (tokenised link — see the 16 Apr 2026 entitlement email)
   * A connected AU Square seller account with Tap to Pay enabled, and a
     real contactless card to tap.
   * AU surcharging: Apple wants the surcharge on its own screen via a
     surcharge API; mobile-payments-sdk-react-native exposes none. Open
     with Square.
SHOTS
}

# Sourced by scripts/record-tap-to-pay.test.sh — only dispatch when run directly.
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  return 0
fi

case "${1:-}" in
  check)    shift; cmd_check "$@" ;;
  record)   shift; cmd_record "$@" ;;
  shotlist) shift; cmd_shotlist "$@" ;;
  *)
    sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
