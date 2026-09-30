/**
 * When the job description is a written scope, the generator is asked for a
 * short customer-facing description per section. When it isn't, the prompt
 * must be exactly what it was — not one byte different.
 */
import { describe, it, expect } from 'vitest';
import { buildMaterialsPrompt, geminiMaterialsMaxOutputTokens, type MaterialsPromptOptions } from './materialsPrompt';

const base: MaterialsPromptOptions = {
  jobDescription: '1. Remove cupboards 2. Frame WIR 3. Demolish ensuite',
  hasExisting: false,
  storeName: 'Bunnings',
  contextSection: '',
  existingMaterialsSection: '',
  templateReferenceSection: '',
  savedRatesSection: '',
  reeceCatalogueSection: '',
  tradeContext: null,
  targetHours: 24,
};

describe('buildMaterialsPrompt — section scope descriptions', () => {
  it('asks for sectionDescriptions, last in the JSON example, with its rules after the one-section rule', () => {
    const prompt = buildMaterialsPrompt({ ...base, askSectionDescriptions: true });
    expect(prompt).toContain('"sectionDescriptions": [{ "section": "<exact section string used on the materials>"');
    expect(prompt.indexOf('"sectionDescriptions"')).toBeGreaterThan(prompt.indexOf('"jobQualityTier"'));
    expect(prompt.indexOf('"sectionDescriptions"')).toBeGreaterThan(prompt.indexOf('"floorplanAnalysis"'));
    expect(prompt).toMatch(/"floorplanAnalysis": "[^"]*",\n  "sectionDescriptions"/);
    const rules = prompt.indexOf('- SECTION DESCRIPTIONS:');
    expect(rules).toBeGreaterThan(prompt.indexOf('- ONE section per stage of work'));
    expect(rules).toBeLessThan(prompt.indexOf('QUALITY TIER DETECTION —'));
    // Copied, not restated: Job Details can only drop the full description
    // when every line the tradie wrote prints under a section word for word.
    expect(prompt).toContain("the tradie's OWN lines COPIED WORD FOR WORD");
    expect(prompt).toContain('Do not reword, shorten, merge, split, summarise, correct or tidy any line');
    expect(prompt).toContain('A numbered title line that has its own lines under it');
    expect(prompt).not.toMatch(/Restate|1–4 short lines/);
    expect(prompt).toContain('Never copy a line that states a price or $ figure');
    expect(prompt).toContain('"by others"');
    expect(prompt).toContain('omit that section rather than invent');
  });

  it('flag off or absent → byte-identical prompt with no trace of section descriptions', () => {
    const absent = buildMaterialsPrompt(base);
    const off = buildMaterialsPrompt({ ...base, askSectionDescriptions: false });
    expect(off).toBe(absent);
    expect(absent).not.toContain('sectionDescriptions');
    expect(absent).not.toContain('SECTION DESCRIPTIONS');
  });

  it('flag on differs from the baseline ONLY by the key and the rules block', () => {
    const baseline = buildMaterialsPrompt(base);
    const on = buildMaterialsPrompt({ ...base, askSectionDescriptions: true });
    const stripped = on
      .replace(/,\n  "sectionDescriptions": \[[^\n]*\]/, '')
      .replace(/\n- SECTION DESCRIPTIONS:[^\n]*/, '');
    expect(stripped).toBe(baseline);
  });
});

describe('geminiMaterialsMaxOutputTokens — the fallback\'s output budget', () => {
  it('a written scope gets at least 16000 tokens, with or without images', () => {
    expect(geminiMaterialsMaxOutputTokens({ hasImages: false, writtenScope: true })).toBeGreaterThanOrEqual(16000);
    expect(geminiMaterialsMaxOutputTokens({ hasImages: true, writtenScope: true })).toBeGreaterThanOrEqual(16000);
  });

  it('non-scope jobs keep exactly the budget they had: 16000 with images, 8000 without', () => {
    expect(geminiMaterialsMaxOutputTokens({ hasImages: true })).toBe(16000);
    expect(geminiMaterialsMaxOutputTokens({ hasImages: false })).toBe(8000);
    expect(geminiMaterialsMaxOutputTokens({ hasImages: false, writtenScope: false })).toBe(8000);
  });
});
