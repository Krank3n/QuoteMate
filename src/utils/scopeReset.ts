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
 * zero, so the pipeline's own estimate stands, exactly as on a fresh draft) —
 * including the extra-hours adjustment, which was the LAST run's difference
 * between a stated total and its sections, not this run's.
 */
import type { Material, Quote, QuoteSection } from '../types';

export function isTradieRow(m: Pick<Material, 'origin' | 'manualPriceOverride'>): boolean {
  return m.origin === 'manual' || m.manualPriceOverride === true;
}

function withoutGeneratedDescription(s: QuoteSection): QuoteSection {
  if (s.descriptionSource !== 'generated') return s;
  const { description: _description, descriptionSource: _source, ...rest } = s;
  return rest;
}

export function resetGeneratedScope(quote: Quote, hours?: number): Quote {
  const materials = (quote.materials || []).filter(isTradieRow);
  const referenced = new Set(materials.map((m) => m.section).filter((s): s is string => !!s));
  // A kept section's generated description described the OLD scope; drop it
  // (and its stamp) so the re-run can write one for the new scope. Text the
  // tradie typed has no stamp and stays.
  const sections: QuoteSection[] | undefined = quote.sections
    ? quote.sections.filter((s) => referenced.has(s.name)).map(withoutGeneratedDescription)
    : undefined;
  return {
    ...quote,
    materials,
    ...(sections !== undefined ? { sections } : {}),
    laborHours: typeof hours === 'number' && hours > 0 ? hours : 0,
    laborExtraHours: 0,
  };
}
