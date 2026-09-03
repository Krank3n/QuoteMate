// asPriced snapshot — the row exactly as the pricing pipeline left it.
//
// Send-time telemetry diffs the sent material against this snapshot: any
// difference is a tradie correction, i.e. a confirmed pipeline miss (wrong
// price, wrong product, wrong count). Unlike replay audits judged by an LLM,
// these are ground truth — a tradie doesn't edit a row that was right.

import { Material } from './types';

export interface AsPricedSnapshot {
  price: number;
  quantity: number;
  name: string;
  pricingSource?: Material['pricingSource'];
  priceConfidence?: Material['priceConfidence'];
}

/**
 * Stamp every pipeline-priced row with its as-priced state. Runs at the end
 * of a price-fetch run, overwriting any previous snapshot — the latest
 * pipeline output is the new baseline (a re-price resets what "unedited"
 * means). Hand-priced rows (manualPriceOverride) are not pipeline output, so
 * they carry no snapshot and never count as pipeline hits or misses.
 */
export function stampAsPriced(materials: Material[]): void {
  for (const m of materials) {
    // A work item is the tradie's own lump sum, never pipeline output — same
    // reasoning as manualPriceOverride below.
    if (m.kind === 'work' || m.manualPriceOverride) {
      m.asPriced = undefined;
      continue;
    }
    m.asPriced = {
      price: m.price,
      quantity: m.quantity,
      name: m.name,
      pricingSource: m.pricingSource,
      priceConfidence: m.priceConfidence,
    };
  }
}
