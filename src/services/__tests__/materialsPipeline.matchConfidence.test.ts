import { describe, it, expect } from 'vitest';

// materialsPipeline pulls in the Expo/React Native module graph at import
// time (keep-awake, constants, notifications). None of it runs in this test —
// applyReconcileResult is pure — so stub the native edges out.

import { applyReconcileResult } from '../../../shared/pricing/pipeline';
import { WEAK_MATCH_NOTE } from '../../../shared/pricing/matchEvidence';
import type { Material } from '../../types';

function mat(overrides: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'N12 Starter Bars 600mm',
    searchTerm: 'N12 starter bar 600mm dowel',
    quantity: 30,
    unit: 'each',
    requiredQty: 30,
    requiredUnit: 'each',
    price: 85,
    totalPrice: 2550,
    manualPriceOverride: false,
    ...overrides,
  } as Material;
}

const TOWEL_BAR = 'Mondella 935mm Chrome Resonance Double Towel Bar';

describe('applyReconcileResult — match evidence outranks the model', () => {
  it('caps a weak match the reconcile pass applied as high confidence', () => {
    const m = mat({ priceConfidence: 'high' });
    const outcome = applyReconcileResult(
      m,
      { id: 'm1', decision: 'apply', chosenIndex: 0, purchaseCount: 30, confidence: 'high' },
      [{ productName: TOWEL_BAR, price: 85 } as never],
      true,
    );
    expect(outcome).toBe('applied');
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain(WEAK_MATCH_NOTE);
  });

  it('leaves a confident, well-matched apply at high confidence', () => {
    const m = mat({
      name: 'Diamond Blade 350mm',
      searchTerm: 'diamond blade 350mm concrete',
      quantity: 1,
      requiredQty: 1,
      price: 114,
      totalPrice: 114,
    });
    applyReconcileResult(
      m,
      { id: 'm1', decision: 'apply', chosenIndex: 0, purchaseCount: 1, confidence: 'high' },
      [{ productName: 'Kango 350mm Segmented Diamond Saw Blade', price: 114 } as never],
      true,
    );
    expect(m.priceConfidence).toBe('high');
    expect(m.description ?? '').not.toContain(WEAK_MATCH_NOTE);
  });
});
