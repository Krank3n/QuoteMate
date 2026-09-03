import { describe, it, expect } from 'vitest';
import { isLumpSumRow, coverageSanePurchaseCount, coverageFloorPurchaseCount, recoverPackInfo } from '../../shared/pricing/purchaseCoverage';
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

  describe('bulk-unit rows (the QU-178377 475-pack over-buy)', () => {
    // A reconcile hallucination: 475 packs of R4.0 ceiling batts for a 38 m²
    // ceiling, $42,702 on one line of a real customer quote. Nothing caught it
    // — insulation is neither a fastener nor a liquid, and the exact-arithmetic
    // branch was gated on BOTH units being countable, which m² is not.
    it('collapses 475 packs of ceiling batts to the 8 that cover 38 m²', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 38,
          name: 'Ceiling insulation batts R4.0',
          perPurchasePrice: 89.9,
          packSize: 5,
          packUnit: 'm²',
          requirementUnit: 'm²',
        }),
      ).toBe(8);
    });

    it('treats m2 and m² as the same unit', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 38,
          name: 'Ceiling insulation batts R4.0',
          perPurchasePrice: 89.9,
          packSize: 5,
          packUnit: 'm2',
          requirementUnit: 'm²',
        }),
      ).toBe(8);
    });

    it('collapses a 20 kg adhesive bag row to 1 for a 5.7 kg requirement', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 5.7,
          name: 'Flexible cement-based tile adhesive',
          perPurchasePrice: 32,
          packSize: 20,
          packUnit: 'kg',
          requirementUnit: 'kg',
        }),
      ).toBe(1);
    });

    it('keeps a genuine multi-pack buy intact', () => {
      // 48 m² of wall batts from 5 m² packs is really 10 packs — not 1.
      expect(
        coverageSanePurchaseCount({
          requirement: 48,
          name: 'Insulation batts R2.5',
          perPurchasePrice: 94.45,
          packSize: 5,
          packUnit: 'm²',
          requirementUnit: 'm²',
        }),
      ).toBe(10);
    });
  });

  describe('one container per piece (the QU-178514 nails over-buy)', () => {
    // Four identical coil-nail rows in one real fencing quote, same $42.90
    // product. 400 and 172 pieces clamped correctly; 72 and 64 fell just under
    // MIN_FASTENER_REQUIREMENT_FOR_TUB and bought one BOX per nail — $5,834 of
    // nails on a $15.6k job. The siblings are the control: the pack assumption
    // was already right, only the gate differed.
    const nails = (requirement: number, proposedCount: number) =>
      coverageSanePurchaseCount({
        requirement,
        name: 'Galvanised coil nails 50 x 2.5mm for palings',
        perPurchasePrice: 42.9,
        requirementUnit: 'each',
        purchaseUnit: 'pack',
        proposedCount,
      });

    it('collapses 72 packs for 72 nails to 1', () => {
      expect(nails(72, 72)).toBe(1);
    });

    it('collapses 64 packs for 64 nails to 1', () => {
      expect(nails(64, 64)).toBe(1);
    });

    it('still clamps the siblings that were already right', () => {
      expect(nails(400, 4)).toBe(4);
      expect(nails(172, 2)).toBe(2);
    });

    it('has no opinion when the purchase is already sane', () => {
      // 2 packs for 72 nails is sensible and is NOT one-per-piece, so the rule
      // does not engage and the caller keeps its own count. null is the guard
      // declining to interfere, not a failure to catch something.
      expect(nails(72, 2)).toBeNull();
    });

    // The gate exists to protect goods sold ONE AT A TIME whose name matches
    // the fastener pattern. Those are counted in 'each', never in packs, so
    // the new rule cannot reach them.
    it('does not touch an individually-sold item counted in each', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 6,
          name: 'Screw pile 76mm galvanised',
          perPurchasePrice: 300,
          requirementUnit: 'each',
          purchaseUnit: 'each',
          proposedCount: 6,
        }),
      ).toBeNull();
    });

    it('does not touch a nail gun bought two at a time', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 2,
          name: 'Framing nail gun',
          perPurchasePrice: 236,
          requirementUnit: 'each',
          purchaseUnit: 'each',
          proposedCount: 2,
        }),
      ).toBeNull();
    });

    it('ignores the rule for a bulk requirement that is not a piece count', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 40,
          name: 'Concrete mix',
          perPurchasePrice: 10,
          requirementUnit: 'kg',
          purchaseUnit: 'pack',
          proposedCount: 40,
        }),
      ).toBeNull();
    });
  });

  describe('mismatched units must never divide (the under-buy this guard protects)', () => {
    it('does not read a "2.4m" pack against a 7-post each-requirement', () => {
      // The failure that motivated the countable-units gate: dividing 7 posts
      // by a 2.4 m length gives 3 posts — an under-buy, the worse error.
      expect(
        coverageSanePurchaseCount({
          requirement: 7,
          name: 'Treated Pine Post',
          perPurchasePrice: 28,
          packSize: 2.4,
          packUnit: 'm',
          requirementUnit: 'each',
        }),
      ).toBeNull();
    });

    it('does not divide a m³ concrete requirement by a kg bag', () => {
      // 0.6 m³ from 20 kg bags is legitimately ~60 bags; dividing 0.6 by 20
      // would clamp it to 1 and under-buy the pour by 59 bags.
      expect(
        coverageSanePurchaseCount({
          requirement: 0.6,
          name: 'Rapid set concrete mix',
          perPurchasePrice: 10.5,
          packSize: 20,
          packUnit: 'kg',
          requirementUnit: 'm³',
        }),
      ).toBeNull();
    });

    it('leaves a bulk-unit row alone when the pack unit is unknown', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 38,
          name: 'Ceiling insulation batts R4.0',
          perPurchasePrice: 89.9,
          packSize: 5,
          requirementUnit: 'm²',
        }),
      ).toBeNull();
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

describe('a known pack size clamps regardless of category', () => {
  // Regression: the fastener/liquid gate ran BEFORE the known-pack-size branch,
  // so every other consumable went unclamped. 100 sanding mesh sheets were
  // billed at the price of a 10-pack, 100 times over — $10,500 against a real
  // $130. A size we can actually read is arithmetic, not a heuristic; the gate
  // only ever needed to guard the guessing branches below it.
  it('divides a non-fastener consumable by its stated pack size', () => {
    expect(
      coverageSanePurchaseCount({
        requirement: 100,
        name: 'Sanding Mesh Sheets 225mm 150 Grit',
        perPurchasePrice: 105,
        packSize: 10,
        packUnit: 'each',
        requirementUnit: 'each',
      }),
    ).toBe(10);
  });

  it('still clamps fasteners with a known pack size', () => {
    expect(
      coverageSanePurchaseCount({
        requirement: 4480,
        name: 'Stainless Decking Screws',
        perPurchasePrice: 29.68,
        packSize: 100,
        packUnit: 'each',
        requirementUnit: 'each',
      }),
    ).toBe(45);
  });

  it('refuses to divide a piece count by a mass pack — the unit guard', () => {
    // A "20kg" pack must never divide a 100-piece requirement.
    expect(
      coverageSanePurchaseCount({
        requirement: 100,
        name: 'Tile Adhesive',
        perPurchasePrice: 40,
        packSize: 20,
        packUnit: 'kg',
        requirementUnit: 'each',
      }),
    ).toBeNull();
  });

  it('leaves a genuine piece-good alone when no pack size is known', () => {
    // 20 doors at $105 each is a real quote, not an over-buy. With no pack
    // size and no fastener/liquid match, the clamp must stay out of the way.
    expect(
      coverageSanePurchaseCount({
        requirement: 20,
        name: 'Internal Pre-Hung Door 820mm',
        perPurchasePrice: 105,
        requirementUnit: 'each',
      }),
    ).toBeNull();
  });
});

describe('the known-pack branch never fires on unstated units', () => {
  it('refuses to divide when the pack unit is unknown', () => {
    // Regression: "Treated Pine Post 2.4m" parses as packSize 2.4 with unit
    // 'm'. A caller that omitted packUnit had that treated as a 2.4-pack and
    // a 7-post requirement was divided down to 3 — an under-buy, which is the
    // worse of the two failures.
    expect(
      coverageSanePurchaseCount({
        requirement: 7,
        name: '100x75mm H4 Treated Hardwood Post 2.4m',
        perPurchasePrice: 32.9,
        packSize: 2.4,
      }),
    ).toBeNull();
  });

  it('refuses when the requirement unit is unknown', () => {
    expect(
      coverageSanePurchaseCount({
        requirement: 100,
        name: 'Sanding Mesh Sheets',
        perPurchasePrice: 105,
        packSize: 10,
        packUnit: 'each',
      }),
    ).toBeNull();
  });
});

describe('the clamp only lowers, so it must not act on guessed pack sizes', () => {
  // The floor raises and the clamp lowers, so they can afford different levels
  // of evidence. A pack size recovered from a row's prose is fine for the
  // floor; giving it to the clamp bought 4 formwork pegs against a 20-peg
  // requirement. Callers must pass only a RESOLVED pack size.
  it('is a no-op for a single-item product with no resolved pack', () => {
    expect(
      coverageSanePurchaseCount({
        requirement: 20,
        name: 'Hardwood Formwork Pegs',
        perPurchasePrice: 5.2,
        requirementUnit: 'each',
      }),
    ).toBeNull();
  });
});

describe('isLumpSumRow (the QU-178514 $18,000 allowance)', () => {
  // "Post hole digging - spoil removal allowance | 15 each @ $1,200 = $18,000"
  // on a $15.6k fence. An allowance is one figure for the whole job; the
  // pricing path multiplied it by the post count and tripled the quote.
  it('recognises an allowance', () => {
    expect(isLumpSumRow('Post hole digging - spoil removal allowance')).toBe(true);
    expect(isLumpSumRow('Waste disposal allowance')).toBe(true);
  });

  it('recognises hire and provisional sums', () => {
    expect(isLumpSumRow('Skip bin hire 6m³')).toBe(true);
    expect(isLumpSumRow('Excavator hire')).toBe(true);
    expect(isLumpSumRow('Provisional sum for tiling')).toBe(true);
    expect(isLumpSumRow('PC sum - tapware')).toBe(true);
  });

  // Deliberately narrow. These read like services but are genuinely per-unit,
  // and collapsing them to one would under-quote real work — the worse error.
  it('does not treat per-unit work as a lump sum', () => {
    expect(isLumpSumRow('Post hole digging')).toBe(false);
    expect(isLumpSumRow('Core hole drilling')).toBe(false);
    expect(isLumpSumRow('Spoil removal')).toBe(false);
    expect(isLumpSumRow('Labour - install palings')).toBe(false);
  });

  it('does not fire on ordinary materials', () => {
    expect(isLumpSumRow('Treated pine H4 post 90x90mm')).toBe(false);
    expect(isLumpSumRow('Galvanised coil nails')).toBe(false);
    expect(isLumpSumRow('')).toBe(false);
  });
});
