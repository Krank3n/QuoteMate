/**
 * Regression: the QU-178377 475-pack over-buy.
 *
 * A real customer quote (9m × 6m garage conversion) came back with
 *
 *   Ceiling insulation batts R4.0 — needs 38 m² — buy 475 pack @ $89.90 = $42,702
 *
 * for a 38 m² ceiling. Reconcile hallucinated the purchase count and nothing
 * stopped it: insulation is neither a fastener nor a liquid, so the price-based
 * heuristics never applied, and the exact-arithmetic branch was gated on both
 * units being COUNTABLE — which m² is not. The one statement of the pack's
 * coverage ("~5m² per pack") sat in reconcile's own coverageNote, which this
 * branch copied onto the row only AFTER both guards had already run.
 *
 * The line was the single largest error in a 12-job measurement, and it is the
 * same family as the tile-adhesive and footings blow-ups: the per-unit price is
 * fine, the COUNT is wild.
 */
import { describe, it, expect } from 'vitest';


import { applyReconcileResult } from '../../../shared/pricing/pipeline';
import type { Material } from '../../types';

function batts(overrides: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'Ceiling insulation batts R4.0',
    searchTerm: 'ceiling insulation batts R4.0',
    quantity: 38,
    unit: 'm²',
    requiredQty: 38,
    requiredUnit: 'm²',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...overrides,
  } as Material;
}

/** The product came back unidentified, so it carries no structured pack info. */
const UNIDENTIFIED = [{ productName: 'Ceiling Batts R4.0', price: 89.9 } as never];

describe('applyReconcileResult — bulk-unit over-buy', () => {
  it('clamps 475 packs to the 8 that cover 38 m², using the coverage the model itself stated', () => {
    const m = batts();
    const outcome = applyReconcileResult(
      m,
      {
        id: 'm1',
        decision: 'apply',
        chosenIndex: 0,
        purchaseCount: 475,
        purchaseUnit: 'pack',
        coverageNote: 'Estimated ~5m² per pack based on standard R4.0 batt coverage.',
      },
      UNIDENTIFIED,
      true,
    );

    expect(outcome).toBe('applied');
    expect(m.quantity).toBe(8);
    // The line total must follow the clamped count, not the hallucinated one.
    expect(m.totalPrice).toBeCloseTo(89.9 * 8, 2);
    expect(m.totalPrice).toBeLessThan(1000);
  });

  it('leaves a legitimate multi-pack buy alone', () => {
    // 48 m² of wall batts from 5 m² packs really is 10 packs.
    const m = batts({
      name: 'Insulation batts R2.5 for 90mm timber external walls',
      quantity: 48,
      requiredQty: 48,
    });
    applyReconcileResult(
      m,
      {
        id: 'm1',
        decision: 'apply',
        chosenIndex: 0,
        purchaseCount: 10,
        purchaseUnit: 'pack',
        coverageNote: '5m² per pack.',
      },
      [{ productName: 'Earthwool R2.7 Wall Batt', price: 94.45 } as never],
      true,
    );
    expect(m.quantity).toBe(10);
  });

  it('does not under-buy a m³ pour priced in kg bags', () => {
    // 0.6 m³ from 20 kg bags is genuinely ~60 bags. Dividing 0.6 by 20 would
    // clamp it to 1 and leave the pour 59 bags short — the worse failure.
    const m = batts({
      name: 'Rapid set concrete mix 20kg',
      unit: 'm³',
      requiredUnit: 'm³',
      quantity: 0.6,
      requiredQty: 0.6,
    });
    applyReconcileResult(
      m,
      {
        id: 'm1',
        decision: 'apply',
        chosenIndex: 0,
        purchaseCount: 60,
        purchaseUnit: 'each',
        coverageNote: '20kg per bag.',
      },
      [{ productName: 'Rapid Set 20kg Concrete Mix', price: 10.5 } as never],
      true,
    );
    expect(m.quantity).toBe(60);
  });
});

describe('applyReconcileResult — the row must say what it is buying', () => {
  /**
   * QU-178377: "Galvanised framing bracket — needs 40 each | buy 4 each" and
   * "Masonry anchor screws — needs 70 | buy 7". The QUANTITIES were right (4
   * packs of 10, 7 packs of 10) but the unit came straight from the model's
   * `purchaseUnit`, which said 'each'. A blind estimator read the pair as
   * "systematic 10x under-buys on fixings" and refused to send the quote — and
   * a tradie reading "buy 4 each" for 40 brackets would reach the same
   * conclusion.
   */
  function bracket(): Material {
    return {
      id: 'm1',
      name: 'Galvanised framing bracket',
      searchTerm: 'galvanised framing bracket',
      quantity: 40,
      unit: 'each',
      requiredQty: 40,
      requiredUnit: 'each',
      price: 0,
      totalPrice: 0,
      manualPriceOverride: false,
    } as Material;
  }

  it("says 'pack' when a pack size explains the count, whatever the model called it", () => {
    const m = bracket();
    applyReconcileResult(
      m,
      { id: 'm1', decision: 'apply', chosenIndex: 0, purchaseCount: 4, purchaseUnit: 'each' },
      [{ productName: 'Pryda Framing Bracket - 10 Pack', price: 18.9 } as never],
      true,
    );
    expect(m.quantity).toBe(4);
    expect(m.unit).toBe('pack');
    expect(m.packSize).toBe(10);
  });

  it("calls a length pack 'each' — one 5.4 m stick is one piece, not a pack", () => {
    const m = bracket();
    m.name = 'Treated pine 90x45';
    m.unit = 'm';
    m.requiredUnit = 'm';
    m.quantity = 22;
    m.requiredQty = 22;
    applyReconcileResult(
      m,
      { id: 'm1', decision: 'apply', chosenIndex: 0, purchaseCount: 5, purchaseUnit: 'm' },
      [{ productName: 'Treated Pine H3 90x45mm 5.4m', price: 24.9 } as never],
      true,
    );
    expect(m.unit).toBe('each');
  });

  it('leaves the model\'s unit alone when no pack size explains the count', () => {
    const m = bracket();
    m.quantity = 2;
    m.requiredQty = 2;
    applyReconcileResult(
      m,
      { id: 'm1', decision: 'apply', chosenIndex: 0, purchaseCount: 2, purchaseUnit: 'each' },
      [{ productName: 'Pryda Framing Bracket', price: 4.9 } as never],
      true,
    );
    expect(m.unit).toBe('each');
  });
});
