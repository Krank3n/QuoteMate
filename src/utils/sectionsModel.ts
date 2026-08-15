/**
 * Every section mutation, as pure functions over { sections, materials }.
 *
 * A section exists in TWO places: as a `QuoteSection` row, and as a `section`
 * NAME string repeated on every material that belongs to it. Each mutation
 * therefore has to rewrite both, in one document, or the two disagree — and a
 * material whose `section` names a section that no longer exists is an orphan:
 * it vanishes from the sectioned part of the list, is silently regrouped under
 * a phantom heading, and its dollars still count toward the total. That class
 * of bug is structural, not a matter of care, so the fix is structural: the
 * screen calls these functions and never rewrites one array without the other.
 *
 * Pure by design — no store, no navigation, no React — so the rules are
 * testable without rendering a 4,000-line screen.
 */

import { Material, QuoteSection } from '../types';

export interface SectionsState {
  sections: QuoteSection[];
  materials: Material[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rewrite sortOrder to 0..n-1 in the array's current order, so "the order the
 * array is in" and "the order sortOrder says" can never disagree. Called at
 * the end of every mutation that can change the order, which is also how a
 * document authored before sortOrder was reliable gets backfilled — on its
 * next section edit, not on read.
 */
export function normaliseSortOrder(sections: QuoteSection[]): QuoteSection[] {
  return sections.map((s, i) => (s.sortOrder === i ? s : { ...s, sortOrder: i }));
}

/**
 * Sections in the one true order: sortOrder, then the array's own order as the
 * tie-break. Missing/duplicate sortOrder values (legacy documents) fall back
 * to the stable array index rather than to an alphabetical sort, so a document
 * never reorders itself just for being read.
 */
export function sortedSections(sections: QuoteSection[] | undefined | null): QuoteSection[] {
  return (sections || [])
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const oa = typeof a.s.sortOrder === 'number' ? a.s.sortOrder : a.i;
      const ob = typeof b.s.sortOrder === 'number' ? b.s.sortOrder : b.i;
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    })
    .map(({ s }) => s);
}

/** Every section name in play — the rows plus any name only a material knows. */
export function sectionNames(state: SectionsState): string[] {
  const names = new Set<string>();
  sortedSections(state.sections).forEach((s) => names.add(s.name));
  state.materials.forEach((m) => { if (m.section) names.add(m.section); });
  return Array.from(names);
}

/** "Bathroom" → "Bathroom (2)" when the name is taken. */
export function uniqueSectionName(state: SectionsState, baseName: string): string {
  const taken = new Set(sectionNames(state));
  if (!taken.has(baseName)) return baseName;
  let counter = 2;
  while (taken.has(`${baseName} (${counter})`)) counter++;
  return `${baseName} (${counter})`;
}

export interface CreateSectionInput {
  name: string;
  /** Hours per unit. Optional — a section is creatable with a name alone. */
  laborHours?: number;
  laborRate?: number;
  multiplier?: number;
  description?: string;
  /** 'lumpSum' stores the typed `laborTotal` and zeroes hours/rate. */
  pricing?: 'hourly' | 'lumpSum';
  /** The typed price, for a lump-sum section. */
  laborTotal?: number;
  id?: string;
}

/**
 * Create a section. Labour is OPTIONAL: a tradie who just wants to group
 * "Bathroom" and "Kitchen" materials shouldn't have to invent a number of
 * hours to be allowed to. A section with no labour is simply worth $0 of
 * labour, which is honest and reversible.
 */
export function createSection(state: SectionsState, input: CreateSectionInput): SectionsState {
  const name = input.name.trim();
  if (!name) return state;

  const isLumpSum = input.pricing === 'lumpSum';
  const hours = isLumpSum ? 0 : (input.laborHours || 0);
  const rate = isLumpSum ? 0 : (input.laborRate || 0);
  const multiplier = input.multiplier && input.multiplier > 0 ? input.multiplier : 1;

  const section: QuoteSection = {
    id: input.id ?? `section-${Date.now()}`,
    name,
    multiplier,
    laborHours: hours,
    laborHoursTotal: round2(hours * multiplier),
    laborRate: rate,
    laborUnit: 'hours',
    laborTotal: isLumpSum ? round2(input.laborTotal || 0) : round2(hours * rate * multiplier),
    sortOrder: state.sections.length,
    ...(isLumpSum ? { pricing: 'lumpSum' as const } : {}),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };

  return {
    sections: normaliseSortOrder([...state.sections, section]),
    materials: state.materials,
  };
}

/**
 * Rename a section in ONE document write: the section row AND every material
 * carrying the old name. Rewriting only one of the two is what orphans lines.
 */
export function renameSection(state: SectionsState, oldName: string, rawNewName: string): SectionsState {
  const newName = rawNewName.trim();
  if (!newName || newName === oldName) return state;
  return {
    sections: state.sections.map((s) => (s.name === oldName ? { ...s, name: newName } : s)),
    materials: state.materials.map((m) => (m.section === oldName ? { ...m, section: newName } : m)),
  };
}

export interface DeleteSectionOptions {
  /**
   * true  — keep the section's materials, unsectioned. Nothing is lost, and
   *         the tradie can regroup them.
   * false — delete the materials with the section.
   *
   * Deleting a section used to always take its lines with it, with no way
   * back: a mis-tap on a section of fifteen priced rows meant re-pricing all
   * fifteen. Deliberately explicit, so no caller gets the destructive one by
   * accident.
   */
  keepMaterials: boolean;
}

export function deleteSection(
  state: SectionsState,
  name: string,
  options: DeleteSectionOptions,
): SectionsState {
  return {
    sections: normaliseSortOrder(state.sections.filter((s) => s.name !== name)),
    materials: options.keepMaterials
      ? state.materials.map((m) =>
          m.section === name ? { ...m, section: undefined, templateBaseQuantity: undefined } : m,
        )
      : state.materials.filter((m) => m.section !== name),
  };
}

/**
 * Move a section one place up or down. Move up/down rather than drag: the
 * materials list is a virtualised FlatList, and drag-and-drop reordering was
 * removed deliberately to keep that virtualisation.
 */
export function moveSection(state: SectionsState, name: string, direction: -1 | 1): SectionsState {
  const ordered = sortedSections(state.sections);
  const from = ordered.findIndex((s) => s.name === name);
  if (from < 0) return state;
  const to = from + direction;
  if (to < 0 || to >= ordered.length) return state;
  const next = [...ordered];
  [next[from], next[to]] = [next[to], next[from]];
  return { sections: normaliseSortOrder(next), materials: state.materials };
}

/** Move one material into a section, or out of every section with `null`. */
export function moveMaterialToSection(
  state: SectionsState,
  materialId: string,
  targetSection: string | null,
): SectionsState {
  return {
    sections: state.sections,
    materials: state.materials.map((m) =>
      m.id === materialId
        ? { ...m, section: targetSection ?? undefined, templateBaseQuantity: undefined }
        : m,
    ),
  };
}

/**
 * What a section is actually worth: its materials AND its labour. The footer
 * used to show only the materials sum under the label "Section Total", so a
 * section whose whole cost was labour read as $0.00.
 */
export function sectionTotals(state: SectionsState, name: string): {
  materials: number;
  labour: number;
  total: number;
} {
  const materials = round2(
    state.materials.reduce((sum, m) => (m.section === name ? sum + (m.totalPrice || 0) : sum), 0),
  );
  const labour = round2(
    state.sections.reduce((sum, s) => (s.name === name ? sum + (s.laborTotal || 0) : sum), 0),
  );
  return { materials, labour, total: round2(materials + labour) };
}
