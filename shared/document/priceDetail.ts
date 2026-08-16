/**
 * How much of the money a customer sees — one question, one answer, one place.
 *
 * This used to be two independent booleans (`showMaterialCosts`,
 * `showLaborCosts`) whose four combinations expressed three meanings, and the
 * same "per-doc override > business default > show" expression was written out
 * by hand in ELEVEN places: both client PDF mappers, four server document
 * handlers, the acceptance-page payload, and the two in-app editor cards. Every
 * one of them was an opportunity for the two mapping layers to drift, and they
 * did — which is why a customer could be shown a breakdown on the web
 * acceptance page that their PDF deliberately hid.
 *
 * The three modes:
 *   'itemised' — every line with its quantity and unit price (today's default)
 *   'summary'  — line names and section totals; NO quantities, NO unit prices.
 *                This is the capability that was missing: "show them WHAT I'm
 *                doing, not what each bit costs me."
 *   'total'    — the grand total alone.
 *
 * GST is disclosed in every mode. It is a legal disclosure, not a preference.
 */

export type PriceDetail = 'itemised' | 'summary' | 'total';

/**
 * The three options as the tradie reads them, in increasing order of what
 * stays private. Shared so the per-document control and the business-default
 * control can't drift on the copy — they are the same choice in two places.
 */
export const PRICE_DETAIL_OPTIONS: { value: PriceDetail; label: string; blurb: string }[] = [
  { value: 'itemised', label: 'Itemised', blurb: 'Every line with its quantity and unit price.' },
  {
    value: 'summary',
    label: 'Scope only',
    blurb: 'What you\u2019re doing and the section totals \u2014 no quantities, no unit prices.',
  },
  { value: 'total', label: 'Total only', blurb: 'One number: the total.' },
];

export function priceDetailBlurb(detail: PriceDetail): string {
  return PRICE_DETAIL_OPTIONS.find((o) => o.value === detail)?.blurb ?? '';
}

export interface PriceDetailDocLike {
  priceDetail?: PriceDetail;
  showMaterialCosts?: boolean;
  showLaborCosts?: boolean;
}

export interface PriceDetailBusinessLike {
  defaultPriceDetail?: PriceDetail;
  showMaterialCostsByDefault?: boolean;
  showLaborCostsByDefault?: boolean;
}

function isPriceDetail(v: unknown): v is PriceDetail {
  return v === 'itemised' || v === 'summary' || v === 'total';
}

/**
 * Migration resolved ON READ — no backfill, so a document written by an older
 * build and never opened since still renders the way its author intended.
 *
 *   priceDetail set                    → wins outright
 *   both legacy flags true/undefined   → 'itemised'
 *   EITHER flag explicitly false       → 'total'
 *   nothing on the doc                 → business default → 'itemised'
 */
export function resolvePriceDetail(
  doc: PriceDetailDocLike | undefined | null,
  business?: PriceDetailBusinessLike | null,
): PriceDetail {
  if (doc && isPriceDetail(doc.priceDetail)) return doc.priceDetail;

  const docMaterials = doc?.showMaterialCosts;
  const docLabour = doc?.showLaborCosts;
  if (docMaterials !== undefined || docLabour !== undefined) {
    return fromLegacyPair(docMaterials, docLabour);
  }

  if (business && isPriceDetail(business.defaultPriceDetail)) return business.defaultPriceDetail;

  const bizMaterials = business?.showMaterialCostsByDefault;
  const bizLabour = business?.showLaborCostsByDefault;
  if (bizMaterials !== undefined || bizLabour !== undefined) {
    return fromLegacyPair(bizMaterials, bizLabour);
  }

  return 'itemised';
}

/**
 * Three modes cannot express the old pair's fourth state ("hide materials,
 * show labour" / "show materials, hide labour"), so a migration has to choose
 * — and it must choose to disclose LESS than the author did, never more.
 *
 * Mapping a half-hidden document to 'summary' looked natural and was wrong:
 * 'summary' prints every material NAME grouped by section, and the tradie who
 * switched materials off was hiding their supplier line-up. Because the
 * migration resolves on read, that would have changed documents already sent —
 * a customer re-opening an old acceptance link would see the list its author
 * had hidden. 'total' can only ever show less.
 *
 * So 'summary' is reachable only by explicitly choosing it. Nothing migrates
 * into it.
 */
function fromLegacyPair(materials?: boolean, labour?: boolean): PriceDetail {
  const showMaterials = materials !== false;
  const showLabour = labour !== false;
  return showMaterials && showLabour ? 'itemised' : 'total';
}

/**
 * The legacy pair to dual-write alongside `priceDetail`, so older installed
 * builds and any read path not yet migrated keep behaving correctly.
 *
 * REMOVE THIS once no build older than the release carrying `priceDetail` is
 * still installed — i.e. once the minimum supported app version is at or above
 * it — and drop `showMaterialCosts` / `showLaborCosts` from the write paths at
 * the same time. Until then, writing one without the other reintroduces
 * exactly the drift this module exists to remove.
 *
 * 'summary' dual-writes as BOTH flags false — i.e. an old build shows only the
 * grand total. That is deliberately less than 'summary' shows: the old pair
 * cannot express "names without prices", and an old build reading
 * materials-shown would print the per-line money 'summary' exists to hide.
 * Under-disclosing is recoverable; over-disclosing is not.
 */
export function legacyFlagsFor(detail: PriceDetail): {
  showMaterialCosts: boolean;
  showLaborCosts: boolean;
} {
  switch (detail) {
    case 'total':
      return { showMaterialCosts: false, showLaborCosts: false };
    case 'summary':
      return { showMaterialCosts: false, showLaborCosts: false };
    case 'itemised':
    default:
      return { showMaterialCosts: true, showLaborCosts: true };
  }
}

/** Per-line quantities and unit prices are shown in 'itemised' only. */
export function showsPerLineMoney(detail: PriceDetail): boolean {
  return detail === 'itemised';
}

/** Line items appear at all in 'itemised' and 'summary'. */
export function showsLineItems(detail: PriceDetail): boolean {
  return detail !== 'total';
}
