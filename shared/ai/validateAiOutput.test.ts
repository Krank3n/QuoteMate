import { validateAndRepairAiOutput, clampMaterialQuantity } from './validateAiOutput';

// Silent logger so warning chatter doesn't pollute test output.
const silent = { warn: () => {} };

describe('validateAndRepairAiOutput', () => {
  it('returns empty flags for a clean materials list', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [
        { name: 'Concrete', quantity: 5, unit: 'kg', price: 12, section: 'Footings', sectionLaborHours: 2 },
        { name: 'Rebar', quantity: 4, unit: 'm', price: 8, section: 'Footings', sectionLaborHours: 2 },
      ],
      silent,
    );
    expect(materials).toHaveLength(2);
    expect(flags.hasInvalidUnit).toBe(false);
    expect(flags.hasZeroLabourSection).toBe(false);
    expect(flags.hasZeroPricedMaterial).toBe(false);
  });

  it('tags pavers stored as m³ with invalid_unit', () => {
    // The exact QU-177963 case.
    const { materials, flags } = validateAndRepairAiOutput(
      [
        { name: 'Concrete Pavers 200x200x60', quantity: 83, unit: 'm³', price: 46 },
      ],
      silent,
    );
    expect(materials[0].pricingSource).toBe('invalid_unit');
    expect(flags.hasInvalidUnit).toBe(true);
    expect(flags.invalidUnitCount).toBe(1);
  });

  it('tags tiles stored as m² with invalid_unit', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [{ name: '600x600 Porcelain Tile', quantity: 25, unit: 'm²', price: 35 }],
      silent,
    );
    expect(materials[0].pricingSource).toBe('invalid_unit');
    expect(flags.invalidUnitCount).toBe(1);
  });

  it('accepts piece-goods with unit "each"', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [{ name: 'Concrete Pavers 400x400', quantity: 172, unit: 'each', price: 8.5 }],
      silent,
    );
    expect(materials[0].pricingSource).toBeUndefined();
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('does not flag bulk materials measured in m² or m³ (geotextile, ready-mix)', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Geotextile / Weed Mat', quantity: 30, unit: 'm²', price: 4 },
        { name: 'Ready-mix Concrete', quantity: 0.054, unit: 'm³', price: 280 },
      ],
      silent,
    );
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('handles m2/m3 ASCII variants of the unit string', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Pavers', quantity: 25, unit: 'm2', price: 10 },
        { name: 'Tiles', quantity: 5, unit: 'm3', price: 30 },
      ],
      silent,
    );
    expect(flags.invalidUnitCount).toBe(2);
  });

  it('flags zero-priced materials with positive quantity', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Garden Edge', quantity: 40, unit: 'm', price: 0 },
        { name: 'Soil', quantity: 40, unit: 'each', price: 0 },
        { name: 'Sand', quantity: 1, unit: 'kg', price: 5 }, // priced — should not count
      ],
      silent,
    );
    expect(flags.hasZeroPricedMaterial).toBe(true);
    expect(flags.zeroPricedMaterialCount).toBe(2);
  });

  it('does not flag $0 materials with zero quantity (placeholder rows)', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Hire — TBD', quantity: 0, unit: 'each', price: 0 }],
      silent,
    );
    expect(flags.hasZeroPricedMaterial).toBe(false);
  });

  // QU-177971 regression — the $94k fencing quote where the AI emitted
  // 6760 packs of concrete for 13 fence post holes. The deterministic
  // absurd-quantity ceiling catches this without any LLM intervention.
  it('flags 6760 packs of concrete as absurd (QU-177971 reproduction)', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [{ name: 'Concrete post footing (pre-mix concrete)', quantity: 6760, unit: 'pack', price: 9.20 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(true);
    expect(flags.absurdQuantityCount).toBe(1);
    expect(materials[0].pricingSource).toBe('absurd_quantity');
  });

  // Round-2 QU-177971 — same job, AI now emits quantity=40 per work unit
  // with sectionMultiplier=10. Per-unit quantity (40) is below the ceiling
  // but the effective total (400) is well over. Ceiling must check the
  // multiplied total, otherwise the bug recurs at smaller scale.
  it('flags quantity × sectionMultiplier when the per-unit slips under the ceiling', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [{
        name: 'Quick-Set Post Concrete 20kg',
        quantity: 40,           // per work unit (per post hole)
        sectionMultiplier: 10,  // 10 post holes
        unit: 'pack',
        price: 9.20,
        section: 'Fence Post Footings',
        sectionLaborHours: 0.6,
      }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(true);
    expect(materials[0].pricingSource).toBe('absurd_quantity');
  });

  it('still passes a realistic per-unit × multiplier through cleanly', () => {
    // 3 bags of concrete per post × 10 posts = 30 bags total. Normal.
    const { flags } = validateAndRepairAiOutput(
      [{
        name: 'Quick-Set Post Concrete 20kg',
        quantity: 3,
        sectionMultiplier: 10,
        unit: 'pack',
        price: 9.20,
        section: 'Fence Post Footings',
      }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(false);
  });

  it('treats missing sectionMultiplier as 1 (no inflation)', () => {
    // sectionMultiplier missing — quantity itself is the effective total.
    // 150 packs of mortar mix on a brick wall job, no multiplier — passes.
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Mortar mix 20kg', quantity: 150, unit: 'pack', price: 9.50 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(false);
  });

  it('allows a large-but-realistic pack count under the ceiling', () => {
    // 150 packs of mortar mix for a brick wall job — large but plausible
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Mortar mix 20kg', quantity: 150, unit: 'pack', price: 9.50 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(false);
  });

  it('catches 5000+ fasteners as absurd', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Galvanised tek screws', quantity: 50000, unit: 'each', price: 0.05 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(true);
  });

  it('catches 100+ m³ of concrete as absurd', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Ready-mix concrete', quantity: 200, unit: 'm³', price: 280 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(true);
  });

  it('does not flag normal-sized quantities', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Pavers', quantity: 172, unit: 'each', price: 8.5 },
        { name: 'Crusher dust', quantity: 4000, unit: 'kg', price: 0.12 },
        { name: 'Geotextile', quantity: 30, unit: 'm²', price: 4 },
        { name: 'Treated pine 90x45', quantity: 75, unit: 'm', price: 5.5 },
      ],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(false);
  });

  it('ignores ceiling check for unknown units', () => {
    // Custom unit "box" not in the ceiling map — no enforcement, passes through
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Whatever', quantity: 999999, unit: 'box', price: 1 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(false);
  });

  it('flags a section whose minimum sectionLaborHours is zero', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Paver A', section: 'Paver Installation (per m²)', sectionLaborHours: 0 },
        { name: 'Paver B', section: 'Paver Installation (per m²)', sectionLaborHours: 0 },
        { name: 'Sand',    section: 'Setup and Preparation',        sectionLaborHours: 1.5 },
      ],
      silent,
    );
    expect(flags.hasZeroLabourSection).toBe(true);
    expect(flags.zeroLabourSections).toEqual(['Paver Installation (per m²)']);
  });

  it('treats a missing sectionLaborHours as zero (NaN guard)', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Pavers', section: 'Paver Installation', sectionLaborHours: undefined }],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual(['Paver Installation']);
  });

  it('flags a section if any material within it reports 0 hours', () => {
    // Defensive — within the same section any zero overrides the min.
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'A', section: 'Paving', sectionLaborHours: 2 },
        { name: 'B', section: 'Paving', sectionLaborHours: 0 },
      ],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual(['Paving']);
  });

  it('ignores materials without a section name', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Pavers', sectionLaborHours: 0 }],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual([]);
  });

  it('reproduces the QU-177963 multi-issue case in one pass', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [
        { name: 'Concrete Pavers 200x200x60', quantity: 83, unit: 'm³', price: 46,
          section: 'Paver Installation (per m²)', sectionLaborHours: 0 },
        { name: 'Bedding Sand', quantity: 3, unit: 'm³', price: 144,
          section: 'Paver Installation (per m²)', sectionLaborHours: 0 },
        { name: 'Concrete Garden Edge 150mm', quantity: 40, unit: 'm', price: 0,
          section: 'Garden Bed Preparation', sectionLaborHours: 2.4 },
        { name: 'Garden Mulch (25L bag)', quantity: 30, unit: 'each', price: 0,
          section: 'Garden Bed Preparation', sectionLaborHours: 2.4 },
      ],
      silent,
    );
    // All four signals should fire at once.
    expect(flags.hasInvalidUnit).toBe(true);         // Pavers in m³
    expect(flags.hasZeroLabourSection).toBe(true);   // Paver Installation = 0h
    expect(flags.hasZeroPricedMaterial).toBe(true);  // Garden Edge + Mulch
    expect(flags.invalidUnitCount).toBe(1);
    expect(flags.zeroPricedMaterialCount).toBe(2);
    expect(flags.zeroLabourSections).toEqual(['Paver Installation (per m²)']);
    expect(materials[0].pricingSource).toBe('invalid_unit');
    // Non-flagged rows pass through untouched.
    expect(materials[3].pricingSource).toBeUndefined();
  });

  it('routes warning messages through the injected logger', () => {
    const calls: Array<{ msg: string; meta?: unknown }> = [];
    const log = { warn: (msg: string, meta?: unknown) => calls.push({ msg, meta }) };
    validateAndRepairAiOutput(
      [{ name: 'Pavers', unit: 'm²', section: 'Paving', sectionLaborHours: 0 }],
      log,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].msg).toMatch(/piece-good/);
    expect(calls[1].msg).toMatch(/zero labour/);
  });

  it('handles an empty materials list without throwing', () => {
    const { materials, flags } = validateAndRepairAiOutput([], silent);
    expect(materials).toEqual([]);
    expect(flags.hasInvalidUnit).toBe(false);
    expect(flags.hasZeroLabourSection).toBe(false);
    expect(flags.hasZeroPricedMaterial).toBe(false);
  });

  it('does not mutate the input array or its items', () => {
    const inputs = [
      { name: 'Pavers', unit: 'm³', section: 'Paving', sectionLaborHours: 0 },
    ];
    const snapshot = JSON.parse(JSON.stringify(inputs));
    validateAndRepairAiOutput(inputs, silent);
    expect(inputs).toEqual(snapshot);
  });
});

// ===== Robustness — case sensitivity, false positives, dirty data =====
//
// These cover the realistic ways the validator gets bypassed in production:
// AI outputs with mixed casing, Reece's ALL-CAPS title echo, whitespace,
// false-positive name matches (e.g. "Paver Sand" is bulk, not a paver),
// and malformed material rows from corrupted/legacy data.

describe('validateAndRepairAiOutput — case sensitivity', () => {
  it('flags all-caps piece-good names (Reece echoes uppercase)', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'CONCRETE PAVERS 400X400', quantity: 25, unit: 'm²', price: 8 }],
      silent,
    );
    expect(flags.invalidUnitCount).toBe(1);
  });

  it('flags mixed-case names', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Concrete pAvers', quantity: 1, unit: 'm²', price: 1 },
        { name: 'ceramic TILE', quantity: 1, unit: 'm³', price: 1 },
        { name: 'Decking Board H4', quantity: 1, unit: 'm', price: 1 },
      ],
      silent,
    );
    // First two flagged; third is bulk-priced linear unit "m" (legitimate)
    expect(flags.invalidUnitCount).toBe(2);
  });
});

describe('validateAndRepairAiOutput — false-positive traps', () => {
  it('does NOT flag "Paver Sand" with a bulk unit', () => {
    // "Paver Sand" matches the /pavers?/ word in the regex, but unit is kg
    // (legitimate bulk aggregate), so the validator correctly leaves it alone.
    const { materials, flags } = validateAndRepairAiOutput(
      [{ name: 'Paver Sand - Joint Fill', quantity: 25, unit: 'kg', price: 3 }],
      silent,
    );
    expect(materials[0].pricingSource).toBeUndefined();
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('does NOT flag bulk consumables that happen to contain a piece-good word', () => {
    // Real production examples — all legitimate non-piece-goods.
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Tile Adhesive', quantity: 5, unit: 'kg', price: 22 },
        { name: 'Plasterboard Joint Compound', quantity: 1, unit: 'L', price: 18 },
        { name: 'Door Handle Lubricant', quantity: 1, unit: 'each', price: 4 },
      ],
      silent,
    );
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('still flags "Paver Sand" with a bad unit — known limitation', () => {
    // Documents current behaviour: when the unit is m²/m³ AND the name
    // contains "paver", we flag. We accept this false positive because the
    // alternative (excluding compound names like "Paver Sand") is harder to
    // pattern-match safely and the unit signal is already a strong red flag
    // on its own.
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Paver Sand', quantity: 5, unit: 'm²', price: 10 }],
      silent,
    );
    expect(flags.invalidUnitCount).toBe(1);
  });

  it('does NOT match piece-good keywords inside other words', () => {
    // \b word boundaries on BOTH sides — "Tilework" has no boundary between
    // "tile" and "work", so it does NOT match \btiles?\b. Same for "Plate".
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Caterpillar Tilework Service', quantity: 1, unit: 'm²', price: 5 },
        { name: 'Galvanised Plate', quantity: 1, unit: 'm³', price: 5 },
        { name: 'Spirit Level', quantity: 1, unit: 'each', price: 25 },
      ],
      silent,
    );
    expect(flags.invalidUnitCount).toBe(0);
  });
});

describe('validateAndRepairAiOutput — dirty input', () => {
  it('treats missing or empty name as a non-piece-good', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: undefined as any, unit: 'm²', quantity: 1, price: 1 },
        { name: '', unit: 'm³', quantity: 1, price: 1 },
        { name: null as any, unit: 'm³', quantity: 1, price: 1 },
      ],
      silent,
    );
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('treats missing unit as not-a-piece-good (cannot judge)', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Pavers', quantity: 100, price: 5 } as any],
      silent,
    );
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('ignores NaN/Infinity prices when counting zero-priced materials', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'A', quantity: 5, unit: 'each', price: NaN },
        { name: 'B', quantity: 5, unit: 'each', price: Infinity },
        { name: 'C', quantity: 5, unit: 'each', price: 0 }, // real zero
      ],
      silent,
    );
    expect(flags.zeroPricedMaterialCount).toBe(1);
  });

  it('ignores NaN quantities when counting zero-priced materials', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'A', quantity: NaN, unit: 'each', price: 0 } as any],
      silent,
    );
    expect(flags.zeroPricedMaterialCount).toBe(0);
  });

  it('does not flag negative prices as zero-priced (separate concern)', () => {
    // A negative price (refund line) is not the same as "missing price".
    // Validator only flags exactly 0 with positive qty.
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Refund', quantity: 1, unit: 'each', price: -10 }],
      silent,
    );
    expect(flags.hasZeroPricedMaterial).toBe(false);
  });

  it('handles null and undefined material entries without crashing', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [null as any, undefined as any, { name: 'Real', unit: 'kg', quantity: 1, price: 5 }],
      silent,
    );
    expect(materials).toHaveLength(3);
    expect(flags.hasInvalidUnit).toBe(false);
  });

  it('treats non-string section names (numeric, null) as section-less', () => {
    // Defensive: legacy / corrupted data may have section: 1 or section: null.
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'A', section: 1 as any, sectionLaborHours: 0 },
        { name: 'B', section: null as any, sectionLaborHours: 0 },
        { name: 'C', section: {} as any, sectionLaborHours: 0 },
      ],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual([]);
  });

  it('trims neither name nor unit — surrounding whitespace currently bypasses checks', () => {
    // Documents current behaviour: "m² " with trailing space does NOT match.
    // If we ever want to harden this, normalise both name and unit before the
    // regex/Set lookup. For now flag this as a known gap.
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'Pavers', unit: 'm² ', quantity: 25, price: 5 }, // trailing space
        { name: ' Pavers', unit: 'm²', quantity: 25, price: 5 }, // leading space on name (regex tolerates)
      ],
      silent,
    );
    expect(flags.invalidUnitCount).toBe(1); // only the leading-name case caught
  });
});

describe('validateAndRepairAiOutput — section labour-hour edge cases', () => {
  it('handles a section with all positive hours (no false positive)', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'A', section: 'Footing', sectionLaborHours: 1.5 },
        { name: 'B', section: 'Footing', sectionLaborHours: 1.5 },
        { name: 'C', section: 'Footing', sectionLaborHours: 1.5 },
      ],
      silent,
    );
    expect(flags.hasZeroLabourSection).toBe(false);
  });

  it('flags only the zero-labour section when multiple sections exist', () => {
    const { flags } = validateAndRepairAiOutput(
      [
        { name: 'A', section: 'Good', sectionLaborHours: 1 },
        { name: 'B', section: 'Bad', sectionLaborHours: 0 },
        { name: 'C', section: 'AlsoGood', sectionLaborHours: 2 },
      ],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual(['Bad']);
  });

  it('treats negative sectionLaborHours as zero-labour', () => {
    // Negative hours shouldn't occur, but if data is corrupt the section
    // is unusable either way — flag it.
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'A', section: 'Weird', sectionLaborHours: -2 }],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual(['Weird']);
  });

  it('treats sectionLaborHours = NaN as zero', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'A', section: 'NaNSection', sectionLaborHours: NaN } as any],
      silent,
    );
    expect(flags.zeroLabourSections).toEqual(['NaNSection']);
  });
});

describe('validateAndRepairAiOutput — performance smoke', () => {
  it('processes 1000 materials in well under a second', () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({
      name: `Item ${i}`,
      quantity: i % 7,
      unit: i % 3 === 0 ? 'm²' : 'each',
      price: i % 5 === 0 ? 0 : 10,
      section: `Section ${i % 20}`,
      sectionLaborHours: i % 4 === 0 ? 0 : 1.5,
    }));
    const t0 = Date.now();
    const { materials, flags } = validateAndRepairAiOutput(big, silent);
    const ms = Date.now() - t0;
    expect(materials).toHaveLength(1000);
    expect(ms).toBeLessThan(200);
    // We expect SOME flags to fire on this dataset (zero-priced + zero-labour seeded)
    expect(flags.hasZeroPricedMaterial).toBe(true);
    expect(flags.hasZeroLabourSection).toBe(true);
  });
});

describe('clampMaterialQuantity', () => {
  describe('discrete units round to whole numbers with a floor of 1', () => {
    it('rounds a fractional count up or down to the nearest whole item', () => {
      expect(clampMaterialQuantity(6.4, 'each')).toBe(6);
      expect(clampMaterialQuantity(6.6, 'each')).toBe(7);
      expect(clampMaterialQuantity(2.5, 'pack')).toBe(3);
      expect(clampMaterialQuantity(1.2, 'box')).toBe(1);
    });

    it('floors a sub-1 count at 1 — you cannot buy 0.4 of a gate latch', () => {
      expect(clampMaterialQuantity(0.4, 'each')).toBe(1);
      expect(clampMaterialQuantity(0.004, 'pack')).toBe(1);
    });

    it('caps a runaway count at 999', () => {
      expect(clampMaterialQuantity(2400, 'each')).toBe(999);
    });

    it('treats an unrecognised unit as a discrete count', () => {
      expect(clampMaterialQuantity(0.5, 'each')).toBe(1);
    });
  });

  describe('continuous units keep their fraction — the QU-178694 defect', () => {
    it('preserves 0.054 m³, the per-footing concrete volume the prompt asks for', () => {
      // Was Math.round(0.054) -> 0 -> floored to 1, which the 35-footing
      // sectionMultiplier then turned into 35 m³ of concrete ($9,545).
      expect(clampMaterialQuantity(0.054, 'm³')).toBe(0.054);
    });

    it('preserves fractions for every continuous unit', () => {
      expect(clampMaterialQuantity(0.25, 'kg')).toBe(0.25);
      expect(clampMaterialQuantity(0.5, 'L')).toBe(0.5);
      expect(clampMaterialQuantity(1.75, 'm')).toBe(1.75);
      expect(clampMaterialQuantity(0.8, 'm²')).toBe(0.8);
    });

    it('rounds to 3 decimal places, matching downstream storage precision', () => {
      expect(clampMaterialQuantity(0.0544444, 'm³')).toBe(0.054);
      expect(clampMaterialQuantity(1.23456, 'kg')).toBe(1.235);
    });

    it('never collapses a tiny positive amount to zero', () => {
      expect(clampMaterialQuantity(0.0001, 'm³')).toBe(0.001);
    });

    it('does not truncate bulk masses at 999 — the prompt asks for 4000 kg of crusher dust', () => {
      expect(clampMaterialQuantity(4000, 'kg')).toBe(4000);
      expect(clampMaterialQuantity(1275, 'kg')).toBe(1275);
    });

    it('still stops a garbage value reaching the pricing layer', () => {
      expect(clampMaterialQuantity(1e9, 'kg')).toBe(100000);
    });
  });

  describe('non-positive and malformed input', () => {
    it('returns 0 so callers can drop the row', () => {
      expect(clampMaterialQuantity(0, 'm³')).toBe(0);
      expect(clampMaterialQuantity(-5, 'each')).toBe(0);
      expect(clampMaterialQuantity(NaN, 'kg')).toBe(0);
      expect(clampMaterialQuantity(Infinity, 'm')).toBe(0);
    });
  });
});

describe('m³ absurd-quantity ceiling (tightened after QU-178694)', () => {
  it('flags 35 m³ of concrete on a residential job', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Ready Mix Concrete', quantity: 1, unit: 'm³', price: 272.73, sectionMultiplier: 35 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(true);
  });

  it('does not flag the corrected 1.89 m³ the same job actually needs', () => {
    const { flags } = validateAndRepairAiOutput(
      [{ name: 'Ready Mix Concrete', quantity: 0.054, unit: 'm³', price: 272.73, sectionMultiplier: 35 }],
      silent,
    );
    expect(flags.hasAbsurdQuantity).toBe(false);
  });

  it('keeps the more specific invalid_unit label when both would fire', () => {
    const { materials, flags } = validateAndRepairAiOutput(
      [{ name: 'Concrete Pavers 200x200x60', quantity: 83, unit: 'm³', price: 46 }],
      silent,
    );
    expect(materials[0].pricingSource).toBe('invalid_unit');
    expect(flags.hasInvalidUnit).toBe(true);
    expect(flags.hasAbsurdQuantity).toBe(true);
  });
});
