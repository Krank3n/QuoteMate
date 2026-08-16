/**
 * The three checks the new-quote wizard runs over a materials list, pulled out
 * of the screens so they can be tested without mounting a navigator.
 *
 * All three exist because a quote built from lump-sum scope lines looks, to
 * the old checks, like a broken materials quote: its prices are typed rather
 * than fetched, one of its lines is deliberately $0, and it carries no labour
 * hours at all. Left alone they fire two false warnings at a painter and let a
 * stray blank row rewrite the customer's PDF.
 */

import type { Material } from '../../types';
import { isWorkItem } from '../../../shared/document';

/** A row the tradie started typing and abandoned. Never a real line. */
export function isBlankDraft(m: Pick<Material, 'name'>): boolean {
  return !m.name?.trim();
}

/**
 * The rapid-entry chain spawns a fresh blank row after every save, so leaving
 * the materials screen strands an unnamed $0 material in the quote. It used to
 * ride onto the customer's PDF as an empty "1 each · $0.00" line, and a single
 * kind-less row is enough to knock a pure scope quote out of the Project Scope
 * layout. Drop them on the way out.
 */
export function pruneBlankMaterials(materials: Material[] | undefined): Material[] {
  return (materials || []).filter((m) => !isBlankDraft(m));
}

/**
 * Whether to warn "some materials don't have prices yet".
 *
 * A work item at $0 is a deliberate inclusions line — the row a painter writes
 * to say what they're covering for free — so it is not unpriced, it is priced
 * at nothing on purpose. Blank drafts aren't materials missing a price either.
 */
export function hasUnpricedMaterials(materials: Material[] | undefined): boolean {
  return (materials || []).some(
    (m) => m.price === 0 && !isWorkItem(m) && !isBlankDraft(m),
  );
}

/**
 * Whether the quote's labour is already inside its scope lines. When it is,
 * zero labour hours is the correct answer and the "Zero Labor Cost" warning is
 * telling the tradie their own quote is broken.
 */
export function labourIsInScopeLines(materials: Material[] | undefined): boolean {
  return (materials || []).some((m) => isWorkItem(m) && (m.totalPrice || 0) > 0);
}
