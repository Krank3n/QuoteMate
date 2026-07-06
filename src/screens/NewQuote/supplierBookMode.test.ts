import { describe, it, expect } from 'vitest';
import { savedItemsSelectable } from './supplierBookMode';

describe('savedItemsSelectable — supplier book entry points', () => {
  it('Settings entry (book mode, no quote section) stays edit-only', () => {
    expect(savedItemsSelectable({ supplierBookOnly: true, hasQuoteSection: false })).toBe(false);
  });

  it('quote-section entry (book mode + section) is addable — regression for the July 2026 report', () => {
    expect(savedItemsSelectable({ supplierBookOnly: true, hasQuoteSection: true })).toBe(true);
  });

  it('normal Saved tab (no book mode) is addable', () => {
    expect(savedItemsSelectable({ supplierBookOnly: false, hasQuoteSection: false })).toBe(true);
    expect(savedItemsSelectable({ supplierBookOnly: false, hasQuoteSection: true })).toBe(true);
  });
});
