import { describe, it, expect } from 'vitest';


import {
  applyReconcileResult,
  applyLastResortGuess,
  LAST_RESORT_GUESS_PRICE,
  LAST_RESORT_GUESS_PREFIX,
} from '../../../shared/pricing/pipeline';
import { normaliseScraperProduct } from '../../../shared/pricing/scraperCandidates';
import { applyPackAwarePricing } from '../../../shared/pricing/packAwarePricing';
import type { Material } from '../../types';

/**
 * The live scraper returns `description` as an ARRAY of bullet strings, while
 * ScraperProduct declares it `string`. Nothing normalised it, so the array
 * reached material.description and applyReconcileResult fed it to
 * parsePackInfo, which called .trim() on it and threw. The pipeline's bare
 * catch then abandoned the entire reconcile pass — coverage floor, over-buy
 * clamp and category gate — with nothing logged.
 *
 * Measured over 24 real customer quotes before the fix: reconcile died on 23,
 * and only 7% of rows were ever checked. One landscaping quote priced 3000 kg
 * of underlay soil at a per-bag rate: $90,000 instead of $210.
 */
const BULLETS = [
  'Professional Grade Quality (50MPa)',
  'Unique fibre-reinforced formula resists cracking',
];

function concreteRow(): Material {
  return {
    id: 'm1',
    name: 'Concrete Mix',
    searchTerm: 'concrete mix 20kg',
    quantity: 440,
    unit: 'kg',
    requiredQty: 440,
    requiredUnit: 'kg',
    price: 14.44,
    totalPrice: 0,
    manualPriceOverride: false,
  } as Material;
}

const APPLY_22_BAGS = {
  id: 'm1',
  decision: 'apply' as const,
  chosenIndex: 0,
  purchaseCount: 22,
  purchaseUnit: 'pack',
  confidence: 'high' as const,
};

describe('normaliseScraperProduct', () => {
  it('joins the bullet array the scraper actually returns', () => {
    const out = normaliseScraperProduct({ productName: 'Dingo 20kg Concrete Mix', description: BULLETS } as never);
    expect(out.description).toBe('Professional Grade Quality (50MPa). Unique fibre-reinforced formula resists cracking');
  });

  it('leaves a string description untouched and returns the same object', () => {
    const p = { productName: 'x', description: 'already a string' } as never;
    expect(normaliseScraperProduct(p)).toBe(p);
  });

  it('survives a missing description and non-string bullets', () => {
    expect(normaliseScraperProduct({ productName: 'x' } as never).description).toBeUndefined();
    expect(normaliseScraperProduct({ productName: 'x', description: [1, 'ok', null] } as never).description).toBe('ok');
  });
});

describe('applyReconcileResult with a raw scraper description', () => {
  it('does not throw when the candidate description is an array', () => {
    // The regression itself: before the fix this threw
    // "productName.trim is not a function" and the caller's bare catch
    // silently abandoned every remaining row on the quote.
    const m = concreteRow();
    const chosen = { productName: 'Dingo 20kg Concrete Mix', description: BULLETS, price: 14.44, itemNumber: '0097689' };
    expect(() => applyReconcileResult(m, APPLY_22_BAGS, [chosen] as never, false)).not.toThrow();
  });

  it('applies the decision and keeps quantity x price === totalPrice', () => {
    const m = concreteRow();
    const chosen = normaliseScraperProduct({
      productName: 'Dingo 20kg Concrete Mix',
      description: BULLETS,
      price: 14.44,
      itemNumber: '0097689',
    } as never);
    const outcome = applyReconcileResult(m, APPLY_22_BAGS, [chosen] as never, false);
    expect(outcome).toBe('applied');
    expect(m.quantity).toBe(22);
    expect(m.totalPrice).toBeCloseTo(Number((m.quantity * m.price).toFixed(2)), 2);
  });

  it('still recovers the pack size from a normalised description', () => {
    // recoverPackInfo reads the row description as one of its sources. Once
    // normalised it is parseable again, so the coverage floor keeps its input
    // instead of the whole pass dying.
    const m = concreteRow();
    m.description = BULLETS as never;
    const normalised = normaliseScraperProduct({
      productName: 'Dingo 20kg Concrete Mix',
      description: BULLETS,
      price: 14.44,
      itemNumber: '0097689',
    } as never);
    m.description = normalised.description;
    const outcome = applyReconcileResult(m, { ...APPLY_22_BAGS, purchaseCount: 22 }, [normalised] as never, false);
    expect(outcome).toBe('applied');
    expect(m.packSize).toBe(20);
    expect(m.packUnit).toBe('kg');
  });

  it('raises an under-buy to the coverage floor — the guard the crash disabled', () => {
    // 11 x 20kg against a 440 kg requirement is half the concrete (QU-178692).
    // This only works when the pass actually runs to completion.
    const m = concreteRow();
    const chosen = normaliseScraperProduct({
      productName: 'Dingo 20kg Concrete Mix',
      description: BULLETS,
      price: 14.44,
      itemNumber: '0097689',
    } as never);
    applyReconcileResult(m, { ...APPLY_22_BAGS, purchaseCount: 11 }, [chosen] as never, false);
    expect(m.quantity).toBeGreaterThanOrEqual(22);
  });
});

describe('applyLastResortGuess', () => {
  const row = (over: Partial<Material> = {}): Material =>
    ({ id: 'x', name: 'Tip fee allowance', quantity: 1, unit: 'each', price: 0, totalPrice: 0, ...over }) as Material;

  it('never ships a $0 line', () => {
    const m = row();
    applyLastResortGuess(m, false);
    expect(m.price).toBeGreaterThan(0);
    expect(m.totalPrice).toBeGreaterThan(0);
  });

  it('prices ONE purchase, never the requirement — the bound that keeps a guess safe', () => {
    // 2,450 cup-head bolts at a $25 guess would be $61,250 of placeholder.
    const m = row({ name: 'M10 x 65mm Cup Head Bolts', quantity: 2450, unit: 'each', requiredQty: 2450, requiredUnit: 'each' });
    applyLastResortGuess(m, false);
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBe(m.price);
    expect(m.totalPrice).toBeLessThan(LAST_RESORT_GUESS_PRICE * 1.2);
  });

  it('does the same for a bulk measurement row', () => {
    const m = row({ name: 'Turf Underlay Soil', quantity: 3000, unit: 'kg', requiredQty: 3000, requiredUnit: 'kg' });
    applyLastResortGuess(m, false);
    expect(m.quantity).toBe(1);
    expect(m.unit).toBe('pack');
    expect(m.totalPrice).toBe(m.price);
  });

  it('names the requirement so the tradie can see what to replace it with', () => {
    const m = row({ name: 'Builders Film', quantity: 5, unit: 'm²', requiredQty: 5, requiredUnit: 'm²' });
    applyLastResortGuess(m, false);
    expect(m.description).toContain(LAST_RESORT_GUESS_PREFIX);
    expect(m.description).toContain('5 m²');
    expect(m.description).toMatch(/your price/i);
    expect(m.description).toMatch(/supplier list/i);
  });

  it('flags low confidence so the card shows the estimate treatment', () => {
    const m = row();
    applyLastResortGuess(m, false);
    expect(m.priceConfidence).toBe('low');
    expect(m.pricingSource).toBe('ai');
  });

  it('drops any product identity left over from a rejected match', () => {
    const m = row({ bunningsItemNumber: '0611066', productUrl: 'https://example.com/p', imageUrl: 'https://example.com/i.jpg' });
    applyLastResortGuess(m, false);
    expect(m.bunningsItemNumber).toBeUndefined();
    expect(m.productUrl).toBeUndefined();
    expect(m.imageUrl).toBeUndefined();
  });

  it('keeps quantity x price === totalPrice in GST-inclusive mode too', () => {
    const m = row();
    applyLastResortGuess(m, true);
    expect(m.totalPrice).toBeCloseTo(m.quantity * m.price, 2);
  });
});

describe('last-resort AI estimate is pack-aware', () => {
  // Regression: the sweep multiplied the estimate by the requirement, so a
  // $25.50 20kg bag of base coat against a 20 kg requirement billed $510 —
  // the same bag-price-per-kilogram shape as the $90,000 turf line. An AI
  // estimate prices ONE purchasable item and must go through
  // applyPackAwarePricing, exactly as the individual pass does.
  it('collapses a measurement requirement to one purchase, not qty x price', () => {
    const m = {
      id: 'm1',
      name: 'Plasterboard Base Coat',
      searchTerm: 'plasterboard base coat',
      quantity: 20,
      unit: 'kg',
      requiredQty: 20,
      requiredUnit: 'kg',
      price: 25.5,
      totalPrice: 0,
    } as Material;
    applyPackAwarePricing(m, { productName: 'CSR Gyprock 20kg Base Coat Compound' });
    // 20 kg requirement, 20 kg bag -> one bag, not twenty.
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBeCloseTo(25.5, 2);
    expect(m.totalPrice).toBeLessThan(100);
  });

  it('still multiplies out for a genuine piece count', () => {
    const m = {
      id: 'm2',
      name: 'Base Coat Setting Compound 20kg Bag',
      searchTerm: 'setting compound 20kg bag',
      quantity: 40,
      unit: 'each',
      requiredQty: 40,
      requiredUnit: 'each',
      price: 22.5,
      totalPrice: 0,
    } as Material;
    applyPackAwarePricing(m, { productName: 'Setting Compound 20kg Bag' });
    expect(m.quantity).toBe(40);
    expect(m.totalPrice).toBeCloseTo(900, 2);
  });
});
