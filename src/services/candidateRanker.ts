/**
 * Candidate ranker — picks the best product from a list of search hits
 * for a given material, taking quality tier and name-match into account.
 *
 * Previously every search path in materialsPipeline.ts just took
 * `candidates[0]`, throwing away the runner-up hits the supplier API or
 * scraper already returned. For "high quality" jobs that meant we always
 * grabbed the cheapest/most-popular SKU because that's how Bunnings sorts
 * by default — see QU-178055 (Kate Nelson kitchen) where a "high quality
 * mixer tap" landed on an $86 budget unit despite the brief asking for
 * premium fittings.
 *
 * This module is a pure post-processing layer: same candidates, smarter
 * pick. No new network calls.
 */

export type QualityTier = 'budget' | 'standard' | 'premium';

/**
 * Minimal candidate shape this ranker needs. Both ScraperProduct (Bunnings)
 * and LocalSearchResult (saved supplier rates / Reece) satisfy this — keep
 * it structural so callers don't have to convert.
 */
export interface RankableCandidate {
  price: number;
  productName?: string;
  brand?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface RankerMaterial {
  name?: string;
  searchTerm?: string;
  qualityTier?: QualityTier;
}

export interface PickOptions {
  /** Job-level tier fallback when the material doesn't carry its own. */
  jobQualityTier?: QualityTier;
}

/**
 * Tiny allowlist of brands that strongly signal a premium tier in Aus
 * trade categories. Kept short and conservative on purpose — the median
 * price band does most of the work; this is just a tiebreaker so a
 * Phoenix tap beats a no-name when both sit above the median.
 */
const PREMIUM_BRANDS = new Set([
  'phoenix',
  'methven',
  'caroma',
  'franke',
  'abey',
  'oliveri',
  'grohe',
  'gessi',
  'brodware',
  'astra walker',
  'fienza',
  'milli',
  'reece',
  'rinnai',
  'bosch',
  'miele',
  'fisher & paykel',
  'smeg',
  'asko',
]);

function isPremiumBrand(brand?: string): boolean {
  if (!brand) return false;
  return PREMIUM_BRANDS.has(brand.trim().toLowerCase());
}

function tokenize(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

const STOP_TOKENS = new Set([
  'and', 'the', 'for', 'with', 'gal', 'galv', 'galvanised', 'galvanized',
  'stainless', 'steel', 'white', 'black', 'natural', 'heavy', 'duty', 'pack',
  'each', 'small', 'medium', 'large', 'premium', 'standard', 'budget',
]);

function importantTokens(s: string | undefined): string[] {
  return tokenize(s).filter((t) => !STOP_TOKENS.has(t) && !/^\d+$/.test(t));
}

function hasAny(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w));
}

/**
 * Hard semantic gate for the most expensive real-world failure families. The
 * scraper occasionally returns a high-confidence lexical hit from the wrong
 * category (e.g. "hardwood decking board" → "hardwood drill bit"). Ranking
 * alone can't save that because the bad result may be first and priced. Return
 * false only for clear category contradictions; borderline rows still flow to
 * the LLM reconcile/estimate path.
 */
function isSemanticallyCompatible(query: string, productName: string): boolean {
  const q = query.toLowerCase();
  const p = productName.toLowerCase();

  const qDim = parseFirstDim(q);
  if (qDim) {
    const pDim = parseFirstDim(p);
    const strictDimQuery = /rhs|rectangular\s+hollow|steel\s+post|h[-\s]?post|post|rail|paling|sleeper|gate|panel|timber|pine|steel|anchor|bolt|screw/.test(q);
    if (strictDimQuery && (!pDim || pDim !== qDim)) return false;
  }

  if (/structural\s+pine|framing\s+pine|90x45|70x35|140x45|\bh2\b|\bh3\b/.test(q) && /pine|timber|framing|studs?|plates?|noggings?|joists?/.test(q)) {
    if (hasAny(p, ['pin', 'drive pin', 'ramset', 'bracket', 'hanger', 'screw', 'bolt', 'nail'])) return false;
    return hasAny(p, ['pine', 'timber', 'framing', 'mgp', 'h2', 'h3']);
  }

  if (/\b(?:decking\s+boards?|deck\s+boards?|hardwood\s+decking|merbau|spotted\s+gum)\b/.test(q)) {
    if (hasAny(p, ['drill bit', 'saw blade', 'screw', 'oil', 'stain', 'bracket', 'hanger'])) return false;
    return hasAny(p, ['decking', 'deck board', 'timber', 'hardwood', 'merbau', 'spotted gum', 'modwood', 'composite']);
  }

  if (/\b(?:treated\s+pine|structural\s+pine|h3|h4)\b/.test(q) && /\b(?:joists?|bearers?|timber|pine)\b/.test(q)) {
    if (hasAny(p, ['hitch pin', 'bracket', 'hanger', 'screw', 'bolt', 'nail', 'plate'])) return false;
    return hasAny(p, ['treated pine', 'structural pine', 'timber', 'h3', 'h4', 'mgp', 'f7']);
  }

  if (/\broof\s+tiles?\b|\bconcrete\s+roof\s+tiles?\b/.test(q)) {
    if (hasAny(p, ['pointing', 'sealant', 'nozzle', 'conduit', 'adhesive', 'mesh', 'compound', 'carpet', 'floor tile', 'vinyl', 'solar', 'mounting', 'bracket'])) return false;
    return hasAny(p, ['roof tile', 'roofing tile', 'concrete tile', 'terracotta tile', 'tile']);
  }

  if (/\b(?:silicone|sealant)\b/.test(q)) {
    if (hasAny(p, ['nozzle', 'applicator', 'scraper', 'tool only'])) return false;
    return hasAny(p, ['silicone', 'sealant', 'sikaflex', 'selleys', 'parfix', 'caulk']);
  }

  if (/\brinnai\b/.test(q) && !/\brinnai\b/.test(p)) return false;

  if (/copper\s+(?:fittings?|elbows?|tees?|sockets?|couplings?)/.test(q)) {
    if (hasAny(p, ['angle bracket', 'bracket', 'galvanised bracket', 'steel bracket'])) return false;
    return hasAny(p, ['copper', 'brass', 'press', 'capillary']) && hasAny(p, ['fitting', 'elbow', 'tee', 'socket', 'coupling']);
  }

  if (/copper\s+pipe|copper\s+tube/.test(q)) {
    if (hasAny(p, ['elbow', 'coupling', 'tee', 'capillary', 'saddle', 'clip', 'bracket', 'valve', 'adaptor', 'adapter', 'bender', 'tube bender', 'tool'])) return false;
    return hasAny(p, ['copper pipe', 'copper tube', 'tube length', 'pipe length']);
  }

  if (/pipe\s+(?:insulation|lagging)|lagging/.test(q)) {
    if (hasAny(p, ['saddle', 'clip', 'bracket', 'galvanised bsp', 'galvanized bsp'])) return false;
    return hasAny(p, ['lagging', 'insulation', 'foam tube', 'pipe wrap']);
  }

  if (/(?:duo|non[-\s]?return|isolation)\s+valve|valve.*non[-\s]?return|valve.*isolation/.test(q)) {
    if (hasAny(p, ['handspray', 'hand spray', 'shower', 'diverter', 'tap adaptor', 'adapter'])) return false;
    return hasAny(p, ['valve', 'non return', 'non-return', 'isolation', 'duo']);
  }

  if (/steel\s+base\s+plate|base\s+plate/.test(q)) {
    if (hasAny(p, ['cover plate', 'flange', 'bsp', 'plumbing', 'escutcheon', 'rise stainless'])) return false;
    return hasAny(p, ['base plate', 'steel plate', 'flat plate', 'weld plate']);
  }

  if (/\bpointing\s+compound\b|\broof\s+pointing\b/.test(q)) {
    if (hasAny(p, ['conduit', 'saddle', 'bracket', 'mesh', 'fibre cement', 'jointing'])) return false;
    return hasAny(p, ['pointing', 'flexipoint']) || (p.includes('roof') && p.includes('compound'));
  }

  if (/\brhs\b|rectangular\s+hollow\s+section|galvanised\s+steel\s+rhs|galvanized\s+steel\s+rhs/.test(q)) {
    if (hasAny(p, ['retaining wall', 'h post', 'h-section', 'timber', 'pine', 'stake', 'fence post'])) return false;
    return hasAny(p, ['rhs', 'rectangular hollow', 'steel tube', 'galvanised steel', 'galvanized steel']);
  }

  if (/\bshs\b|square\s+hollow\s+section/.test(q)) {
    if (hasAny(p, ['fireplace', 'poker', 'tool', 'accessory', 'timber', 'pine'])) return false;
    return hasAny(p, ['shs', 'square hollow', 'steel tube']);
  }

  if (/exposed\s+aggregate\s+concrete|\b\d{2}\s*mpa\b.*concrete|concrete.*\b\d{2}\s*mpa\b/.test(q)) {
    if (hasAny(p, ['20kg', '10kg', 'bag', 'rapid set', 'quick set'])) return false;
    return hasAny(p, ['concrete', 'exposed aggregate', 'ready mix', 'readymix']);
  }

  if (/ready[-\s]?mix\s+concrete|concrete\s+for\s+slab|slab\s+concrete/.test(q)) {
    if (hasAny(p, ['bag', 'bagged', '20kg', '10kg', 'rapid set', 'quick set'])) return false;
    return hasAny(p, ['ready mix', 'readymix', 'concrete']);
  }

  if (/road\s+base|crusher\s+dust|aggregate\s+base/.test(q)) {
    // Bulk civil materials should be quoted from a landscape/civil supplier by
    // m³/tonne, not matched to small Bunnings retail bags or unrelated cleaners.
    return false;
  }

  if (/sl72|reinforcing\s+mesh|reo\s+mesh/.test(q)) {
    if (hasAny(p, ['trench mesh', 'small mesh', '1.8m x 1m', '1800 x 1000'])) return false;
    if (/sl72/.test(q) && !/sl72/i.test(p)) return false;
    return hasAny(p, ['sl72', 'reinforcing mesh', 'reo mesh', 'mesh sheet']);
  }

  if (/formwork\s+pegs?|timber\s+pegs?|hardwood\s+pegs?|stakes?/.test(q)) {
    if (hasAny(p, ['formply', 'plywood', 'sheet', 'panel', 'garden edging', 'metal garden', 'rust metal'])) return false;
    return hasAny(p, ['peg', 'stake', 'pointed', 'hardwood', 'timber']);
  }

  if (/rapid\s+set\s+concrete|concrete\s+mix|post\s+concrete/.test(q)) {
    if (hasAny(p, ['membrane', 'waterproof', 'sealant', 'paint', 'primer', 'liquid'])) return false;
    if (/concrete\s+mix/.test(q) && /sand\s*(?:&|and)\s*cement|cement\s+mortar/.test(p)) return false;
    const qKg = firstKgWeight(q);
    const pKg = firstKgWeight(p);
    if (qKg && pKg && Math.abs(qKg - pKg) > 0.1) return false;
    return hasAny(p, ['concrete', 'cement', 'rapid set', 'quick set']);
  }

  if (/sliding\s+gate\s+track|gate\s+track/.test(q)) {
    if (hasAny(p, ['wardrobe', 'internal door', 'plastic', 'shower', 'curtain'])) return false;
    return hasAny(p, ['gate track', 'sliding gate track', 'bolt down']) || (p.includes('track') && p.includes('gate'));
  }

  if (/sliding\s+gate\s+(?:catcher|receiver|stop)|gate\s+(?:catcher|receiver|stop)/.test(q)) {
    if (hasAny(p, ['carabiner', 's-biner', 'track', 'rail', 'wheel', 'hinge', 'hinges'])) return false;
    if (/catcher|receiver/.test(q)) return hasAny(p, ['catch', 'catcher', 'receiver']);
    if (/\bstop\b/.test(q)) return hasAny(p, ['stop', 'stopper']);
    return hasAny(p, ['catch', 'catcher', 'receiver', 'stop']);
  }

  if (/sliding\s+gate\s+wheels?|gate\s+wheels?/.test(q)) {
    if (hasAny(p, ['track', 'rail', 'guide', 'stop', 'latch'])) return false;
    return hasAny(p, ['wheel', 'roller']);
  }

  if (/pool\s+gate|aluminium\s+.*gate|aluminum\s+.*gate/.test(q)) {
    if (hasAny(p, ['post', 'fence panel', 'balustrade panel'])) return false;
    return hasAny(p, ['gate']);
  }

  if (/galvanised\s+steel\s+post|galvanized\s+steel\s+post|steel\s+post/.test(q) && !/h[-\s]?post|100uc/.test(q)) {
    if (hasAny(p, ['sleeper', 'retaining wall', 'timber', 'pine', 'star picket'])) return false;
    return hasAny(p, ['steel post', 'galvanised post', 'galvanized post', 'fence post']);
  }

  if (/\b(?:h[-\s]?post|100uc|steel\s+h\s*post)\b/.test(q)) {
    if (hasAny(p, ['timber', 'pine', 'sleeper', 'paling'])) return false;
    return hasAny(p, ['h post', 'h-post', 'h section', 'h-section', '100uc', 'steel']);
  }

  if (/colorbond\s+fence\s+(?:sheet|panel)|fence\s+(?:sheet|panel).*colorbond/.test(q)) {
    if (hasAny(p, ['post', 'rail', 'bracket', 'cap', 'screw'])) return false;
    return hasAny(p, ['sheet', 'panel', 'infill']) && hasAny(p, ['colorbond', 'fence']);
  }

  if (/colorbond\s+fence\s+rail|fence\s+rail.*colorbond/.test(q)) {
    if (hasAny(p, ['post', 'sheet', 'panel', 'bracket', 'cap'])) return false;
    return hasAny(p, ['rail']) && hasAny(p, ['colorbond', 'fence']);
  }

  if (/corrugated\s+metal\s+roof|metal\s+roofing|colorbond|zincalume/.test(q)) {
    if (hasAny(p, ['polycarbonate', 'plastic', 'pvc', 'foam', 'infill', 'closure strip'])) return false;
    return hasAny(p, ['metal', 'steel', 'colorbond', 'zincalume', 'corrugated']) && !hasAny(p, ['infill']);
  }

  if (/downpipe/.test(q)) {
    if (hasAny(p, ['adaptor', 'adapter', 'bend', 'elbow', 'clip', 'bracket', 'outlet', 'cover', 'guard'])) return false;
    return hasAny(p, ['downpipe']) && hasAny(p, ['length', 'pipe']);
  }

  if (/gutter\s+(?:quad|profile|length)|quad\s+gutter/.test(q)) {
    if (hasAny(p, ['stop end', 'strap', 'bracket', 'clip', 'outlet', 'corner'])) return false;
    return hasAny(p, ['gutter']) && hasAny(p, ['quad', 'length', 'profile']);
  }

  if (/vapou?r\s+barrier|building\s+wrap|sarking|wall\s+wrap|roof\s+sarking|builders?\s+plastic/.test(q)) {
    if (hasAny(p, ['tape', 'jointing', 'flashing tape', 'foil tape'])) return false;
    return hasAny(p, ['wrap', 'sarking', 'vapour barrier', 'vapor barrier', 'membrane', 'film', 'sheeting']);
  }

  if (/plasterboard|villaboard|fibre\s+cement\s+sheet|fiber\s+cement\s+sheet|cement\s+sheet|cladding\s+sheets?|external\s+cladding|fibre\s+cement\s+cladding|fiber\s+cement\s+cladding/.test(q)) {
    if (hasAny(p, ['screw', 'nail', 'drill bit', 'bit', 'tape', 'jointing', 'sealant', 'adhesive', 'compound', 'patch', 'repair panel', 'pinboard'])) return false;
    return hasAny(p, ['sheet', 'board', 'panel', 'plasterboard', 'villaboard', 'fibre cement', 'fiber cement', 'cladding']);
  }

  if (/floor\s+tiles?|wall\s+tiles?|ceramic\s+tiles?|porcelain\s+tiles?/.test(q) && !/roof/.test(q)) {
    if (hasAny(p, ['grate', 'drain', 'insert', 'spacer', 'adhesive', 'trim'])) return false;
    return hasAny(p, ['tile', 'tiles']);
  }

  if (/\bgrout\b/.test(q)) {
    if (hasAny(p, ['cleaner', 'spray', 'brush', 'sealer', 'sealer remover', 'repair tube'])) return false;
    const qKg = firstKgWeight(q);
    if (qKg && /\b\d+(?:\.\d+)?\s*(?:g|grams?)\b/i.test(p) && !/kg/i.test(p)) return false;
    return hasAny(p, ['grout']);
  }

  if (/toilet\s+suite|back\s+to\s+wall\s+toilet/.test(q)) {
    if (hasAny(p, ['seat', 'hinge', 'button', 'cistern only', 'pan only'])) return false;
    return hasAny(p, ['toilet suite', 'suite', 'back to wall toilet']);
  }

  if (/3[-\s]?phase|three[-\s]?phase|5[-\s]?pin/.test(q)) {
    if (hasAny(p, ['trailer', '12v', '7 pin flat', 'automotive'])) return false;
  }

  if (/gland/.test(q)) {
    if (hasAny(p, ['conduit length', 'conduit roll', 'rigid conduit', 'corrugated conduit']) && !p.includes('gland')) return false;
    return hasAny(p, ['gland', 'cable gland', 'conduit gland']);
  }

  if (/coveralls?|disposable\s+coveralls?|painters?\s+coveralls?/.test(q)) {
    if (hasAny(p, ['roller cover', 'paint roller', 'brush', 'drop sheet'])) return false;
    return hasAny(p, ['coverall', 'coveralls', 'disposable suit', 'protective suit']);
  }

  if (/\b(?:pvc|pex)\b.*\bpipe\b|\bpipe\b.*\b(?:pvc|pex)\b|waste\s+pipe|dwv\s+pipe/.test(q)) {
    if (hasAny(p, ['bend', 'elbow', 'reducer', 'adaptor', 'adapter', 'tee', 'junction', 'cap'])) return false;
    return hasAny(p, ['pipe', 'length']);
  }

  if (/plumber'?s?\s+putty|plumbing\s+putty/.test(q)) {
    if (hasAny(p, ['glazing', 'water putty', 'wood putty', 'hard setting', 'linseed'])) return false;
    return hasAny(p, ['plumber', 'plumbers', 'plumbing putty', 'sanitary putty']);
  }

  if (/basin\s+mixer|mixer\s+tap/.test(q)) {
    if (hasAny(p, ['cartridge', 'aerator', 'spout only', 'handle only'])) return false;
    return hasAny(p, ['mixer', 'tap']);
  }

  if (/(?:p[-\s]?trap|s[-\s]?trap|waste\s+trap|sink\s+waste\s+trap)/.test(q)) {
    if (hasAny(p, ['reducer', 'adaptor', 'adapter', 'bend', 'elbow', 'pipe length'])) return false;
    return hasAny(p, ['p trap', 'p-trap', 's trap', 's-trap', 'waste trap', 'trap']);
  }

  if (/debris\s+netting|safety\s+debris|shade\s+cloth|safety\s+mesh/.test(q)) {
    if (hasAny(p, ['patio blind', 'retractable', 'roller blind', 'awning'])) return false;
    return hasAny(p, ['shade cloth', 'mesh', 'netting', 'barrier']);
  }

  if (/marking\s+paint|spot\s+marking\s+paint|spray\s+and\s+mark/.test(q)) {
    if (hasAny(p, ['handle', 'wand', 'applicator', 'gun'])) return false;
    return hasAny(p, ['paint', 'spray and mark', 'marking']);
  }

  if (/palings?|paling/.test(q)) {
    if (hasAny(p, ['cladding', 'decking', 'screening', 'sleeper', 'acoustic', 'pinboard', 'panel board'])) return false;
    return hasAny(p, ['paling', 'fence paling']);
  }

  if (/fence\s+rails?|treated\s+pine\s+.*rails?|timber\s+rails?/.test(q)) {
    if (hasAny(p, ['bracket', 'brace', 'hanger', 'plate', 'post'])) return false;
    return hasAny(p, ['rail', 'treated pine', 'timber']);
  }

  if (/brackets?|fence\s+panel\s+brackets?/.test(q)) {
    if (hasAny(p, ['post', 'panel', 'gate']) && !hasAny(p, ['bracket', 'clip', 'fixing'])) return false;
    return hasAny(p, ['bracket', 'clip', 'fixing']);
  }

  if (/ring\s+shank|coil\s+nails?|fencing\s+nails?/.test(q)) {
    if (hasAny(p, ['brad', 'finishing', 'finish nail', 'pin nail', 'connector nail', 'timber connector'])) return false;
    if (/coil/.test(q) && !/coil/i.test(p)) return false;
    return hasAny(p, ['ring shank', 'coil nail', 'fencing nail', 'nail']);
  }

  if (/geotextile|filter\s+wrap|filter\s+fabric/.test(q)) {
    if (hasAny(p, ['irrigation', 'spray', 'stake', 'sprinkler', 'dripper'])) return false;
    return hasAny(p, ['geotextile', 'filter fabric', 'filter wrap', 'landscape fabric', 'weed mat', 'fabric']);
  }

  if (/sugar\s+soap.*liquid|liquid.*sugar\s+soap/.test(q)) {
    if (hasAny(p, ['wipes', 'wipe'])) return false;
    return hasAny(p, ['sugar soap', 'liquid', 'spray']);
  }

  if (/hydrochloric\s+acid|muriatic\s+acid/.test(q)) {
    if (hasAny(p, ['dry acid', 'sodium bisulfate', 'sodium bisulphate', 'granular'])) return false;
    return hasAny(p, ['hydrochloric', 'muriatic', 'acid']);
  }

  if (/mineral\s+oil\s+absorbent|oil\s+absorbent|spill\s+absorbent/.test(q)) {
    if (hasAny(p, ['grate', 'drain', 'pvc', 'floor waste', 'plumbing'])) return false;
    return hasAny(p, ['absorbent', 'spill', 'sorb', 'kitty litter', 'granules']);
  }

  if (/surface\s+retarder|concrete\s+retarder|rugasol/.test(q)) {
    if (hasAny(p, ['sealer', 'sealant', 'cleaner'])) return false;
    return hasAny(p, ['retarder', 'rugasol']);
  }

  if (/airless\s+sprayer\s+cleanup|sprayer\s+cleanup|pump\s+armor|pump\s+protector/.test(q)) {
    if (hasAny(p, ['bug', 'tar', 'car', 'automotive', 'detailing'])) return false;
    return hasAny(p, ['pump armor', 'pump protector', 'sprayer', 'cleaner', 'solvent']);
  }

  if (/spot\s+marking\s+paint|marking\s+paint|spray\s+and\s+mark/.test(q)) {
    if (hasAny(p, ['marble', 'decorative', 'wall paint', 'craft'])) return false;
    return hasAny(p, ['marking', 'spray and mark', 'line marking', 'spot']);
  }

  if (/circuit\s+breaker|\bmcb\b|\brcbo\b/.test(q)) {
    if (hasAny(p, ['connector strip', 'terminal', 'busbar', 'enclosure'])) return false;
    if (/3[-\s]?pole|three[-\s]?pole/.test(q) && !/3[-\s]?pole|three[-\s]?pole/i.test(p)) return false;
    return hasAny(p, ['breaker', 'mcb', 'rcbo', 'rccb']);
  }

  const qCores = cableCoreCount(q);
  const pCores = cableCoreCount(p);
  if (qCores && pCores && qCores !== pCores) return false;

  if (/green\s+waste|disposal|tip\s*fee|tipping|dumping/.test(q)) {
    if (hasAny(p, ['fertiliser', 'fertilizer', 'mulch', 'compost', 'bag'])) return false;
    // Service fees are usually not retail products. Let the pricing layer use
    // an explicit estimate/manual flag rather than a bogus SKU.
    return false;
  }

  if (/\b(?:diesel|petrol|fuel|unleaded|machine\s+fuel)\b/.test(q)) {
    if (hasAny(p, ['cleaner', 'additive', 'treatment', 'stabiliser', 'conditioner', 'injector', 'jerry can', 'fuel can', 'container', 'mixing bottle', 'engine oil', '4-stroke oil', '2-stroke oil', 'bar oil'])) return false;
  }

  if (/screws?|anchors?|bolts?|nails?/.test(q)) {
    const qLen = firstMmLength(q);
    const pLen = firstMmLength(p);
    if (qLen && pLen) {
      if (pLen < qLen * 0.75) return false;
      // For fasteners, being much too long is also wrong (e.g. 50mm paling
      // nails must not become 100mm framing nails).
      if (/nails?|screws?/.test(q) && pLen > qLen * 1.5) return false;
    }
  }

  if (/tps|cable|twin\s+and\s+earth/.test(q)) {
    const qGauge = cableGauge(q);
    const pGauge = cableGauge(p);
    if (qGauge && pGauge && Math.abs(qGauge - pGauge) > 0.05) return false;
  }

  if (/thread\s+(?:seal|tape)|gas\s+(?:teflon|ptfe)|yellow\s+gas\s+thread/.test(q)) {
    if (hasAny(p, ['anti slip', 'anti-slip', 'grip tape', 'cloth tape', 'electrical tape'])) return false;
    return hasAny(p, ['thread seal', 'thread tape', 'ptfe', 'teflon', 'gas thread']);
  }

  if (/electrical\s+tape|insulation\s+tape/.test(q)) {
    if (hasAny(p, ['anti slip', 'anti-slip', 'grip tape', 'cloth tape'])) return false;
    return hasAny(p, ['electrical tape', 'insulation tape', 'pvc tape']);
  }

  if (/2[-\s]?stroke\s+(?:engine\s+)?oil/.test(q)) {
    if (hasAny(p, ['4-stroke', '4 stroke', 'four stroke'])) return false;
    return hasAny(p, ['2-stroke', '2 stroke', 'two stroke', 'engine oil', 'oil']);
  }

  if (/2[-\s]?stroke\s+fuel|fuel\s+mix/.test(q)) {
    if (hasAny(p, ['2 stroke oil', '2-stroke oil', 'engine oil', 'mixing bottle', 'bottle'])) return false;
  }

  if (/\bwire\s+connectors?\b|\bbp\s+connectors?\b|\belectrical\s+connectors?\b|\bwago\b/.test(q)) {
    if (hasAny(p, ['irrigation', 'hose', 'poly', 'sprinkler', 'barbed', 'ev charging', 'charging cable', 'extension lead'])) return false;
    return hasAny(p, ['wire connector', 'electrical connector', 'terminal', 'bp connector', 'wago', 'joiner']);
  }

  return true;
}

function tokenCoverageScore(query: string | undefined, productName: string | undefined): number {
  const tokens = importantTokens(query);
  if (tokens.length === 0) return 1;
  const p = (productName || '').toLowerCase();
  const hits = tokens.filter((t) => p.includes(t)).length;
  return hits / tokens.length;
}

function parseFirstDim(s: string): string | null {
  const m = s.toLowerCase().match(/\b(\d{2,4})\s*x\s*(\d{2,4})(?:\s*mm)?(?:\s*x\s*\d+(?:\.\d+)?\s*m{1,2})?\b|\b(\d{2,4})\s*×\s*(\d{2,4})(?:\s*mm)?(?:\s*×\s*\d+(?:\.\d+)?\s*m{1,2})?\b/);
  if (!m) return null;
  const a = m[1] || m[3];
  const b = m[2] || m[4];
  return `${parseInt(a, 10)}x${parseInt(b, 10)}`;
}

function firstMmLength(s: string): number | null {
  const matches = [...s.matchAll(/\b(\d{1,4})\s*mm\b/gi)].map(m => parseInt(m[1], 10)).filter(n => n > 0);
  return matches.length ? matches[matches.length - 1] : null;
}

function firstKgWeight(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*kg\b/i);
  return m ? parseFloat(m[1]) : null;
}

function cableGauge(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*mm(?:²|2)?\b/i);
  return m ? parseFloat(m[1]) : null;
}

function cableCoreCount(s: string): number | null {
  const m = s.match(/\b(\d+)\s*[- ]?cores?\b|\b(\d+)c(?:\+e)?\b|\b(two|three|four)\s+cores?\b/i);
  if (!m) return null;
  if (m[1] || m[2]) return parseInt(m[1] || m[2], 10);
  const word = (m[3] || '').toLowerCase();
  return word === 'two' ? 2 : word === 'three' ? 3 : word === 'four' ? 4 : null;
}

/**
 * Pick the best candidate for a material from a list of search hits.
 *
 * Returns the first candidate unchanged when the list is 0–1 long (nothing
 * to choose between). Otherwise scores each priced candidate against:
 *  1. Quality tier bias — pull toward the right price band relative to the
 *     candidate set's own median.
 *  2. Search-term token match in the product name.
 *  3. Penalty for "junk" prices far below the median (usually accessories
 *     or replacement parts the scraper mis-ranked).
 *  4. Brand allowlist bonus when the job is premium.
 *  5. Mild confidence tiebreaker (high > medium > low) — matches the
 *     existing rankCandidates() behaviour so we don't regress.
 *
 * Falls back to the first candidate if every candidate is unpriced.
 */
export function pickBestCandidate<T extends RankableCandidate>(
  candidates: T[],
  material: RankerMaterial = {},
  options: PickOptions = {},
): T | null {
  if (!candidates || candidates.length === 0) return null;
  const query = material.searchTerm || material.name || '';
  const hadPricedCandidates = candidates.some((c) => typeof c.price === 'number' && c.price > 0);
  const priced = candidates.filter((c) =>
    typeof c.price === 'number' &&
    c.price > 0 &&
    isSemanticallyCompatible(query, c.productName || '')
  );
  // If there were priced candidates but every one failed the semantic gate,
  // return null so callers can estimate/flag instead of silently applying an
  // unrelated SKU. If the supplier truly returned no prices, preserve the old
  // fallback for callers that use the product metadata only.
  if (priced.length === 0) return hadPricedCandidates ? null : candidates[0];
  if (priced.length === 1) return priced[0];

  const tier: QualityTier = material.qualityTier || options.jobQualityTier || 'standard';

  const sortedPrices = priced.map((c) => c.price).sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];

  const searchTokens = importantTokens(query);

  const scored = priced.map((c, idx) => {
    let score = 0;

    // 1. Tier bias — pull toward the right price band.
    //    Use a 30% band around the median for "standard", and prefer
    //    >= median for premium, <= median for budget.
    if (tier === 'premium') {
      if (c.price >= median) score += 3;
      else score -= 2;
      // Extra reward for the most expensive priced candidate when
      // premium — covers the case where the median itself is still
      // a mid-tier SKU.
      if (c.price === sortedPrices[sortedPrices.length - 1]) score += 1;
    } else if (tier === 'budget') {
      if (c.price <= median) score += 2;
      else score -= 1;
    } else {
      // standard — prefer items within ±30% of median
      const delta = Math.abs(c.price - median) / Math.max(median, 1);
      if (delta <= 0.3) score += 1;
    }

    // 2. Name-match — every searchTerm token that appears in the
    //    product name is a strong signal we picked the right product
    //    family (e.g. "mixer" should match "Kitchen Mixer Tap" not
    //    "Tap Aerator"). Worth more than tier bias when present.
    if (searchTokens.length > 0) {
      const name = (c.productName || '').toLowerCase();
      const hits = searchTokens.filter((t) => name.includes(t)).length;
      const coverage = tokenCoverageScore(query, c.productName);
      score += hits * 0.75;
      // Strong penalty for low token overlap. This catches wrong-family hits
      // such as "roof tile" → "roof pointing nozzle" while preserving normal
      // cases where dimensions/colour tokens differ.
      if (coverage < 0.34) score -= 4;
      else if (coverage < 0.5) score -= 1.5;
    }

    // 3. Junk-price penalty — anything priced under 20% of the median
    //    in a multi-candidate list is almost always an accessory the
    //    relevance ranker mis-grouped. Examples seen in production:
    //    a $4 tap aerator returned alongside $80–$400 mixer taps.
    if (c.price < median * 0.2) score -= 2;

    // 4. Premium brand bonus — only meaningful when the tier asks for it.
    if (tier === 'premium' && isPremiumBrand(c.brand)) score += 2;

    // 5. Confidence tiebreaker — matches the old rankCandidates() order
    //    so callers that depended on confidence-first don't regress.
    if (c.confidence === 'high') score += 0.3;
    else if (c.confidence === 'medium') score += 0.1;

    return { c, score, idx };
  });

  // Stable sort: highest score first, original order as tiebreaker so
  // when scores tie we preserve the supplier's relevance ranking.
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return scored[0].c;
}
