import { describe, it, expect } from 'vitest';
import { resolveJobRequirements, SUPPLY_OR_REPLACE_QUESTION } from '../readTools';
import { buildSupplierBookSnapshot } from '../../supplierBookCoverage';
import type { FavoriteProductMapping } from '../../../types';

function personalRate(
  productName: string,
  store = 'Metro Fencing',
): FavoriteProductMapping {
  return { productName, store, price: 40, isPersonalRate: true };
}

const COLORBOND_BOOK = buildSupplierBookSnapshot([
  personalRate('Colorbond fence infill sheet 1.8m Monument'),
  personalRate('Colorbond fence post 75 x 75 x 2.4m'),
  personalRate('Colorbond fence top rail 2.4m'),
]);

const PLUMBING_BOOK = buildSupplierBookSnapshot([
  personalRate('Copper pipe 15mm x 3m', 'Reece'),
  personalRate('Basin mixer chrome', 'Reece'),
]);

describe('resolveJobRequirements', () => {
  it('returns mustAskQuestions for fencing niche', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    const labels = result.mustAskQuestions.map(q => q.toLowerCase());
    expect(labels.some(l => l.includes('length') || l.includes('linear') || l.includes('metre'))).toBe(true);
    expect(labels.some(l => l.includes('height') || l.includes('panel'))).toBe(true);
    expect(labels.some(l => l.includes('gate') || l.includes('gates'))).toBe(true);
    expect(labels.some(l => l.includes('removal') || l.includes('old fence') || l.includes('exist'))).toBe(true);
  });

  it('returns mustAskQuestions for lawn care niche', () => {
    const result = resolveJobRequirements({ categoryId: 'landscape_gardening', nicheId: 'lawn_care' });
    const labels = result.mustAskQuestions.map(q => q.toLowerCase());
    expect(labels.some(l => l.includes('area') || l.includes('size') || l.includes('m²') || l.includes('sqm'))).toBe(true);
  });

  it('matches fencing from freeText', () => {
    const result = resolveJobRequirements({ freeText: 'colorbond fence quote' });
    expect(result.matched.nicheId).toBe('fencing');
    expect(result.matched.categoryId).toBe('other');
  });

  it('specialistSupply true for fencing', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    expect(result.specialistSupply).toBe(true);
  });

  it('specialistSupply false for painting', () => {
    const result = resolveJobRequirements({ categoryId: 'painting', nicheId: 'interior' });
    expect(result.specialistSupply).toBe(false);
  });

  it('supplierBookPopulated is false when no supplier-book snapshot is supplied', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    expect(result.supplierBookPopulated).toBe(false);
    expect(result.supplierBookSuppliers).toEqual([]);
    expect(result.supplierBookCoversTrade).toBe(false);
  });

  it('supplierBookPopulated is true when the snapshot has imported items', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: COLORBOND_BOOK,
    });
    expect(result.supplierBookPopulated).toBe(true);
  });

  it('coversTrade is true for a fencing job against a Colorbond list', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: COLORBOND_BOOK,
    });
    expect(result.supplierBookCoversTrade).toBe(true);
  });

  it('coversTrade is false for a fencing job against a plumbing list', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: PLUMBING_BOOK,
    });
    expect(result.supplierBookPopulated).toBe(true);
    expect(result.supplierBookCoversTrade).toBe(false);
  });

  it('supplierBookSuppliers echoes at most 3 names', () => {
    const book = buildSupplierBookSnapshot([
      personalRate('a', 'Metro Fencing'),
      personalRate('b', 'Stratco'),
      personalRate('c', 'Bowens'),
      personalRate('d', 'Reece'),
    ]);
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing', supplierBook: book });
    expect(result.supplierBookSuppliers).toEqual(['Metro Fencing', 'Stratco', 'Bowens']);
  });

  // Injecting a snapshot (rather than loading one) is what keeps this callable
  // from the pure tool path with no AsyncStorage / Firestore in the graph.
  it('resolveJobRequirements stays synchronous and does no IO', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: COLORBOND_BOOK,
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as unknown as { then?: unknown }).then).toBe('undefined');
  });

  it('measurementDriven true for per_linear_m niche', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    // fencing is per_linear_m
    if (result.pricingMethod) {
      if (['per_linear_m', 'per_sqm', 'per_cubic_m'].includes(result.pricingMethod)) {
        expect(result.measurementDriven).toBe(true);
      }
    }
  });

  it('returns empty mustAskQuestions for unknown niche', () => {
    const result = resolveJobRequirements({ categoryId: 'unknown_cat', nicheId: 'unknown_niche' });
    expect(Array.isArray(result.mustAskQuestions)).toBe(true);
  });
});

describe('a defaulted trade must not outvote the job in front of you', () => {
  /**
   * From a real voice transcript, 27 Aug 2026. A cabinet maker asked Mate to
   * quote a 1m x 2m concrete slab. get_job_requirements fills category/niche
   * from the tradie's business settings when the caller passes none, so the
   * call became {cabinet_making, kitchens, freeText: "concrete slab on
   * ground"} — and resolveJobRequirements only consulted freeText when no
   * template had been found. One had, from the defaults.
   *
   * Mate was handed Kitchen Cabinetry's must-ask list — linear metres of
   * cabinets, door finish, benchtop material — for a concrete pour. It
   * recovered by calling again with an explicit category, but nothing
   * guaranteed that, and a tradie asked about their slab's benchtop finish
   * would rightly conclude the thing is broken.
   */
  it('does not return kitchen questions for a concrete slab', () => {
    const r = resolveJobRequirements({
      categoryId: 'cabinet_making',
      nicheId: 'kitchens',
      freeText: 'concrete slab on ground',
      categoryFromSettings: true,
    });
    expect(r.matched.categoryId).not.toBe('cabinet_making');
    const asked = r.mustAskQuestions.join(' ').toLowerCase();
    expect(asked).not.toMatch(/benchtop|cabinet|door finish/);
  });

  it('lets freeText pick a trade outside the tradie\'s usual one', () => {
    const r = resolveJobRequirements({
      categoryId: 'cabinet_making',
      nicheId: 'kitchens',
      freeText: 'colorbond fence',
      categoryFromSettings: true,
    });
    expect(r.matched.categoryId).not.toBe('cabinet_making');
  });

  it('still respects a category the CALLER pinned explicitly', () => {
    // An explicit category is a statement, not a default — freeText must not
    // override it, or Mate loses the ability to say "no, this IS a kitchen".
    const r = resolveJobRequirements({
      categoryId: 'cabinet_making',
      nicheId: 'kitchens',
      freeText: 'concrete slab on ground',
      categoryFromSettings: false,
    });
    expect(r.matched.categoryId).toBe('cabinet_making');
  });

  it('falls back to the tradie\'s trade when freeText matches nothing', () => {
    // Better their usual questions than none at all.
    const r = resolveJobRequirements({
      categoryId: 'cabinet_making',
      nicheId: 'kitchens',
      freeText: 'zzzzz qqqqq',
      categoryFromSettings: true,
    });
    expect(r.matched.categoryId).toBe('cabinet_making');
    expect(r.mustAskQuestions.length).toBeGreaterThan(0);
  });

  it('is unchanged when there is no freeText to go on', () => {
    const r = resolveJobRequirements({
      categoryId: 'cabinet_making',
      nicheId: 'kitchens',
      categoryFromSettings: true,
    });
    expect(r.matched.categoryId).toBe('cabinet_making');
  });
});

// An invoice is for work already done. The electrician invoicing a
// switchboard (3 Sep 2026) was asked poles, circuits, RCDs and asbestos and
// offered a supplier list — twelve messages before the draft.
describe('resolveJobRequirements — invoice fast path', () => {
  it('collapses the questions to what was done and who for, and turns the supply flags off', () => {
    const result = resolveJobRequirements({ freeText: 'supply and install a new switchboard', documentType: 'invoice', supplierBook: COLORBOND_BOOK });
    expect(result.invoiceFastPath).toBe(true);
    expect(result.mustAskQuestions).toHaveLength(2);
    expect(result.mustAskQuestions[0].toLowerCase()).toContain('what work was done');
    expect(result.mustAskQuestions[1].toLowerCase()).toContain('who it is for');
    expect(result.genericScope).toBe(false);
    expect(result.specialistSupply).toBe(false);
    expect(result.planHelps).toBe(false);
    expect(result.measurementDriven).toBe(false);
    expect(result.supplierBookCoversTrade).toBe(false);
  });

  it('still names the trade it matched, so the pricing engine knows the niche', () => {
    const result = resolveJobRequirements({ freeText: 'colorbond fence', documentType: 'invoice' });
    expect(result.matched.nicheId).toBe('fencing');
  });

  it('is off for a quote — a fence quote keeps its own questions and specialist-supply flag', () => {
    const result = resolveJobRequirements({ freeText: 'colorbond fence', documentType: 'quote' });
    expect(result.invoiceFastPath).toBe(false);
    expect(result.mustAskQuestions.length).toBeGreaterThan(0);
    expect(result.specialistSupply).toBe(true);
  });
});


// A smoke-alarm quote (3 Sep 2026): no such job type existed, so Mate forced
// the nearest niche (Power Points) and opened with singles-or-doubles and USB
// questions — and then supplied four battery alarms the customer already
// owned, a third of the price.
describe('smoke alarms, and supply-or-replace on every install-type job', () => {
  it('matches a smoke-alarm job to its own niche, not Power Points', () => {
    const named = resolveJobRequirements({ jobType: 'Smoke Alarms' });
    expect(named.matched).toMatchObject({ categoryId: 'electrical', nicheId: 'smoke_alarms', templateName: 'Smoke Alarms' });
    const fuzzy = resolveJobRequirements({ freeText: 'install fire detectors — smoke alarms, two hardwired and four battery' });
    expect(fuzzy.matched.templateName).toBe('Smoke Alarms');
    const q = named.mustAskQuestions.join(' ').toLowerCase();
    expect(q).toContain('hardwired');
    expect(q).toContain('replacing existing');
    expect(q).not.toContain('usb');
  });

  it('adds the supply-or-replace question to an install-type job whose own questions never ask', () => {
    const points = resolveJobRequirements({ jobType: 'Power Points' });
    expect(points.mustAskQuestions).toContain(SUPPLY_OR_REPLACE_QUESTION);
    // "off existing" (a circuit) is not the supply question — it still gets asked.
    expect(points.mustAskQuestions).toHaveLength(2);
  });

  it('does not double up when the niche already asks about replacing existing gear', () => {
    const alarms = resolveJobRequirements({ jobType: 'Smoke Alarms' });
    expect(alarms.mustAskQuestions).not.toContain(SUPPLY_OR_REPLACE_QUESTION);
    expect(alarms.mustAskQuestions).toHaveLength(1);
    // "New install or replacing halogen?" already covers it.
    const downlights = resolveJobRequirements({ jobType: 'LED Downlights' });
    expect(downlights.mustAskQuestions).not.toContain(SUPPLY_OR_REPLACE_QUESTION);
  });

  it('leaves non-install work alone', () => {
    const result = resolveJobRequirements({ jobType: 'none', freeText: 'end of lease clean' });
    expect(result.mustAskQuestions).not.toContain(SUPPLY_OR_REPLACE_QUESTION);
  });

  it('an invoice never asks it — the work is done', () => {
    const result = resolveJobRequirements({ jobType: 'Power Points', documentType: 'invoice' });
    expect(result.mustAskQuestions).not.toContain(SUPPLY_OR_REPLACE_QUESTION);
  });
});
