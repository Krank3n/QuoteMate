import { describe, it, expect } from 'vitest';
import { buildMaterialsPrompt, type MaterialsPromptOptions } from './materialsPrompt';

const base: MaterialsPromptOptions = {
  jobDescription: 'Full plumbing for a new 3 bed 2 bath house',
  hasExisting: false,
  storeName: 'Bunnings',
  contextSection: '',
  existingMaterialsSection: '',
  templateReferenceSection: '',
  savedRatesSection: '',
  reeceCatalogueSection: '',
  tradeContext: null,
};

describe('materials prompt: fittings are counted, not measured', () => {
  it('tells the generator that pipe fittings are piece-goods in each, and only the pipe is in metres', () => {
    const prompt = buildMaterialsPrompt(base);
    expect(prompt).toContain('PIPE AND PLUMBING FITTINGS ARE PIECE-GOODS TOO');
    expect(prompt).toMatch(/couplings, elbows, bends, tees, junctions, reducers, adaptors, end caps, inspection openings/);
    expect(prompt).toContain('Only the pipe itself is emitted in linear metres');
  });
});
