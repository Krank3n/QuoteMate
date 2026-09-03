/**
 * simplifySearchTerm — soften an over-specified supplier search term for a
 * rescue retry after every candidate was rejected as the wrong category.
 *
 * Generation emits precise terms ("2400x100x100mm CCA Treated Hardwood Post
 * (Durability Class 1)") that supplier search engines answer with keyword-
 * adjacent junk (drill bits, steel posts). The category-level version
 * ("treated hardwood post") usually surfaces the real product family. Same
 * idea as the scraper's zero-result softening, but run client-side when
 * results existed and were all wrong.
 *
 * Returns null when simplification produces nothing new or nothing usable —
 * callers should skip the retry in that case.
 */
export function simplifySearchTerm(term: string): string | null {
  if (!term) return null;
  const simplified = term
    // Parentheticals: "(Durability Class 1)", "(pair)"
    .replace(/\([^)]*\)/g, ' ')
    // 2- and 3-way dimensions: "2400x100x100mm", "100 x 75mm", "150x25"
    .replace(/\b\d+(?:\.\d+)?\s*(?:mm|cm|m)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m)?(?:\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m)?)?\b/gi, ' ')
    // Standalone lengths/sizes: "2.4m", "600mm", "90mm"
    .replace(/\b\d+(?:\.\d+)?\s*(?:mm|cm|m)\b/gi, ' ')
    // Weights/volumes: "20kg", "15kg bag", "4L", "750ml"
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|l|ml|litres?|liters?)s?\b/gi, ' ')
    // Timber grades / treatments: H3, MGP10, F17, LOSP, CCA, ACQ
    .replace(/\b(?:h[234]|mgp\d+|f\d+|losp|cca|acq|micropro|tanalised|tanalith)\b/gi, ' ')
    // Screw gauges: "10G", "14 gauge"
    .replace(/\b\d+\s*(?:g|gauge)\b/gi, ' ')
    .replace(/\bdurability\s+class\s*\d\b/gi, ' ')
    // Pack qualifiers: "4 pack", "100pk", "box of 500"
    .replace(/\b(?:box|pack|packet)\s+of\s+\d+\b/gi, ' ')
    .replace(/\b\d+\s*[- ]?(?:pack|pk|box)\b/gi, ' ')
    // Leftover bare numbers from stripped compounds
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    // Orphaned dimension separators left behind ("14g x 125mm" → " x ")
    .replace(/\s+[x×]\s+/gi, ' ')
    .replace(/(?:^|\s)[x×](?:\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!simplified || simplified.length < 3) return null;
  if (simplified.toLowerCase() === term.trim().toLowerCase()) return null;
  return simplified;
}
