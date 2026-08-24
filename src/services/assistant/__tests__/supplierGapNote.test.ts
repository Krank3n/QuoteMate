// When is a supplier-book gap worth a line?
//
// The trap this pins: supplier-priority-fallback only fires when
// businessSettings.supplierPriority ranks a local supplier above Bunnings, and
// only TradePricingScreen ever writes that — so for most tradies missedTerms
// is permanently empty. Treating that as "the book covered everything" would
// mean the note never fires for the people who need it most.

import { describe, it, expect } from 'vitest';
import { buildSupplierGapNote, type SupplierGapSummary } from '../supplierGapNote';

function gap(overrides: Partial<SupplierGapSummary> = {}): SupplierGapSummary {
  return {
    missedTerms: [],
    estimatedCount: 0,
    pricedRowCount: 20,
    supplierBookPopulated: true,
    ...overrides,
  };
}

describe('buildSupplierGapNote', () => {
  it('is null when nothing was estimated and nothing was missed', () => {
    expect(buildSupplierGapNote(gap())).toBeNull();
  });

  it('is null for a single estimated row in a 20-row quote', () => {
    expect(buildSupplierGapNote(gap({ estimatedCount: 1 }))).toBeNull();
  });

  it('notes 3+ estimated rows', () => {
    const note = buildSupplierGapNote(gap({ estimatedCount: 3 }));
    expect(note).toContain('3 of 20 priced rows are estimates');
  });

  it('notes a quote where the estimate ratio exceeds 30%', () => {
    // 2 of 6 is a third of the quote, well under the flat 3-row bar.
    const note = buildSupplierGapNote(gap({ estimatedCount: 2, pricedRowCount: 6 }));
    expect(note).toContain('2 of 6 priced rows are estimates');
  });

  it('notes a non-empty missedTerms even with a low estimate count', () => {
    const note = buildSupplierGapNote(
      gap({ missedTerms: ['Colorbond sheet 1.8m'], estimatedCount: 1 }),
    );
    expect(note).toContain('Colorbond sheet 1.8m');
  });

  it('names at most two items', () => {
    const note = buildSupplierGapNote(
      gap({ missedTerms: ['Colorbond sheet', 'Fence post', 'Top rail', 'Post cap'] }),
    );
    expect(note).toContain('Colorbond sheet, Fence post');
    expect(note).not.toContain('Top rail');
    expect(note).not.toContain('Post cap');
  });

  it('says "is empty" for an unseen book and "didn\'t cover these" for a real one', () => {
    const empty = buildSupplierGapNote(
      gap({ estimatedCount: 4, supplierBookPopulated: false }),
    );
    expect(empty).toContain('The supplier list on this phone is empty');
    expect(empty).not.toContain("didn't cover these");

    const populated = buildSupplierGapNote(
      gap({ estimatedCount: 4, missedTerms: ['Fence post'] }),
    );
    expect(populated).toContain("Their supplier list didn't cover these: Fence post");
    expect(populated).not.toContain('is empty');
  });

  it('caps the offer at one line and one ask', () => {
    const note = buildSupplierGapNote(gap({ estimatedCount: 4 }))!;
    expect(note).toContain('ONE line of your acknowledgement');
    expect(note).toContain('once only, and drop it if they knock it back');
  });

  it('never divides by a zero row count', () => {
    expect(buildSupplierGapNote(gap({ pricedRowCount: 0 }))).toBeNull();
  });
});
