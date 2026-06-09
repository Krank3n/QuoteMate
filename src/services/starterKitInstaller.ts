/**
 * Starter Kit Installer
 *
 * Installs a trade starter kit (collection of `StarterKitItem`s) into the
 * current user's data:
 *   - Ensures a SupplierGroup exists matching `kit.supplierName`.
 *   - Bulk-saves each item as a FavoriteProductMapping under that supplier
 *     via the existing `bulkSaveFavorites` merge-aware path. Re-running
 *     the installer is safe \u2014 unchanged items report as updates, not
 *     duplicates.
 *   - Optionally creates a SectionTemplate per item so they show up in
 *     the quote flow's template picker.
 *
 * Returns a summary suitable for snackbar feedback.
 */

import { bulkSaveFavorites } from './materialFavorites';
import { getSupplierGroupByName, saveGroup, loadGroups } from './supplierGroupService';
import { saveTemplate, loadTemplates } from './sectionTemplateService';
import { generateId } from '../utils/generateId';
import type {
  FavoriteProductMapping,
  SectionTemplate,
  SupplierGroup,
  Material,
} from '../types';
import type { StarterKit, StarterKitItem } from './starterKits/insulation';

export type { StarterKit, StarterKitItem };

export interface StarterKitInstallResult {
  supplierCreated: boolean;
  favorites: { created: number; updated: number; unchanged: number };
  templatesCreated: number;
  templatesSkipped: number;
}

/**
 * Slug helper matching the one used by materialFavorites.ts. Kept local
 * so the installer doesn't depend on private symbols from that module.
 */
function slugKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
}

/**
 * Install a starter kit. Idempotent: re-running with the same kit will
 * refresh prices/descriptions without creating duplicate favorites or
 * templates.
 */
export async function installStarterKit(
  kit: StarterKit,
  options?: { createTemplates?: boolean },
): Promise<StarterKitInstallResult> {
  const createTemplates = options?.createTemplates !== false;
  const now = new Date().toISOString();

  // 1. Supplier group \u2014 ensure one exists with this name.
  const existingGroup = await getSupplierGroupByName(kit.supplierName);
  let supplierCreated = false;
  let group: SupplierGroup;
  if (existingGroup) {
    group = existingGroup;
  } else {
    const groups = await loadGroups();
    const maxSort = groups.reduce((m, g) => Math.max(m, g.sortOrder || 0), 0);
    group = {
      id: generateId(),
      name: kit.supplierName,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
      notes: `Auto-created by ${kit.id} starter kit`,
    };
    await saveGroup(group);
    supplierCreated = true;
  }

  // 2. Favorites \u2014 map each kit item and bulk-save.
  const favoritesPayload: Array<Partial<FavoriteProductMapping> & { productName: string }> = kit.items.map((item) => ({
    productName: item.productName,
    store: group.name,
    unit: item.unit,
    price: item.price,
    isPersonalRate: true,
    coveragePerUnit: item.coveragePerUnit,
    coverageUnit: item.coverageUnit,
    roundingIncrement: item.roundingIncrement,
    keywords: item.keywords,
    notes: item.customerDescription,
    source: 'manual' as const,
    sourceRef: kit.id,
    lastUpdatedAt: now,
  }));
  const favResult = await bulkSaveFavorites(favoritesPayload);

  // 3. Section templates \u2014 one per item, idempotent by name.
  let templatesCreated = 0;
  let templatesSkipped = 0;
  if (createTemplates) {
    const existing = await loadTemplates();
    const existingNames = new Set(existing.map((t) => t.name.trim().toLowerCase()));

    for (const item of kit.items) {
      if (existingNames.has(item.productName.trim().toLowerCase())) {
        templatesSkipped += 1;
        continue;
      }
      // Material requires a non-optional `unit`. Kit items always carry one;
      // the assertion is just to satisfy TS's narrowing through Partial.
      const unit: Material['unit'] = item.unit as Material['unit'];
      const material: Omit<Material, 'id'> = {
        name: item.productName,
        quantity: 1,
        unit,
        price: item.price ?? 0,
        totalPrice: item.price ?? 0,
        manualPriceOverride: true,
        pricingSource: 'manual',
        description: item.customerDescription,
        category: 'insulation',
        favoriteProduct: {
          productName: item.productName,
          store: group.name,
          unit: item.unit,
          price: item.price,
          coveragePerUnit: item.coveragePerUnit,
          coverageUnit: item.coverageUnit,
          roundingIncrement: item.roundingIncrement,
          isPersonalRate: true,
          source: 'manual',
          sourceRef: kit.id,
          lastUpdatedAt: now,
        },
      };
      const template: SectionTemplate = {
        id: generateId(),
        name: item.productName,
        description: item.customerDescription,
        keywords: item.keywords,
        materials: [material],
        laborHours: 0,
        laborRate: 0,
        laborUnit: 'hours',
        createdAt: now,
        updatedAt: now,
      };
      await saveTemplate(template);
      templatesCreated += 1;
    }
  }

  return {
    supplierCreated,
    favorites: favResult,
    templatesCreated,
    templatesSkipped,
  };
}

/**
 * Detect whether a kit looks "installed" \u2014 used by the Starter Kits
 * screen to swap the CTA between Install and Refresh. Returns true when
 * the supplier exists and at least one item from the kit is already in
 * the favorites store.
 */
export async function isStarterKitInstalled(kit: StarterKit): Promise<boolean> {
  const group = await getSupplierGroupByName(kit.supplierName);
  if (!group) return false;
  // Cheapest signal: scan the local favorites for any slug from the kit.
  const { loadFavoritesFromLocal } = await import('./materialFavorites');
  const local = await loadFavoritesFromLocal();
  for (const item of kit.items) {
    if (local[slugKey(item.productName)]) return true;
  }
  return false;
}
