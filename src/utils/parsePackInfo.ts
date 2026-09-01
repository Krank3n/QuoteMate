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

export interface ParsePackOptions {
  /**
   * The unit the CALLER needs the answer in. A title routinely states its pack
   * more than one way — "Earthwool R2.0 Wall Batt … 16.0m² 32 Pack" is both a
   * 32-piece pack and 16 m² of coverage — and declaration order alone picked
   * the count, which is useless to an m² requirement. The caller then found the
   * units incompatible and fell through to charging the pack price per m².
   *
   * Set this to the requirement's unit and a reading in that unit wins.
   */
  preferUnit?: PackInfo['packUnit'];
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

// Order matters — more specific patterns first. m²/m³ MUST come before m so
// "30m²" doesn't match the plain "m" pattern first.
const PATTERNS: Array<{ re: RegExp; unit: PackInfo['packUnit'] }> = [
  // "Box of 500", "Pack of 100", "Bag of 60", "Tub of 250"
  { re: new RegExp(String.raw`\b(?:box|pack|packet|bag|tub|carton|case)\s+of\s+${NUM}\b`, 'i'), unit: 'each' },
  // "500 pack", "100-pack", "100pk", "2400 Box"
  { re: new RegExp(String.raw`\b${NUM}\s*[- ]?(?:pack|pk|box|carton)\b`, 'i'), unit: 'each' },
  // "500 pieces", "500pc", "500 pcs"
  { re: new RegExp(String.raw`\b${NUM}\s*(?:pieces|piece|pcs|pc)\b`, 'i'), unit: 'each' },
  // Area: "30m²", "30 sqm", "30 sq m", "30m2 roll". Must precede the linear-m pattern.
  // The tail is a negative lookahead, NOT \b: `²` and `³` are non-word
  // characters, so a trailing \b after them can only match before another word
  // character — i.e. never in a real title. That silently made the "16.0m²"
  // spelling unparseable, which is how an Earthwool batt pack stating its own
  // coverage still got charged per square metre.
  { re: new RegExp(String.raw`${NUM}\s*(?:m²|m2|sqm|sq\s*m|square\s+(?:metres?|meters?))(?!\w)`, 'i'), unit: 'm²' },
  // Volume: "0.054m³", "0.5m3 bag", "1 cubic metre". Must precede the linear-m pattern.
  { re: new RegExp(String.raw`${NUM}\s*(?:m³|m3|cubic\s+(?:metres?|meters?))(?!\w)`, 'i'), unit: 'm³' },
  // Length: "5.4m length", "5.4m long", or just trailing "5.4m" / "2400mm" at end
  { re: new RegExp(String.raw`(?<![\d.])${NUM}\s*m(?![lm²2a-z])(?:\s+(?:length|long|roll))?`, 'i'), unit: 'm' },
  { re: new RegExp(String.raw`\b${NUM}\s*mm\s+(?:length|long)\b`, 'i'), unit: 'm' }, // mm length → convert below
  // Weight: "20kg bag", "900g tub". Keep before liquids because concrete
  // descriptions often include a secondary wet yield ("10kg ... yields 1.1L")
  // while the purchasable pack size is the kg bag. Grams convert to kg below.
  { re: new RegExp(String.raw`\b${NUM}\s*(?:kg|g|grams?)\b`, 'i'), unit: 'kg' },
  // Volume: "750ml", "4L", "20 litre". mL must precede L so "750ml" does
  // not get misread or ignored; convert below.
  { re: new RegExp(String.raw`\b${NUM}\s*(?:ml|millilitres?|milliliters?)\b`, 'i'), unit: 'L' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:l|lt|litres?|liters?)\b`, 'i'), unit: 'L' },
];

const MM_LENGTH_RE = new RegExp(String.raw`\b${NUM}\s*mm\s+(?:length|long)\b`, 'i');

/**
 * Plausible band for a stock length quoted in millimetres. Below 900mm is a
 * profile or a fixing, above 6500mm is not something sold as a stick.
 */
const STOCK_LENGTH_MIN_MM = 900;
const STOCK_LENGTH_MAX_MM = 6500;

/** Goods whose two stated dimensions describe the whole purchasable piece. */
const AREA_NOUN_RE = /\b(?:roll|fabric|mat|geotextile|membrane|sheet|sheeting|film|wrap|sarking|barrier|insulation|plywood|ply|plastic|polyethylene|poly)\b/i;

/**
 * Extract pack size/unit from a product title. Returns null when nothing
 * obvious matches — caller should leave the material's qty alone.
 */
export function parsePackInfo(
  productName: string | string[] | undefined | null,
  opts: ParsePackOptions = {},
): PackInfo | null {
  if (!productName) return null;
  // This is a total function on purpose. Its callers sit inside best-effort
  // regions guarded by bare catches, so a throw here does not surface as a
  // parse failure — it silently takes the whole surrounding pass with it.
  // That is exactly what happened: the scraper returns product descriptions
  // as a bullet ARRAY, `.trim()` threw on it, and the reconcile pass died on
  // 23 of 24 real quotes for twelve days with nothing logged. Accept the
  // array (joining keeps the pack size that may be stated in a bullet) and
  // refuse anything else rather than throwing.
  const text = Array.isArray(productName)
    ? productName.filter((p) => typeof p === 'string').join('. ')
    : productName;
  if (typeof text !== 'string') return null;
  const title = text.trim();
  if (!title) return null;

  // A stated figure in the unit we need beats anything inferred. "Earthwool
  // R2.0 Wall Batt 90mm x 430mm x 1160mm 16.0m² 32 Pack" says 16 m² outright;
  // reading its 90 x 430 face dimensions as the pack area instead gives
  // 0.04 m², and taking the "32 Pack" gives a piece count an m² requirement
  // can't use. Only runs when the caller stated a unit, so the long-standing
  // no-preference ordering below is untouched.
  if (opts.preferUnit) {
    const stated = readPack(title, PATTERNS.filter((p) => p.unit === opts.preferUnit));
    if (stated) return stated;
  }

  // Roll/sheet area from dimensions, e.g. "2m x 20m roll" = 40m². Must run
  // before plain length parsing so m² requirements don't buy one roll per m.
  // The noun list covers goods whose two stated dimensions ARE the whole piece.
  // `plywood`/`ply` earn their place — "2400 x 1200 x 12mm Plywood" is 2.88 m²,
  // and without it a 0.74 m² requirement priced the sheet 0.74 times. Nouns
  // whose face dimensions describe ONE unit of a multi-unit pack (batts, boards,
  // panels) are deliberately absent: they yield the size of a piece, not a pack.
  if (AREA_NOUN_RE.test(title) && (!opts.preferUnit || opts.preferUnit === 'm²')) {
    const areaDims = title.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|m)\b/i);
    if (areaDims) {
      const a = parseFloat(areaDims[1]) / (areaDims[2].toLowerCase() === 'mm' ? 1000 : 1);
      const b = parseFloat(areaDims[3]) / (areaDims[4].toLowerCase() === 'mm' ? 1000 : 1);
      if (a > 0 && b > 0) return { packSize: Math.round(a * b * 100) / 100, packUnit: 'm²' };
    }
    // Sheet goods usually carry the unit once, at the end: "2400 x 1200 x 12mm
    // Plywood". Both leading figures are millimetres, so the sheet is 2.88 m².
    const bareDims = title.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\s*[x×]\s*\d+(?:\.\d+)?\s*mm\b/i);
    if (bareDims) {
      const a = parseInt(bareDims[1], 10);
      const b = parseInt(bareDims[2], 10);
      if (a >= 100 && a <= 5000 && b >= 100 && b <= 5000) {
        return { packSize: Math.round((a / 1000) * (b / 1000) * 100) / 100, packUnit: 'm²' };
      }
    }
  }

  // Special-case mm lengths — convert to metres so packUnit stays in 'm'.
  const mmMatch = title.match(MM_LENGTH_RE);
  if (mmMatch) {
    const mm = parseFloat(mmMatch[1]);
    if (mm > 0 && (!opts.preferUnit || opts.preferUnit === 'm')) return { packSize: mm / 1000, packUnit: 'm' };
  }

  // Trim and moulding titles state the stock length in millimetres with no
  // "length"/"long" to key on, and pair it with the profile: "Gyprock CSR 90mm
  // x 3600mm Cove Plaster Cornice" is a 3.6 m stick, not 90 mm of anything. For
  // a requirement counted in lineal metres the stock length is the LARGEST mm
  // figure — the smaller ones are the profile. Without this, 640 m of stopping
  // angle was billed as 640 × the price of one 3 m length.
  if (opts.preferUnit === 'm') {
    const mms = [...title.matchAll(/\b(\d{3,4})\s*mm\b/gi)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= STOCK_LENGTH_MIN_MM && n <= STOCK_LENGTH_MAX_MM);
    if (mms.length) return { packSize: Math.max(...mms) / 1000, packUnit: 'm' };
  }

  return readPack(title, PATTERNS);
}

function readPack(title: string, patterns: typeof PATTERNS): PackInfo | null {
  for (const { re, unit } of patterns) {
    const match = title.match(re);
    if (!match) continue;
    let size = parseFloat(match[1]);
    if (!isFinite(size) || size <= 0) continue;
    if (unit === 'L' && /(?:ml|millilitres?|milliliters?)/i.test(match[0])) {
      size = size / 1000;
    }
    if (unit === 'kg' && /\d\s*(?:g|grams?)\b/i.test(match[0]) && !/kg/i.test(match[0])) {
      size = size / 1000;
    }
    // Skip nonsensical pack sizes (a "0.5 pack" or a "1 each" is just per-unit).
    if (unit === 'each' && size < 2) continue;
    return { packSize: size, packUnit: unit };
  }
  return null;
}

