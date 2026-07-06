import { describe, it, expect } from 'vitest';
import { normalizeGapKind, replayDeterministicIssues, capVerdict, GAP_KINDS } from './replayOracle.helpers';

describe('normalizeGapKind', () => {
  it('passes canonical kinds through', () => {
    for (const k of GAP_KINDS) expect(normalizeGapKind(k)).toBe(k);
  });

  it('maps the variants observed in real audit runs onto the enum', () => {
    // Every distinct kind from quote-replay-priced-audit-20-retry-hardened.json.
    const observed: Record<string, string> = {
      'product_match': 'product_match',
      'product-match': 'product_match',
      'product-matching': 'product_match',
      'product_matching': 'product_match',
      'product_selection': 'product_match',
      'unit_conversion': 'unit_conversion',
      'unit-conversion': 'unit_conversion',
      'unit_mismatch': 'unit_conversion',
      'unit_correction': 'unit_conversion',
      'quantity_correction': 'quantity',
      'quantity_overestimation': 'quantity',
      'quantity_mismatch': 'quantity',
      'quantity-estimation': 'quantity',
      'quantity': 'quantity',
      'pricing_improvement': 'pricing',
      'pricing': 'pricing',
      'price_estimation': 'pricing',
      'estimation_accuracy': 'pricing',
      'pack_size_mismatch': 'pack_conversion',
      'pack_conversion': 'pack_conversion',
      'material_breakdown': 'material_generation',
      'material_generation': 'material_generation',
      'material_addition': 'missing_material',
      'missing_material': 'missing_material',
      'labor_estimate': 'labour',
      'labour_realism': 'labour',
      'labour-estimation': 'labour',
      'fallback_estimate': 'fallback_estimate',
    };
    for (const [raw, want] of Object.entries(observed)) {
      expect(normalizeGapKind(raw), raw).toBe(want);
    }
  });

  it('maps unknowns and empties to other', () => {
    expect(normalizeGapKind('completely_novel_thing')).toBe('other');
    expect(normalizeGapKind(undefined)).toBe('other');
    expect(normalizeGapKind('')).toBe('other');
  });
});

describe('replayDeterministicIssues', () => {
  it('flags zero-priced replay rows with positive quantity', () => {
    const issues = replayDeterministicIssues({
      materialsSubtotal: 500,
      materials: [
        { name: 'Fence post', quantity: 9, price: 0, totalPrice: 0 },
        { name: 'Screws', quantity: 2, price: 42.5, totalPrice: 85 },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('zero_priced_replay_material');
    expect(issues[0].detail).toContain('Fence post');
  });

  it('flags a single line dominating a large subtotal', () => {
    // The $5,250 joint-tape case: one consumable line soaking up the quote.
    const issues = replayDeterministicIssues({
      materialsSubtotal: 6000,
      materials: [
        { name: 'Plasterboard joint tape', quantity: 150, price: 35, totalPrice: 5250 },
        { name: 'Plasterboard', quantity: 15, price: 50, totalPrice: 750 },
      ],
    });
    expect(issues.map((i) => i.code)).toContain('dominant_line_total');
  });

  it('does not flag dominance on small quotes or balanced quotes', () => {
    expect(
      replayDeterministicIssues({
        materialsSubtotal: 300,
        materials: [{ name: 'Hot water unit', quantity: 1, price: 250, totalPrice: 250 }],
      })
    ).toHaveLength(0);
    expect(
      replayDeterministicIssues({
        materialsSubtotal: 2000,
        materials: [
          { name: 'A', quantity: 1, price: 900, totalPrice: 900 },
          { name: 'B', quantity: 1, price: 1100, totalPrice: 1100 },
        ],
      })
    ).toHaveLength(0);
  });
});

describe('capVerdict', () => {
  it('caps pass to review when deterministic issues exist, preserving the original', () => {
    const oracle: { verdict?: string; rawVerdict?: string } = { verdict: 'pass' };
    capVerdict(oracle, [{ code: 'zero_priced_replay_material', detail: 'x' }]);
    expect(oracle.verdict).toBe('review');
    expect(oracle.rawVerdict).toBe('pass');
  });

  it('leaves fail/review verdicts and clean passes alone', () => {
    const fail: { verdict?: string } = { verdict: 'fail' };
    capVerdict(fail, [{ code: 'x', detail: 'y' }]);
    expect(fail.verdict).toBe('fail');

    const cleanPass: { verdict?: string; rawVerdict?: string } = { verdict: 'pass' };
    capVerdict(cleanPass, []);
    expect(cleanPass.verdict).toBe('pass');
    expect(cleanPass.rawVerdict).toBeUndefined();
  });
});
