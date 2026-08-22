// The specialist-supply set is what makes Mate mention a supplier list at all.
// A key that doesn't resolve to a real template is dead weight that silently
// never fires, so that's pinned here too.

import { describe, it, expect } from 'vitest';
import { SPECIALIST_SUPPLY_NICHES, isSpecialistSupplyNiche } from './specialistSupplyNiches';
import { NICHE_TEMPLATES } from './nicheTemplates';

describe('SPECIALIST_SUPPLY_NICHES', () => {
  it('covers the five trades whose core gear is refused retail search', () => {
    expect([...SPECIALIST_SUPPLY_NICHES].sort()).toEqual([
      'other:concreting',
      'other:fencing',
      'other:gyprock',
      'other:rendering',
      'roofing:roof_install',
    ]);
    expect(isSpecialistSupplyNiche('other', 'fencing')).toBe(true);
    expect(isSpecialistSupplyNiche('other', 'concreting')).toBe(true);
    expect(isSpecialistSupplyNiche('other', 'gyprock')).toBe(true);
    expect(isSpecialistSupplyNiche('other', 'rendering')).toBe(true);
    expect(isSpecialistSupplyNiche('roofing', 'roof_install')).toBe(true);
  });

  it('interior painting and hot water are not specialist supply', () => {
    // Both price fine off retail / Reece — offering a price-list import there
    // is noise.
    expect(isSpecialistSupplyNiche('painting', 'interior')).toBe(false);
    expect(isSpecialistSupplyNiche('plumbing', 'hot_water')).toBe(false);
  });

  it('every key resolves to a real NICHE_TEMPLATES category:niche pair', () => {
    const known = new Set(NICHE_TEMPLATES.map((t) => `${t.categoryId}:${t.nicheId}`));
    for (const key of SPECIALIST_SUPPLY_NICHES) {
      expect(known.has(key), `${key} matches no niche template`).toBe(true);
    }
  });

  it('is false when categoryId or nicheId is missing', () => {
    expect(isSpecialistSupplyNiche(undefined, 'fencing')).toBe(false);
    expect(isSpecialistSupplyNiche('other', undefined)).toBe(false);
    expect(isSpecialistSupplyNiche(undefined, undefined)).toBe(false);
  });
});
