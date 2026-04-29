/**
 * parsePackInfo — extract pack size/unit from a product title.
 *
 * Hardware-store titles bundle pack info into the name: "Decking Screws Box of
 * 500", "Treated Pine 90x45 5.4m", "Joist Tape 50mm x 20m roll". Without this,
 * a quote that needs 750 screws and pulls back the box price multiplies the
 * box price by 750 — turning $147 of screws into $22,140.
 *
 * Returns null when the title doesn't expose pack info clearly. Callers should
 * leave qty unchanged in that case (and ideally flag the row low-confidence
 * for items like screws/nails/clips/tape that almost always come in packs).
 */

export interface PackInfo {
  packSize: number;
  packUnit: 'each' | 'm' | 'm²' | 'm³' | 'L' | 'kg' | 'box' | 'pack';
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

// Order matters — more specific patterns first.
const PATTERNS: Array<{ re: RegExp; unit: PackInfo['packUnit'] }> = [
  // "Box of 500", "Pack of 100", "Bag of 60", "Tub of 250"
  { re: new RegExp(String.raw`\b(?:box|pack|packet|bag|tub|carton|case)\s+of\s+${NUM}\b`, 'i'), unit: 'each' },
  // "500 pack", "100-pack", "100pk"
  { re: new RegExp(String.raw`\b${NUM}\s*[- ]?(?:pack|pk)\b`, 'i'), unit: 'each' },
  // "500 pieces", "500pc", "500 pcs"
  { re: new RegExp(String.raw`\b${NUM}\s*(?:pieces|piece|pcs|pc)\b`, 'i'), unit: 'each' },
  // Length: "5.4m length", "5.4m long", or just trailing "5.4m" / "2400mm" at end
  { re: new RegExp(String.raw`\b${NUM}\s*m(?:etres?|eters?)?\b(?:\s+(?:length|long|roll))?`, 'i'), unit: 'm' },
  { re: new RegExp(String.raw`\b${NUM}\s*mm\s+(?:length|long)\b`, 'i'), unit: 'm' }, // mm length → convert below
  // Volume: "4L", "20 litre"
  { re: new RegExp(String.raw`\b${NUM}\s*(?:l|lt|litres?|liters?)\b`, 'i'), unit: 'L' },
  // Weight: "20kg bag", "1kg tub"
  { re: new RegExp(String.raw`\b${NUM}\s*kg\b`, 'i'), unit: 'kg' },
];

const MM_LENGTH_RE = new RegExp(String.raw`\b${NUM}\s*mm\s+(?:length|long)\b`, 'i');

/**
 * Extract pack size/unit from a product title. Returns null when nothing
 * obvious matches — caller should leave the material's qty alone.
 */
export function parsePackInfo(productName: string | undefined | null): PackInfo | null {
  if (!productName) return null;
  const title = productName.trim();
  if (!title) return null;

  // Special-case mm lengths — convert to metres so packUnit stays in 'm'.
  const mmMatch = title.match(MM_LENGTH_RE);
  if (mmMatch) {
    const mm = parseFloat(mmMatch[1]);
    if (mm > 0) return { packSize: mm / 1000, packUnit: 'm' };
  }

  for (const { re, unit } of PATTERNS) {
    const match = title.match(re);
    if (!match) continue;
    const size = parseFloat(match[1]);
    if (!isFinite(size) || size <= 0) continue;
    // Skip nonsensical pack sizes (a "0.5 pack" or a "1 each" is just per-unit).
    if (unit === 'each' && size < 2) continue;
    return { packSize: size, packUnit: unit };
  }

  return null;
}

/**
 * Items that are almost always sold in packs/rolls/lengths. Used to flag
 * low confidence when no pack info could be extracted — these rows are the
 * ones most likely to inflate a quote when priced per-unit.
 */
const BULK_KEYWORDS = [
  'screw', 'nail', 'clip', 'fastener', 'bolt', 'nut', 'washer', 'rivet',
  'staple', 'bracket', 'connector', 'tape', 'concrete', 'cement', 'mortar',
  'sand', 'gravel', 'road base', 'mulch', 'soil', 'compost',
];

export function isLikelyBulkItem(name: string | undefined | null): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return BULK_KEYWORDS.some(kw => lower.includes(kw));
}
