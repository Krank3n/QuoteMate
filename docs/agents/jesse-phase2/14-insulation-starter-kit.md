# Agent 6 — Insulation starter kit (Jesse's 11 line items)

Feature ref: Jesse #14.

## What Jesse said
> I need to describe the service/ product exactly the same as I currently
> am. Below I will copy paste all of the most common line items I will
> need on my qoutes.

11 line items with Jesse's exact descriptions (R4.1 Ceiling, R3.5 Single
Layer, R7 Double Layer, R2.5 Polyester floor, R2.5 HD Sub Floor, R2.5 HD
Walls, R2.7 Acoustic Soundbreak, R3.1 Acoustic Soundbreak, R5 Ceiling,
LED Electrician, LED Lights). Prices noted where Jesse provided them
($187.25 ex GST for R2.5 Polyester floor; $65 ex GST per unit for LEDs).

## Goal
Ship "Trade starter kits" — opinionated bundles of line items a tradie can
install in one tap. Insulation is the first; this same machinery will
ship fencing / decking / painting later.

Each kit installs:
- A `SupplierGroup` named after the tradie / supplier ("J. Gorman
  Insulation" — owner-operated).
- A set of `FavoriteProductMapping` records under that group, with the
  exact `productName`, `unit`, `price`, `coveragePerUnit` (where
  applicable), `roundingIncrement`, and `notes` containing Jesse's
  customer-facing description verbatim.
- Optional `SectionTemplate` records (one per line item) so they appear
  in the existing "Job Templates" picker on the materials screen.

Installation is idempotent — running it twice doesn't create duplicates.

## Deliverables

### 1. Seed data
New `src/services/starterKits/insulation.ts`:
```ts
import type { FavoriteProductMapping } from '../../types';

export interface StarterKitItem {
  productName: string;
  customerDescription: string;     // verbatim from Jesse — used in notes
                                   // and the SectionTemplate body
  unit: FavoriteProductMapping['unit'];
  price?: number;                  // ex GST. Some items leave price empty
                                   // when Jesse hasn't priced them yet.
  coveragePerUnit?: number;
  coverageUnit?: 'm²' | 'm³' | 'm';
  roundingIncrement?: number;
  keywords: string[];              // for the LLM auto-generate match
}

export const insulationStarterKit: {
  supplierName: string;
  items: StarterKitItem[];
} = {
  supplierName: 'J. Gorman Insulation',
  items: [
    {
      productName: 'R4.1 Ceiling Insulation — supply & fit',
      customerDescription: `R4.1 Supply and Fit R4.1 Ceiling Insulation.\nSite Clean and Rubbish Removal.`,
      unit: 'each',
      coverageUnit: 'm²',
      keywords: ['r4.1', 'ceiling', 'insulation', 'batts'],
    },
    {
      productName: 'R3.5 Single Layer Ceiling — cross-weave over existing',
      customerDescription: `R3.5 Single layer.\nInstall R3.5 single layer. I will cross weave the second layer over the top of the existing Insulation.`,
      unit: 'each',
      coverageUnit: 'm²',
      keywords: ['r3.5', 'single layer', 'ceiling', 'cross weave'],
    },
    // … 9 more, copy the rest verbatim from JESSE_FEEDBACK_ANALYSIS.md
    // §14. Pricing for R2.5 Polyester floor = 187.25 ex GST; LEDs = 65 ex GST.
  ],
};
```

Fill all 11. Use the verbatim text from Jesse's message in #14. Don't
paraphrase — these are his exact words his customers expect to read.

### 2. Installer
New `src/services/starterKitInstaller.ts`:
```ts
export interface StarterKitInstallResult {
  supplierCreated: boolean;
  favoritesCreated: number;
  favoritesUpdated: number;
  templatesCreated: number;
}

export async function installStarterKit(
  kit: typeof insulationStarterKit,
  options?: { createTemplates?: boolean }
): Promise<StarterKitInstallResult>
```
- Looks up or creates a `SupplierGroup` matching `kit.supplierName` via
  `supplierGroupService`.
- Maps each `StarterKitItem` → `FavoriteProductMapping` and bulk-saves
  via the existing `bulkSaveFavorites` from `materialFavorites.ts`. The
  merge policy already preserves user edits, so re-running the installer
  is safe.
- If `createTemplates === true` (default), creates a `SectionTemplate`
  per item pointing at the favorite, with the customerDescription as the
  template body. Use existing `sectionTemplateService.saveTemplate`.
- Idempotency: uses the same slug key the favorites service uses, so a
  second install reports `favoritesUpdated` not `favoritesCreated`.

### 3. UI surface
Add a settings entry:

`src/screens/SettingsScreen.tsx > Documents` section:
```ts
{
  id: 'starterKits',
  title: 'Trade Starter Kits',
  subtitle: 'Pre-built line-item libraries for common trades',
  icon: 'briefcase-plus',
  screen: 'StarterKits',
  badge: 'NEW',
  badgeColor: colors.primary,
},
```

New `src/screens/settings/StarterKitsScreen.tsx`:
- Render a card per available kit.
- For insulation: badge "Recommended for: insulation, ceiling installers".
- "Install kit" CTA → calls `installStarterKit` and shows the result
  (e.g. "Added 11 items + 11 templates under J. Gorman Insulation").
- If already installed (detected by the supplier name existing with > 0
  favorites under it), show "Update from latest" instead.

Also offer a one-tap install from the **Onboarding** flow:
- Find the niche-picker step (search `tradeNiche` / `NewOnboardingScreen`).
- When the user ticks `insulation`, surface a "Install insulation
  starter kit?" toggle (default on). On finish, run the installer.

### 4. Tests
- `src/services/__tests__/starterKitInstaller.test.ts`:
  - Fresh install creates 1 supplier + 11 favorites + 11 templates.
  - Re-install reports updates, no duplicates.
  - `createTemplates: false` skips templates.
- Use the existing AsyncStorage mock pattern from other service tests.

## Acceptance
- [ ] `npm test` passes; installer test green.
- [ ] Onboarding + Settings both offer the insulation kit.
- [ ] After install, R4.1, R3.5, R5, R2.5 Polyester, etc. all appear as
      typeable matches in the materials auto-complete.
- [ ] Re-installing doesn't create duplicates.
- [ ] R2.5 Polyester floor lands with price = 187.25 ex GST.
- [ ] LED line items land with price = 65 ex GST per unit.

## Out of scope
- Other trade kits (fencing, decking, painting) — same machinery, content
  comes later.
- Importing kits from a server-side library — v1 ships static seeds.
- Marking templates as "starter" so they're distinguishable from
  user-created ones (could be a `source` tag later).
