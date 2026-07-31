import { describe, expect, it } from 'vitest';
import { buildJobDictationContext } from './jobDictationContext';

describe('buildJobDictationContext', () => {
  it('biases the recogniser toward the terms misheard in the Bui deck recording', () => {
    const terms = buildJobDictationContext(null);

    expect(terms).toEqual(expect.arrayContaining([
      'Ekodeck',
      'ModWood',
      'Makita',
      'Diablo',
      'tip fees',
      "carpenter's time",
      '185 millimetre blade',
    ]));
  });

  it('adds selected-template vocabulary without duplicates', () => {
    const terms = buildJobDictationContext({
      id: 'deck-repair',
      name: 'Deck repair',
      suggestedMaterials: ['Ekodeck', 'Joist protection tape'],
    } as any);

    expect(terms).toContain('Deck repair');
    expect(terms).toContain('Joist protection tape');
    expect(terms.filter((term) => term.toLowerCase() === 'ekodeck')).toHaveLength(1);
  });
});
