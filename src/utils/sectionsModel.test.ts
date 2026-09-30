/**
 * A section lives in two places at once — a `QuoteSection` row, and a `section`
 * NAME repeated on every material in it. Every mutation has to rewrite both in
 * one document, or the two disagree and a material ends up naming a section
 * that no longer exists: gone from the sectioned list, silently regrouped, but
 * still counted in the total.
 *
 * These cases pin the rules that make that structurally impossible.
 */

import { describe, it, expect } from 'vitest';
import {
  createSection,
  renameSection,
  setSectionDescription,
  sectionChangeKeepsTotals,
  deleteSection,
  moveSection,
  moveMaterialToSection,
  normaliseSortOrder,
  sortedSections,
  sectionNames,
  uniqueSectionName,
  sectionTotals,
  type SectionsState,
} from './sectionsModel';
import type { Material, Quote, QuoteSection } from '../types';
import { recalculateQuoteTotals } from '../../shared/pricing/documentTotals';

function mat(id: string, section: string | undefined, totalPrice = 100): Material {
  return {
    id,
    name: `Item ${id}`,
    quantity: 1,
    unit: 'each',
    price: totalPrice,
    totalPrice,
    manualPriceOverride: true,
    section,
  };
}

function sec(name: string, sortOrder: number, laborTotal = 0): QuoteSection {
  return {
    id: name,
    name,
    multiplier: 1,
    laborHours: laborTotal > 0 ? 1 : 0,
    laborHoursTotal: laborTotal > 0 ? 1 : 0,
    laborRate: laborTotal,
    laborUnit: 'hours',
    laborTotal,
    sortOrder,
  };
}

function state(): SectionsState {
  return {
    sections: [sec('Demolition', 0, 340), sec('Painting', 1, 850)],
    materials: [mat('a', 'Demolition'), mat('b', 'Painting', 250), mat('c', undefined, 60)],
  };
}

describe('createSection', () => {
  it('creates a section with a name and no labour hours', () => {
    // The old screen refused to create a section without hours, so a tradie
    // who just wanted "Bathroom" and "Kitchen" as headings couldn't have one.
    const next = createSection({ sections: [], materials: [] }, { name: 'Bathroom' });
    expect(next.sections).toHaveLength(1);
    expect(next.sections[0].name).toBe('Bathroom');
    expect(next.sections[0].laborHours).toBe(0);
    expect(next.sections[0].laborTotal).toBe(0);
    expect(next.sections[0].sortOrder).toBe(0);
  });

  it('derives laborTotal from hours × rate × multiplier when labour is given', () => {
    const next = createSection(
      { sections: [], materials: [] },
      { name: 'Framing', laborHours: 2, laborRate: 85, multiplier: 3 },
    );
    expect(next.sections[0].laborTotal).toBe(510);
    expect(next.sections[0].laborHoursTotal).toBe(6);
  });

  it('stores a lump-sum section with zeroed hours and rate', () => {
    const next = createSection(
      { sections: [], materials: [] },
      { name: 'Regrout', pricing: 'lumpSum', laborTotal: 1200 },
    );
    const s = next.sections[0];
    expect(s.pricing).toBe('lumpSum');
    expect(s.laborTotal).toBe(1200);
    expect(s.laborHours).toBe(0);
    expect(s.laborHoursTotal).toBe(0);
    expect(s.laborRate).toBe(0);
  });

  it('refuses a blank name rather than creating an unnamed section', () => {
    const before = state();
    expect(createSection(before, { name: '   ' })).toBe(before);
  });
});

describe('renameSection', () => {
  it('rewrites the sections row and every material in one document', () => {
    const next = renameSection(state(), 'Painting', 'Interior Painting');
    expect(next.sections.map((s) => s.name)).toEqual(['Demolition', 'Interior Painting']);
    expect(next.materials.find((m) => m.id === 'b')!.section).toBe('Interior Painting');
    // Nothing else moves.
    expect(next.materials.find((m) => m.id === 'a')!.section).toBe('Demolition');
    expect(next.materials.find((m) => m.id === 'c')!.section).toBeUndefined();
  });

  it('leaves the document untouched for a no-op rename', () => {
    const before = state();
    expect(renameSection(before, 'Painting', ' Painting ')).toBe(before);
    expect(renameSection(before, 'Painting', '')).toBe(before);
  });
});

describe('setSectionDescription', () => {
  it('sets the description, trimmed, on the named section only', () => {
    const next = setSectionDescription(state(), 'Painting', '  Two coats to the new walls.\nCeilings by others.  ');
    expect(next.sections.find((s) => s.name === 'Painting')!.description).toBe(
      'Two coats to the new walls.\nCeilings by others.',
    );
    expect('description' in next.sections.find((s) => s.name === 'Demolition')!).toBe(false);
  });

  it('empty or blank text removes the key entirely (never stored as undefined)', () => {
    const withText = setSectionDescription(state(), 'Painting', 'Two coats.');
    for (const blank of ['', '   ', '\n\n']) {
      const cleared = setSectionDescription(withText, 'Painting', blank);
      const painting = cleared.sections.find((s) => s.name === 'Painting')!;
      expect('description' in painting).toBe(false);
    }
  });

  it('an unknown section name is a no-op', () => {
    const before = state();
    expect(setSectionDescription(before, 'Plastering', 'Sheet and set.')).toBe(before);
  });

  it('leaves materials, labour and money untouched', () => {
    const before = state();
    const next = setSectionDescription(before, 'Demolition', 'Remove the old kitchen.');
    expect(next.materials).toBe(before.materials);
    const { description, ...rest } = next.sections.find((s) => s.name === 'Demolition')!;
    expect(description).toBe('Remove the old kitchen.');
    expect(rest).toEqual(before.sections.find((s) => s.name === 'Demolition'));
    expect(sectionTotals(next, 'Demolition')).toEqual(sectionTotals(before, 'Demolition'));
    expect(next.sections.find((s) => s.name === 'Painting')).toBe(before.sections.find((s) => s.name === 'Painting'));
  });

  it('typed text drops the generated stamp — it is the tradie\'s own now', () => {
    const before: SectionsState = {
      ...state(),
      sections: state().sections.map((s) =>
        s.name === 'Painting' ? { ...s, description: 'From the scope.', descriptionSource: 'generated' as const } : s,
      ),
    };
    const typed = setSectionDescription(before, 'Painting', 'My words.').sections.find((s) => s.name === 'Painting')!;
    expect(typed.description).toBe('My words.');
    expect('descriptionSource' in typed).toBe(false);
    const cleared = setSectionDescription(before, 'Painting', '').sections.find((s) => s.name === 'Painting')!;
    expect('description' in cleared).toBe(false);
    expect('descriptionSource' in cleared).toBe(false);
  });

  it('saves a description for a section that exists only on its materials, as a $0 lump sum, totals unchanged', () => {
    const before: SectionsState = {
      sections: state().sections,
      materials: [...state().materials, mat('d', 'Site clean', 40)],
    };
    const next = setSectionDescription(before, 'Site clean', '  Sweep out and take the rubbish away. ');
    const created = next.sections.find((s) => s.name === 'Site clean')!;
    expect(created.description).toBe('Sweep out and take the rubbish away.');
    expect(created.pricing).toBe('lumpSum');
    expect(created.laborTotal).toBe(0);
    expect(created.laborHours).toBe(0);
    expect(created.laborRate).toBe(0);
    expect('descriptionSource' in created).toBe(false);
    expect(next.materials).toBe(before.materials);

    // Labour here already comes from the section records, and the heal
    // ignores lump sums, so a $0 record moves no money.
    const quote = {
      job: { id: 'j', name: 'Reno', description: 'Reno' },
      materials: before.materials,
      sections: before.sections,
      laborRate: 85,
      laborHours: 20,
      markup: 15,
      laborMarkup: 10,
      pricesIncludeGst: false,
      gstRegistered: true,
    } as unknown as Quote;
    expect(sectionChangeKeepsTotals(quote, next)).toBe(true);
    const a = recalculateQuoteTotals(quote);
    const b = recalculateQuoteTotals({ ...quote, sections: next.sections, materials: next.materials });
    expect(b.total).toBe(a.total);
    expect(b.laborTotal).toBe(a.laborTotal);
  });

  it('a blank description on a materials-only name creates nothing', () => {
    const before: SectionsState = { sections: [], materials: [mat('d', 'Site clean', 40)] };
    expect(setSectionDescription(before, 'Site clean', '   ')).toBe(before);
  });

  it('sectionChangeKeepsTotals refuses a first section record on a quote whose labour is top-level', () => {
    const before: SectionsState = { sections: [], materials: [mat('d', 'Site clean', 40)] };
    const next = setSectionDescription(before, 'Site clean', 'Sweep out.');
    expect(next.sections).toHaveLength(1);
    const quote = {
      job: { id: 'j', name: 'Clean', description: 'Clean' },
      materials: before.materials,
      sections: [],
      laborRate: 85,
      laborHours: 4,
      markup: 0,
      pricesIncludeGst: false,
      gstRegistered: true,
    } as unknown as Quote;
    expect(sectionChangeKeepsTotals(quote, next)).toBe(false);
    // With no labour at all there is nothing to move.
    expect(sectionChangeKeepsTotals({ ...quote, laborHours: 0 } as Quote, next)).toBe(true);
  });

  it('renameSection keeps the description', () => {
    const described = setSectionDescription(state(), 'Painting', 'Two coats.');
    const renamed = renameSection(described, 'Painting', 'Interior Painting');
    expect(renamed.sections.find((s) => s.name === 'Interior Painting')!.description).toBe('Two coats.');
  });
});

describe('deleteSection', () => {
  it('loses no line when asked to keep the items', () => {
    const next = deleteSection(state(), 'Painting', { keepMaterials: true });
    expect(next.sections.map((s) => s.name)).toEqual(['Demolition']);
    expect(next.materials).toHaveLength(3);
    // The kept line is unsectioned, not orphaned onto a section that is gone.
    expect(next.materials.find((m) => m.id === 'b')!.section).toBeUndefined();
  });

  it('takes the items with it when explicitly asked to', () => {
    const next = deleteSection(state(), 'Painting', { keepMaterials: false });
    expect(next.materials.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('renumbers sortOrder so the array order and sortOrder cannot disagree', () => {
    const before: SectionsState = {
      sections: [sec('A', 0), sec('B', 1), sec('C', 2)],
      materials: [],
    };
    const next = deleteSection(before, 'B', { keepMaterials: true });
    expect(next.sections.map((s) => [s.name, s.sortOrder])).toEqual([['A', 0], ['C', 1]]);
  });
});

describe('moveSection', () => {
  it('swaps a section with its neighbour and renumbers', () => {
    const next = moveSection(state(), 'Painting', -1);
    expect(next.sections.map((s) => [s.name, s.sortOrder])).toEqual([['Painting', 0], ['Demolition', 1]]);
  });

  it('is a no-op at either end, and for a section that is not there', () => {
    const before = state();
    expect(moveSection(before, 'Demolition', -1)).toBe(before);
    expect(moveSection(before, 'Painting', 1)).toBe(before);
    expect(moveSection(before, 'Nope', 1)).toBe(before);
  });
});

describe('ordering', () => {
  it('falls back to the array index when sortOrder is missing', () => {
    // A legacy document must not reorder itself just for being read.
    const legacy = [
      { ...sec('B', 0), sortOrder: undefined as unknown as number },
      { ...sec('A', 0), sortOrder: undefined as unknown as number },
    ];
    expect(sortedSections(legacy).map((s) => s.name)).toEqual(['B', 'A']);
  });

  it('normaliseSortOrder returns the same objects when nothing changed', () => {
    const sections = [sec('A', 0), sec('B', 1)];
    const next = normaliseSortOrder(sections);
    expect(next[0]).toBe(sections[0]);
    expect(next[1]).toBe(sections[1]);
  });
});

describe('sectionTotals', () => {
  it('includes the section labour, not just its materials', () => {
    // The footer used to sum materials alone under the label "Section Total",
    // so a section whose whole cost was labour read $0.00.
    expect(sectionTotals(state(), 'Painting')).toEqual({
      materials: 250,
      labour: 850,
      total: 1100,
    });
  });

  it('is zero for a section nobody has put anything in', () => {
    expect(sectionTotals(state(), 'Nope')).toEqual({ materials: 0, labour: 0, total: 0 });
  });
});

describe('names', () => {
  it('sees a section a material knows about but the sections array does not', () => {
    const orphaned: SectionsState = { sections: [], materials: [mat('x', 'Ghost')] };
    expect(sectionNames(orphaned)).toEqual(['Ghost']);
  });

  it('suffixes a duplicate name rather than merging two sections', () => {
    expect(uniqueSectionName(state(), 'Painting')).toBe('Painting (2)');
    expect(uniqueSectionName(state(), 'Roofing')).toBe('Roofing');
  });
});

describe('moveMaterialToSection', () => {
  it('drops the template-derived quantity link when a line changes section', () => {
    const before: SectionsState = {
      sections: [sec('A', 0)],
      materials: [{ ...mat('a', 'A'), templateBaseQuantity: 2 }],
    };
    const next = moveMaterialToSection(before, 'a', null);
    expect(next.materials[0].section).toBeUndefined();
    expect(next.materials[0].templateBaseQuantity).toBeUndefined();
  });
});
