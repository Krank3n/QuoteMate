/**
 * "Make the total $1,232" — the pure planner behind propose_set_total.
 *
 * The fixture is INV-004 from the electrician's conversation of 3 Sep 2026:
 * $549 of gear, three hourly sections worth $702, 30% material markup, no
 * GST (not registered). Mate read out $1,260 and then $1,416 while the tradie
 * wanted $1,232, and the invoice went out at $1,360.80 by hand.
 */
import { describe, it, expect } from 'vitest';
import { applySetTotal, describeSetTotalPlan, planSetTotal, DISCOUNT_NAME, PRICE_ADJUSTMENT_NAME } from '../setTotal';
import { updateDocumentCalculations } from '../documentCalculator';
import { checkDocumentIntegrity } from '../../../shared/document/integrityCheck';
import type { Material, QuoteSection } from '../../types';
import type { Document } from '../../types/document';

function material(over: Partial<Material> = {}): Material {
  return {
    id: over.id ?? 'm1',
    name: 'Switchboard enclosure 24-pole',
    quantity: 1,
    unit: 'each',
    price: 549,
    totalPrice: 549,
    manualPriceOverride: false,
    ...over,
  } as Material;
}

function hourly(id: string, hours: number, multiplier = 1): QuoteSection {
  return {
    id,
    name: `Section ${id}`,
    multiplier,
    laborHours: hours,
    laborHoursTotal: hours * multiplier,
    laborRate: 90,
    laborUnit: 'hours',
    laborTotal: hours * multiplier * 90,
    sortOrder: 0,
  };
}

function lump(id: string, total: number): QuoteSection {
  return { id, name: `Lump ${id}`, multiplier: 1, laborHours: 0, laborHoursTotal: 0, laborRate: 0, laborUnit: 'hours', laborTotal: total, sortOrder: 0, pricing: 'lumpSum' };
}

/** INV-004: $549 gear, $702 labour (4.5 + 2 + 1.3 h at $90), 30% markup, no GST. */
function inv004(over: Partial<Document> = {}): Document {
  return updateDocumentCalculations({
    id: 'inv-004',
    type: 'invoice',
    materials: [material()],
    sections: [hourly('a', 4.5), hourly('b', 0.2, 10), hourly('c', 1.3)],
    laborRate: 90,
    laborHours: 7.8,
    laborExtraHours: 0,
    markup: 30,
    laborMarkup: 0,
    pricesIncludeGst: false,
    gstRegistered: false,
    ...over,
  } as unknown as Document);
}

const settle = (doc: Document, target: number) => {
  const result = applySetTotal(doc, target);
  if (!result.ok) throw new Error(result.message);
  const next = updateDocumentCalculations({ ...doc, ...result.patch } as Document);
  return { result, next };
};

describe('planSetTotal', () => {
  it('INV-004 is the fixture it claims to be', () => {
    expect(inv004().total).toBe(1415.7);
  });

  it('absorbs the difference in labour when the document has hourly labour', () => {
    const plan = planSetTotal(inv004(), 1232);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan).toMatchObject({ mechanism: 'labour', via: 'extraHours', currentTotal: 1415.7, targetTotal: 1232, labourBefore: 702, labourAfter: 518.3 });
  });

  it('says so when the total is already there', () => {
    const plan = planSetTotal(inv004(), 1415.7);
    expect(plan.ok && plan.plan.mechanism).toBe('none');
  });

  it('refuses a target under the materials, naming the floor in a plain sentence', () => {
    const plan = planSetTotal(inv004(), 400);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('below_materials');
    expect(plan.floor).toBe(549);
    expect(plan.message).toBe("That's under the materials — they come to $549.00 on their own, so $549.00 is as low as this one goes.");
  });

  it('the materials floor counts the gear, not lump-sum lines', () => {
    const doc = inv004({
      materials: [material({ price: 100, totalPrice: 100 }), material({ id: 'w', name: 'Callout', kind: 'work', price: 1000, totalPrice: 1000, manualPriceOverride: true })],
    });
    const plan = planSetTotal(doc, 150);
    expect(plan.ok).toBe(true);
  });

  it('refuses nonsense targets', () => {
    expect(planSetTotal(inv004(), 0).ok).toBe(false);
    expect(planSetTotal(inv004(), Number.NaN).ok).toBe(false);
  });
});

describe('applySetTotal — hourly labour', () => {
  it('lands exactly on $1,232 with no GST, by moving labour through extra hours', () => {
    const { result, next } = settle(inv004(), 1232);
    expect(result.plan.mechanism).toBe('labour');
    expect(next.total).toBe(1232);
    expect(next.laborTotal).toBe(518.3);
    expect(next.laborExtraHours).toBeLessThan(0);
    // Sections are untouched — the tradie's per-section hours survive.
    expect(next.sections!.map((s) => s.laborTotal)).toEqual([405, 180, 117]);
    // Materials and their markup are untouched.
    expect(next.materialsSubtotal).toBe(549);
    expect(next.markupAmount).toBe(164.7);
  });

  it('lands exactly on the customer-facing figure in exclusive-GST mode (target ÷ 1.1 moves)', () => {
    const doc = inv004({ gstRegistered: true, pricesIncludeGst: false });
    expect(doc.total).toBe(1557.27);
    const { next } = settle(doc, 1400);
    expect(next.total).toBe(1400);
    expect(next.gst).toBe(127.27);
  });

  it('lands exactly on the figure in inclusive-GST mode (no conversion, GST disclosed as 1/11)', () => {
    const doc = inv004({ gstRegistered: true, pricesIncludeGst: true });
    expect(doc.total).toBe(1415.7);
    const { next } = settle(doc, 1232);
    expect(next.total).toBe(1232);
    expect(next.gst).toBe(112);
  });

  it('solves through labour markup and the travel percentage rather than moving labour naively', () => {
    const doc = inv004({ laborMarkup: 20, travelAdjustment: 5 });
    const { result, next } = settle(doc, 1300);
    expect(result.plan.mechanism).toBe('labour');
    expect(next.total).toBe(1300);
  });

  it('moves the hours field when there are no sections', () => {
    const doc = inv004({ sections: [], laborHours: 8 });
    expect(doc.laborTotal).toBe(720);
    const { result, next } = settle(doc, 1232);
    expect(result.plan).toMatchObject({ mechanism: 'labour', via: 'hours' });
    expect(next.total).toBe(1232);
    expect(next.laborHours).toBeCloseTo((720 - (1433.7 - 1232)) / 90, 6);
  });

  it('uses the sections\' rate when the document never had one stamped, instead of falling to a Discount line', () => {
    const doc = inv004({ laborRate: 0 });
    expect(doc.laborTotal).toBe(702);
    const { result, next } = settle(doc, 1232);
    expect(result.plan.mechanism).toBe('labour');
    expect(next.total).toBe(1232);
    expect(next.laborRate).toBe(90);
    expect(next.materials.some((m) => m.kind === 'work')).toBe(false);
  });

  it('can raise the total as well as lower it', () => {
    const { next } = settle(inv004(), 1600);
    expect(next.total).toBe(1600);
    expect(next.laborExtraHours).toBeGreaterThan(0);
  });

  it('never takes labour below zero — the adjustment line carries a bigger cut instead', () => {
    const doc = inv004({ sections: [hourly('a', 1)], laborHours: 1 }); // $90 labour, total 803.7
    expect(doc.total).toBe(803.7);
    const { result, next } = settle(doc, 600);
    expect(result.plan).toMatchObject({ mechanism: 'adjustment', existing: false, amount: -203.7 });
    expect(next.total).toBe(600);
    expect(next.laborTotal).toBe(90);
    // Money off is a "Discount" on the customer's copy, not a "Price adjustment".
    const line = next.materials.find((m) => m.name === DISCOUNT_NAME)!;
    expect(line).toMatchObject({ kind: 'work', quantity: 1, unit: 'each', price: -203.7, totalPrice: -203.7, manualPriceOverride: true, pricingSource: 'manual' });
    expect(next.materials.find((m) => m.name === PRICE_ADJUSTMENT_NAME)).toBeUndefined();
  });
});

describe('applySetTotal — lump sums and the adjustment line', () => {
  it('moves the biggest lump-sum section when labour is all lump sums (a rate-card job)', () => {
    const doc = inv004({ materials: [], sections: [lump('x', 300), lump('y', 500)], laborHours: 0 });
    expect(doc.total).toBe(800);
    const { result, next } = settle(doc, 700);
    expect(result.plan).toMatchObject({ mechanism: 'labour', via: 'lumpSum', sectionId: 'y' });
    expect(next.total).toBe(700);
    expect(next.sections!.find((s) => s.id === 'y')!.laborTotal).toBe(400);
    expect(next.sections!.find((s) => s.id === 'x')!.laborTotal).toBe(300);
  });

  it('adds one lump-sum line when there is no labour to absorb it — a "Discount" for money off', () => {
    const doc = inv004({ sections: [], laborHours: 0 }); // 549 + 164.7 = 713.7
    expect(doc.total).toBe(713.7);
    const { result, next } = settle(doc, 650);
    expect(result.plan).toMatchObject({ mechanism: 'adjustment', existing: false, amount: -63.7 });
    expect(next.total).toBe(650);
    expect(next.materials.filter((m) => m.name === DISCOUNT_NAME)).toHaveLength(1);
    // Markup must not apply to the adjustment: 549 × 30% is still the whole markup.
    expect(next.markupAmount).toBe(164.7);
  });

  it('a "Price adjustment" for money on, renamed to "Discount" if a later set-total takes it below zero', () => {
    const doc = inv004({ sections: [], laborHours: 0 });
    const up = settle(doc, 800).next;
    expect(up.materials.find((m) => m.name === PRICE_ADJUSTMENT_NAME)).toMatchObject({ price: 86.3 });
    const down = settle(up, 650).next;
    expect(down.materials.filter((m) => m.kind === 'work')).toHaveLength(1);
    expect(down.materials.find((m) => m.name === DISCOUNT_NAME)).toMatchObject({ price: -63.7 });
    expect(down.total).toBe(650);
  });

  it('reads an existing adjustment line by its total — a legacy row with a quantity lands the target, not $54.97 off', () => {
    const doc = inv004({
      sections: [],
      laborHours: 0,
      materials: [material({ price: 500, totalPrice: 500 }), material({ id: 'd', name: DISCOUNT_NAME, kind: 'work', quantity: 2, price: -50, totalPrice: -100, manualPriceOverride: true })],
    });
    // 500 + 150 markup - 100 = 550
    expect(doc.total).toBe(550);
    const { next } = settle(doc, 700);
    expect(next.total).toBe(700);
    expect(next.materials.filter((m) => m.kind === 'work')).toHaveLength(1);
    expect(next.materials.find((m) => m.kind === 'work')).toMatchObject({ name: PRICE_ADJUSTMENT_NAME, quantity: 1, price: 50, totalPrice: 50 });
  });

  it('moves the existing adjustment line on a second set-total instead of stacking another', () => {
    const doc = inv004({ sections: [], laborHours: 0 });
    const first = settle(doc, 650).next;
    const { result, next } = settle(first, 700);
    expect(result.plan).toMatchObject({ mechanism: 'adjustment', existing: true, amount: -13.7 });
    expect(next.total).toBe(700);
    expect(next.materials.filter((m) => m.kind === 'work')).toHaveLength(1);
  });

  it('hits an awkward exclusive-GST target to the cent through a typed adjustment', () => {
    const doc = inv004({ sections: [], laborHours: 0, gstRegistered: true, pricesIncludeGst: false });
    expect(doc.total).toBe(785.07);
    for (const target of [1000, 999.99, 1233.33, 786.01]) {
      const { next } = settle(doc, target);
      expect(next.total).toBe(target);
    }
  });

  it('hits an awkward target through a lump-sum section with a travel percentage on', () => {
    const doc = inv004({ materials: [], sections: [lump('x', 800)], laborHours: 0, travelAdjustment: 7, gstRegistered: true, pricesIncludeGst: false });
    const { next } = settle(doc, 1001.01);
    expect(next.total).toBe(1001.01);
  });
});

describe('describeSetTotalPlan', () => {
  it('names the labour without quantifying it — the figure on the quote rolls markup in', () => {
    const down = planSetTotal(inv004(), 1232);
    const up = planSetTotal(inv004(), 1600);
    expect(down.ok && describeSetTotalPlan(down.plan)).toBe('off the labour');
    expect(up.ok && describeSetTotalPlan(up.plan)).toBe('onto the labour');
  });

  it('names the adjustment line by its sign', () => {
    const doc = inv004({ sections: [], laborHours: 0 });
    const off = planSetTotal(doc, 650);
    const on = planSetTotal(doc, 800);
    expect(off.ok && describeSetTotalPlan(off.plan)).toBe(`a new "${DISCOUNT_NAME}" line at -$63.70`);
    expect(on.ok && describeSetTotalPlan(on.plan)).toBe(`a new "${PRICE_ADJUSTMENT_NAME}" line at $86.30`);
  });
});

describe('applySetTotal keeps the integrity check quiet', () => {
  const quiet = (doc: Document) => checkDocumentIntegrity(doc, { businessHourlyRate: 90 }).map((i) => i.code);

  it('after a labour move', () => {
    const { next } = settle(inv004(), 1232);
    expect(quiet(next)).toEqual([]);
  });

  it('after a lump-sum move', () => {
    const doc = inv004({ materials: [], sections: [lump('x', 800)], laborHours: 0 });
    expect(quiet(settle(doc, 700).next)).toEqual([]);
  });

  it('after an adjustment line', () => {
    const doc = inv004({ sections: [], laborHours: 0 });
    expect(quiet(settle(doc, 650).next)).toEqual([]);
  });
});

// The bug audit's repro: the first solve works from the ROUNDED current total
// and the rounded labour delta, so labour markup, travel or exclusive GST
// scaled the move a cent off. 1,575 misses in a 5,856-cell sweep before the
// residual passes; the hourly path is continuous, so it must be exact.
describe('applySetTotal lands to the cent through every scaling factor', () => {
  it('the audit repro: $549.37 gear, 7.5% travel, no GST, target $1,233.33', () => {
    const doc = inv004({ materials: [material({ price: 549.37, totalPrice: 549.37 })], markup: 0, laborMarkup: 0, travelAdjustment: 7.5 });
    expect(doc.total).toBe(1345.22);
    const { result, next } = settle(doc, 1233.33);
    expect(result.total).toBe(1233.33);
    expect(next.total).toBe(1233.33);
  });

  it('sweeps GST modes × markup × labour markup × travel × awkward targets — hourly labour is always exact', () => {
    const modes = [
      { gstRegistered: false, pricesIncludeGst: false },
      { gstRegistered: true, pricesIncludeGst: false },
      { gstRegistered: true, pricesIncludeGst: true },
    ];
    let cells = 0;
    for (const mode of modes) {
      for (const markup of [0, 30]) {
        for (const laborMarkup of [0, 20]) {
          for (const travelAdjustment of [0, 7.5]) {
            const doc = inv004({ ...mode, markup, laborMarkup, travelAdjustment, materials: [material({ price: 549.37, totalPrice: 549.37 })] });
            for (const target of [1233.33, 1234.01, 1250, 1299.99, 1301.07, 1400.5, 1555.55, 1600]) {
              // Only hourly-labour moves are tested here; a target the labour can't
              // reach (below zero) falls to the typed adjustment line by design.
              const plan = planSetTotal(doc, target);
              if (!plan.ok || plan.plan.mechanism !== 'labour') continue;
              const { next } = settle(doc, target);
              expect(next.total, `${JSON.stringify(mode)} mk${markup} lm${laborMarkup} tv${travelAdjustment} → ${target}`).toBe(target);
              cells++;
            }
          }
        }
      }
    }
    expect(cells).toBeGreaterThan(150);
  });

  it('reports the total it actually stored when a typed adjustment line cannot reach the target', () => {
    // Exclusive GST: a cent on a typed line is 1.1c at the bottom, so some
    // targets sit between two reachable totals. `total` is the truth then.
    const doc = inv004({ sections: [], laborHours: 0, gstRegistered: true, pricesIncludeGst: false });
    let nearest = 0;
    for (const target of [786.01, 786.02, 786.03, 786.04, 786.05, 786.06, 786.07, 786.08, 786.09]) {
      const { result, next } = settle(doc, target);
      expect(next.total).toBe(result.total);
      expect(Math.abs(next.total - target)).toBeLessThan(0.02);
      if (next.total !== target) nearest++;
    }
    expect(nearest).toBeLessThanOrEqual(3);
  });
});
