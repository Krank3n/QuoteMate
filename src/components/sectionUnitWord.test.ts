// "Floor Tiling (per m²)" rendered its per-unit subtitle as "1/m²) ·" on a
// real quote — the unit word was the section's last word verbatim, bracket
// included.

import { describe, it, expect } from 'vitest';
import { sectionUnitWord } from './sectionUnitWord';

describe('sectionUnitWord', () => {
  it('strips the punctuation pipeline section names carry', () => {
    expect(sectionUnitWord('Floor Tiling (per m²)')).toBe('m²');
  });

  it('keeps the plain last word for template sections', () => {
    expect(sectionUnitWord('Fence Bay')).toBe('bay');
    expect(sectionUnitWord('Deck Section')).toBe('section');
  });

  it('falls back to "unit" when there is nothing usable', () => {
    expect(sectionUnitWord(undefined)).toBe('unit');
    expect(sectionUnitWord('  ')).toBe('unit');
    expect(sectionUnitWord('()')).toBe('unit');
  });
});
