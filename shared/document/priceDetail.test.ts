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

  it('either flag explicitly false → total, never summary', () => {
    // Three modes can't express "hide one half", so the migration discloses
    // LESS than the author chose rather than more. Mapping a
    // materials-hidden document to 'summary' would print every material NAME
    // — the supplier line-up its author was hiding — and because this
    // resolves on read it would change documents already sent.
    expect(resolvePriceDetail({ showMaterialCosts: false, showLaborCosts: true })).toBe('total');
    expect(resolvePriceDetail({ showMaterialCosts: true, showLaborCosts: false })).toBe('total');
    expect(resolvePriceDetail({ showMaterialCosts: false, showLaborCosts: false })).toBe('total');
  });

  it('one flag set and the other undefined treats the missing one as shown', () => {
    // undefined has always meant "show" everywhere in the app.
    expect(resolvePriceDetail({ showLaborCosts: false })).toBe('total');
    expect(resolvePriceDetail({ showMaterialCosts: false })).toBe('total');
    expect(resolvePriceDetail({ showMaterialCosts: true })).toBe('itemised');
  });

  it('nothing migrates INTO summary — it is reachable only by choosing it', () => {
    const legacyCombos = [
      { showMaterialCosts: true, showLaborCosts: true },
      { showMaterialCosts: true, showLaborCosts: false },
      { showMaterialCosts: false, showLaborCosts: true },
      { showMaterialCosts: false, showLaborCosts: false },
    ];
    for (const doc of legacyCombos) {
      expect(resolvePriceDetail(doc)).not.toBe('summary');
    }
  });

  it('nothing on the doc falls through to the business default', () => {
    expect(resolvePriceDetail({}, { defaultPriceDetail: 'summary' })).toBe('summary');
    expect(resolvePriceDetail(undefined, { defaultPriceDetail: 'total' })).toBe('total');
  });

  it("falls through to the business's own legacy pair before defaulting", () => {
    expect(resolvePriceDetail({}, { showMaterialCostsByDefault: false, showLaborCostsByDefault: false }))
      .toBe('total');
    expect(resolvePriceDetail({}, { showLaborCostsByDefault: false })).toBe('total');
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
  it('round-trips the two modes the old pair can express', () => {
    expect(resolvePriceDetail(legacyFlagsFor('itemised'))).toBe('itemised');
    expect(resolvePriceDetail(legacyFlagsFor('total'))).toBe('total');
  });

  it('degrades summary to total for an older build, rather than over-disclosing', () => {
    // The old pair has no way to say "names without prices". An old build
    // reading materials-shown would print the per-line money 'summary' exists
    // to hide, so the dual write tells it to show only the grand total.
    expect(legacyFlagsFor('summary')).toEqual({ showMaterialCosts: false, showLaborCosts: false });
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
