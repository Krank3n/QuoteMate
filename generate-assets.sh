#!/bin/bash

# Generate all app assets from quote-mate.svg
# Requires ImageMagick: brew install imagemagick

set -e

echo "🎨 Generating QuoteMate app assets..."

# Colors
DARK_BG="#0F172A"
PRIMARY="#009868"

# Source SVG
SVG="assets/quote-mate.svg"

if [ ! -f "$SVG" ]; then
    echo "❌ Error: $SVG not found!"
    exit 1
fi

# 1. App Icon (1024x1024) - Logo on dark background
echo "📱 Generating icon.png..."
magick "$SVG" -resize 800x800 -background "$DARK_BG" -gravity center -extent 1024x1024 assets/icon.png

# 2. Adaptive Icon (1024x1024) - Transparent background, logo within safe zone
echo "🤖 Generating adaptive-icon.png..."
magick "$SVG" -resize 680x680 -background none -gravity center -extent 1024x1024 assets/adaptive-icon.png

# 3. Splash Screen (1284x2778) - Logo centered on dark background
echo "🌊 Generating splash.png..."
magick "$SVG" -resize 600x600 -background "$DARK_BG" -gravity center -extent 1284x2778 assets/splash.png

# 4. Favicon (192x192) - Small icon for web
echo "🌐 Generating favicon.png..."
magick "$SVG" -resize 160x160 -background "$DARK_BG" -gravity center -extent 192x192 assets/favicon.png

# 5. Play Store Icon (512x512) - For Google Play Store
echo "🎮 Generating play-store-icon.png..."
magick "$SVG" -resize 420x420 -background "$DARK_BG" -gravity center -extent 512x512 assets/play-store-icon.png

echo "✅ All assets generated successfully!"
echo ""
echo "Next steps:"
echo "1. Review the generated assets in the assets/ folder"
echo "2. Run: npx expo prebuild --clean"
echo "3. Rebuild your app to see the new icons"
