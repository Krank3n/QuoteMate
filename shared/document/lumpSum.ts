/**
 * Lump-sum pricing, and the one rule every money path has to know about it.
 *
 * Two shapes carry a price the TRADIE TYPED: a section with
 * `pricing: 'lumpSum'`, and a work item (`Material.kind === 'work'`). Neither
 * has anything behind it to derive dollars from — a lump-sum section has no
 * hours and no rate (both 0 by invariant), and a work item's quantity is a
 * fixed 1 — so nothing may recompute them and, crucially, nothing may mark
 * them up. A tradie who types $1,200 into a "Bathroom regrout" section and
 * reads $1,380 on the customer's copy has been lied to by their own software;
 * the whole point of typing a lump sum is that it IS the price. The field even
 * says "Line total".
 *
 * Rate-based pricing keeps its markup untouched — hourly labour is a margin on
 * a rate the tradie set as a rate, and a real material is a margin on a
 * supplier price they didn't set at all. This module is the single place that
 * split lives, so the client calculator, the shared integrity check, the
 * server's hide-markup display pass and the PDF can't drift apart on it.
 */

export interface LumpSumSectionLike {
  pricing?: 'hourly' | 'lumpSum';
  laborTotal?: number;
}

export interface WorkItemLike {
  kind?: 'material' | 'work';
  totalPrice?: number;
}

export function isLumpSumSection(s: LumpSumSectionLike | undefined | null): boolean {
  return !!s && s.pricing === 'lumpSum';
}

/** Σ of the lump-sum sections' dollars. */
export function lumpSumLabourTotal(sections?: LumpSumSectionLike[] | null): number {
  return (sections || []).reduce(
    (sum, s) => sum + (isLumpSumSection(s) ? (Number(s.laborTotal) || 0) : 0),
    0,
  );
}

/**
 * The slice of a document's labour total that labour markup may be applied to
 * — everything except the lump sums. Never negative: a document whose lump
 * sums somehow exceed its labour total gets a zero markup base rather than a
 * credit.
 */
export function markupableLabourTotal(
  laborTotal: number,
  sections?: LumpSumSectionLike[] | null,
): number {
  return Math.max(0, (Number(laborTotal) || 0) - lumpSumLabourTotal(sections));
}

/** A work item is a lump sum wearing a material's clothes. */
export function isWorkItem(m: WorkItemLike | undefined | null): boolean {
  return !!m && m.kind === 'work';
}

/**
 * The markup multiplier to apply to ONE line. Work items always get 1 — their
 * price is final. Renderers must use this per row rather than multiplying the
 * whole materials array, or a scope line silently inflates.
 */
export function lineMarkupMultiplier(m: WorkItemLike, multiplier: number): number {
  return isWorkItem(m) ? 1 : multiplier;
}

/**
 * Σ of the work items' dollars — the slice of a materials subtotal that
 * material markup may NOT be applied to.
 */
export function workItemsTotal(materials?: WorkItemLike[] | null): number {
  return (materials || []).reduce(
    (sum, m) => sum + (isWorkItem(m) ? (Number(m.totalPrice) || 0) : 0),
    0,
  );
}

/**
 * The slice of a document's materials subtotal that material markup may be
 * applied to — everything except the work items. Never negative, for the same
 * reason as markupableLabourTotal.
 */
export function markupableMaterialsTotal(
  materialsSubtotal: number,
  materials?: WorkItemLike[] | null,
): number {
  return Math.max(0, (Number(materialsSubtotal) || 0) - workItemsTotal(materials));
}
