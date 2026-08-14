/**
 * The migration table, one case per row. Two independent booleans expressed
 * three meanings across four combinations, and the resolution expression was
 * hand-written in eleven places — so a document could render one way in the
 * PDF and another on the web acceptance page.
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePriceDetail,
  legacyFlagsFor,
  showsPerLineMoney,
  showsLineItems,
} from './priceDetail';

describe('resolvePriceDetail — migration', () => {
  it('priceDetail set wins outright, whatever the legacy flags say', () => {
    expect(
      resolvePriceDetail(
        { priceDetail: 'total', showMaterialCosts: true, showLaborCosts: true },
        { defaultPriceDetail: 'itemised' },
      ),
    ).toBe('total');
  });

  it('both legacy flags true → itemised', () => {
    expect(resolvePriceDetail({ showMaterialCosts: true, showLaborCosts: true })).toBe('itemised');
  });

  it('exactly one of the two flags false → summary', () => {
    expect(resolvePriceDetail({ showMaterialCosts: false, showLaborCosts: true })).toBe('summary');
    expect(resolvePriceDetail({ showMaterialCosts: true, showLaborCosts: false })).toBe('summary');
  });

  it('both flags false → total', () => {
    expect(resolvePriceDetail({ showMaterialCosts: false, showLaborCosts: false })).toBe('total');
  });

  it('one flag set and the other undefined treats the missing one as shown', () => {
    // undefined has always meant "show" everywhere in the app.
    expect(resolvePriceDetail({ showLaborCosts: false })).toBe('summary');
    expect(resolvePriceDetail({ showMaterialCosts: false })).toBe('summary');
  });

  it('nothing on the doc falls through to the business default', () => {
    expect(resolvePriceDetail({}, { defaultPriceDetail: 'summary' })).toBe('summary');
    expect(resolvePriceDetail(undefined, { defaultPriceDetail: 'total' })).toBe('total');
  });

  it("falls through to the business's own legacy pair before defaulting", () => {
    expect(resolvePriceDetail({}, { showMaterialCostsByDefault: false, showLaborCostsByDefault: false }))
      .toBe('total');
    expect(resolvePriceDetail({}, { showLaborCostsByDefault: false })).toBe('summary');
  });

  it('defaults to itemised when nothing at all is set', () => {
    expect(resolvePriceDetail({}, {})).toBe('itemised');
    expect(resolvePriceDetail(null, null)).toBe('itemised');
  });

  it('ignores a junk priceDetail value rather than rendering nothing', () => {
    expect(resolvePriceDetail({ priceDetail: 'nonsense' as never })).toBe('itemised');
  });
});

describe('legacyFlagsFor — the dual write', () => {
  it('round-trips every mode back through the resolver', () => {
    for (const detail of ['itemised', 'summary', 'total'] as const) {
      expect(resolvePriceDetail(legacyFlagsFor(detail))).toBe(detail);
    }
  });
});

describe('mode predicates', () => {
  it('shows per-line money in itemised only', () => {
    expect(showsPerLineMoney('itemised')).toBe(true);
    expect(showsPerLineMoney('summary')).toBe(false);
    expect(showsPerLineMoney('total')).toBe(false);
  });

  it('shows line items in itemised and summary', () => {
    expect(showsLineItems('itemised')).toBe(true);
    expect(showsLineItems('summary')).toBe(true);
    expect(showsLineItems('total')).toBe(false);
  });
});
