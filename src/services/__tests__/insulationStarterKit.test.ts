import { describe, it, expect } from 'vitest';
import { insulationStarterKit } from '../starterKits/insulation';

describe('insulation starter kit', () => {
  it('contains all 11 of Jesse\'s line items', () => {
    expect(insulationStarterKit.items).toHaveLength(11);
  });

  it('uses J. Gorman Insulation as the supplier name', () => {
    expect(insulationStarterKit.supplierName).toBe('J. Gorman Insulation');
  });

  it('targets the insulation niche', () => {
    expect(insulationStarterKit.tradeNiche).toBe('insulation');
  });

  it('has a stable kit id for idempotent re-install detection', () => {
    expect(insulationStarterKit.id).toBe('insulation-v1');
  });

  it('prices R2.5 Polyester floor at $187.25 ex GST (Jesse\'s number)', () => {
    const r25polyester = insulationStarterKit.items.find((i) =>
      i.productName.toLowerCase().includes('polyester'),
    );
    expect(r25polyester).toBeDefined();
    expect(r25polyester!.price).toBe(187.25);
  });

  it('prices LED Electrician and LED Lights at $65 each (Jesse\'s number)', () => {
    const ledElec = insulationStarterKit.items.find((i) =>
      i.productName === 'LED Electrician',
    );
    const ledLights = insulationStarterKit.items.find((i) =>
      i.productName === 'LED Lights',
    );
    expect(ledElec?.price).toBe(65);
    expect(ledLights?.price).toBe(65);
  });

  it('every item has a non-empty verbatim customer description', () => {
    for (const item of insulationStarterKit.items) {
      expect(item.customerDescription.length).toBeGreaterThan(10);
      expect(item.customerDescription).not.toMatch(/\bTODO\b/);
    }
  });

  it('every item has at least one keyword for LLM matching', () => {
    for (const item of insulationStarterKit.items) {
      expect(item.keywords.length).toBeGreaterThan(0);
    }
  });

  it('every item has a valid unit', () => {
    const validUnits = new Set(['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack']);
    for (const item of insulationStarterKit.items) {
      expect(validUnits.has(item.unit)).toBe(true);
    }
  });

  it('R-value items carry an m² coverage unit so the area calc lights up', () => {
    const rValueItems = insulationStarterKit.items.filter((i) =>
      i.productName.match(/R\d/),
    );
    expect(rValueItems.length).toBeGreaterThan(5);
    for (const item of rValueItems) {
      expect(item.coverageUnit).toBe('m²');
    }
  });

  it('R7 Double Layer description references its R3.5 components', () => {
    const r7 = insulationStarterKit.items.find((i) =>
      i.productName.includes('R7 Double Layer'),
    );
    expect(r7).toBeDefined();
    expect(r7!.customerDescription).toContain('R 3.5');
    expect(r7!.customerDescription.toLowerCase()).toContain('cross weave');
  });
});
