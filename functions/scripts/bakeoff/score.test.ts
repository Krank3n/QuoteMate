/**
 * Tests for the bake-off's deterministic scorers.
 *
 * These matter more than most tests in this repo: the scorers are the ruler the
 * whole "is the app better than asking Claude?" conclusion rests on. A silent
 * scoring bug does not crash — it produces a confident, wrong answer. Two of
 * these cases are regressions for scoring bugs that did exactly that during the
 * first runs (the item:"unknown" key collision, and fallback-priced rows being
 * counted as unverifiable coverage rather than as having no SKU at all).
 */

import { describe, it, expect } from 'vitest';
import { baseUnit, realCostToCover, scoreLine, scoreArm } from './score';
import { factsKey } from './productFacts';
import { normaliseLabel } from './scopeCoverage';
import { ProductFacts, QuoteLine, ScraperProduct } from './types';

const facts = (over: Partial<ProductFacts> & { productName: string }): ProductFacts => ({
  yieldAmount: 1,
  yieldUnit: 'each',
  piecesPerPurchase: null,
  confidence: 'high',
  ...over,
});

const line = (over: Partial<QuoteLine>): QuoteLine => ({
  name: 'x',
  requiredQty: 1,
  requiredUnit: 'each',
  quantity: 1,
  unit: 'each',
  unitPrice: 10,
  totalPrice: 10,
  priceSource: 'scraped',
  ...over,
});

describe('baseUnit', () => {
  it('collapses purchase units onto each, leaves measures alone', () => {
    expect(baseUnit('pack')).toBe('each');
    expect(baseUnit('box')).toBe('each');
    expect(baseUnit('each')).toBe('each');
    expect(baseUnit('kg')).toBe('kg');
    expect(baseUnit('m²')).toBe('m²');
  });
});

describe('factsKey', () => {
  it('does not key on the scraper\'s literal "unknown" item number', () => {
    // Regression: the scraper returns itemNumber:"unknown" for unidentified
    // products, which collapsed every such SKU onto one cache entry — a tiling
    // sponge inherited a multi-tool blade's pack facts and coverage scoring
    // silently went wrong for a whole run.
    const a = factsKey({ itemNumber: 'unknown', productName: 'Rawlplug Tiling Sponge' });
    const b = factsKey({ itemNumber: 'unknown', productName: 'Makita Carbide Blade' });
    expect(a).not.toBe(b);
    expect(a).toBe('name:rawlplug tiling sponge');
  });

  it('keys on a genuine item number when there is one', () => {
    expect(factsKey({ itemNumber: '0097689', productName: 'Dingo 20kg Concrete' })).toBe('item:0097689');
  });
});

describe('coverage', () => {
  const factsMap = (f: ProductFacts) => new Map([[factsKey(f as any), f]]);

  it('passes a correct bag count for a bulk requirement', () => {
    const f = facts({ productName: 'Dingo 20kg Concrete Mix', itemNumber: '1', yieldAmount: 20, yieldUnit: 'kg' });
    const s = scoreLine(
      line({ requiredQty: 440, requiredUnit: 'kg', quantity: 22, unit: 'pack', unitPrice: 14.44, totalPrice: 317.68, productName: f.productName, itemNumber: '1' }),
      factsMap(f),
      [],
    );
    expect(s.coverage).toBe('ok');
    expect(s.coverageRatio).toBe(1);
  });

  it('catches the under-buy that ships half the concrete', () => {
    const f = facts({ productName: 'Dingo 20kg Concrete Mix', itemNumber: '1', yieldAmount: 20, yieldUnit: 'kg' });
    const s = scoreLine(
      line({ requiredQty: 440, requiredUnit: 'kg', quantity: 11, unit: 'pack', unitPrice: 14.44, totalPrice: 158.84, productName: f.productName, itemNumber: '1' }),
      factsMap(f),
      [],
    );
    expect(s.coverage).toBe('under');
    expect(s.coverageRatio).toBe(0.5);
  });

  it('catches the bag-price-per-kilo blow-out as a gross over-buy', () => {
    // 440 "bags" against a 440 kg requirement — the QU-178692 family.
    const f = facts({ productName: 'Dingo 20kg Concrete Mix', itemNumber: '1', yieldAmount: 20, yieldUnit: 'kg' });
    const s = scoreLine(
      line({ requiredQty: 440, requiredUnit: 'kg', quantity: 440, unit: 'pack', unitPrice: 14.44, totalPrice: 6353.6, productName: f.productName, itemNumber: '1' }),
      factsMap(f),
      [],
    );
    expect(s.coverage).toBe('over');
    expect(s.coverageRatio).toBe(20);
  });

  it('uses pieces per pack when the requirement is a piece count', () => {
    const f = facts({ productName: 'All Set Microfibre Cloths - 20 Pack', itemNumber: '2', yieldAmount: 20, yieldUnit: 'each', piecesPerPurchase: 20 });
    const s = scoreLine(
      line({ requiredQty: 10, requiredUnit: 'each', quantity: 1, unit: 'pack', unitPrice: 5.91, totalPrice: 5.91, productName: f.productName, itemNumber: '2' }),
      factsMap(f),
      [],
    );
    expect(s.coverage).toBe('ok');
  });

  it('reports no-sku (not unknown) for a fallback-priced row', () => {
    // Regression: flat trade-table estimates have no product behind them. They
    // were scoring as "unknown", which read as a measurement gap rather than
    // what it is — money with nothing to verify it against.
    const s = scoreLine(line({ productName: undefined, priceSource: 'estimated', unitPrice: 55, totalPrice: 55 }), new Map(), []);
    expect(s.coverage).toBe('no-sku');
  });

  it('reports unpriced for a $0 row', () => {
    const s = scoreLine(line({ unitPrice: 0, totalPrice: 0, priceSource: 'unpriced' }), new Map(), []);
    expect(s.coverage).toBe('unpriced');
  });

  it('flags broken line arithmetic', () => {
    const s = scoreLine(line({ quantity: 3, unitPrice: 10, totalPrice: 25 }), new Map(), []);
    expect(s.arithmeticOk).toBe(false);
  });
});

describe('realCostToCover', () => {
  it('takes the median over unit-compatible candidates only', () => {
    const cands: ScraperProduct[] = [
      { productName: '20kg bag', itemNumber: 'a', price: 10 },
      { productName: '20kg bag premium', itemNumber: 'b', price: 20 },
      // Incompatible: a tool, not a mass. Must be ignored, not averaged in.
      { productName: 'trowel', itemNumber: 'c', price: 500 },
    ];
    const f = new Map<string, ProductFacts>([
      [factsKey({ itemNumber: 'a', productName: '20kg bag' }), facts({ productName: '20kg bag', yieldAmount: 20, yieldUnit: 'kg' })],
      [factsKey({ itemNumber: 'b', productName: '20kg bag premium' }), facts({ productName: '20kg bag premium', yieldAmount: 20, yieldUnit: 'kg' })],
      [factsKey({ itemNumber: 'c', productName: 'trowel' }), facts({ productName: 'trowel' })],
    ]);
    // 100 kg needs 5 x 20kg. Candidates cost 5*10=50 and 5*20=100 -> median 75.
    const { cost } = realCostToCover(line({ requiredQty: 100, requiredUnit: 'kg' }), cands, f);
    expect(cost).toBe(75);
  });

  it('ignores a candidate that would need to be bought hundreds of times', () => {
    // Regression: a $236 nail GUN was read as yielding one nail, so covering a
    // 340-nail requirement "really cost" $80,240 — which swamped the whole
    // job's price-realism figure and made every arm look arbitrary.
    const cands: ScraperProduct[] = [
      { productName: 'Paslode Framing Nailer', itemNumber: 'gun', price: 236 },
      { productName: 'Framing Nails 90mm 1000 Pack', itemNumber: 'box', price: 40 },
    ];
    const f = new Map<string, ProductFacts>([
      [factsKey({ itemNumber: 'gun', productName: 'Paslode Framing Nailer' }), facts({ productName: 'Paslode Framing Nailer' })],
      [
        factsKey({ itemNumber: 'box', productName: 'Framing Nails 90mm 1000 Pack' }),
        facts({ productName: 'Framing Nails 90mm 1000 Pack', yieldAmount: 1000, piecesPerPurchase: 1000 }),
      ],
    ]);
    const { cost } = realCostToCover(line({ requiredQty: 340, requiredUnit: 'each' }), cands, f);
    expect(cost).toBe(40);
  });

  it('drops a candidate priced far above the cheapest sensible option', () => {
    const cands: ScraperProduct[] = [
      { productName: 'bag A', itemNumber: 'a', price: 10 },
      { productName: 'bag B', itemNumber: 'b', price: 900 },
    ];
    const f = new Map<string, ProductFacts>([
      [factsKey({ itemNumber: 'a', productName: 'bag A' }), facts({ productName: 'bag A', yieldAmount: 20, yieldUnit: 'kg' })],
      [factsKey({ itemNumber: 'b', productName: 'bag B' }), facts({ productName: 'bag B', yieldAmount: 20, yieldUnit: 'kg' })],
    ]);
    // 5 purchases each: $50 vs $4500. The dear one is >5x and is discarded.
    const { cost } = realCostToCover(line({ requiredQty: 100, requiredUnit: 'kg' }), cands, f);
    expect(cost).toBe(50);
  });

  it('returns null when nothing is unit-compatible', () => {
    const cands: ScraperProduct[] = [{ productName: 'trowel', itemNumber: 'c', price: 30 }];
    const f = new Map<string, ProductFacts>([
      [factsKey({ itemNumber: 'c', productName: 'trowel' }), facts({ productName: 'trowel' })],
    ]);
    const { cost } = realCostToCover(line({ requiredQty: 100, requiredUnit: 'kg' }), cands, f);
    expect(cost).toBeNull();
  });
});

describe('scoreArm', () => {
  it('counts defects and reports the median cost ratio', () => {
    const scores = [
      { name: 'a', coverageRatio: 1, coverage: 'ok' as const, costRatio: 1.0, realCost: 100, lineTotal: 100, arithmeticOk: true, priceSource: 'scraped' as const },
      { name: 'b', coverageRatio: 0.5, coverage: 'under' as const, costRatio: 0.5, realCost: 100, lineTotal: 50, arithmeticOk: true, priceSource: 'scraped' as const },
      { name: 'c', coverageRatio: null, coverage: 'no-sku' as const, costRatio: 4.0, realCost: 25, lineTotal: 100, arithmeticOk: true, priceSource: 'estimated' as const },
    ];
    const s = scoreArm('app', scores, 250);
    expect(s.underBuy).toBe(1);
    expect(s.coverageOk).toBe(1);
    expect(s.noSkuLines).toBe(1);
    // 0.5 is at the boundary (not < 0.5), 4.0 is over 2.0 -> one way-off line.
    expect(s.costWayOff).toBe(1);
    expect(s.medianCostRatio).toBe(1.0);
    expect(s.realSubtotalOnComparable).toBe(225);
  });
});

describe('normaliseLabel', () => {
  it('accepts both the bare letter and the "Quote X" form models actually emit', () => {
    // Regression: an unmatched label silently attributed a work item to no arm,
    // so a whole job scored 0/4 for everyone and vanished from the totals.
    expect(normaliseLabel('A')).toBe('A');
    expect(normaliseLabel('Quote A')).toBe('A');
    expect(normaliseLabel(' quote d ')).toBe('D');
    expect(normaliseLabel(undefined)).toBe('');
  });
});
