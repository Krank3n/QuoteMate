# Generate App Assets from quote-mate.svg

## Required Assets

Your new QuoteMate logo needs to be converted into the following assets:

### 1. **icon.png** (1024x1024px)
- Square app icon
- Use the full logo centered on dark background (#2C3E50 or #0F172A)
- Save as PNG

### 2. **adaptive-icon.png** (1024x1024px)
- Android adaptive icon (foreground layer only)
- Logo should be centered with safe zone padding
- Background will be #009868 (set in app.config.js)
- Make sure logo fits within the safe zone (66% of total size)

### 3. **splash.png** (1284x2778px for iPhone 14 Pro Max)
- Full splash screen
- Logo centered on dark background (#0F172A)
- Logo should be about 30-40% of screen height

### 4. **favicon.png** (192x192px or larger)
- Web favicon
- Simplified version of logo if needed
- Works well at small sizes

### 5. **play-store-icon.png** (512x512px)
- Google Play Store icon
- Full logo on dark background

## Option 1: Using Figma (Recommended)

1. Open quote-mate.svg in Figma
2. Create artboards for each size listed above
3. Center the logo on each artboard with appropriate background
4. Export each artboard as PNG at the specified dimensions

## Option 2: Using Online Tools

### Quick Generation with icon.kitchen
1. Go to https://icon.kitchen/
2. Upload your `quote-mate.svg`
3. Adjust padding, background color (#0F172A or #009868)
4. Download the generated icon pack
5. Extract and rename files to match requirements

### Manual with Inkscape (Free)
1. Open quote-mate.svg in Inkscape
2. Set document size to required dimensions
3. Add background rectangle with dark color
4. Center logo
5. Export as PNG

## Option 3: Using ImageMagick (Command Line)

```bash
# Install ImageMagick if not installed
brew install imagemagick

# Generate icon.png (1024x1024)
magick quote-mate.svg -resize 800x800 -background "#0F172A" -gravity center -extent 1024x1024 assets/icon.png

# Generate adaptive-icon.png (1024x1024, foreground only)
magick quote-mate.svg -resize 680x680 -background none -gravity center -extent 1024x1024 assets/adaptive-icon.png

# Generate splash.png (1284x2778)
magick quote-mate.svg -resize 600x600 -background "#0F172A" -gravity center -extent 1284x2778 assets/splash.png

# Generate favicon.png (192x192)
magick quote-mate.svg -resize 160x160 -background "#0F172A" -gravity center -extent 192x192 assets/favicon.png

# Generate play-store-icon.png (512x512)
magick quote-mate.svg -resize 420x420 -background "#0F172A" -gravity center -extent 512x512 assets/play-store-icon.png
```

## After Generating Assets

1. Replace all PNG files in the `assets/` folder
2. Run `npx expo prebuild --clean` to regenerate native projects
3. Test the app to see new icons and splash screen

## Color Reference

- **Background Dark**: #0F172A
- **Surface Dark**: #1E293B
- **Primary Green**: #009868
- **Secondary Gold**: #cfa153
- **White**: #FFFFFF

## Safe Zones

- **App Icon**: Keep logo within 80% of canvas (allow 10% padding on each side)
- **Adaptive Icon**: Keep logo within 66% circle (Android clips to circle/rounded square)
- **Splash Screen**: Logo should not exceed 40% of screen height
