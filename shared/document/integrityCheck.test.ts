import { checkDocumentIntegrity, IntegrityCode, IntegrityIssue } from './integrityCheck';

// Helpers ---------------------------------------------------------------------

function codes(issues: IntegrityIssue[]): IntegrityCode[] {
  return issues.map((i) => i.code);
}

function buildClean(over: Partial<any> = {}): any {
  // A minimally-consistent quote: $100 materials, $200 labour, 0% markup, exclusive GST.
  return {
    laborRate: 100,
    laborHours: 2,
    laborUnit: 'hours',
    laborTotal: 200,
    laborExtraHours: 0,
    laborMarkup: 0,
    markup: 0,
    travelAdjustment: 0,
    materialsSubtotal: 100,
    subtotal: 300,
    markupAmount: 0,
    gst: 30,
    total: 330,
    pricesIncludeGst: false,
    materials: [{ name: 'Foo', quantity: 1, unit: 'each', price: 100, totalPrice: 100 }],
    sections: [],
    job: { estimatedHours: 2 },
    ...over,
  };
}

// Sanity ----------------------------------------------------------------------

describe('checkDocumentIntegrity — clean documents', () => {
  it('reports no issues on a minimal internally-consistent quote', () => {
    expect(checkDocumentIntegrity(buildClean())).toEqual([]);
  });

  it('reports no issues with valid sections + extra labour', () => {
    const doc = buildClean({
      laborHours: 0, // ignored when sections exist
      laborTotal: 600,
      laborExtraHours: 1,
      sections: [
        { name: 'A', multiplier: 2, laborHours: 2, laborRate: 100, laborUnit: 'hours', laborTotal: 400 },
        { name: 'B', multiplier: 1, laborHours: 1, laborRate: 100, laborUnit: 'hours', laborTotal: 100 },
      ],
      // 500 section sum + 1×100 extra = 600 labour, +100 materials = 700 subtotal
      subtotal: 700,
      gst: 70,
      total: 770,
      job: { estimatedHours: 6 }, // 2×2 + 1×1 + 1 extra = 6h
    });
    expect(checkDocumentIntegrity(doc)).toEqual([]);
  });

  it('treats sub-tolerance rounding drift as clean', () => {
    const doc = buildClean({ materialsSubtotal: 100.4 }); // drift of 0.40, below default tolerance of 0.50
    expect(codes(checkDocumentIntegrity(doc))).not.toContain('materials_subtotal_mismatch');
  });

  it('flags drift just above tolerance', () => {
    const doc = buildClean({ materialsSubtotal: 100.6 });
    expect(codes(checkDocumentIntegrity(doc))).toContain('materials_subtotal_mismatch');
  });
});

// Individual checks -----------------------------------------------------------

describe('checkDocumentIntegrity — single-issue cases', () => {
  it('flags materials_subtotal_mismatch when stored value drifts', () => {
    const doc = buildClean({ materialsSubtotal: 999 });
    expect(codes(checkDocumentIntegrity(doc))).toContain('materials_subtotal_mismatch');
  });

  it('flags labour_total_mismatch when laborTotal != Σ sections + extra', () => {
    const doc = buildClean({
      laborTotal: 9999,
      sections: [{ name: 'A', multiplier: 1, laborHours: 2, laborRate: 100, laborUnit: 'hours', laborTotal: 200 }],
    });
    expect(codes(checkDocumentIntegrity(doc))).toContain('labour_total_mismatch');
  });

  it('flags subtotal_mismatch when subtotal != materialsSubtotal + laborTotal', () => {
    const doc = buildClean({ subtotal: 9999 });
    expect(codes(checkDocumentIntegrity(doc))).toContain('subtotal_mismatch');
  });

  it('flags markup_amount_mismatch when stored markup contradicts the percentages', () => {
    const doc = buildClean({ markup: 10, laborMarkup: 20, markupAmount: 0 }); // expected $100 × 10% + $200 × 20% = $50
    expect(codes(checkDocumentIntegrity(doc))).toContain('markup_amount_mismatch');
  });

  it('flags total_mismatch under exclusive GST', () => {
    const doc = buildClean({ total: 1000 });
    expect(codes(checkDocumentIntegrity(doc))).toContain('total_mismatch');
  });

  it('accepts a correct inclusive-GST total', () => {
    const doc = buildClean({
      pricesIncludeGst: true,
      total: 300, // = subtotal, no +10%
      gst: 27.27, // 300 - 300/1.1
    });
    expect(codes(checkDocumentIntegrity(doc))).not.toContain('total_mismatch');
  });

  it('flags section_zero_labour when a section has 0h and $0', () => {
    const doc = buildClean({
      laborTotal: 0,
      laborHours: 0,
      sections: [{ name: 'Equipment Hire', multiplier: 1, laborHours: 0, laborRate: 0, laborUnit: 'hours', laborTotal: 0 }],
      subtotal: 100,
      gst: 10,
      total: 110,
      job: { estimatedHours: 0 },
    });
    const issues = codes(checkDocumentIntegrity(doc));
    expect(issues).toContain('section_zero_labour');
  });

  it('flags section_total_mismatch when multiplier is dropped from labour calc (QU-177866 shape)', () => {
    const doc = buildClean({
      laborHours: 10,
      laborUnit: 'days',
      laborRate: 1100,
      laborTotal: 10945, // matches stored
      laborExtraHours: 7.8,
      materialsSubtotal: 10847.24,
      subtotal: 21792.24,
      gst: 2179.22,
      total: 23971.46,
      sections: [
        {
          name: 'Hardwood Deck Surface',
          multiplier: 43, laborHours: 2.15, laborHoursTotal: 2.15,
          laborRate: 1100, laborUnit: 'days',
          laborTotal: 2365, // BUG: 2.15 × 1100 × 1, not × 43 — multiplier dropped
        },
      ],
      job: { estimatedHours: 48 },
    });
    const issues = checkDocumentIntegrity(doc);
    const sectionMismatch = issues.find((i) => i.code === 'section_total_mismatch');
    expect(sectionMismatch).toBeDefined();
    expect(sectionMismatch!.expected).toBe(101695);  // 2.15 × 1100 × 43
    expect(sectionMismatch!.actual).toBe(2365);
  });

  it('flags piece_good_bad_unit (delegates to validateAndRepairAiOutput)', () => {
    const doc = buildClean({
      materials: [
        { name: 'Concrete Pavers 200x200x60', quantity: 83, unit: 'm³', price: 46, totalPrice: 3818 },
      ],
      materialsSubtotal: 3818,
      subtotal: 4018,
      gst: 401.8,
      total: 4419.8,
    });
    expect(codes(checkDocumentIntegrity(doc))).toContain('piece_good_bad_unit');
  });

  it('flags zero_priced_material when qty > 0 but price = 0', () => {
    const doc = buildClean({
      materials: [
        { name: 'Garden Mulch (25L bag)', quantity: 30, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Sand', quantity: 1, unit: 'kg', price: 100, totalPrice: 100 },
      ],
      materialsSubtotal: 100,
    });
    expect(codes(checkDocumentIntegrity(doc))).toContain('zero_priced_material');
  });

  it('raises no zero_priced_material for a $0 work item', () => {
    // A lump-sum scope line is a title, a paragraph and one price the tradie
    // typed. "General preparation — included" at $0 is correct, not a hole.
    const doc = buildClean({
      materials: [
        { name: 'General Preparation', kind: 'work', quantity: 1, unit: 'each', price: 0, totalPrice: 0, scope: 'Cover and protect.' },
        { name: 'Interior', kind: 'work', quantity: 1, unit: 'each', price: 100, totalPrice: 100 },
      ],
      materialsSubtotal: 100,
    });
    expect(codes(checkDocumentIntegrity(doc))).not.toContain('zero_priced_material');
  });

  it('flags estimated_hours_drift when JobSpec estimate diverges from section sum', () => {
    const doc = buildClean({
      sections: [{ name: 'A', multiplier: 1, laborHours: 2, laborRate: 100, laborUnit: 'hours', laborTotal: 200 }],
      job: { estimatedHours: 40 }, // section sum = 2h, drift 38h
    });
    expect(codes(checkDocumentIntegrity(doc))).toContain('estimated_hours_drift');
  });

  it('converts days correctly when computing estimated_hours_drift', () => {
    // 1 day section = 8h, no extra. job.estimatedHours = 24 → drift 16h.
    const doc = buildClean({
      laborTotal: 1100,
      laborUnit: 'days',
      sections: [{ name: 'A', multiplier: 1, laborHours: 1, laborRate: 1100, laborUnit: 'days', laborTotal: 1100 }],
      subtotal: 1200,
      gst: 120,
      total: 1320,
      job: { estimatedHours: 24 },
    });
    expect(codes(checkDocumentIntegrity(doc))).toContain('estimated_hours_drift');
  });

  it('does NOT flag estimated_hours_drift within 1h tolerance', () => {
    const doc = buildClean({
      sections: [
        { name: 'A', multiplier: 1, laborHours: 2.3, laborRate: 100, laborUnit: 'hours', laborTotal: 230 },
      ],
      laborTotal: 230, subtotal: 330, gst: 33, total: 363,
      job: { estimatedHours: 2 }, // round(2.3) = 2, drift 0
    });
    expect(codes(checkDocumentIntegrity(doc))).not.toContain('estimated_hours_drift');
  });

  it('treats missing JobSpec.estimatedHours as no-op', () => {
    const doc = buildClean({
      sections: [{ name: 'A', multiplier: 1, laborHours: 5, laborRate: 100, laborUnit: 'hours', laborTotal: 500 }],
      laborTotal: 500, subtotal: 600, gst: 60, total: 660,
      job: {}, // no estimatedHours field
    });
    expect(codes(checkDocumentIntegrity(doc))).not.toContain('estimated_hours_drift');
  });
});

// Configurable tolerances ----------------------------------------------------

describe('checkDocumentIntegrity — tolerance options', () => {
  it('accepts a dollarTolerance override', () => {
    const doc = buildClean({ materialsSubtotal: 105 }); // $5 drift
    expect(codes(checkDocumentIntegrity(doc, { dollarTolerance: 10 }))).not.toContain('materials_subtotal_mismatch');
    expect(codes(checkDocumentIntegrity(doc, { dollarTolerance: 1 }))).toContain('materials_subtotal_mismatch');
  });

  it('accepts an estimatedHoursDriftToleranceH override', () => {
    const doc = buildClean({
      sections: [{ name: 'A', multiplier: 1, laborHours: 2, laborRate: 100, laborUnit: 'hours', laborTotal: 200 }],
      job: { estimatedHours: 5 }, // section sum = 2h, drift 3h
    });
    expect(codes(checkDocumentIntegrity(doc, { estimatedHoursDriftToleranceH: 5 }))).not.toContain('estimated_hours_drift');
    expect(codes(checkDocumentIntegrity(doc, { estimatedHoursDriftToleranceH: 2 }))).toContain('estimated_hours_drift');
  });
});

// Real-world reproductions ---------------------------------------------------
//
// These fixtures are derived from PII-stripped audit output of the 50 most
// recent production quotes (2026-05-25). Each one exhibits a specific bug
// pattern the audit surfaced.

describe('checkDocumentIntegrity — real production shapes', () => {
  it('QU-177963 paving job — four simultaneous issues', () => {
    // Per the audit summary: section_zero_labour, piece_good_bad_unit,
    // zero_priced_material, estimated_hours_drift all fire together.
    const doc = {
      type: 'quote', stage: 'draft',
      laborRate: 3000, laborHours: 0, laborUnit: 'days',
      laborTotal: 3300, laborExtraHours: 0.1,
      materialsSubtotal: 7283, subtotal: 10583, markup: 0, laborMarkup: 20,
      markupAmount: 660, gst: 1124.30, total: 12367.30,
      pricesIncludeGst: false,
      sections: [
        { name: 'Paver Installation (per m²)', multiplier: 82, laborHours: 0, laborRate: 3000, laborUnit: 'days', laborTotal: 0 },
        { name: 'Paving Edge Restraint',     multiplier: 1, laborHours: 0.2, laborRate: 3000, laborUnit: 'days', laborTotal: 600 },
        { name: 'Setup and Preparation',     multiplier: 1, laborHours: 0.2, laborRate: 3000, laborUnit: 'days', laborTotal: 600 },
        { name: 'Equipment Hire',            multiplier: 1, laborHours: 0.1, laborRate: 3000, laborUnit: 'days', laborTotal: 300 },
        { name: 'Waste Removal',             multiplier: 1, laborHours: 0.1, laborRate: 3000, laborUnit: 'days', laborTotal: 300 },
        { name: 'Garden Bed Preparation',    multiplier: 1, laborHours: 0.3, laborRate: 3000, laborUnit: 'days', laborTotal: 900 },
        { name: 'Tools and Consumables',     multiplier: 1, laborHours: 0.1, laborRate: 3000, laborUnit: 'days', laborTotal: 300 },
      ],
      materials: [
        { name: 'Concrete Pavers 200x200x60', quantity: 83, unit: 'm³', price: 46, totalPrice: 3818 },
        { name: 'Bedding Sand',              quantity: 3,  unit: 'm³', price: 144, totalPrice: 432 },
        { name: 'Paving Sand - Joint Fill',  quantity: 19, unit: 'each', price: 15, totalPrice: 285 },
        { name: 'Concrete Garden Edge 150mm', quantity: 40, unit: 'm', price: 0, totalPrice: 0 },
        { name: 'Cement (20kg) for Haunching', quantity: 9, unit: 'each', price: 12, totalPrice: 108 },
        { name: "Builder's String Line", quantity: 1, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Timber Stakes', quantity: 20, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Marking Paint Spray Can', quantity: 2, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Truck Hire (day rate)', quantity: 1, unit: 'each', price: 456, totalPrice: 456 },
        { name: 'Mini Excavator Hire (day rate)', quantity: 1, unit: 'each', price: 384, totalPrice: 384 },
        { name: 'Waste removal and Tip fees', quantity: 1, unit: 'each', price: 1800, totalPrice: 1800 },
        { name: 'Garden Soil (25L bag)', quantity: 40, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Garden Mulch (25L bag)', quantity: 30, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Wheelbarrow - Heavy Duty', quantity: 1, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Rubber Mallet', quantity: 1, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Broom - Stiff Bristle', quantity: 1, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Safety Glasses', quantity: 2, unit: 'each', price: 0, totalPrice: 0 },
        { name: 'Diamond Blade 350mm', quantity: 2, unit: 'each', price: 0, totalPrice: 0 },
      ],
      job: { estimatedHours: 40 },
    };
    const issues = codes(checkDocumentIntegrity(doc));
    expect(issues).toContain('section_zero_labour');
    expect(issues).toContain('piece_good_bad_unit');
    expect(issues).toContain('zero_priced_material');
    expect(issues).toContain('estimated_hours_drift');
  });

  it('QU-177866 hardwood decking — multiplier dropped from one section', () => {
    // From the audit: section "Hardwood Deck Surface" stored as 2.15 × 1100 = $2365,
    // but multiplier=43 means the fair labour is $101,695. The customer signed for
    // ~$28,765 — a real undercharge of ~$90,750 sitting in production.
    const doc = {
      laborRate: 1100, laborHours: 10, laborUnit: 'days' as const,
      laborTotal: 10945, laborExtraHours: 7.8,
      materialsSubtotal: 10847.24, subtotal: 21792.24,
      markup: 0, laborMarkup: 20, markupAmount: 2189, gst: 2615.07, total: 28765.76,
      pricesIncludeGst: false,
      sections: [
        {
          name: 'Hardwood Deck Surface',
          multiplier: 43, laborHours: 2.15, laborHoursTotal: 2.15,
          laborRate: 1100, laborUnit: 'days', laborTotal: 2365,
        },
      ],
      materials: [],
      job: { estimatedHours: 48 },
    };
    const issues = checkDocumentIntegrity(doc);
    const section = issues.find((i) => i.code === 'section_total_mismatch');
    expect(section).toBeDefined();
    expect(section!.expected).toBe(101695);
    expect(section!.actual).toBe(2365);
    // The drift also produces estimated_hours_drift in the audit (48 vs 80h).
    expect(codes(issues)).toContain('estimated_hours_drift');
  });

  it('QU-177944 painting job — every material at $0 (pricing pipeline blank)', () => {
    // From audit: 15/15 materials are zero-priced — a full Bunnings scrape miss.
    const doc = {
      laborRate: 680, laborHours: 0.9, laborUnit: 'days' as const, laborTotal: 612,
      laborExtraHours: 0,
      materialsSubtotal: 0, subtotal: 612,
      markup: 0, laborMarkup: 20, markupAmount: 122.4, gst: 73.44, total: 807.84,
      pricesIncludeGst: false,
      sections: [
        { name: 'Wall Repair and Preparation', multiplier: 1, laborHours: 0.4, laborRate: 680, laborUnit: 'days', laborTotal: 272 },
        { name: 'Priming and Painting Three Walls', multiplier: 1, laborHours: 0.5, laborRate: 680, laborUnit: 'days', laborTotal: 340 },
      ],
      materials: Array.from({ length: 15 }, (_, i) => ({
        name: `Material ${i}`, quantity: 1, unit: 'each', price: 0, totalPrice: 0,
      })),
      job: { estimatedHours: 7 },
    };
    const issues = codes(checkDocumentIntegrity(doc));
    expect(issues).toContain('zero_priced_material');
    expect(issues).not.toContain('labour_total_mismatch'); // labour math holds
    expect(issues).not.toContain('total_mismatch'); // total math holds
  });

  it('QU-177889 per-m² section + extra labour — only estimated_hours_drift', () => {
    // Per-m² section with multiplier=25, laborHours=0.04 per m² (well-formed).
    // 0.04 × 25 = 1 day section + 5.1 days extra = 6.1 days = 48.8h.
    // JobSpec.estimatedHours was 20 → drift.
    const doc = {
      laborRate: 1150, laborHours: 6.1, laborUnit: 'days' as const, laborTotal: 7015,
      laborExtraHours: 5.1,
      materialsSubtotal: 0, subtotal: 7015,
      markup: 0, laborMarkup: 0, markupAmount: 0, gst: 701.5, total: 7716.5,
      pricesIncludeGst: false,
      sections: [
        {
          name: 'Hardwood Deck Surface',
          multiplier: 25, laborHours: 0.04, laborHoursTotal: 1,
          laborRate: 1150, laborUnit: 'days', laborTotal: 1150,
        },
      ],
      materials: [],
      job: { estimatedHours: 20 },
    };
    const issues = codes(checkDocumentIntegrity(doc));
    // Section math is correct (0.04 × 1150 × 25 = 1150)
    expect(issues).not.toContain('section_total_mismatch');
    // Labour math is correct (1150 + 5.1 × 1150 = 1150 + 5865 = 7015)
    expect(issues).not.toContain('labour_total_mismatch');
    expect(issues).toContain('estimated_hours_drift');
  });

  it('flags both inflated AND deflated section_total_mismatch with the same code', () => {
    // checkDocumentIntegrity is intentionally direction-agnostic — it only
    // detects that laborTotal ≠ laborHours × laborRate × multiplier. The
    // heal step (healInflatedSections.ts) and a human reviewer then have to
    // decide which way to repair.
    const inflatedDoc = {
      laborRate: 1100, laborHours: 27.6, laborUnit: 'days' as const,
      laborTotal: 30360, // matches stored; section sum = 30360, no extra
      laborExtraHours: 0,
      materialsSubtotal: 0, subtotal: 30360,
      markup: 0, laborMarkup: 0, markupAmount: 0,
      gst: 3036, total: 33396, pricesIncludeGst: false,
      sections: [{
        name: 'Inflated',
        multiplier: 12, laborHours: 27.6, laborRate: 1100, laborUnit: 'days',
        laborTotal: 30360, // = 27.6 × 1100 × 1 (not × 12) — under-billed by mul
      }],
      materials: [], job: {},
    };
    const deflatedDoc = {
      laborRate: 1100, laborHours: 2.15, laborUnit: 'days' as const,
      laborTotal: 2365, laborExtraHours: 0,
      materialsSubtotal: 0, subtotal: 2365,
      markup: 0, laborMarkup: 0, markupAmount: 0,
      gst: 236.5, total: 2601.5, pricesIncludeGst: false,
      sections: [{
        name: 'Deflated',
        multiplier: 43, laborHours: 2.15, laborRate: 1100, laborUnit: 'days',
        laborTotal: 2365, // = 2.15 × 1100 × 1 (not × 43)
      }],
      materials: [], job: {},
    };
    const inflatedIssues = codes(checkDocumentIntegrity(inflatedDoc));
    const deflatedIssues = codes(checkDocumentIntegrity(deflatedDoc));
    expect(inflatedIssues).toContain('section_total_mismatch');
    expect(deflatedIssues).toContain('section_total_mismatch');
  });

  it('QU-177916 paving with mixed per-m² and fixed sections + one zero', () => {
    const doc = {
      laborRate: 1040, laborHours: 2.5, laborUnit: 'days' as const, laborTotal: 2600,
      laborExtraHours: 0.2,
      materialsSubtotal: 0, subtotal: 2600,
      markup: 0, laborMarkup: 0, markupAmount: 0, gst: 260, total: 2860,
      pricesIncludeGst: false,
      sections: [
        { name: 'Paver Laying (per m²)', multiplier: 25, laborHours: 0.044, laborRate: 1040, laborUnit: 'days', laborTotal: 1144 },
        { name: 'Base Preparation (per m²)', multiplier: 25, laborHours: 0.024, laborRate: 1040, laborUnit: 'days', laborTotal: 624 },
        { name: 'Site Preparation', multiplier: 1, laborHours: 0.2, laborRate: 1040, laborUnit: 'days', laborTotal: 208 },
        { name: 'Edge Restraint', multiplier: 1, laborHours: 0.3, laborRate: 1040, laborUnit: 'days', laborTotal: 312 },
        { name: 'Tools & Consumables', multiplier: 1, laborHours: 0.1, laborRate: 1040, laborUnit: 'days', laborTotal: 104 },
        { name: 'Equipment Hire', multiplier: 1, laborHours: 0, laborRate: 1040, laborUnit: 'days', laborTotal: 0 },
      ],
      materials: [],
      job: { estimatedHours: 16 }, // 2.5 + 0.2 = 2.7 days = 21.6h, drift 5.6
    };
    const issues = codes(checkDocumentIntegrity(doc));
    expect(issues).toContain('section_zero_labour'); // Equipment Hire
    expect(issues).toContain('estimated_hours_drift');
    expect(issues).not.toContain('section_total_mismatch');
    expect(issues).not.toContain('labour_total_mismatch');
  });
});

describe('checkDocumentIntegrity — not GST-registered', () => {
  function buildNotRegistered(over: Partial<any> = {}): any {
    // Same $300 doc as buildClean but gstRegistered=false: no GST, total = subtotal.
    return buildClean({ gstRegistered: false, gst: 0, total: 300, ...over });
  }

  it('accepts total = subtotal-with-markup and gst = 0', () => {
    expect(checkDocumentIntegrity(buildNotRegistered())).toEqual([]);
  });

  it('accepts markup composing without any 10%', () => {
    // 300 subtotal + 10% material markup on $100 materials = $10 → total 310
    expect(checkDocumentIntegrity(buildNotRegistered({ markup: 10, markupAmount: 10, total: 310 }))).toEqual([]);
  });

  it('flags total_mismatch when a non-registered doc still carries a +10% total', () => {
    const issues = checkDocumentIntegrity(buildNotRegistered({ total: 330 }));
    expect(codes(issues)).toContain('total_mismatch');
  });

  it('flags a non-zero stored gst on a non-registered doc', () => {
    const issues = checkDocumentIntegrity(buildNotRegistered({ gst: 30, total: 300 }));
    expect(codes(issues)).toContain('total_mismatch');
    expect(issues.find((i) => i.detail.includes('not-GST-registered'))).toBeTruthy();
  });

  it('undefined gstRegistered still means registered (legacy docs)', () => {
    // buildClean has no gstRegistered — the exclusive +10% expectation must hold.
    expect(checkDocumentIntegrity(buildClean())).toEqual([]);
    expect(codes(checkDocumentIntegrity(buildClean({ total: 300 })))).toContain('total_mismatch');
  });
});

// Labour units ----------------------------------------------------------------

describe('checkDocumentIntegrity — labour units and rate sanity', () => {
  // The state that produced the Aug 2026 ×8 inflation: one document holding
  // two unit systems. Every damaged quote passed checks 1-9 because a doubled
  // rate is still internally consistent — these are the checks that catch it.
  const sectioned = (sections: any[], over: Partial<any> = {}) => buildClean({
    laborHours: 0,
    laborTotal: sections.reduce((s, x) => s + x.laborTotal, 0),
    subtotal: 100 + sections.reduce((s, x) => s + x.laborTotal, 0),
    gst: (100 + sections.reduce((s, x) => s + x.laborTotal, 0)) * 0.1,
    total: (100 + sections.reduce((s, x) => s + x.laborTotal, 0)) * 1.1,
    sections,
    job: { estimatedHours: Math.round(sections.reduce((s, x) => s + x.laborHours * (x.multiplier || 1) * (x.laborUnit === 'days' ? 8 : 1), 0)) },
    ...over,
  });

  it('flags sections that disagree with each other about the unit', () => {
    const issues = checkDocumentIntegrity(sectioned([
      { name: 'A', multiplier: 1, laborHours: 2, laborRate: 100, laborUnit: 'hours', laborTotal: 200 },
      { name: 'B', multiplier: 1, laborHours: 1, laborRate: 800, laborUnit: 'days', laborTotal: 800 },
    ]));
    expect(codes(issues)).toContain('mixed_labour_units');
  });

  it('flags a document whose unit disagrees with its sections', () => {
    const issues = checkDocumentIntegrity(sectioned([
      { name: 'A', multiplier: 1, laborHours: 1, laborRate: 800, laborUnit: 'days', laborTotal: 800 },
    ]));
    expect(codes(issues)).toContain('mixed_labour_units');
  });

  it('flags labour stored in days with no sections', () => {
    const issues = checkDocumentIntegrity(buildClean({
      laborUnit: 'days', laborRate: 800, laborHours: 0.25, laborTotal: 200,
    }));
    expect(codes(issues)).toContain('mixed_labour_units');
  });

  it('passes a canonical hours document', () => {
    expect(codes(checkDocumentIntegrity(sectioned([
      { name: 'A', multiplier: 1, laborHours: 2, laborRate: 100, laborUnit: 'hours', laborTotal: 200 },
    ])))).not.toContain('mixed_labour_units');
  });

  it('flags an effective rate 8× the business rate (QU-178558 shape)', () => {
    const issues = checkDocumentIntegrity(sectioned([
      { name: 'Roof Tiles', multiplier: 1, laborHours: 5, laborRate: 680, laborUnit: 'hours', laborTotal: 3400 },
    ]), { businessHourlyRate: 85 });
    const hit = issues.find((i) => i.code === 'labour_rate_implausible');
    expect(hit).toBeTruthy();
    expect(hit!.actual).toBe(680);
    expect(hit!.expected).toBe(85);
  });

  it('sees through a day rate when judging plausibility', () => {
    // $5,440/day is $680/h — the same bug wearing the other unit.
    const issues = checkDocumentIntegrity(sectioned([
      { name: 'Bay', multiplier: 21, laborHours: 0.19, laborRate: 5440, laborUnit: 'days', laborTotal: 21705.6 },
    ]), { businessHourlyRate: 85 });
    expect(codes(issues)).toContain('labour_rate_implausible');
  });

  it('leaves a tradie charging a genuine premium alone', () => {
    const issues = checkDocumentIntegrity(sectioned([
      { name: 'A', multiplier: 1, laborHours: 2, laborRate: 170, laborUnit: 'hours', laborTotal: 340 },
    ]), { businessHourlyRate: 85 });
    expect(codes(issues)).not.toContain('labour_rate_implausible');
  });

  it('skips the rate check when the business rate is unknown', () => {
    const issues = checkDocumentIntegrity(sectioned([
      { name: 'A', multiplier: 1, laborHours: 5, laborRate: 680, laborUnit: 'hours', laborTotal: 3400 },
    ]));
    expect(codes(issues)).not.toContain('labour_rate_implausible');
  });
});
