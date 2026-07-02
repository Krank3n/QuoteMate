// Price-fetch outcome summariser — turns a completed fetchPricesForQuote run
// into the compact payload reportPriceFetchUsage (Firebase callable) expects.
//
// Kept in its own pure module (types-only imports) so the pricingSource →
// telemetry-bucket mapping is unit-testable without dragging materialsPipeline's
// react-native / LLM import graph into the test runner.

import type { Material } from '../types';

export interface PriceFetchOutcomeCounts {
  fetchedCount: number;
  failedCount: number;
  skippedCount: number;
  cancelled: boolean;
}

export interface PriceFetchUsageSummary {
  fetched: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  bySource: { bunnings: number; reece: number; websearch: number; local: number };
}

/**
 * Count priced rows (price > 0) by their resolved pricingSource, mapping each
 * supplier channel onto the telemetry bucket names:
 *   scraper → bunnings, api → reece, ai → websearch, manual → local.
 * Rows that never resolved a price (price <= 0) are not counted in bySource.
 */
export function summarizePriceFetchOutcome(
  materials: Material[],
  counts: PriceFetchOutcomeCounts,
): PriceFetchUsageSummary {
  const bySource = { bunnings: 0, reece: 0, websearch: 0, local: 0 };
  for (const m of materials) {
    if (!(m.price > 0)) continue;
    switch (m.pricingSource) {
      case 'scraper':
        bySource.bunnings += 1;
        break;
      case 'api':
        bySource.reece += 1;
        break;
      case 'ai':
        bySource.websearch += 1;
        break;
      case 'manual':
        bySource.local += 1;
        break;
      default:
        break;
    }
  }
  return {
    fetched: counts.fetchedCount,
    failed: counts.failedCount,
    skipped: counts.skippedCount,
    cancelled: counts.cancelled,
    bySource,
  };
}
