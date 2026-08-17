import { describe, it, expect } from 'vitest';
import { coverageSanePurchaseCount, coverageFloorPurchaseCount, recoverPackInfo } from './purchaseCoverage';
import { parsePackInfo } from './parsePackInfo';

describe('coverageSanePurchaseCount', () => {
  describe('the QU-178011 failures it exists to fix', () => {
    it('collapses 19 tubs of decking screws to 1 (unknown pack, bulk price)', () => {
      // ~470 screws for a 10 m² deck; a $151 product with no count token is a
      // 500-screw tub → one purchase covers it.
      const sane = coverageSanePurchaseCount({
        requirement: 470,
        name: 'Stainless Steel Decking Screws 10G x 50mm',
        perPurchasePrice: 151.64,
      });
      expect(sane).toBe(1);
    });

    it('collapses 5 tins of decking oil to 1', () => {
      // ~3 L needed for two coats over 10 m²; a $150 product is a ~10 L drum.
      const sane = coverageSanePurchaseCount({
        requirement: 3,
        name: 'Merbau Decking Oil',
        perPurchasePrice: 150.54,
      });
      expect(sane).toBe(1);
    });
  });

  describe('known pack size is authoritative', () => {
    it('divides the requirement by a known screw pack size', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 470, name: 'Deck Screws', perPurchasePrice: 151, packSize: 500 }),
      ).toBe(1);
      expect(
        coverageSanePurchaseCount({ requirement: 1200, name: 'Deck Screws', perPurchasePrice: 151, packSize: 500 }),
      ).toBe(3);
    });

    it('divides oil litres by a known drum size — preserving legit multi-drum buys', () => {
      // A genuinely large deck needing 20 L from 10 L drums → 2, not clamped to 1.
      expect(
        coverageSanePurchaseCount({ requirement: 20, name: 'Decking Oil', perPurchasePrice: 150, packSize: 10 }),
      ).toBe(2);
    });
  });

  describe('does NOT touch legitimate cases (clamp must never over-reduce)', () => {
    it('collapses cheap retail fastener packs when the requirement is an individual count', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 100,
          name: 'Galvanized Bugle Batten Screws 14G x 100mm',
          perPurchasePrice: 17.02,
        }),
      ).toBe(1);
    });

    it('collapses nail tubs/boxes instead of treating the tub price as per nail', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 200,
          name: 'Pryda Flathead Nails 35x3.15mm Galv',
          perPurchasePrice: 12.01,
        }),
      ).toBe(2);
    });

    it('leaves piece-goods (boards) untouched', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 112, name: 'Merbau Decking Board 90x19mm', perPurchasePrice: 6.24 }),
      ).toBeNull();
    });

    it('leaves individually-sold bolts untouched', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 96,
          name: 'Galvanized Cup Head Bolts M10 x 120mm',
          perPurchasePrice: 1.9,
        }),
      ).toBeNull();
    });

    it('leaves concrete and other non-fastener/non-liquid rows untouched', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 2, name: 'Quick Set Concrete', perPurchasePrice: 9.75 }),
      ).toBeNull();
    });

    it('does not assume a bulk tub for a small fastener requirement', () => {
      // High price but only ~20 needed → a small pack suffices; leave it alone.
      expect(
        coverageSanePurchaseCount({ requirement: 20, name: 'Specialty Decking Screws', perPurchasePrice: 100 }),
      ).toBeNull();
    });
  });

  describe('guards', () => {
    it('returns null for non-positive requirement or price', () => {
      expect(coverageSanePurchaseCount({ requirement: 0, name: 'Screws', perPurchasePrice: 150 })).toBeNull();
      expect(coverageSanePurchaseCount({ requirement: 100, name: 'Screws', perPurchasePrice: 0 })).toBeNull();
    });

    it('a mid-priced oil tin ($80–120) is treated as ~4 L', () => {
      // 6 L needed from a ~$90 4 L tin → 2 tins.
      expect(
        coverageSanePurchaseCount({ requirement: 6, name: 'Timber Oil', perPurchasePrice: 90 }),
      ).toBe(2);
    });
  });
});

describe('coverageFloorPurchaseCount', () => {
  describe('the QU-178290 under-buys it exists to fix', () => {
    it('raises 3 posts back to the 7-post requirement (each piece-good, length SKU)', () => {
      // Requirement "7 each" was mislabelled as metres; the reconcile LLM
      // divided by the 2.4m length and returned 3. One purchase = one post.
      expect(
        coverageFloorPurchaseCount({
          requirement: 7,
          name: '100x75mm H4 Treated Hardwood Post 2.4m',
          requirementUnit: 'each',
          packSize: 2.4,
          packUnit: 'm',
        }),
      ).toBe(7);
    });

    it('raises 132 palings back to the 197-paling requirement', () => {
      expect(
        coverageFloorPurchaseCount({
          requirement: 197,
          name: '1500x75x16mm CCA Treated Pine Paddle Pop Paling',
          requirementUnit: 'each',
          packSize: 1.5,
          packUnit: 'm',
        }),
      ).toBe(197);
    });

    it('raises 3 concrete bags back to a 480kg requirement over 20kg bags', () => {
      expect(
        coverageFloorPurchaseCount({
          requirement: 480,
          name: 'Post-Mix Concrete 20kg Bag',
          requirementUnit: 'kg',
          packSize: 20,
          packUnit: 'kg',
        }),
      ).toBe(24);
    });
  });

  it('honours the LLM correctedRequirement instead of the inflated round-1 figure', () => {
    // 223 boards was inflated; the LLM corrected to 22 — the floor must not
    // re-inflate a legitimate correction.
    expect(
      coverageFloorPurchaseCount({
        requirement: 223,
        correctedRequirement: 22,
        name: 'Merbau Decking Board 5.4m',
        requirementUnit: 'each',
      }),
    ).toBe(22);
  });

  it('never touches bulk fasteners or liquids (each ≠ one purchase)', () => {
    expect(
      coverageFloorPurchaseCount({
        requirement: 600,
        name: 'Stainless Steel Decking Screws 10G x 50mm',
        requirementUnit: 'each',
      }),
    ).toBeNull();
    expect(
      coverageFloorPurchaseCount({
        requirement: 12,
        name: 'Merbau Decking Oil',
        requirementUnit: 'L',
      }),
    ).toBeNull();
  });

  it('does not read "Post-Mix Concrete" as a post piece-good', () => {
    // Without a unit-compatible pack size, a concrete mix each-requirement
    // gets no floor via the accidental \bpost\b match.
    expect(
      coverageFloorPurchaseCount({
        requirement: 24,
        name: 'Post-Mix Concrete',
        requirementUnit: 'each',
        packSize: 10,
        packUnit: 'kg',
      }),
    ).toBeNull();
  });

  it('floors bag each-requirements one-per-purchase when named as bags', () => {
    expect(
      coverageFloorPurchaseCount({
        requirement: 24,
        name: 'Post-Mix Concrete 20kg Bag',
        requirementUnit: 'each',
        packSize: 10,
        packUnit: 'kg',
      }),
    ).toBe(24);
  });

  it('returns null for spliceable linear goods where fewer longer lengths may cover', () => {
    expect(
      coverageFloorPurchaseCount({
        requirement: 6,
        name: 'Colorbond Quad Gutter 4m',
        requirementUnit: 'each',
        packSize: 4,
        packUnit: 'm',
      }),
    ).toBeNull();
  });

  it('divides by a unit-compatible pack size (screw box case is excluded, timber m case works)', () => {
    expect(
      coverageFloorPurchaseCount({
        requirement: 38.4,
        name: '75x38mm H3 Treated Pine Fence Rail',
        requirementUnit: 'm',
        packSize: 4.8,
        packUnit: 'm',
      }),
    ).toBe(8);
  });

  it('returns null with no requirement or a zero requirement', () => {
    expect(
      coverageFloorPurchaseCount({ requirement: 0, name: 'Treated Pine Post', requirementUnit: 'each' }),
    ).toBeNull();
  });
});

/**
 * QU-178692 (fencing quote, 17 Aug 2026). The same "Concrete Mix" product
 * appeared twice in one quote and got two different answers:
 *
 *   End Post & Site Setup — requiredQty 40 kg,  packSize 20 kg → 2 packs   ✓
 *   Fence Bay (2.4m)      — requiredQty 440 kg, packSize null  → 11 packs  ✗
 *
 * 11 × 20 kg = 220 kg against a 440 kg requirement: half the concrete for an
 * 11-bay fence. The reconcile model even stated the shortfall in its own
 * reasoning — "20kg per bag, 11 bags total 220kg" — but because the chosen
 * candidate carried no structured pack size, coverageFloorPurchaseCount had
 * nothing to divide by, returned null, and the under-buy went through.
 */
describe('recoverPackInfo — the QU-178692 under-buy', () => {
  const CONCRETE = 'Concrete Mix';
  const MODEL_REASONING = '20kg per bag, 11 bags total 220kg';

  const floorFor = (sources: Parameters<typeof recoverPackInfo>[0], requirement = 440) => {
    const { packSize, packUnit } = recoverPackInfo(sources, parsePackInfo);
    return coverageFloorPurchaseCount({
      requirement,
      name: CONCRETE,
      requirementUnit: 'kg',
      packSize,
      packUnit,
    });
  };

  it('recovers the pack size the model stated in its own reasoning', () => {
    expect(recoverPackInfo({ rowDescription: MODEL_REASONING }, parsePackInfo)).toEqual({
      packSize: 20,
      packUnit: 'kg',
    });
  });

  it('had no floor at all before recovery — this is the gap that shipped', () => {
    // What the pipeline passed pre-fix: candidate carried no pack fields, so
    // nothing to divide by, so no floor, so the model's 11 stood unchecked.
    expect(
      coverageFloorPurchaseCount({
        requirement: 440,
        name: CONCRETE,
        requirementUnit: 'kg',
        packSize: undefined,
        packUnit: undefined,
      }),
    ).toBeNull();
  });

  it('turns the unguarded 11 bags into a floor of 22', () => {
    expect(floorFor({ rowDescription: MODEL_REASONING })).toBe(22);
  });

  it('recovers from the row name when the description says nothing', () => {
    expect(floorFor({ rowName: 'Concrete Mix 20kg' })).toBe(22);
  });

  it('recovers pack info already stamped on the row by an earlier pass', () => {
    expect(floorFor({ rowPackSize: 20, rowPackUnit: 'kg' })).toBe(22);
  });

  it('leaves the sibling 40 kg row at 2 bags', () => {
    expect(floorFor({ rowDescription: '20kg per bag' }, 40)).toBe(2);
  });

  describe('precedence — most trustworthy source wins', () => {
    it('prefers the candidate’s structured pack size over any parsed text', () => {
      const { packSize } = recoverPackInfo(
        {
          candidatePackSize: 40,
          candidatePackUnit: 'kg',
          candidateProductName: 'Concrete Mix 20kg',
          rowDescription: MODEL_REASONING,
        },
        parsePackInfo,
      );
      expect(packSize).toBe(40);
    });

    it('prefers the candidate product name over the row’s own text', () => {
      const { packSize } = recoverPackInfo(
        { candidateProductName: 'Rapid Set Concrete Mix 25kg', rowDescription: MODEL_REASONING },
        parsePackInfo,
      );
      expect(packSize).toBe(25);
    });
  });

  describe('the estimate branch — same gap, one decision-type over', () => {
    // reconcile can return decision='estimate' when no candidate matched. That
    // branch ran only the over-buy clamp, and coverageSanePurchaseCount bails
    // out on anything that is not a fastener or a liquid — so an estimated
    // concrete row had NO guard in either direction.
    it('clamps nothing for a bulk material, leaving the floor as the only guard', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 440, name: CONCRETE, perPurchasePrice: 12.9 }),
      ).toBeNull();
    });

    it('floors an estimated concrete row off the model’s coverage note', () => {
      expect(floorFor({ rowDescription: 'estimated 20kg bags' })).toBe(22);
    });
  });

  describe('guards that must not regress', () => {
    it('recovers nothing when no source carries a size', () => {
      expect(recoverPackInfo({ rowName: CONCRETE, rowDescription: 'Great value' }, parsePackInfo)).toEqual({
        packSize: undefined,
        packUnit: undefined,
      });
    });

    it('still refuses to divide when the recovered unit cannot match the requirement', () => {
      // "60 each" concrete bags against a 20kg SKU must NOT become 3 — the
      // requirement is already counted in bags. Recovery does not weaken this.
      const { packSize, packUnit } = recoverPackInfo({ rowDescription: '20kg per bag' }, parsePackInfo);
      expect(
        coverageFloorPurchaseCount({
          requirement: 60,
          name: CONCRETE,
          requirementUnit: 'each',
          packSize,
          packUnit,
        }),
      ).toBeNull();
    });
  });
});
