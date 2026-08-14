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
 *   exactly one of the two flags false → 'summary'
 *   both false                         → 'total'
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

function fromLegacyPair(materials?: boolean, labour?: boolean): PriceDetail {
  const showMaterials = materials !== false;
  const showLabour = labour !== false;
  if (showMaterials && showLabour) return 'itemised';
  if (!showMaterials && !showLabour) return 'total';
  return 'summary';
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
 * 'summary' maps to materials-shown / labour-hidden because that is the shape
 * an old build renders closest to it: line names visible, no separate labour
 * block.
 */
export function legacyFlagsFor(detail: PriceDetail): {
  showMaterialCosts: boolean;
  showLaborCosts: boolean;
} {
  switch (detail) {
    case 'total':
      return { showMaterialCosts: false, showLaborCosts: false };
    case 'summary':
      return { showMaterialCosts: true, showLaborCosts: false };
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
