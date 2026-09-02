/**
 * What a scope change keeps from the previous materials run.
 *
 * generateMaterialsForQuote is additive by design: with rows already on the
 * quote it APPENDS the new list, appends the new sections, and ADDS its hour
 * estimate to the existing labour (materialsPipeline.ts, `hasExistingMaterials`).
 * That is right for the wizard's "add more" flow and wrong for a scope
 * correction — re-running "12 m of fence" over "10 m of fence" doubled the
 * list to 22 rows and the labour with it (sim run, 2 Sep 2026).
 *
 * So before the re-run, drop everything the last run generated and keep only
 * what the tradie put their own hand to: rows they added (`origin: 'manual'`)
 * or priced themselves (`manualPriceOverride`). Sections survive only while a
 * kept row still points at them. Labour restarts from the corrected hours (or
 * zero, so the pipeline's own estimate stands, exactly as on a fresh draft).
 */
import type { Material, Quote, QuoteSection } from '../types';

export function isTradieRow(m: Pick<Material, 'origin' | 'manualPriceOverride'>): boolean {
  return m.origin === 'manual' || m.manualPriceOverride === true;
}

export function resetGeneratedScope(quote: Quote, hours?: number): Quote {
  const materials = (quote.materials || []).filter(isTradieRow);
  const referenced = new Set(materials.map((m) => m.section).filter((s): s is string => !!s));
  const sections: QuoteSection[] | undefined = quote.sections
    ? quote.sections.filter((s) => referenced.has(s.name))
    : undefined;
  return {
    ...quote,
    materials,
    ...(sections !== undefined ? { sections } : {}),
    laborHours: typeof hours === 'number' && hours > 0 ? hours : 0,
  };
}
