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
const PATTERNS: Array<{ re: RegExp; unit: PackInfo['packUnit']; allowOne?: boolean }> = [
  // "50 palings per bundle", "300 coil nails per pack", "1 paling per purchase".
  // This is the reconcile model's OWN phrasing — its coverageNote states the
  // arithmetic behind its purchase count in exactly this shape, row after row.
  // Nothing here could read it, so recoverPackInfo fell through to worse
  // sources: on a real fencing quote the floor divided a 147-paling
  // requirement by a wrong pack size and RAISED the model's correct 3 bundles
  // to 15 ($3,285 for ~750 palings), while "1 paling per purchase" rows were
  // left under-bought. The one source that stated the true size was the one
  // the parser was illiterate in. Up to two words may sit between the number
  // and "per" (the item's name); the container word is anchored.
  // Guarded two ways: a $-prefixed or decimal number is a PRICE per container
  // ("$219 per bundle"), not a size, so only bare integers match; and unlike
  // every other 'each' pattern a size of ONE is meaningful here — "1 paling
  // per purchase" is the model saying each purchase is a single piece, which
  // is exactly what the coverage floor needs to raise an under-bought count.
  {
    re: new RegExp(String.raw`(?<![$.\d])(\d+)\s+(?:[a-z]+\s+){0,2}per\s+(?:pack|packet|box|bag|bundle|carton|case|tub|purchase|unit)\b`, 'i'),
    unit: 'each',
    allowOne: true,
  },
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

/**
 * A weight that is a LOAD RATING, not a purchasable pack size.
 *
 * A real quote read "Ladder levelling/stabiliser accessory ... 1 pack @ $161.82"
 * with packSize 120 kg, because the product title carries the ladder's 120 kg
 * duty rating and the kg pattern below is happy to read any weight at all. Pack
 * maths then treats a safety rating as the quantity in the box, and the row
 * either over-buys or reads as nonsense to the tradie — "a pack of 120 kg of
 * ladder feet" is the kind of line that costs trust in the whole quote.
 *
 * Two shapes are masked before any pattern runs:
 *   1. The weight sits next to a rating word ("120kg rated", "rated to 120kg",
 *      "max load 150kg", "WLL 200kg"). Precise, so it applies to any product.
 *   2. The product is access or load-bearing gear, where a stated kg figure is
 *      ALWAYS what it holds, never what you get.
 * Masking (rather than skipping the match) is what lets shape 1 be surgical: a
 * rating phrase is removed and any OTHER weight in the title is still read, so
 * "20kg bag, rated to 200kg per pallet" still yields the 20 kg bag. Shape 2 is
 * deliberately blunt by comparison — on a ladder or a trestle every kg figure
 * in the title is a rating or a shipping weight, and neither is a pack size.
 */
const CAPACITY_PHRASE_RES: RegExp[] = [
  // Weight first: "120kg rated", "120 kg rating", "120kg capacity",
  // "120kg load rating", "120kg max load", "120kg duty rating", "120kg limit".
  /\b\d+(?:\.\d+)?\s*kgs?\s*(?:[-\u2013\u2014\/]\s*)?(?:max(?:imum)?\s+)?(?:load\s+|weight\s+|duty\s+|working\s+)?(?:rated|rating|capacity|limit|load|duty|max(?:imum)?)\b/gi,
  // Rating word first: "rated to 120kg", "capacity of 120kg", "max load 150kg",
  // "holds up to 120kg", "supports 120kg", "WLL 200kg", "SWL 200kg".
  /\b(?:rated|rating|capacity|limit|duty|wll|swl|safe\s+working\s+load|load\s+capacity|weight\s+(?:limit|capacity)|max(?:imum)?(?:\s+(?:load|weight))?|holds?|supports?)\b(?:\s+(?:up\s+to|to|of|at))?\s*:?\s*\d+(?:\.\d+)?\s*kgs?\b/gi,
];

/**
 * Access and load-bearing gear. A kg figure on one of these is what it carries.
 * Deliberately narrow: every noun here is something a person or a load stands
 * on, hangs off, or is held by, so no purchasable weight is lost by masking.
 */
const LOAD_RATED_NOUN_RE =
  /\b(?:ladder|ladders|stepladder|step\s*ladders?|trestle|scaffold|scaffolds|scaffolding|platform|plank|planks|harness|lanyard|hoist|winch|jack|ramp|trolley|castor|caster|bracket|brackets|shelf|shelves|shelving|hook|hooks|stand|tripod|anchor\s+point)\b/i;

/** Bare kg/g weights, for masking on load-rated goods. */
const BARE_WEIGHT_RE = /\b\d+(?:\.\d+)?\s*kgs?\b/gi;

/** Replace load-rating weights with a digit-free token so no pattern reads them. */
export function maskLoadRatings(title: string): string {
  let out = title;
  for (const re of CAPACITY_PHRASE_RES) out = out.replace(re, ' [rating] ');
  if (LOAD_RATED_NOUN_RE.test(out)) out = out.replace(BARE_WEIGHT_RE, ' [rating] ');
  return out;
}

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
  // Strip load ratings before anything reads a weight — see maskLoadRatings.
  const title = maskLoadRatings(text.trim()).trim();
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
  for (const { re, unit, allowOne } of patterns) {
    const match = title.match(re);
    if (!match) continue;
    let size = parseFloat(match[1]);
    if (!isFinite(size) || size <= 0) continue;
    // An explicit per-container statement makes a size of one meaningful.
    if (allowOne && unit === 'each' && size >= 1) return { packSize: size, packUnit: unit };
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

