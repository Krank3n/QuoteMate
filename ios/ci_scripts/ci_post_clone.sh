#!/bin/sh

# ci_post_clone.sh
# This script runs after Xcode Cloud clones the repository
# It installs CocoaPods dependencies before the build

set -e

echo "📦 Installing CocoaPods dependencies..."

# Navigate to the ios directory
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"

# Install CocoaPods if not available
if ! command -v pod &> /dev/null; then
    echo "🔧 Installing CocoaPods..."
    gem install cocoapods
fi

# Install pods
echo "🔧 Running pod install..."
pod install

echo "✅ CocoaPods installation complete!"
