// Trade-context builder for the analyzeJobDescription pipeline. The wizard
// builds this object inline in two places (JobDetailsScreen, MaterialsListScreen);
// Mate's applyProposal needs the same thing when handing a draft off to the
// pipeline. Extracted so all three callers stay in sync.

import { BusinessSettings } from '../types';
import { getTradeCategoryById, getTradeNicheById } from '../constants/tradeCategories';

export interface TradeContext {
  categoryName?: string;
  nicheName?: string;
  suggestedMaterials?: string[];
  pricingMethod?: string;
  selectedStore?: string;
}

export function buildTradeContext(businessSettings: BusinessSettings | null | undefined): TradeContext | undefined {
  if (!businessSettings) return undefined;

  const categoryNames: string[] = [];
  const nicheNames: string[] = [];
  const allSuggestedMaterials: string[] = [];
  let pricingMethod: string | undefined;

  if (businessSettings.tradeCategories && businessSettings.tradeCategories.length > 0) {
    for (const id of businessSettings.tradeCategories) {
      const c = getTradeCategoryById(id);
      if (c) categoryNames.push(c.name);
    }
    if (businessSettings.tradeNiches && businessSettings.tradeNiches.length > 0) {
      for (const catId of businessSettings.tradeCategories) {
        for (const nicheId of businessSettings.tradeNiches) {
          const niche = getTradeNicheById(catId, nicheId);
          if (niche) {
            nicheNames.push(niche.name);
            allSuggestedMaterials.push(...(niche.commonServices || []));
            if (!pricingMethod && niche.pricingMethods && niche.pricingMethods.length > 0) {
              pricingMethod = niche.pricingMethods[0].label;
            }
          }
        }
      }
    }
  } else if (businessSettings.tradeCategory) {
    const category = getTradeCategoryById(businessSettings.tradeCategory);
    if (category) categoryNames.push(category.name);
    if (businessSettings.tradeNiche) {
      const niche = getTradeNicheById(businessSettings.tradeCategory, businessSettings.tradeNiche);
      if (niche) {
        nicheNames.push(niche.name);
        allSuggestedMaterials.push(...(niche.commonServices || []));
        if (niche.pricingMethods && niche.pricingMethods.length > 0) {
          pricingMethod = niche.pricingMethods[0].label;
        }
      }
    }
  }

  const uniqueMaterials = Array.from(new Set(allSuggestedMaterials));

  return {
    categoryName: categoryNames.join(', ') || undefined,
    nicheName: nicheNames.join(', ') || undefined,
    suggestedMaterials: uniqueMaterials.length > 0 ? uniqueMaterials : undefined,
    pricingMethod,
    selectedStore: businessSettings.selectedStore || 'bunnings',
  };
}
