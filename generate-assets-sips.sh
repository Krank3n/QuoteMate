#!/bin/bash

# Generate all app assets from quote-mate.jpg using macOS sips
set -e

echo "🎨 Generating QuoteMate app assets with sips..."

# Source image
SOURCE="assets/quote-mate.jpg"

if [ ! -f "$SOURCE" ]; then
    echo "❌ Error: $SOURCE not found!"
    exit 1
fi

# 1. App Icon (1024x1024)
echo "📱 Generating icon.png..."
sips -z 1024 1024 "$SOURCE" --out assets/icon.png > /dev/null

# 2. Adaptive Icon (1024x1024)
echo "🤖 Generating adaptive-icon.png..."
sips -z 1024 1024 "$SOURCE" --out assets/adaptive-icon.png > /dev/null

# 3. Splash Screen (1284x2778) - Maintain aspect ratio
echo "🌊 Generating splash.png..."
# First resize to fit within splash dimensions while maintaining aspect ratio
sips -Z 800 "$SOURCE" --out assets/splash-temp.png > /dev/null
# Then pad to splash screen size (this creates a centered image)
sips -p 2778 1284 assets/splash-temp.png --out assets/splash.png > /dev/null
rm assets/splash-temp.png

# 4. Favicon (192x192)
echo "🌐 Generating favicon.png..."
sips -z 192 192 "$SOURCE" --out assets/favicon.png > /dev/null

# 5. Play Store Icon (512x512)
echo "🎮 Generating play-store-icon.png..."
sips -z 512 512 "$SOURCE" --out assets/play-store-icon.png > /dev/null

echo "✅ All assets generated successfully!"
echo ""
echo "Next steps:"
echo "1. Review the generated assets in the assets/ folder"
echo "2. Run: npx expo prebuild --clean"
echo "3. Rebuild your app to see the new icons"
