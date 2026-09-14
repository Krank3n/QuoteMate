/**
 * When the tradie has stated the total labour hours, the generator is told the
 * number is fixed — its sections are a split of it, not a fresh estimate. The
 * deterministic hold in shared/pricing/pipeline.ts guarantees the figure on the
 * quote either way; this is what keeps the split it hands back sensible.
 */
import { describe, it, expect } from 'vitest';
import { buildMaterialsPrompt, type MaterialsPromptOptions } from './materialsPrompt';

const base: MaterialsPromptOptions = {
  jobDescription: 'Rough in and fit off a two-bathroom extension.',
  hasExisting: false,
  storeName: 'Reece',
  contextSection: '',
  existingMaterialsSection: '',
  templateReferenceSection: '',
  savedRatesSection: '',
  reeceCatalogueSection: '',
  tradeContext: null,
};

describe('buildMaterialsPrompt — stated labour hours', () => {
  it('makes the stated total a hard target for the sections and for estimatedHours', () => {
    const prompt = buildMaterialsPrompt({ ...base, targetHours: 40 });
    expect(prompt).toContain('STATED the total labour as 40 hours');
    expect(prompt).toContain('set "estimatedHours" to exactly 40');
    expect(prompt).toContain('across all sections equal 40');
    expect(prompt).not.toContain('should roughly equal estimatedHours');
  });

  it('keeps the soft rule when no hours were stated, or the value is not a real number of hours', () => {
    for (const targetHours of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const prompt = buildMaterialsPrompt({ ...base, targetHours });
      expect(prompt).toContain('should roughly equal estimatedHours');
      expect(prompt).not.toContain('STATED the total labour');
    }
  });
});
