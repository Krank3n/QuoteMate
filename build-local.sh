#!/bin/bash

# Local Android Build Script for QuoteMate
# This script builds the app locally without using EAS

set -e

echo "🔨 Building QuoteMate locally..."

# Check for .env file
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file with at minimum:"
    echo "  ANTHROPIC_API_KEY=your_key"
    echo "  BUNNINGS_SCRAPER_URL=..."
    echo "  BUNNINGS_SCRAPER_API_KEY=..."
    echo "(See .env.example for the full list of supported keys.)"
    exit 1
fi

# Check for keystore
if [ ! -f "android/app/release.keystore" ]; then
    echo "❌ Error: Production keystore not found at android/app/release.keystore"
    echo "Please download the keystore using: eas credentials (interactive)"
    exit 1
fi

# Check for keystore.properties
if [ ! -f "android/keystore.properties" ]; then
    echo "❌ Error: keystore.properties not found!"
    exit 1
fi

echo "✅ Environment files found"
echo "📦 Building Android App Bundle..."

# Navigate to android directory and build
cd android
./gradlew clean
./gradlew bundlePlayRelease

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo "📍 AAB location: android/app/build/outputs/bundle/playRelease/app-play-release.aab"
    ls -lh app/build/outputs/bundle/playRelease/app-play-release.aab
else
    echo "❌ Build failed!"
    exit 1
fi
