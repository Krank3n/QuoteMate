/**
 * The generator prompt must tell the model that the tradie's own tools,
 * hire and PPE are never materials — and that "using my own gear" means
 * consumables are in the rate too. The deterministic filter in ownedGear.ts
 * is the backstop; this is the first line.
 */
import { describe, it, expect } from 'vitest';
import { buildMaterialsPrompt } from './materialsPrompt';

function render(overrides: Partial<Parameters<typeof buildMaterialsPrompt>[0]> = {}): string {
  return buildMaterialsPrompt({
    jobDescription: 'Vacate clean of a 3 bedroom house, using my own gear',
    hasExisting: false,
    storeName: 'Bunnings',
    contextSection: '',
    existingMaterialsSection: '',
    templateReferenceSection: '',
    savedRatesSection: '',
    reeceCatalogueSection: '',
    tradeContext: { nicheName: 'Cleaner' },
    ...overrides,
  });
}

describe('buildMaterialsPrompt — owned gear rule', () => {
  it('states that tools, equipment and PPE the tradie owns are never materials', () => {
    const prompt = render();
    expect(prompt).toContain('TOOLS, EQUIPMENT AND PPE THE TRADIE ALREADY OWNS ARE NEVER MATERIALS');
    expect(prompt).toMatch(/NEVER list tools, equipment, hire or PPE that a tradie in this trade owns/);
    for (const gear of ['hammers', 'pry/wrecking bars', 'brooms', 'mops', 'extension poles', 'squeegees', 'gernis/pressure washers', 'ladders', 'gloves', 'safety glasses']) {
      expect(prompt).toContain(gear);
    }
  });

  it('keeps consumables used up on the job and hire the job genuinely needs', () => {
    const prompt = render();
    expect(prompt).toMatch(/CONSUMABLES that are used up on THIS job stay/);
    expect(prompt).toMatch(/HIRE stays ONLY when the job description explicitly asks for it/);
    expect(prompt).toContain('a scissor lift, a skip bin, a concrete pump');
  });

  it('treats "using my own gear" as consumables included in the rate', () => {
    const prompt = render();
    expect(prompt).toMatch(/say they use their own materials, gear or chemicals/);
    expect(prompt).toMatch(/treat consumables as included in their rate and list NOTHING for them/);
  });

  it('no longer invites safety gear as a prep material', () => {
    const prompt = render();
    expect(prompt).not.toContain('Include safety/prep materials if relevant');
    expect(prompt).toContain('never the tools or PPE the tradie already owns');
  });

  it('keeps the plate compactor as a genuine hire example without a toolbox beside it', () => {
    const prompt = render();
    expect(prompt).toContain('Plate compactor hire (half day): quantity 1, unit "each" — a genuine hire item');
    expect(prompt).toContain('Do NOT add a hammer, broom, wheelbarrow, gloves or glasses alongside it');
  });
});
