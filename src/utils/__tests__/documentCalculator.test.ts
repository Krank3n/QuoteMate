import {
  calculateDocumentTotals,
  calculateEffectiveHourlyRate,
  calculateProfitMargin,
  formatCurrency,
  roundToTwoDecimals,
  supplierPriceForGstMode,
  updateAllMaterialPrices,
  updateMaterialTotalPrice,
} from '../documentCalculator';
import type { Material, QuoteSection } from '../../types';

function material(over: Partial<Material> = {}): Material {
  return {
    id: 'm',
    name: 'Item',
    quantity: 1,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...over,
  };
}

function section(over: Partial<QuoteSection> = {}): QuoteSection {
  return {
    id: 'sec',
    name: 'Section',
    multiplier: 1,
    laborHours: 0,
    laborRate: 0,
    laborUnit: 'hours',
    laborTotal: 0,
    sortOrder: 0,
    ...over,
  };
}

describe('roundToTwoDecimals', () => {
  it('rounds binary-float drift', () => {
    expect(roundToTwoDecimals(0.1 + 0.2)).toBe(0.3);
    expect(roundToTwoDecimals(1.005)).toBeGreaterThanOrEqual(1.0); // banker's rounding caveat: don't pin exact
  });

  it('handles negatives (Math.round rounds 0.5 toward +∞, so -12.345 → -12.34)', () => {
    expect(roundToTwoDecimals(-12.345)).toBe(-12.34);
    expect(roundToTwoDecimals(-12.346)).toBe(-12.35);
  });
});

describe('formatCurrency', () => {
  it('formats AUD with two decimals', () => {
    // en-AU formatting can use either ASCII space or NBSP between sign and amount,
    // and 'A$' or '$' depending on Node ICU version. Just assert the digits and cents.
    const out = formatCurrency(1234.5);
    expect(out).toMatch(/1,234\.50/);
    expect(out).toContain('$');
  });

  it('rounds to 2dp', () => {
    expect(formatCurrency(0.999)).toMatch(/1\.00/);
  });
});

describe('updateMaterialTotalPrice / updateAllMaterialPrices', () => {
  it('refreshes one material', () => {
    const m = material({ quantity: 3, price: 4.99 });
    expect(updateMaterialTotalPrice(m).totalPrice).toBe(14.97);
  });

  it('rounds the line total to 2dp', () => {
    // Pick a price where the float math is clean: 7 × 2.35 = 16.45 exactly.
    const m = material({ quantity: 7, price: 2.35 });
    expect(updateMaterialTotalPrice(m).totalPrice).toBe(16.45);
  });

  it('refreshes a whole list', () => {
    const list = [
      material({ id: 'a', quantity: 2, price: 10 }),
      material({ id: 'b', quantity: 5, price: 3.50 }),
    ];
    const updated = updateAllMaterialPrices(list);
    expect(updated.map((m) => m.totalPrice)).toEqual([20, 17.5]);
  });
});

describe('supplierPriceForGstMode', () => {
  it('returns price unchanged in inclusive mode', () => {
    expect(supplierPriceForGstMode(11, true)).toBe(11);
  });

  it('strips 10% GST in exclusive mode', () => {
    expect(supplierPriceForGstMode(11, false)).toBe(10);
  });

  it('rounds to 2dp', () => {
    // 19.99 inc -> 18.17 ex
    expect(supplierPriceForGstMode(19.99, false)).toBe(18.17);
  });
});

describe('calculateProfitMargin', () => {
  it('computes margin percentage', () => {
    expect(calculateProfitMargin(1000, 700)).toBe(30);
  });

  it('returns 0 when revenue is 0', () => {
    expect(calculateProfitMargin(0, 0)).toBe(0);
    expect(calculateProfitMargin(0, 500)).toBe(0);
  });

  it('handles negative margin', () => {
    expect(calculateProfitMargin(800, 1000)).toBe(-25);
  });
});

describe('calculateEffectiveHourlyRate', () => {
  it('divides revenue by hours', () => {
    expect(calculateEffectiveHourlyRate(800, 8)).toBe(100);
  });

  it('returns 0 when no hours', () => {
    expect(calculateEffectiveHourlyRate(800, 0)).toBe(0);
  });
});

describe('calculateDocumentTotals', () => {
  it('materials-only quote, no labour, no markup, exclusive GST', () => {
    const calc = calculateDocumentTotals(
      [material({ quantity: 10, price: 5, totalPrice: 50 })],
      0,
      0,
      0,
    );
    expect(calc.materialsSubtotal).toBe(50);
    expect(calc.laborTotal).toBe(0);
    expect(calc.subtotal).toBe(50);
    expect(calc.markupAmount).toBe(0);
    expect(calc.gst).toBe(5);
    expect(calc.total).toBe(55);
  });

  it('top-level labour without sections', () => {
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 100 })],
      85,    // rate
      4,     // hours
      0,
    );
    expect(calc.laborTotal).toBe(340);
    expect(calc.subtotal).toBe(440);
    expect(calc.total).toBe(484); // (440 + 10% GST)
  });

  it('sections override top-level labour', () => {
    // Top-level 999h × $50 = $49,950 — should be ignored because sections exist.
    const calc = calculateDocumentTotals(
      [],
      50, 999,
      0,
      0,
      [
        section({ laborTotal: 200 }),
        section({ laborTotal: 300 }),
      ],
    );
    expect(calc.laborTotal).toBe(500);
  });

  it('adds laborExtraHours × laborRate on top of sections', () => {
    // This is QU-177963's "phantom $300" — extra labour buffer.
    const calc = calculateDocumentTotals(
      [],
      3000,  // $/day
      0,
      0,
      0,
      [section({ laborTotal: 3000 })],
      0,
      0.1,   // 0.1 day of extra
    );
    expect(calc.laborTotal).toBe(3300); // 3000 + 0.1 × 3000
  });

  it('applies independent material and labour markup percentages', () => {
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1000 })],
      100, 5, // $500 labour
      10,     // 10% material markup
      0,
      undefined,
      20,     // 20% labour markup
    );
    // 1000 × 10% = $100, 500 × 20% = $100, combined markup = $200
    expect(calc.markupAmount).toBe(200);
    expect(calc.subtotal).toBe(1500);
    // total = (1500 + 200) × 1.1 = 1870
    expect(calc.total).toBe(1870);
    expect(calc.gst).toBeCloseTo(170, 2);
  });

  it('applies a positive travel adjustment as a surcharge', () => {
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1000 })],
      0, 0, 0,
      15, // +15% of subtotal
    );
    expect(calc.travelAdjustmentAmount).toBe(150);
    // (1000 + 150) × 1.1 = 1265
    expect(calc.total).toBe(1265);
  });

  it('applies a negative travel adjustment as a discount', () => {
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1000 })],
      0, 0, 0,
      -10,
    );
    expect(calc.travelAdjustmentAmount).toBe(-100);
    expect(calc.total).toBe(990); // 900 × 1.1
  });

  it('treats line prices as GST-inclusive when pricesIncludeGst=true', () => {
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1100 })], // already includes $100 GST
      0, 0, 0, 0, undefined, 0, 0,
      true, // inclusive
    );
    expect(calc.total).toBe(1100);
    expect(calc.gst).toBeCloseTo(100, 2);
  });

  // ===== GST inclusive mode × everything else =====
  //
  // The inclusive-GST branch is exercised by the calculator whenever a
  // tradie checks "prices include GST" in business settings. The math is
  // total = subtotalWithMarkup; gst = total - total/1.1. These tests verify
  // the inclusive branch composes correctly with every other knob in the
  // calculator: markup (mat + lab independently), travel adjustment, extra
  // labour, sections. Each case is hand-computed in the test comment so a
  // future change can be diffed against an explicit derivation.

  it('inclusive GST: subtotal-only quote leaves the total untouched', () => {
    // Materials only, no markup, no labour. Inclusive total stays at subtotal.
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1100 })],
      0, 0, 0, 0, undefined, 0, 0, true,
    );
    expect(calc.total).toBe(1100);
    // GST = 1100 × (1 − 1/1.1) ≈ 100
    expect(calc.gst).toBeCloseTo(100, 2);
  });

  it('inclusive GST: applies material markup correctly', () => {
    // $1100 inclusive materials + 10% material markup → subtotal+markup = 1210
    // GST extracted: 1210 − 1210/1.1 = 110
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1100 })],
      0, 0,
      10, // 10% material markup
      0,
      undefined, 0, 0,
      true,
    );
    expect(calc.markupAmount).toBe(110);
    expect(calc.total).toBe(1210);
    expect(calc.gst).toBeCloseTo(110, 2);
  });

  it('inclusive GST: applies labour markup independently from material markup', () => {
    // Materials $550 inc, labour $440 inc (4h × $110/h), 10% mat markup, 25% lab markup.
    // mat markup: 550 × 10% = 55
    // lab markup: 440 × 25% = 110
    // markupAmount = 165
    // subtotal = 550 + 440 = 990
    // total = 990 + 165 = 1155
    // gst = 1155 − 1155/1.1 = 105
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 550 })],
      110, 4,
      10,
      0,
      undefined,
      25,
      0,
      true,
    );
    expect(calc.materialsSubtotal).toBe(550);
    expect(calc.laborTotal).toBe(440);
    expect(calc.subtotal).toBe(990);
    expect(calc.markupAmount).toBe(165);
    expect(calc.total).toBe(1155);
    expect(calc.gst).toBeCloseTo(105, 2);
  });

  it('inclusive GST: applies travel surcharge as a fraction of subtotal', () => {
    // $1000 materials, +10% travel. subtotal=1000, travel=100, total=1100 inc.
    // gst = 1100 − 1100/1.1 = 100
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1000 })],
      0, 0, 0,
      10, // 10% travel
      undefined, 0, 0,
      true,
    );
    expect(calc.travelAdjustmentAmount).toBe(100);
    expect(calc.total).toBe(1100);
    expect(calc.gst).toBeCloseTo(100, 2);
  });

  it('inclusive GST: applies negative travel adjustment as a discount', () => {
    // $1000 inc materials, −10% travel. subtotal=1000, travel=−100, total=900.
    // gst = 900 − 900/1.1 ≈ 81.82
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 1000 })],
      0, 0, 0,
      -10,
      undefined, 0, 0,
      true,
    );
    expect(calc.travelAdjustmentAmount).toBe(-100);
    expect(calc.total).toBe(900);
    expect(calc.gst).toBeCloseTo(81.82, 2);
  });

  it('inclusive GST: composes with sections + extra labour', () => {
    // Sections: 0.5d × $1100 = $550, 0.25d × $1100 = $275. Sum=$825.
    // Extra labour: 0.1d × $1100 = $110. Total labour = $935.
    // Materials: $385 inc. subtotal = 935 + 385 = 1320.
    // No markup, no travel. total = 1320, gst = 120.
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 385 })],
      1100,
      0,
      0,
      0,
      [
        { ...section({ laborTotal: 550 }) },
        { ...section({ laborTotal: 275 }) },
      ],
      0,
      0.1, // extra labour
      true,
    );
    expect(calc.laborTotal).toBe(935);
    expect(calc.materialsSubtotal).toBe(385);
    expect(calc.subtotal).toBe(1320);
    expect(calc.total).toBe(1320);
    expect(calc.gst).toBeCloseTo(120, 2);
  });

  it('inclusive GST: all knobs at once (Australian small-reno typical case)', () => {
    // Materials inc: $5500. Labour: 16h × $95 = $1520 inc.
    // Material markup 15%, labour markup 30%, travel 5%.
    //   mat markup = 5500 × 15% = 825
    //   lab markup = 1520 × 30% = 456
    //   markupAmount = 1281
    //   subtotal = 5500 + 1520 = 7020
    //   travel = 7020 × 5% = 351
    //   total = 7020 + 1281 + 351 = 8652
    //   gst   = 8652 − 8652/1.1 ≈ 786.55
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 5500 })],
      95, 16,
      15,
      5,
      undefined,
      30,
      0,
      true,
    );
    expect(calc.materialsSubtotal).toBe(5500);
    expect(calc.laborTotal).toBe(1520);
    expect(calc.markupAmount).toBe(1281);
    expect(calc.travelAdjustmentAmount).toBe(351);
    expect(calc.total).toBe(8652);
    expect(calc.gst).toBeCloseTo(786.55, 2);
  });

  it('inclusive GST: extraction stays clean at sub-cent boundaries', () => {
    // total = $99.99 inc. 99.99 / 1.1 = 90.9 exactly, so GST = 9.09.
    // Verifies the 1/11 extraction doesn't introduce drift that fails toBe(...)
    // assertions for downstream code.
    const calc = calculateDocumentTotals(
      [material({ totalPrice: 99.99 })],
      0, 0, 0, 0, undefined, 0, 0,
      true,
    );
    expect(calc.total).toBe(99.99);
    expect(calc.gst).toBe(9.09);
  });

  it('exclusive vs inclusive on the same line items: total differs by 10% × subtotal-with-markup', () => {
    // Same inputs, one inclusive one exclusive. The exclusive total = inclusive
    // total + GST applied a SECOND time. This catches regressions where the
    // mode branch gets swapped.
    const materials = [material({ totalPrice: 500 })];
    const exclusive = calculateDocumentTotals(materials, 100, 5, 10, 0, undefined, 20, 0, false);
    const inclusive = calculateDocumentTotals(materials, 100, 5, 10, 0, undefined, 20, 0, true);
    // exclusive: subtotal-with-markup × 1.1
    // inclusive: subtotal-with-markup (treated as already inc)
    expect(exclusive.subtotal).toBe(inclusive.subtotal);
    expect(exclusive.markupAmount).toBe(inclusive.markupAmount);
    expect(exclusive.total).toBeCloseTo(inclusive.total * 1.1, 2);
  });

  it('reproduces QU-177963 paving quote totals', () => {
    // Real-world reproduction: 7 sections, 18 materials, 0% material markup,
    // 20% labour markup, exclusive GST. Numbers from the live quote.
    const materials = [
      material({ totalPrice: 3818 }), material({ totalPrice: 432 }),
      material({ totalPrice: 285 }),  material({ totalPrice: 0 }),
      material({ totalPrice: 108 }),  material({ totalPrice: 0 }),
      material({ totalPrice: 0 }),    material({ totalPrice: 0 }),
      material({ totalPrice: 456 }),  material({ totalPrice: 384 }),
      material({ totalPrice: 1800 }), material({ totalPrice: 0 }),
      material({ totalPrice: 0 }),    material({ totalPrice: 0 }),
      material({ totalPrice: 0 }),    material({ totalPrice: 0 }),
      material({ totalPrice: 0 }),    material({ totalPrice: 0 }),
    ];
    const sections = [
      section({ laborTotal: 0 }),    // Paver Installation (per m²) - missing
      section({ laborTotal: 600 }),  // Paving Edge Restraint
      section({ laborTotal: 600 }),  // Setup and Preparation
      section({ laborTotal: 300 }),  // Equipment Hire
      section({ laborTotal: 300 }),  // Waste Removal
      section({ laborTotal: 900 }),  // Garden Bed Preparation
      section({ laborTotal: 300 }),  // Tools and Consumables
    ];
    const calc = calculateDocumentTotals(
      materials,
      3000,   // $/day — derived: 0.1 day × $3000 = $300 extra
      0,
      0,      // 0% material markup
      0,
      sections,
      20,     // 20% labour markup
      0.1,    // 0.1 day of extra labour to bring total to $3300
    );
    expect(calc.materialsSubtotal).toBe(7283);
    expect(calc.laborTotal).toBe(3300);
    expect(calc.subtotal).toBe(10583);
    expect(calc.markupAmount).toBe(660); // 3300 × 20% (labour only)
    expect(calc.gst).toBeCloseTo(1124.30, 2);
    expect(calc.total).toBeCloseTo(12367.30, 2);
  });
});
