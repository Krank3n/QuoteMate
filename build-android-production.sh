#!/bin/bash

# QuoteMate Android Production Build Script
# This script builds a production-signed AAB for Google Play

set -e  # Exit on error

echo "================================================"
echo "Building QuoteMate Android Production AAB"
echo "================================================"
echo ""

# Check if keystore exists
if [ ! -f "android/app/upload.keystore" ]; then
    echo "❌ Error: Keystore not found at android/app/upload.keystore"
    echo ""
    echo "Please run: npx eas-cli credentials"
    echo "Then download the keystore to android/app/upload.keystore"
    exit 1
fi

# Check if keystore properties exist
if [ ! -f "android/keystore.properties" ]; then
    echo "❌ Error: Keystore properties not found at android/keystore.properties"
    echo ""
    echo "Create android/keystore.properties with:"
    echo "  storePassword=YOUR_STORE_PASSWORD"
    echo "  keyPassword=YOUR_KEY_PASSWORD"
    echo "  keyAlias=YOUR_KEY_ALIAS"
    echo "  storeFile=upload.keystore"
    exit 1
fi

# Get current version
# app.config.js is the authority: it is what Constants.expoConfig.version
# returns at runtime and what config/appUpdate is compared against.
VERSION=$(grep -m1 -E '^[[:space:]]*version:' app.config.js | sed -E 's/.*version:[[:space:]]*"([^"]+)".*/\1/')
echo "📦 Building version: $VERSION"
echo ""

# Clean previous build
echo "🧹 Cleaning previous build..."
cd android
./gradlew clean > /dev/null 2>&1
cd ..
echo "✅ Clean complete"
echo ""

# Build AAB
echo "🔨 Building production AAB..."
cd android
./gradlew app:bundleRelease
cd ..
echo ""
echo "✅ Build complete!"
echo ""

# Copy to project root
AAB_PATH="android/app/build/outputs/bundle/release/app-release.aab"
OUTPUT_NAME="app-production-v${VERSION}.aab"

if [ -f "$AAB_PATH" ]; then
    cp "$AAB_PATH" "$OUTPUT_NAME"
    echo "================================================"
    echo "✅ SUCCESS!"
    echo "================================================"
    echo ""
    echo "📦 Production AAB created:"
    echo "   $OUTPUT_NAME"
    echo ""
    ls -lh "$OUTPUT_NAME"
    echo ""

    # Verify signature
    echo "🔐 Verifying signature..."
    FINGERPRINT=$(keytool -printcert -jarfile "$OUTPUT_NAME" 2>/dev/null | grep "SHA1:" | head -1)
    echo "   $FINGERPRINT"
    echo ""

    # Check if it matches expected
    EXPECTED_SHA1="A1:61:C6:5E:E2:9B:51:16:27:87:6E:EF:D9:3B:FC:8E:8D:BD:A2:E7"
    if echo "$FINGERPRINT" | grep -q "$EXPECTED_SHA1"; then
        echo "✅ Signature matches Google Play keystore!"
    else
        echo "⚠️  Warning: Signature doesn't match expected Google Play keystore"
        echo "   Expected: SHA1: $EXPECTED_SHA1"
    fi
    echo ""
    echo "================================================"
    echo "Next steps:"
    echo "  1. Upload to Google Play Console"
    echo "  2. https://play.google.com/console"
    echo "================================================"
else
    echo "❌ Error: Build failed - AAB not found"
    exit 1
fi
