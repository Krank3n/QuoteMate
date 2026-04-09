# QuoteMate

**A modern quoting tool for Australian tradies**

QuoteMate is a React Native mobile app designed to help Australian tradies quickly create professional quotes. It auto-populates material pricing from a local-first chain (saved templates → user supplier price book → Bunnings scraper → AI estimation), so the user's own data always wins. Built with Expo, TypeScript, and React Native Paper for a polished, work-site-friendly interface.

## Features

✅ **Smart Job Templates** - Pre-configured templates for common jobs (stairs, decks, fences, pergolas)
✅ **Section Templates** - Save reusable bundles like "fence bay" with materials + labour pre-attached
✅ **Supplier Price Book** - Per-user material favourites scoped to your real suppliers
✅ **AI-Powered Custom Jobs** - Describe any job in plain English, Claude analyzes and suggests materials
✅ **Local-First Pricing** - Your saved prices win over any retail lookup
✅ **Professional Quotes** - Generate and export PDF quotes with GST calculations
✅ **Company Branding** - Upload your logo to appear on all PDF invoices
✅ **Offline Support** - Save quotes locally with AsyncStorage
✅ **Quote Management** - Track quote status (draft, sent, accepted, rejected)
✅ **Customizable** - Edit materials, labor rates, and markup percentages
✅ **Mobile-First Design** - Thumb-friendly UI optimized for work sites

## Screenshots

*(Add screenshots here after running the app)*

## Tech Stack

- **Framework**: React Native (Expo)
- **Language**: TypeScript
- **State Management**: Zustand
- **UI Components**: React Native Paper
- **Navigation**: React Navigation (Stack + Bottom Tabs)
- **Storage**: AsyncStorage
- **PDF Generation**: expo-print
- **Pricing**: Bunnings price scraper, web scraping, Claude/AI estimation
- **AI**: Anthropic Claude (via Firebase Functions)
- **Backend**: Firebase (Auth, Firestore, Functions, Storage)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
- **npm** or **yarn**
- **Expo CLI** - Install globally: `npm install -g expo-cli`
- **Expo Go** app on your phone (iOS or Android)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/QuoteMate.git
cd QuoteMate
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure API credentials

Create a `.env` file in the root directory (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` and add the API keys you need. At minimum:

```env
# Anthropic — used for AI material generation and the Claude-powered
# pricing fallback. Required for the auto-generate flow.
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Bunnings scraper service (managed; ask the maintainer for these)
BUNNINGS_SCRAPER_URL=...
BUNNINGS_SCRAPER_API_KEY=...
```

See `.env.example` for the full list of optional integrations
(Reece, OpenAI, Kimi, Stripe, Firebase, Google OAuth, Xero).

### 4. Start the development server

```bash
npm start
```

This will start the Expo development server. You can then:

- **Scan the QR code** with the Expo Go app on your phone
- Press `i` to open in iOS Simulator (macOS only)
- Press `a` to open in Android Emulator

## Project Structure

```
QuoteMate/
├── App.tsx                      # Main app entry point
├── app.json                     # Expo configuration
├── src/
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   ├── services/
│   │   ├── bunningsScraperClient.ts  # Bunnings price scraper client
│   │   ├── localMaterialSearch.ts    # Templates + favorites lookup
│   │   ├── materialFavorites.ts      # Per-user supplier price book
│   │   ├── sectionTemplateService.ts # Reusable section bundles
│   │   └── supplierGroupService.ts   # User-defined suppliers
│   ├── store/
│   │   └── useStore.ts         # Zustand state management
│   ├── data/
│   │   └── jobTemplates.ts     # Pre-configured job templates
│   ├── utils/
│   │   ├── materialsEstimator.ts  # Materials calculation logic
│   │   └── quoteCalculator.ts     # Quote pricing calculations
│   ├── navigation/
│   │   └── RootNavigator.tsx   # Navigation structure
│   ├── screens/
│   │   ├── OnboardingScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── QuotesListScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── NewQuote/
│   │       ├── JobDetailsScreen.tsx
│   │       ├── MaterialsListScreen.tsx
│   │       ├── LaborMarkupScreen.tsx
│   │       └── QuotePreviewScreen.tsx
│   └── theme.ts                # App theme configuration
├── package.json
└── tsconfig.json
```

## Usage

### First Time Setup

1. **Onboarding**: On first launch, enter your business details, default labor rate, and markup percentage
2. **Dashboard**: View your quote statistics and recent quotes

### Creating a Quote

1. **Tap "New Quote"** from the dashboard or FAB button
2. **Enter Customer Details** - Name, email, phone, job address
3. **Select Template** - Choose from pre-configured templates or custom
4. **Enter Job Parameters**
   - For templates: e.g., number of steps, deck area, fence length
   - For custom jobs: Describe the job in plain English, AI will analyze and suggest materials
5. **Review Materials** - Edit quantities, add/remove items
6. **Fetch Prices** - Auto-populate pricing from your saved templates,
   supplier price book, the Bunnings scraper, or AI estimation (in that
   priority order)
7. **Set Labor & Markup** - Configure hours, rate, and markup percentage
8. **Preview & Export** - Review the quote and export as PDF

### Using AI for Custom Jobs

When you select "Custom Job":
1. Enter a detailed description like: *"Build a 5x4 meter outdoor deck with 10 steps leading down to the garden. Need to replace old timber and add handrails."*
2. Claude analyzes your description and automatically:
   - Identifies required materials with specific search terms
   - Estimates quantities based on job scope
   - Suggests labor hours
   - Groups materials into work sections
3. Materials are then priced via the local-first chain (templates →
   supplier favorites → Bunnings scraper → AI estimation)
4. You can edit any suggestions before finalizing the quote

### Managing Quotes

- **View All Quotes** - Access from the bottom tab bar
- **Filter & Search** - Find quotes by customer name or job
- **Edit/Duplicate** - Long press for more options
- **Update Status** - Mark as draft, sent, accepted, or rejected
- **Share** - Export quotes as PDF via email, SMS, or WhatsApp

## Pricing Sources

Material prices are resolved through a priority chain so the user's own
data always wins:

1. **Section templates** — saved bundles like "fence bay" with prices
   already attached. Matched by name/keywords.
2. **Supplier favorites** — the per-user price book, scoped to the
   suppliers configured in Settings.
3. **Bunnings scraper** — only runs if Bunnings is in the supplier list
   (or no suppliers are configured at all).
4. **Web scraping** — runs against the user's other configured
   supplier websites.
5. **AI estimation** — Claude-powered fallback when nothing else turns
   up a price.

The same chain is used for both single-material search
(`AddMaterialScreen.handleSearch`) and the bulk "Fetch Prices" flow
(`MaterialsListScreen`).

## Customization

### Adding New Job Templates

Edit `src/data/jobTemplates.ts`:

```typescript
{
  id: 'my-custom-job',
  name: 'Custom Job',
  description: 'My custom job template',
  requiredParams: [
    { key: 'length', label: 'Length', unit: 'm', defaultValue: 10 }
  ],
  defaultMaterials: [
    {
      name: 'Material Name',
      searchTerm: 'bunnings search term',
      quantityFormula: 'length * 2',
      unit: 'each'
    }
  ],
  estimatedHoursFormula: 'length * 0.5'
}
```

### Changing Theme Colors

Edit `src/theme.ts`:

```typescript
colors: {
  primary: '#008542',  // Bunnings green
  secondary: '#FF6B35', // Orange accent
  // ... other colors
}
```

## Building for Production

### iOS

```bash
expo build:ios
```

### Android

```bash
expo build:android
```

For detailed instructions, see [Expo Build Documentation](https://docs.expo.dev/build/setup/).

## Troubleshooting

### "No prices found"

- Make sure the Bunnings scraper env vars are set (or that the user has
  saved supplier favorites for the materials they're searching)
- Check your internet connection
- Try tweaking the material name to match what's on the shelf

### "Expo Go app not connecting"

- Ensure phone and computer are on same WiFi network
- Try scanning QR code again
- Restart Expo development server

### "TypeScript errors"

```bash
npm run build  # Check for type errors
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- **Bunnings** for providing the Sandbox API
- **Expo** for the excellent React Native framework
- Australian tradies for inspiration and feedback

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Email: support@quotemate.com.au

---

**Built with ❤️ for Australian tradies**

QuoteMate - Making quoting simple, one job at a time.
