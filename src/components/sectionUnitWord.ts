/**
 * Unit word for a material row's per-unit subtitle, derived from its section
 * name: "Fence Bay" → "bay", "Deck Section" → "section". Punctuation is
 * stripped because pipeline sections arrive like "Floor Tiling (per m²)" —
 * the last word taken verbatim rendered as "1/m²) ·" on a real quote.
 *
 * Own module (not in MaterialItemCard) so it can be unit tested without the
 * component's react-native import graph.
 */
export function sectionUnitWord(section: string | undefined): string {
  const words = (section || '').split(/\s+/).filter(Boolean);
  const last = (words[words.length - 1] || '').replace(/[()[\]{}.,]/g, '').toLowerCase();
  return last || 'unit';
}
