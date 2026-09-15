import { describe, expect, it } from 'vitest';
import { applyPackAwarePricing, perUnitSale } from './packAwarePricing';
import { Material } from '../types';

function mat(quantity: number, unit: Material['unit'], price = 12): Material {
  return {
    id: 'm1',
    name: 'Rapid Set Concrete',
    quantity,
    unit,
    price,
    totalPrice: quantity * price,
    manualPriceOverride: false,
  } as Material;
}

describe('applyPackAwarePricing', () => {
  it('converts each-count length products when the requested each has a nominal length', () => {
    const m = mat(2, 'each', 18.57);
    m.name = 'Sliding Gate Track 3m';
    applyPackAwarePricing(m, {
      productName: 'Richmond 1m Bolt Down Gate Track for Sliding Gates',
      packSize: 1,
      packUnit: 'm',
    });
    expect(m.quantity).toBe(6);
    expect(m.unit).toBe('each');
    expect(m.packSize).toBe(1);
    expect(m.packUnit).toBe('m');
  });

  it('prefers compatible title pack info over incompatible scraper yield metadata', () => {
    const m = mat(240, 'kg', 12.48);
    applyPackAwarePricing(m, {
      productName: 'Dingo 10kg Fast Set Hi-Strength Concrete',
      packSize: 1.1,
      packUnit: 'L',
    });
    expect(m.quantity).toBe(24);
    expect(m.unit).toBe('pack');
    expect(m.packSize).toBe(10);
    expect(m.packUnit).toBe('kg');
    expect(m.totalPrice).toBe(299.52);
  });
});

/**
 * Re-pricing must not corrupt a row that already converted correctly.
 *
 * applyPackAwarePricing overwrites `material.unit` with a PURCHASE unit
 * ('pack'/'each') when it divides. It then used to re-read that same `unit` on
 * the next call to decide whether the product's pack size was compatible — so
 * a second pass over a converted row saw 'pack' (→ 'each'), compared it against
 * the product's 'kg', called them incompatible, and took the no-division branch
 * that assigns quantity = requiredQty outright.
 *
 * On the fence quote that followed QU-178692 that turned a 440 kg concrete
 * requirement into 440 BAGS — $4,048.00 of quick-set for an 11-bay fence,
 * while the identical product in a neighbouring section sat correctly at 2.
 *
 * `requiredUnit` is captured on the first pass for exactly this reason; the
 * compatibility check has to use it.
 */
describe('applyPackAwarePricing is idempotent', () => {
  const BAG = { productName: 'Rapid Set Concrete 20kg', packSize: 20, packUnit: 'kg' };

  it('keeps a 440 kg requirement at 22 bags across repeated pricing passes', () => {
    const m = mat(440, 'kg', 9.2);

    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);
    expect(m.unit).toBe('pack');
    expect(m.requiredQty).toBe(440);
    expect(m.requiredUnit).toBe('kg');

    // The re-price that used to blow it out to 440 bags.
    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);
    expect(m.unit).toBe('pack');
    expect(m.packSize).toBe(20);
    expect(m.packUnit).toBe('kg');
    expect(m.totalPrice).toBe(202.4);

    // And a third, for good measure.
    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);
  });

  it('recomputes from the requirement, not the previous pack count, when the pack size changes', () => {
    const m = mat(440, 'kg', 9.2);
    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);

    // Re-priced against a 40kg bag: 440 / 40 = 11, derived from the 440 kg
    // requirement rather than from the 22 packs now sitting in `quantity`.
    applyPackAwarePricing(m, { productName: 'Rapid Set Concrete 40kg', packSize: 40, packUnit: 'kg' });
    expect(m.quantity).toBe(11);
    expect(m.packSize).toBe(40);
  });

  it('still refuses to divide an each-requirement by a kg pack, on every pass', () => {
    // "60 each" concrete bags against a 20kg SKU must never become 3.
    const m = mat(60, 'each', 9.2);

    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(60);
    expect(m.packSize).toBeUndefined();

    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(60);
    expect(m.packSize).toBeUndefined();
  });

  it('keeps a linear each→metre conversion stable across passes', () => {
    const m = mat(7, 'each', 18);
    m.name = 'Colorbond Fence Rail 2.4m';
    const RAIL = { productName: 'Fence Rail 4.8m length', packSize: 4.8, packUnit: 'm' };

    applyPackAwarePricing(m, RAIL);
    const afterFirst = m.quantity;
    applyPackAwarePricing(m, RAIL);
    expect(m.quantity).toBe(afterFirst);
  });
});

// Regressions from the 28-29 Aug Mate audit. Each case is a real row off a real
// quote, named by what it did to the tradie's total.
describe('applyPackAwarePricing — purchase-unit invariant', () => {
  it('prices a 16m2 32-pack batt against a 21m2 requirement as 2 packs, not 21', () => {
    // QIp452Jh carport quote: 21 x $97.87 = $2,055.27 of insulation.
    const m = mat(21, 'm²', 97.87);
    m.name = 'Wall & Ceiling Insulation Batts R2.0';
    applyPackAwarePricing(m, {
      productName: 'Earthwool R2.0 Wall Batt 90mm x 430mm x 1160mm 16.0m² 32 Pack',
    });
    expect(m.quantity).toBe(2);
    expect(m.packSize).toBe(16);
    expect(m.packUnit).toBe('m²');
    expect(m.totalPrice).toBe(195.74);
  });

  it('prices an 11m underlay roll against an 8m2 requirement as one purchase, flagged', () => {
    // euBZ9wiS / QIp452Jh: 8 x $47.71 = $381.68. One roll is the honest answer.
    const m = mat(8, 'm²', 47.71);
    m.name = 'Flooring Underlay';
    applyPackAwarePricing(m, {
      productName: 'QEP 2mm 11m Silver Laminate Floating Floor Underlay',
    });
    expect(m.quantity).toBe(1);
    expect(m.unit).toBe('pack');
    expect(m.totalPrice).toBe(47.71);
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain('check it covers 8 m²');
  });

  it('treats a 1L tin as a pack rather than a per-litre price', () => {
    // ptQG8JbX: 10 x $53.95 = $539.50 charged as though $53.95 bought a litre.
    const m = mat(10, 'L', 53.95);
    m.name = 'Interior Low Sheen Paint';
    applyPackAwarePricing(m, {
      productName: 'Taubmans 1L White Low Sheen Endure Interior Walls Paint',
    });
    expect(m.quantity).toBe(10);
    expect(m.unit).toBe('pack');
    expect(m.packSize).toBe(1);
    expect(m.packUnit).toBe('L');
  });

  it('reads a 2400x1200 plywood sheet as 2.88m2 and buys one', () => {
    const m = mat(0.74, 'm²', 46);
    m.name = '12mm CD Structural Plywood';
    applyPackAwarePricing(m, {
      productName: 'Customply 2400 x 1200 x 12mm Non Structural Plywood',
    });
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBe(46);
  });

  it('flags a measurement requirement it cannot reconcile, even when it cannot repair it', () => {
    // "Gyprock Paper Joint Tape" states no roll length, so we can't know how
    // many rolls 75 m needs — but we can refuse to present it as confident.
    // (The real $2,386.50 tape row was an estimate, killed by the unit-aware
    // trade fallback rather than here.)
    const m = mat(75, 'm', 31.82);
    m.name = 'Paper Joint Tape';
    applyPackAwarePricing(m, { productName: 'Gyprock Paper Joint Tape' });
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain('check it covers 75 m');
  });

  it('leaves a genuine per-each row untouched', () => {
    const m = mat(1, 'each', 24.98);
    m.name = 'Passage Lever Door Handle';
    applyPackAwarePricing(m, { productName: 'Gainsborough Passage Lever Door Handle Set' });
    expect(m.quantity).toBe(1);
    expect(m.unit).toBe('each');
    expect(m.totalPrice).toBe(24.98);
    expect(m.priceConfidence).toBeUndefined();
  });

  it('still multiplies a counted requirement with no pack info', () => {
    const m = mat(34, 'each', 4.9);
    m.name = 'Hardwood Formwork Pegs 300mm';
    applyPackAwarePricing(m, { productName: 'Hardwood Formwork Peg' });
    expect(m.quantity).toBe(34);
    expect(m.totalPrice).toBe(166.6);
  });
});

describe('applyPackAwarePricing — an unknown product is not assumed to be one purchase', () => {
  it('keeps a lineal-metre requirement when the title states no pack at all', () => {
    // "Treated Pine Framing H3 90x45mm" carries no length. Collapsing 231 m to
    // one length would quote $23 for $1,781 of timber.
    const m = mat(231, 'm', 23.13);
    m.name = 'Treated pine joists 90x45mm H3';
    applyPackAwarePricing(m, { productName: 'Treated Pine Framing H3 90x45mm' });
    expect(m.quantity).toBe(231);
    expect(m.totalPrice).toBe(5343.03);
    expect(m.priceConfidence).toBe('low');
  });

  it('still buys one when the title proves it is a pack we could not map', () => {
    const m = mat(8, 'm²', 47.71);
    applyPackAwarePricing(m, { productName: 'QEP 2mm 11m Silver Laminate Floating Floor Underlay' });
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBe(47.71);
  });

  it('converts a stated stock length rather than flagging it', () => {
    const m = mat(231, 'm', 23.13);
    applyPackAwarePricing(m, { productName: '90 x 45mm Outdoor Framing H3 Treated Pine 3.0m' });
    expect(m.quantity).toBe(77);
    expect(m.packSize).toBe(3);
    expect(m.priceConfidence).toBeUndefined();
  });
});

describe('estimated prices state what one purchase buys (QU-178444 / QU-178571)', () => {
  /**
   * The AI price estimator returned only a price and a name. With no pack
   * evidence this fell through to multiplying the PURCHASE price by the whole
   * requirement, which is how five real quotes carried $25,051 of invented
   * money on 16 lines — a $45.90 bag of tile adhesive billed 150 times over,
   * a $189 box of Cat6 billed 35 times, a $8.50 roll of joint tape 250 times.
   * The estimator is now asked what one purchase contains.
   */
  function estimated(name: string, required: number, unit: Material['unit'], price: number): Material {
    const m = mat(required, unit, price);
    m.name = name;
    m.requiredQty = required;
    m.requiredUnit = unit;
    return m;
  }

  it('buys 2 bags of adhesive for 150 kg, not 150', () => {
    const m = estimated('Flexible cement based wall tile adhesive', 150, 'kg', 45.9);
    applyPackAwarePricing(m, { productName: 'Ardex 20kg Tile Adhesive', packSize: 20, packUnit: 'kg' });
    expect(m.quantity).toBe(8);
    expect(m.totalPrice).toBeCloseTo(45.9 * 8, 2);
  });

  it('buys 1 box of Cat6 for a 35 m run, not 35 boxes', () => {
    const m = estimated('Cat6 UTP data cable', 35, 'm', 189);
    applyPackAwarePricing(m, { productName: 'Cat6 UTP Cable 305m Box', packSize: 305, packUnit: 'm' });
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBeCloseTo(189, 2);
  });

  it('buys 3 rolls of joint tape for 250 m, not 250', () => {
    const m = estimated('Paper plasterboard joint tape 52mm', 250, 'm', 8.5);
    applyPackAwarePricing(m, { productName: 'Gyprock 90m Paper Joint Tape', packSize: 90, packUnit: 'm' });
    expect(m.quantity).toBe(3);
    expect(m.totalPrice).toBeCloseTo(25.5, 2);
  });

  // The case the multiply branch exists to protect: goods a store really does
  // price per metre. packSize 1 'm' means one purchase IS one metre, so the
  // count must stay at the requirement rather than collapsing to a single buy.
  it('still charges framing timber per lineal metre', () => {
    const m = estimated('Treated pine H3 90x45', 231, 'm', 8.9);
    applyPackAwarePricing(m, { productName: 'Treated Pine H3 90x45mm', packSize: 1, packUnit: 'm' });
    expect(m.quantity).toBe(231);
    expect(m.totalPrice).toBeCloseTo(231 * 8.9, 2);
  });

  it('leaves the old behaviour when the estimator states no pack size', () => {
    // No evidence either way — unchanged, and still flagged for the tradie.
    const m = estimated('Mystery bulk product', 40, 'm', 10);
    applyPackAwarePricing(m, { productName: 'Mystery Bulk Product' });
    expect(m.quantity).toBe(40);
    expect(m.description).toContain('check it covers');
  });
});

describe("goods sold per the requirement's own unit buy the whole requirement", () => {
  /**
   * A bulk landscaping product priced "(per cubic metre, bulk delivery)"
   * against a 3 m³ requirement came out as ONE purchase. The title carries no
   * figure for parsePackInfo to read, the estimator's "1 each" left a pack the
   * branches could not map onto m³, and a bare `!!packSize` treated that as
   * proof of a pack it had merely failed to size — so the row collapsed to a
   * single load at the per-cubic-metre price, carrying a third of the money
   * with a note asking the tradie to check it covered 3 m³.
   */
  function estimated(name: string, required: number, unit: Material['unit'], price: number): Material {
    const m = mat(required, unit, price);
    m.name = name;
    m.requiredQty = required;
    m.requiredUnit = unit;
    return m;
  }

  it('buys 3 of a per-cubic-metre product for a 3 m³ requirement, not 1', () => {
    const m = estimated('Garden mulch', 3, 'm³', 59.09);
    applyPackAwarePricing(m, {
      productName: 'Bulk Hardwood Bark Mulch (per cubic metre, bulk delivery)',
      packSize: 1,
      packUnit: 'each',
    });
    expect(m.quantity).toBe(3);
    expect(m.packSize).toBe(1);
    expect(m.packUnit).toBe('m³');
    expect(m.totalPrice).toBeCloseTo(177.27, 2);
    expect(m.description ?? '').not.toContain('one purchase');
  });

  it('reads the per-unit wording when the estimator states no pack at all', () => {
    const m = estimated('Garden mulch', 3, 'm³', 59.09);
    applyPackAwarePricing(m, { productName: 'Bulk Hardwood Bark Mulch (per cubic metre, bulk delivery)' });
    expect(m.quantity).toBe(3);
    expect(m.totalPrice).toBeCloseTo(177.27, 2);
  });

  it('rounds a per-tonne product up to whole tonnes for a kg requirement', () => {
    const m = estimated('Crusher dust', 2500, 'kg', 85);
    applyPackAwarePricing(m, { productName: 'Crusher Dust Roadbase (per tonne)' });
    expect(m.quantity).toBe(3);
    expect(m.packSize).toBe(1000);
    expect(m.packUnit).toBe('kg');
    expect(m.totalPrice).toBeCloseTo(255, 2);
  });

  it('charges per-lineal-metre, per-m² and per-litre goods by the requirement', () => {
    const timber = estimated('Framing timber', 231, 'm', 8.9);
    applyPackAwarePricing(timber, { productName: 'Framing Timber H3 90x45mm - per lineal metre' });
    expect(timber.quantity).toBe(231);

    const tiles = estimated('Floor tiles', 24, 'm²', 39);
    applyPackAwarePricing(tiles, { productName: 'Porcelain Floor Tile 600x600 $39/m2' });
    expect(tiles.quantity).toBe(24);

    const fuel = estimated('Diesel', 40, 'L', 2.1);
    applyPackAwarePricing(fuel, { productName: 'Bulk Diesel per litre', packSize: 1, packUnit: 'each' });
    expect(fuel.quantity).toBe(40);
  });

  it('lets a stated pack size beat the per-unit wording', () => {
    // "2m³ Bulk Bag" is what one purchase holds; the "$30 per m³" beside it is
    // the rate the supplier quotes. Two bags, not three cubic metres of bags.
    const m = estimated('Garden mulch', 3, 'm³', 30);
    applyPackAwarePricing(m, { productName: 'Hardwood Bark Mulch 2m³ Bulk Bag ($30 per m³)' });
    expect(m.quantity).toBe(2);
    expect(m.packSize).toBe(2);
    expect(m.totalPrice).toBeCloseTo(60, 2);
  });

  it('ignores per-unit wording in a unit the requirement is not measured in', () => {
    const m = estimated('Garden mulch', 3, 'm³', 39);
    applyPackAwarePricing(m, { productName: 'Porcelain Floor Tile 600x600 per m2' });
    expect(m.quantity).toBe(3);
    expect(m.priceConfidence).toBe('low');
  });

  it('still buys one 20 kg bag whose 3 m² coverage exceeds a 2 m² need', () => {
    const m = estimated('Tile adhesive', 2, 'm²', 45.9);
    applyPackAwarePricing(m, {
      productName: 'Flexible Tile Adhesive 20kg Bag (covers 3 m² per bag)',
      packSize: 20,
      packUnit: 'kg',
    });
    expect(m.quantity).toBe(1);
    expect(m.packSize).toBe(3);
    expect(m.totalPrice).toBeCloseTo(45.9, 2);
  });

  it('leaves a discrete piece-good counted in each untouched', () => {
    const m = estimated('Fence posts', 7, 'each', 24.5);
    applyPackAwarePricing(m, { productName: 'Treated Pine Post H4 100x100mm 2.4m', packSize: 1, packUnit: 'each' });
    expect(m.quantity).toBe(7);
    expect(m.unit).toBe('each');
    expect(m.totalPrice).toBeCloseTo(171.5, 2);
    expect(m.priceConfidence).toBeUndefined();
  });

  it('keeps the requirement, flagged, when coverage is unknown — never one purchase', () => {
    // A "1 each" pack with no per-unit wording and no figure in the title says
    // nothing about coverage. Quantity 1 silently under-quotes; the
    // requirement with the existing note is the honest answer.
    const m = estimated('Garden mulch', 3, 'm³', 59.09);
    applyPackAwarePricing(m, { productName: 'Bulk Hardwood Bark Mulch', packSize: 1, packUnit: 'each' });
    expect(m.quantity).toBe(3);
    expect(m.unit).toBe('m³');
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain('check it covers 3 m³');
  });

  it('still collapses to one purchase when the title proves a pack it cannot map', () => {
    const m = estimated('Flooring underlay', 8, 'm²', 47.71);
    applyPackAwarePricing(m, {
      productName: 'QEP 2mm 11m Silver Laminate Floating Floor Underlay',
      packSize: 1,
      packUnit: 'each',
    });
    expect(m.quantity).toBe(1);
    expect(m.description).toContain('check it covers 8 m²');
  });
});

describe('perUnitSale reads a price basis and refuses a consumption rate', () => {
  it('reads every supported per-unit spelling', () => {
    expect(perUnitSale('Bulk Hardwood Bark Mulch (per cubic metre, bulk delivery)')).toEqual({ packSize: 1, packUnit: 'm³' });
    expect(perUnitSale('Buffalo Turf sold by the square metre')).toEqual({ packSize: 1, packUnit: 'm²' });
    expect(perUnitSale('Washed River Sand (per tonne)')).toEqual({ packSize: 1000, packUnit: 'kg' });
    expect(perUnitSale('Loose Blue Metal Aggregate per kg')).toEqual({ packSize: 1, packUnit: 'kg' });
    expect(perUnitSale('Colorbond Fascia priced per-lineal-metre')).toEqual({ packSize: 1, packUnit: 'm' });
    expect(perUnitSale('Bulk Hydraulic Oil per litre')).toEqual({ packSize: 1, packUnit: 'L' });
    expect(perUnitSale('Porcelain Floor Tile $39/m2')).toEqual({ packSize: 1, packUnit: 'm²' });
  });

  it('refuses a consumption rate, which is what a figure before the "per" makes it', () => {
    // "5kg per m²" is how much a square metre eats, not what a purchase buys.
    // Read as a one-m² purchase it would buy a whole bag per square metre.
    expect(perUnitSale('Flexible Tile Adhesive 20kg — 5kg per m²')).toBeNull();
    expect(perUnitSale('Driveway Sealer 4L, 250ml per square metre')).toBeNull();
  });

  it('refuses container wording, bare slashes and lookalike words', () => {
    expect(perUnitSale('Decking Screws 100 per box')).toBeNull();
    expect(perUnitSale('Washed Sand $30 per 20kg bag')).toBeNull();
    expect(perUnitSale('Flexible Tile Adhesive 20kg/m²')).toBeNull();
    expect(perUnitSale('Exterior Paint/Lacquer Thinner')).toBeNull();
    expect(perUnitSale('Scaffold Hire per month')).toBeNull();
    expect(perUnitSale('Aluminium Angle priced per length')).toBeNull();
  });
});
