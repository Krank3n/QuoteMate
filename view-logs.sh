#!/bin/bash

# QuoteMate Android Log Viewer
# Shows logs from connected Android device

echo "🔍 Viewing QuoteMate logs from Android device..."
echo "Looking for: Bunnings Scraper, API calls, errors"
echo ""
echo "Press Ctrl+C to stop"
echo "================================"
echo ""

~/Library/Android/sdk/platform-tools/adb logcat -c  # Clear old logs
~/Library/Android/sdk/platform-tools/adb logcat | grep -E "(ReactNativeJS|Bunnings|Scraper|🔧|✅|❌|fetch)"
