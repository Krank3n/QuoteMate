#!/usr/bin/env bash
#
# Tests for the device-discovery parsing in record-tap-to-pay.sh.
#
# The parsing is the part that fails silently: ffmpeg lists the iPhone under BOTH
# video and audio devices at different indexes, and xctrace prints connected and
# offline devices under headers a naive sed range runs straight through. Picking
# the audio index, or calling an offline phone connected, both look fine until
# you have a phone in your hand and a card to tap.
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/record-tap-to-pay.sh

FIX=$(mktemp -d); trap 'rm -rf "$FIX"' EXIT
pass=0; fail=0

expect() { # name expected actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1"; echo "       expected: [$2]"; echo "       actual:   [$3]"
  fi
}

cat > "$FIX/avf-connected" <<'EOF'
[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Camera
[AVFoundation indev @ 0x1] [1] MacBook Pro Desk View Camera
[AVFoundation indev @ 0x1] [2] Thomas’s iPhone
[AVFoundation indev @ 0x1] [3] Capture screen 0
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x1] [1] Thomas’s iPhone
EOF

cat > "$FIX/avf-none" <<'EOF'
[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Camera
[AVFoundation indev @ 0x1] [1] Capture screen 0
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone
EOF

cat > "$FIX/xctrace-offline" <<'EOF'
== Devices ==
Thomas’s MacBook Pro (2940EAE3-BCB3-5EA1-A000-0FB681DDADE1)

== Devices Offline ==
Thomas’s iPhone (18.6.2) (00008030-001E046111DB802E)

== Simulators ==
iPhone 17 Pro Simulator (26.0) (6A931840-5294-4483-9B0F-49C750E87E35)
EOF

cat > "$FIX/xctrace-connected" <<'EOF'
== Devices ==
Thomas’s MacBook Pro (2940EAE3-BCB3-5EA1-A000-0FB681DDADE1)
Thomas’s iPhone (18.6.2) (00008030-001E046111DB802E)

== Simulators ==
iPhone 17 Pro Simulator (26.0) (6A931840-5294-4483-9B0F-49C750E87E35)
EOF

echo "iphone_index"
TTP_FAKE_AVF="$FIX/avf-connected" expect "picks the VIDEO index, not the audio one" \
  "2" "$(TTP_FAKE_AVF=$FIX/avf-connected iphone_index)"
expect "is empty when no iPhone is attached" \
  "" "$(TTP_FAKE_AVF=$FIX/avf-none iphone_index)"

echo "connected_iphones / offline_iphones"
expect "an offline phone is not reported as connected" \
  "" "$(TTP_FAKE_XCTRACE=$FIX/xctrace-offline connected_iphones)"
expect "an offline phone is reported as offline" \
  "Thomas’s iPhone (18.6.2) (00008030-001E046111DB802E)" \
  "$(TTP_FAKE_XCTRACE=$FIX/xctrace-offline offline_iphones)"
expect "a connected phone is reported as connected" \
  "Thomas’s iPhone (18.6.2) (00008030-001E046111DB802E)" \
  "$(TTP_FAKE_XCTRACE=$FIX/xctrace-connected connected_iphones)"
expect "simulators never leak into the device lists" \
  "" "$(TTP_FAKE_XCTRACE=$FIX/xctrace-connected connected_iphones | grep -i simulator || true)"

# Regression: `check` told us to plug the phone in while it was already connected,
# because a SECOND phone sitting in the offline section tripped the hint.
cat > "$FIX/xctrace-mixed" <<'EOF'
== Devices ==
Thomasâs MacBook Pro (2940EAE3-BCB3-5EA1-A000-0FB681DDADE1)
Thomasâs iPhone (18.6.2) (00008030-001E046111DB802E)

== Devices Offline ==
Someone Elseâs iPhone (26.3) (00008120-000A51E934E2601E)

== Simulators ==
iPhone 17 Pro Simulator (26.0) (6A931840-5294-4483-9B0F-49C750E87E35)
EOF

expect "a connected phone is still connected when another phone is offline" \
  "Thomasâs iPhone (18.6.2) (00008030-001E046111DB802E)" \
  "$(TTP_FAKE_XCTRACE=$FIX/xctrace-mixed connected_iphones)"
expect "the offline list holds only the other phone" \
  "Someone Elseâs iPhone (26.3) (00008120-000A51E934E2601E)" \
  "$(TTP_FAKE_XCTRACE=$FIX/xctrace-mixed offline_iphones)"

echo "device_udid"
expect "reads the UDID of the connected phone" \
  "00008030-001E046111DB802E" "$(TTP_FAKE_XCTRACE=$FIX/xctrace-connected device_udid)"
expect "is empty when the phone is only offline" \
  "" "$(TTP_FAKE_XCTRACE=$FIX/xctrace-offline device_udid)"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
