import { describe, expect, it } from 'vitest';
import {
  MAX_SECTION_DESCRIPTION_CHARS,
  MAX_SECTION_DESCRIPTIONS,
  normaliseAnalyzeResponse,
  normaliseSectionDescriptions,
  sectionDescriptionsForWire,
} from './llmMaterials';

/**
 * Section descriptions reach the customer's quote, so the model's array is
 * validated hard: plain strings only, capped, and never a dollar figure.
 */
describe('normaliseSectionDescriptions', () => {
  it('turns the array into a section → description map, trimmed', () => {
    expect(
      normaliseSectionDescriptions([
        { section: 'Demolition', description: '  Remove kitchen cupboards.\nDemolish the ensuite.  ' },
        { section: ' WIR Framing ', description: 'Frame the walk-in robe.' },
      ]),
    ).toEqual({
      Demolition: 'Remove kitchen cupboards.\nDemolish the ensuite.',
      'WIR Framing': 'Frame the walk-in robe.',
    });
  });

  it('drops non-strings, blanks and malformed entries; undefined when nothing survives', () => {
    const out = normaliseSectionDescriptions([
      null,
      'Demolition',
      { section: 'Demolition', description: 42 },
      { section: 7, description: 'Numbers are not names.' },
      { section: '   ', description: 'No name.' },
      { section: 'Framing', description: '   ' },
      { section: 'Painting', description: 'Two coats to the new walls.' },
    ]);
    expect(out).toEqual({ Painting: 'Two coats to the new walls.' });
    expect(normaliseSectionDescriptions([{ section: 'A', description: '' }])).toBeUndefined();
    expect(normaliseSectionDescriptions([])).toBeUndefined();
    expect(normaliseSectionDescriptions({ Demolition: 'not an array' })).toBeUndefined();
    expect(normaliseSectionDescriptions(undefined)).toBeUndefined();
  });

  it('caps length and collapses runs of blank lines to one', () => {
    const out = normaliseSectionDescriptions([
      { section: 'Long', description: 'x'.repeat(MAX_SECTION_DESCRIPTION_CHARS + 200) },
      { section: 'Gappy', description: 'Line one.\n\n\n\n\nLine two.' },
    ]);
    expect(out?.Long).toHaveLength(MAX_SECTION_DESCRIPTION_CHARS);
    expect(out?.Gappy).toBe('Line one.\n\nLine two.');
  });

  it('drops any description that quotes a dollar amount', () => {
    const out = normaliseSectionDescriptions([
      { section: 'Demolition', description: 'Remove cupboards — $120 tip fee included.' },
      { section: 'Framing', description: 'Frame the robe, allow $ 450.' },
      { section: 'Painting', description: 'Two coats — paint customer-supplied.' },
    ]);
    expect(out).toEqual({ Painting: 'Two coats — paint customer-supplied.' });
  });

  it('drops amounts written as dollars, bucks or AUD, and $ with any spacing', () => {
    const out = normaliseSectionDescriptions([
      { section: 'A', description: 'Allow 1,200 dollars for the tiles.' },
      { section: 'B', description: 'About 500 bucks of timber.' },
      { section: 'C', description: 'AUD 500 allowance.' },
      { section: 'D', description: 'Allowance of 500 AUD.' },
      { section: 'E', description: 'Fixed at $  1200.' },
      { section: 'F', description: 'Two coats — 2 bedrooms and 1 hallway, customer-supplied paint.' },
    ]);
    expect(out).toEqual({ F: 'Two coats — 2 bedrooms and 1 hallway, customer-supplied paint.' });
  });

  it('section names like "constructor", "toString" and "__proto__" are ordinary keys', () => {
    const out = normaliseSectionDescriptions([
      { section: 'constructor', description: 'Builder works.' },
      { section: 'toString', description: 'Sign-writing.' },
      { section: '__proto__', description: 'Odd name, still a name.' },
    ])!;
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(out.constructor).toBe('Builder works.');
    expect(out.toString).toBe('Sign-writing.');
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toBe('Odd name, still a name.');
  });

  it(`keeps at most ${MAX_SECTION_DESCRIPTIONS} descriptions`, () => {
    const raw = Array.from({ length: MAX_SECTION_DESCRIPTIONS + 10 }, (_, i) => ({ section: `S${i}`, description: `Item ${i}.` }));
    const out = normaliseSectionDescriptions(raw)!;
    expect(Object.keys(out)).toHaveLength(MAX_SECTION_DESCRIPTIONS);
    expect(out.S0).toBe('Item 0.');
  });

  it('keeps the first entry when a section name repeats', () => {
    expect(
      normaliseSectionDescriptions([
        { section: 'Demolition', description: 'First.' },
        { section: 'Demolition', description: 'Second.' },
      ]),
    ).toEqual({ Demolition: 'First.' });
  });
});

describe('normaliseAnalyzeResponse — sectionDescriptions', () => {
  const materials = [{ name: 'Skip bin', searchTerm: 'skip bin', quantity: 1, unit: 'each', section: 'Demolition' }];

  it('carries validated section descriptions through', () => {
    const res = normaliseAnalyzeResponse({
      materials,
      estimatedHours: 6,
      jobSummary: 'Reno',
      sectionDescriptions: [{ section: 'Demolition', description: 'Remove the cupboards.' }],
    });
    expect(res.sectionDescriptions).toEqual({ Demolition: 'Remove the cupboards.' });
  });

  it('no key (or nothing valid) → no sectionDescriptions on the response', () => {
    const none = normaliseAnalyzeResponse({ materials, estimatedHours: 6, jobSummary: 'Reno' });
    expect('sectionDescriptions' in none).toBe(false);
    const allBad = normaliseAnalyzeResponse({
      materials,
      estimatedHours: 6,
      jobSummary: 'Reno',
      sectionDescriptions: [{ section: 'Demolition', description: 'All in for $900.' }],
    });
    expect('sectionDescriptions' in allBad).toBe(false);
  });
});

describe('sectionDescriptionsForWire — server-side validation of the analyse payload', () => {
  it('keeps only plain string pairs, capped, back in the array shape the client parses', () => {
    const out = sectionDescriptionsForWire([
      { section: 'Demolition', description: '  Remove the cupboards.  ', extra: 'dropped' },
      { section: 'Framing', description: { text: 'not a string' } },
      { section: 'Painting', description: 'x'.repeat(MAX_SECTION_DESCRIPTION_CHARS + 50) },
      { section: 'Tiling', description: 'Allow $900 for tiles.' },
    ]);
    expect(out).toEqual([
      { section: 'Demolition', description: 'Remove the cupboards.' },
      { section: 'Painting', description: 'x'.repeat(MAX_SECTION_DESCRIPTION_CHARS) },
    ]);
  });

  it('caps the count and round-trips through normaliseAnalyzeResponse', () => {
    const raw = Array.from({ length: 100 }, (_, i) => ({ section: `S${i}`, description: `Item ${i}.` }));
    const wire = sectionDescriptionsForWire(raw)!;
    expect(wire).toHaveLength(MAX_SECTION_DESCRIPTIONS);
    const res = normaliseAnalyzeResponse({ materials: [], estimatedHours: 1, jobSummary: '', sectionDescriptions: wire });
    expect(Object.keys(res.sectionDescriptions!)).toHaveLength(MAX_SECTION_DESCRIPTIONS);
  });

  it('nothing usable (or not an array) → undefined, so the payload carries no key', () => {
    expect(sectionDescriptionsForWire(undefined)).toBeUndefined();
    expect(sectionDescriptionsForWire('Demolition: remove cupboards')).toBeUndefined();
    expect(sectionDescriptionsForWire([{ section: 'A', description: '$50' }])).toBeUndefined();
  });
});
