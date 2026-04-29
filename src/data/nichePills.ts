/**
 * Niche Pills — checklist items shown above the dictation input.
 *
 * Each pill represents a topic the tradie should mention for that niche.
 * As the live transcript flows in, pills tick themselves off via a
 * client-side keyword/regex match (best-effort, no negation handling).
 * On cleanup submit, the LLM round-trips the same pill IDs and returns
 * an authoritative {id: bool} map that overrides the client guess —
 * that pass handles negation ("no oven", "skip windows") correctly.
 *
 * Keys are `${categoryId}:${nicheId}` because some niches (e.g. `specialty`)
 * appear under multiple categories with very different meanings.
 *
 * Keyword authoring rules:
 * - Prefer plain lowercase substrings — they match anywhere ("metres" hits
 *   "metre", "rangehood" hits "range hood" if the phrase is included).
 * - Use a regex when you need a number/unit pattern (e.g. "30m", "3 bed").
 * - When using a numeric regex, ALSO list the unit word as a plain string
 *   so the pill still ticks when the user says it without a number.
 */

export interface PillSpec {
  id: string;
  label: string;
  /** Lowercase substrings or regexes; any match flips the pill on. */
  keywords: (string | RegExp)[];
  /** Field name passed to the LLM so it can return per-pill bools. */
  jsonField: string;
}

const KEY = (categoryId: string, nicheId: string) => `${categoryId}:${nicheId}`;

// Common keyword fragments reused across many niches. Defined as substrings
// (not regexes) so they catch "metres", "metropolitan-only" etc via includes.
const M_WORDS = ['metre', 'meter'];          // matches metre/metres/meter/meters
// Includes both word orders — voice transcription of "100 meters square"
// produces unit-before-"square", which doesn't match "square metre".
const SQM_WORDS = [
  'sqm', 'm2', 'm²',
  'square metre', 'square meter',
  'metres squared', 'meters squared', 'metre squared', 'meter squared',
  'metres square', 'meters square', 'metre square', 'meter square',
];

/**
 * Universal pills shown for every job — including the "Other" / custom path
 * where no niche template is selected. Niche-specific pills with the same
 * jsonField take precedence (see getPillsForNiche), so a niche's tailored
 * "Access" entry will replace the generic one rather than appearing twice.
 *
 * Custom path is the only place a tradie has zero niche guidance, so the
 * pills here lean toward "did you say what the job actually is" rather than
 * niche-specific specifics.
 */
export const UNIVERSAL_PILLS: PillSpec[] = [
  {
    id: 'universal_what',
    label: 'What',
    keywords: [
      'install', 'repair', 'replace', 'fix', 'build', 'remove', 'paint', 'clean',
      'service', 'upgrade', 'demolish', 'connect', 'mount', 'hang', 'fit',
      'rip out', 'pull out', 'put in', 'set up',
    ],
    jsonField: 'what',
  },
  {
    id: 'universal_where',
    label: 'Where',
    keywords: [
      'kitchen', 'bathroom', 'laundry', 'garage', 'bedroom', 'lounge', 'living',
      'hallway', 'roof', 'backyard', 'front yard', 'driveway', 'upstairs',
      'downstairs', 'outside', 'inside', 'garden', 'shed', 'fence line',
      'yard', 'patio', 'deck', 'eaves', 'attic',
    ],
    jsonField: 'where',
  },
  {
    id: 'universal_area',
    label: 'Size / how many',
    keywords: [
      // Number followed by any size unit, in either word order.
      // Matches "100m2", "100 sqm", "100 metres", "100 meters square", etc.
      /\b\d+\s*(m2|m²|sqm|square|metre|meter|mm|cm|kw|litre|liter)/i,
      // Spelled-out small counts as whole words (avoids "stone"/"alone" hits).
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|dozen)\b/i,
      ...SQM_WORDS,
      'how many', 'a couple', 'a few', 'several', 'small', 'medium', 'large',
      'about', 'roughly', 'around', 'approx',
    ],
    jsonField: 'sizeOrCount',
  },
  {
    id: 'universal_supply',
    label: 'Supplies',
    keywords: [
      'customer supply', 'customer supplied', 'customer to supply',
      'we supply', 'supply only', 'supplied by', 'tradie supply',
      "i'll supply", 'i will supply', 'bring', 'provide', 'i bring', 'they bring',
    ],
    jsonField: 'supply',
  },
  {
    id: 'universal_access',
    label: 'Access',
    keywords: [
      'access', 'parking', 'narrow', 'tight', 'gate', 'driveway', 'side path',
      'stairs', 'lift', 'easy access', 'hard to reach', 'tight spot',
    ],
    jsonField: 'access',
  },
  {
    id: 'universal_deadline',
    label: 'Deadline',
    keywords: [
      /\bin\s+\d+\s*(day|week|month)/i,
      /\bnext\s+(week|month)/i,
      /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      'urgent', 'asap', 'this week', 'next week', 'deadline',
      'before', 'rush', 'need it done', 'when can', 'as soon as', 'by then',
    ],
    jsonField: 'deadline',
  },
];

export const NICHE_PILLS: Record<string, PillSpec[]> = {
  // ============================================
  // FENCING & GATES
  // ============================================
  [KEY('other', 'fencing')]: [
    { id: 'length',   label: 'Length',     keywords: [/\b\d+\s*(m|metre|meter|lm|linear)\b/i, ...M_WORDS, 'length', 'long', 'linear'], jsonField: 'length' },
    { id: 'height',   label: 'Height',     keywords: [/\b\d+(\.\d+)?\s*(m|metre|meter)\s*(high|tall)/i, 'height', 'tall', 'high'],     jsonField: 'height' },
    { id: 'material', label: 'Material',   keywords: ['colorbond', 'timber', 'paling', 'glass', 'aluminium', 'aluminum', 'steel', 'pine'], jsonField: 'material' },
    { id: 'gates',    label: 'Gates',      keywords: ['gate'],                                                                          jsonField: 'gates' },
    { id: 'removal',  label: 'Old fence',  keywords: ['old fence', 'existing fence', 'remove', 'demolish', 'tear down', 'pull down', 'rip out'], jsonField: 'oldFenceRemoval' },
    { id: 'access',   label: 'Access',     keywords: ['access', 'side gate', 'sloped', 'slope', 'narrow', 'tight'],                     jsonField: 'access' },
  ],

  // ============================================
  // LANDSCAPE & GARDENING
  // ============================================
  [KEY('landscape_gardening', 'lawn_care')]: [
    { id: 'area',    label: 'Area',         keywords: [/\b\d+\s*(m2|m²|sqm|square)/i, ...SQM_WORDS, 'lawn', 'area', 'size'], jsonField: 'area' },
    { id: 'edging',  label: 'Edging',       keywords: ['edge', 'edging', 'edges', 'trim', 'whipper', 'whippersnipper', 'line trim'],   jsonField: 'edging' },
    { id: 'waste',   label: 'Green waste',  keywords: ['green waste', 'clipping', 'bag', 'remove', 'haul', 'tip'], jsonField: 'wasteRemoval' },
    { id: 'access',  label: 'Access',       keywords: ['access', 'gate', 'narrow', 'side'],                       jsonField: 'access' },
  ],
  [KEY('landscape_gardening', 'hedge_tree')]: [
    { id: 'count',     label: 'How many',   keywords: [/\b\d+\s*(tree|hedge|shrub|bush)/i, 'tree', 'hedge', 'shrub', 'bush'],   jsonField: 'count' },
    { id: 'height',    label: 'Height',     keywords: [/\b\d+(\.\d+)?\s*(m|metre|meter)/i, ...M_WORDS, 'tall', 'high', 'height'], jsonField: 'height' },
    { id: 'species',   label: 'Species',    keywords: ['lilly pilly', 'pittosporum', 'photinia', 'gum', 'eucalyptus', 'camellia', 'box hedge', 'murraya', 'oleander'], jsonField: 'species' },
    { id: 'waste',     label: 'Waste',      keywords: ['mulch', 'chip', 'green waste', 'remove', 'haul', 'tip', 'cart away'],            jsonField: 'wasteRemoval' },
    { id: 'access',    label: 'Access',     keywords: ['access', 'powerline', 'power line', 'climbing', 'ladder', 'cherry picker'],      jsonField: 'access' },
  ],
  [KEY('landscape_gardening', 'garden_install')]: [
    { id: 'area',     label: 'Area',     keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'bed', 'garden bed', 'area'],         jsonField: 'area' },
    { id: 'plants',   label: 'Plants',   keywords: ['plant', 'shrub', 'tree', 'native', 'grass', 'flower', 'hedge'],             jsonField: 'plants' },
    { id: 'mulch',    label: 'Mulch',    keywords: ['mulch', 'bark', 'sugar cane', 'pine bark', 'woodchip', 'wood chip'],         jsonField: 'mulch' },
    { id: 'soil',     label: 'Soil',     keywords: ['soil', 'topsoil', 'compost', 'underturf', 'dirt'],                            jsonField: 'soil' },
    { id: 'edging',   label: 'Edging',   keywords: ['edging', 'border', 'sleeper', 'metal edge', 'edge'],                          jsonField: 'edging' },
    { id: 'irrigation', label: 'Irrigation', keywords: ['irrigation', 'drip', 'sprinkler', 'water', 'tap'],                        jsonField: 'irrigation' },
  ],
  [KEY('landscape_gardening', 'landscaping')]: [
    { id: 'area',      label: 'Area',         keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'area'],            jsonField: 'area' },
    { id: 'paving',    label: 'Paving',       keywords: ['pave', 'paver', 'cobble', 'flagstone'],                  jsonField: 'paving' },
    { id: 'retaining', label: 'Retaining',    keywords: ['retaining', 'sleeper', 'block wall', 'wall'],            jsonField: 'retainingWall' },
    { id: 'turf',      label: 'Turf',         keywords: ['turf', 'lawn', 'sir walter', 'kikuyu', 'buffalo'],       jsonField: 'turf' },
    { id: 'drainage',  label: 'Drainage',     keywords: ['drain', 'ag pipe', 'agi', 'french drain', 'soakwell'],   jsonField: 'drainage' },
    { id: 'features',  label: 'Features',     keywords: ['water feature', 'fire pit', 'pergola', 'pond', 'lighting', 'feature'], jsonField: 'features' },
  ],

  // ============================================
  // PLUMBING
  // ============================================
  [KEY('plumbing', 'drain_services')]: [
    { id: 'symptoms',  label: 'Symptoms',  keywords: ['blocked', 'block', 'slow drain', 'overflow', 'gurgl', 'smell', 'backup', 'back up', 'clog'], jsonField: 'symptoms' },
    { id: 'location',  label: 'Where',     keywords: ['kitchen', 'bathroom', 'laundry', 'toilet', 'main', 'sewer', 'stormwater', 'outside'], jsonField: 'location' },
    { id: 'access',    label: 'Access',    keywords: ['inspection point', 'i.o', 'gully', 'cleanout', 'manhole', 'crawl space', 'access'], jsonField: 'access' },
    { id: 'cause',     label: 'Cause',     keywords: ['tree root', 'root', 'collapsed', 'wipes', 'grease', 'foreign object', 'crack'],     jsonField: 'cause' },
    { id: 'cctv',      label: 'CCTV',      keywords: ['cctv', 'camera', 'inspect', 'jet', 'jetter'],                                       jsonField: 'cctvNeeded' },
  ],
  [KEY('plumbing', 'fixtures_fittings')]: [
    { id: 'fixture',     label: 'Fixture',   keywords: ['tap', 'mixer', 'shower', 'toilet', 'basin', 'sink', 'bath', 'dishwasher', 'spout'], jsonField: 'fixture' },
    { id: 'count',       label: 'How many',  keywords: [/\b\d+\s*(tap|mixer|fitting|fixture)/i, 'one', 'two', 'three', 'four', 'how many'],  jsonField: 'count' },
    { id: 'supply',      label: 'Supply',    keywords: ['customer supplied', 'supplied by', 'we supply', 'supply only', 'customer to supply'], jsonField: 'supply' },
    { id: 'isolation',   label: 'Isolation', keywords: ['isolation valve', 'shut off', 'mains', 'meter', 'stop tap'],                       jsonField: 'isolation' },
    { id: 'access',      label: 'Access',    keywords: ['under sink', 'wall cavity', 'tile wall', 'access hatch', 'access'],                jsonField: 'access' },
  ],
  [KEY('plumbing', 'hot_water')]: [
    { id: 'capacity',  label: 'Litres',    keywords: [/\b\d+\s*(l|litre|liter)\b/i, 'litre', 'liter', 'litres', 'liters', '50l', '125l', '170l', '250l', '315l'], jsonField: 'capacity' },
    { id: 'fuel',      label: 'Gas/Elec',  keywords: ['gas', 'electric', 'heat pump', 'solar', 'continuous', 'storage'], jsonField: 'fuelType' },
    { id: 'location',  label: 'Location',  keywords: ['external', 'outside', 'inside', 'garage', 'roof', 'wall mount', 'ground', 'eave'], jsonField: 'location' },
    { id: 'swap',      label: 'Swap/New',  keywords: ['replace', 'swap', 'like for like', 'change over', 'new install', 'changeover'],   jsonField: 'swapOrNew' },
    { id: 'brand',     label: 'Brand',     keywords: ['rinnai', 'rheem', 'bosch', 'aquamax', 'dux', 'vulcan', 'sanden', 'thermann'],     jsonField: 'brand' },
    { id: 'tempering', label: 'Tempering', keywords: ['tempering valve', 'tmv', 'tempering'],                                            jsonField: 'temperingValve' },
  ],
  [KEY('plumbing', 'bathroom_reno')]: [
    { id: 'scope',       label: 'Scope',       keywords: ['full reno', 'rough in', 'fit off', 'rough-in', 'fit-off', 'strip out', 'renovation'], jsonField: 'scope' },
    { id: 'fixtures',    label: 'Fixtures',    keywords: ['shower', 'toilet', 'vanity', 'bath', 'tap', 'mixer', 'basin'],            jsonField: 'fixtures' },
    { id: 'waterproof',  label: 'Waterproof',  keywords: ['waterproof', 'membrane', 'tank', 'wet seal'],                              jsonField: 'waterproofing' },
    { id: 'tiling',      label: 'Tiling',      keywords: ['tile', 'tiling', 'grout', 'mosaic'],                                       jsonField: 'tiling' },
    { id: 'demo',        label: 'Demo',        keywords: ['demo', 'strip', 'remove existing', 'old bathroom', 'rip out', 'demolition'], jsonField: 'demo' },
    { id: 'plumber',     label: 'Plumber',     keywords: ['plumber', 'compliance certificate', 'cert'],                                jsonField: 'plumberRequired' },
  ],

  // ============================================
  // ELECTRICAL
  // ============================================
  [KEY('electrical', 'power_lighting')]: [
    { id: 'type',     label: 'GPO/Light',  keywords: ['gpo', 'power point', 'powerpoint', 'light', 'downlight', 'pendant', 'switch', 'fan'], jsonField: 'type' },
    { id: 'count',    label: 'How many',   keywords: [/\b\d+\s*(gpo|point|light|downlight|switch)/i, 'gpo', 'point', 'light', 'downlight', 'switch', 'how many'], jsonField: 'count' },
    { id: 'location', label: 'Location',   keywords: ['kitchen', 'bedroom', 'lounge', 'outside', 'garage', 'bathroom', 'hallway'], jsonField: 'location' },
    { id: 'cable',    label: 'Cable run',  keywords: ['cable', 'wire', 'tps', 'conduit', 'cable run', 'ceiling', 'wall', 'roof void'], jsonField: 'cableRun' },
    { id: 'circuit',  label: 'Circuit',    keywords: ['new circuit', 'circuit', 'rcd', 'safety switch', 'breaker', 'mcb', 'spare way'], jsonField: 'circuit' },
  ],
  [KEY('electrical', 'switchboards')]: [
    { id: 'phase',    label: 'Phase',      keywords: ['single phase', 'three phase', '3 phase', 'phase'],                jsonField: 'phase' },
    { id: 'upgrade',  label: 'Upgrade',    keywords: ['upgrade', 'replace board', 'new board', 'main switch'],            jsonField: 'upgrade' },
    { id: 'rcd',      label: 'RCD',        keywords: ['rcd', 'safety switch', 'rcbo'],                                    jsonField: 'rcd' },
    { id: 'metering', label: 'Metering',   keywords: ['meter', 'smart meter', 'metering', 'solar inverter'],              jsonField: 'metering' },
    { id: 'asbestos', label: 'Asbestos',   keywords: ['asbestos', 'meter panel', 'zelemite', 'bakelite'],                  jsonField: 'asbestos' },
  ],
  [KEY('electrical', 'specialty')]: [
    { id: 'system',   label: 'System',     keywords: ['ev charger', 'evse', 'solar', 'battery', 'data', 'cat6', 'cctv', 'alarm', 'intercom'], jsonField: 'system' },
    { id: 'capacity', label: 'Capacity',   keywords: [/\b\d+\s*(kw|amp)/i, 'kw', 'kilowatt', 'amp', '7kw', '11kw', '22kw'],                    jsonField: 'capacity' },
    { id: 'location', label: 'Location',   keywords: ['garage', 'carport', 'driveway', 'meter board'],                                          jsonField: 'location' },
    { id: 'cable',    label: 'Cable run',  keywords: ['cable run', 'cable', 'underground', 'trench', 'conduit'],                                jsonField: 'cableRun' },
  ],

  // ============================================
  // CARPENTRY
  // ============================================
  [KEY('carpentry', 'outdoor')]: [
    { id: 'structure', label: 'Structure',  keywords: ['deck', 'pergola', 'patio', 'verandah', 'gazebo', 'screen', 'cubby'],                jsonField: 'structure' },
    { id: 'size',      label: 'Size',       keywords: [/\b\d+(\.\d+)?\s*(x|by)\s*\d+/i, ...SQM_WORDS, 'square metres', 'metre wide', 'metre long'], jsonField: 'size' },
    { id: 'material',  label: 'Material',   keywords: ['merbau', 'spotted gum', 'treated pine', 'composite', 'modwood', 'hardwood', 'pine'], jsonField: 'material' },
    { id: 'height',    label: 'Height',     keywords: ['high', 'tall', 'low set', 'high set', 'ground level', 'raised'],                    jsonField: 'height' },
    { id: 'finish',    label: 'Finish',     keywords: ['oil', 'stain', 'cutek', 'sikkens', 'paint', 'unfinished', 'seal'],                  jsonField: 'finish' },
    { id: 'permits',   label: 'Permits',    keywords: ['permit', 'engineer', 'council', 'da', 'cdc', 'bca', 'approval'],                    jsonField: 'permits' },
  ],
  [KEY('carpentry', 'doors_windows')]: [
    { id: 'count',    label: 'How many',  keywords: [/\b\d+\s*(door|window)/i, 'door', 'window'],                                            jsonField: 'count' },
    { id: 'type',     label: 'Type',      keywords: ['hinge', 'sliding', 'bifold', 'french', 'awning', 'casement', 'double hung', 'stacker'], jsonField: 'type' },
    { id: 'material', label: 'Material',  keywords: ['timber', 'aluminium', 'aluminum', 'composite', 'steel', 'pvc', 'upvc'],                jsonField: 'material' },
    { id: 'glazing',  label: 'Glazing',   keywords: ['double glaze', 'single glaze', 'low e', 'tinted', 'frosted', 'glass'],                jsonField: 'glazing' },
    { id: 'reveal',   label: 'Reveals',   keywords: ['reveal', 'architrave', 'trim', 'jamb'],                                                jsonField: 'reveals' },
  ],
  [KEY('carpentry', 'custom_joinery')]: [
    { id: 'item',      label: 'Item',         keywords: ['wardrobe', 'kitchen', 'vanity', 'bookshelf', 'tv unit', 'shelving', 'island', 'cabinet'], jsonField: 'item' },
    { id: 'dimensions', label: 'Dimensions',  keywords: [/\b\d+(\.\d+)?\s*(x|by)\s*\d+/i, 'mm wide', 'metre', 'wide', 'long', 'high', 'deep'],     jsonField: 'dimensions' },
    { id: 'material',  label: 'Material',     keywords: ['mdf', 'melamine', 'laminate', 'veneer', 'two-pack', '2 pac', 'plywood', 'oak', 'ash'],   jsonField: 'material' },
    { id: 'hardware',  label: 'Hardware',     keywords: ['hinge', 'drawer runner', 'blum', 'handle', 'soft close', 'push to open', 'hardware'],   jsonField: 'hardware' },
    { id: 'finish',    label: 'Finish',       keywords: ['paint', 'stain', 'lacquer', 'matte', 'gloss', 'satin'],                                  jsonField: 'finish' },
  ],

  // ============================================
  // PAINTING
  // ============================================
  [KEY('painting', 'interior')]: [
    { id: 'rooms',    label: 'Rooms',     keywords: [/\b\d+\s*(bed|room)/i, 'bed', 'bedroom', 'lounge', 'kitchen', 'hallway', 'whole house', 'rooms'], jsonField: 'rooms' },
    { id: 'surface',  label: 'Surface',   keywords: ['wall', 'ceiling', 'cornice', 'skirting', 'architrave', 'door', 'trim'],         jsonField: 'surface' },
    { id: 'prep',     label: 'Prep',      keywords: ['prep', 'sand', 'fill', 'patch', 'undercoat', 'sugar soap'],                     jsonField: 'prep' },
    { id: 'coats',    label: 'Coats',     keywords: ['two coat', '2 coat', 'three coat', '3 coat', 'one coat', 'undercoat', 'topcoat', 'coat'], jsonField: 'coats' },
    { id: 'colours',  label: 'Colours',   keywords: ['dulux', 'taubmans', 'haymes', 'colour', 'natural white', 'lexicon', 'colors'],   jsonField: 'colours' },
    { id: 'furniture', label: 'Furniture', keywords: ['furniture', 'cover', 'move', 'empty room', 'occupied', 'tenant'],               jsonField: 'furniture' },
  ],
  [KEY('painting', 'exterior')]: [
    { id: 'area',     label: 'Area',      keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'storeys', 'storey', 'whole house'],                jsonField: 'area' },
    { id: 'surface',  label: 'Surface',   keywords: ['weatherboard', 'render', 'brick', 'fibre cement', 'fc sheet', 'eave', 'fascia', 'cladding'], jsonField: 'surface' },
    { id: 'prep',     label: 'Prep',      keywords: ['pressure wash', 'scrape', 'sand', 'prime', 'lead paint', 'prep'],                         jsonField: 'prep' },
    { id: 'access',   label: 'Access',    keywords: ['scaffold', 'ladder', 'cherry picker', 'two storey', 'high reach', 'ewp'],                 jsonField: 'access' },
    { id: 'roof',     label: 'Roof',      keywords: ['roof paint', 'roof restoration', 'roof spray'],                                            jsonField: 'roofPaint' },
  ],
  [KEY('painting', 'specialty')]: [
    { id: 'finish',   label: 'Finish',    keywords: ['venetian', 'limewash', 'effects paint', 'stencil', 'mural', 'wallpaper', 'feature wall'], jsonField: 'finish' },
    { id: 'area',     label: 'Area',      keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'wall', 'feature wall'],                              jsonField: 'area' },
    { id: 'product',  label: 'Product',   keywords: ['porters paints', 'murobond', 'rockcote', 'dulux design'],                                  jsonField: 'product' },
    { id: 'prep',     label: 'Prep',      keywords: ['prep', 'sand', 'patch', 'undercoat'],                                                      jsonField: 'prep' },
  ],

  // ============================================
  // FLOORING
  // ============================================
  [KEY('flooring', 'timber')]: [
    { id: 'area',      label: 'Area',       keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'metres squared'],                jsonField: 'area' },
    { id: 'product',   label: 'Product',    keywords: ['solid timber', 'engineered', 'laminate', 'hybrid', 'bamboo', 'floorboard'], jsonField: 'product' },
    { id: 'subfloor',  label: 'Subfloor',   keywords: ['concrete', 'particleboard', 'plywood', 'subfloor', 'self level'],          jsonField: 'subfloor' },
    { id: 'demolition', label: 'Demolition', keywords: ['rip up', 'remove old', 'existing carpet', 'existing tile', 'demo', 'pull up'], jsonField: 'demolition' },
    { id: 'finish',    label: 'Finish',     keywords: ['sand and polish', 'oil', 'matte', 'satin', 'gloss', 'polish'],            jsonField: 'finish' },
    { id: 'scotia',    label: 'Scotia',     keywords: ['scotia', 'beading', 'skirting', 'quad'],                                  jsonField: 'scotia' },
  ],
  [KEY('flooring', 'carpet')]: [
    { id: 'area',     label: 'Area',       keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'rooms'],                            jsonField: 'area' },
    { id: 'rooms',    label: 'Rooms',      keywords: [/\b\d+\s*(bed|room)/i, 'bed', 'bedroom', 'lounge', 'stairs'],              jsonField: 'rooms' },
    { id: 'product',  label: 'Product',    keywords: ['wool', 'nylon', 'solution dyed', 'pet friendly', 'loop pile', 'cut pile'], jsonField: 'product' },
    { id: 'underlay', label: 'Underlay',   keywords: ['underlay', 'foam underlay', 'rubber underlay'],                            jsonField: 'underlay' },
    { id: 'uplift',   label: 'Old uplift', keywords: ['uplift', 'remove old', 'pull up', 'rip up'],                               jsonField: 'oldUplift' },
    { id: 'stairs',   label: 'Stairs',     keywords: ['stair', 'stairs', 'staircase'],                                            jsonField: 'stairs' },
  ],
  [KEY('flooring', 'tiles')]: [
    { id: 'area',      label: 'Area',       keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'square metres'],                  jsonField: 'area' },
    { id: 'tile',      label: 'Tile',       keywords: ['600x600', '300x300', 'porcelain', 'ceramic', 'mosaic', 'subway', 'tile'], jsonField: 'tileSpec' },
    { id: 'supply',    label: 'Supply',     keywords: ['customer supply', 'we supply', 'supplied by', 'tradie supply', 'customer to supply'], jsonField: 'supply' },
    { id: 'prep',      label: 'Prep',       keywords: ['prime', 'self level', 'level', 'screed', 'waterproof'],                  jsonField: 'prep' },
    { id: 'pattern',   label: 'Pattern',    keywords: ['straight lay', 'brick bond', 'herringbone', 'diagonal', 'pattern'],      jsonField: 'pattern' },
    { id: 'grout',     label: 'Grout',      keywords: ['grout', 'epoxy grout', 'charcoal grout', 'white grout'],                  jsonField: 'grout' },
  ],

  // ============================================
  // CLEANING
  // ============================================
  [KEY('cleaning', 'residential')]: [
    { id: 'rooms',      label: 'Rooms',       keywords: [/\b\d+\s*(bed|bedroom|room)/i, 'bed', 'bedroom', 'rooms'],                jsonField: 'rooms' },
    { id: 'bathrooms',  label: 'Bathrooms',   keywords: [/\b\d+\s*(bath|bathroom)/i, 'bath', 'shower', 'toilet', 'ensuite'],       jsonField: 'bathrooms' },
    { id: 'kitchen',    label: 'Kitchen',     keywords: ['oven', 'stove', 'cooktop', 'range hood', 'rangehood', 'kitchen', 'splashback', 'fridge', 'cupboard'], jsonField: 'kitchen' },
    { id: 'floors',     label: 'Floors',      keywords: ['floor', 'mop', 'vacuum', 'carpet', 'tile floor'],                         jsonField: 'floors' },
    { id: 'windows',    label: 'Windows',     keywords: ['window', 'blind', 'glass', 'screen'],                                     jsonField: 'windows' },
    { id: 'walls',      label: 'Walls',       keywords: ['wall', 'spot clean', 'scuff', 'mark', 'mould'],                           jsonField: 'walls' },
    { id: 'furnished',  label: 'Furnished',   keywords: ['furnished', 'unfurnished', 'empty', 'occupied', 'tenant', 'vacant'],      jsonField: 'furnished' },
  ],
  [KEY('cleaning', 'specialty')]: [
    { id: 'area',     label: 'Area',       keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS],                                       jsonField: 'area' },
    { id: 'surface',  label: 'Surface',    keywords: ['concrete', 'paver', 'tile', 'render', 'driveway', 'path', 'wall'],          jsonField: 'surface' },
    { id: 'staining', label: 'Staining',   keywords: ['mould', 'mold', 'lichen', 'oil', 'rust', 'algae', 'stain'],                 jsonField: 'staining' },
    { id: 'chemical', label: 'Pre-treat',  keywords: ['chemical', 'pre-treat', 'pretreat', '30 seconds', 'wet and forget'],        jsonField: 'chemicalTreat' },
    { id: 'water',    label: 'Water',      keywords: ['water tap', 'water access', 'tank water', 'no water', 'water'],             jsonField: 'water' },
  ],

  // ============================================
  // CONCRETING & RENDERING & GYPROCK
  // ============================================
  [KEY('other', 'concreting')]: [
    { id: 'area',      label: 'Area',         keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'square metres'],                  jsonField: 'area' },
    { id: 'thickness', label: 'Thickness',    keywords: [/\b\d+\s*(mm|millimetre)/i, 'mm', 'millimetre', '100mm', '125mm', '150mm', 'thick'], jsonField: 'thickness' },
    { id: 'finish',    label: 'Finish',       keywords: ['broom finish', 'exposed', 'plain', 'trowel', 'pebble', 'stencil', 'polished', 'finish'], jsonField: 'finish' },
    { id: 'reo',       label: 'Reinforcement', keywords: ['mesh', 'reo', 'sl82', 'sl72', 'rebar', 'bar chair'],                    jsonField: 'reinforcement' },
    { id: 'prep',      label: 'Prep',         keywords: ['excavate', 'road base', 'compact', 'formwork', 'dig'],                  jsonField: 'prep' },
    { id: 'pump',      label: 'Pump',         keywords: ['pump', 'line pump', 'boom pump', 'wheelbarrow', 'truck'],                jsonField: 'pumpRequired' },
  ],
  [KEY('other', 'rendering')]: [
    { id: 'area',      label: 'Area',        keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS],                                      jsonField: 'area' },
    { id: 'substrate', label: 'Substrate',   keywords: ['brick', 'blockwork', 'fc sheet', 'hebel', 'cement sheet', 'block'],        jsonField: 'substrate' },
    { id: 'texture',   label: 'Texture',     keywords: ['sponge', 'sandstone', 'smooth', 'roll on', 'trowel', 'bagged', 'texture'], jsonField: 'texture' },
    { id: 'colour',    label: 'Colour',      keywords: ['dulux', 'colorbond', 'colour', 'paint', 'natural white', 'colors'],        jsonField: 'colour' },
    { id: 'access',    label: 'Access',      keywords: ['scaffold', 'two storey', 'single storey', 'cherry picker', 'storey'],     jsonField: 'access' },
  ],
  [KEY('other', 'gyprock')]: [
    { id: 'walls_or_ceilings', label: 'Walls/Ceilings', keywords: ['wall', 'ceiling'],                                              jsonField: 'wallsOrCeilings' },
    { id: 'area',              label: 'Area',           keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS],                            jsonField: 'area' },
    { id: 'board',             label: 'Board type',     keywords: ['standard', 'moisture resistant', 'fire rated', 'soundcheck', 'wet area', 'aquacheck'], jsonField: 'boardType' },
    { id: 'cornice',           label: 'Cornice',        keywords: ['cornice', 'cove', 'square set', 'shadowline', 'no cornice'],     jsonField: 'cornice' },
    { id: 'finish',            label: 'Set level',      keywords: ['set 3', 'set 4', 'set 5', 'level 4', 'level 5', 'paint ready', 'set'], jsonField: 'setLevel' },
  ],

  // ============================================
  // HVAC
  // ============================================
  [KEY('hvac', 'split_systems')]: [
    { id: 'units',    label: 'Units',     keywords: [/\b\d+\s*(unit|split|system)/i, 'split', 'unit', 'system'],                jsonField: 'units' },
    { id: 'capacity', label: 'kW',        keywords: [/\b\d+(\.\d+)?\s*(kw|kilowatt)/i, 'kw', 'kilowatt', '2.5kw', '5kw', '7kw', '9kw'], jsonField: 'capacity' },
    { id: 'pipe_run', label: 'Pipe run',  keywords: ['pipe run', 'back to back', 'back-to-back', 'long run', 'pipe'],          jsonField: 'pipeRun' },
    { id: 'power',    label: 'Power',     keywords: ['power', 'gpo', 'isolator', 'circuit', 'cable run'],                       jsonField: 'power' },
    { id: 'wall',     label: 'Wall type', keywords: ['brick', 'weatherboard', 'fibre cement', 'render', 'cladding', 'wall'],   jsonField: 'wallType' },
  ],
  [KEY('hvac', 'ducted_systems')]: [
    { id: 'capacity', label: 'kW',       keywords: [/\b\d+(\.\d+)?\s*(kw|kilowatt)/i, 'kw', 'kilowatt', '14kw', '16kw', '20kw'], jsonField: 'capacity' },
    { id: 'zones',   label: 'Zones',     keywords: [/\b\d+\s*zone/i, 'zone'],                                                   jsonField: 'zones' },
    { id: 'storeys', label: 'Storeys',   keywords: ['single storey', 'two storey', 'double storey', 'storey'],                   jsonField: 'storeys' },
    { id: 'access',  label: 'Roof access', keywords: ['roof access', 'roof space', 'crawl space', 'tile roof', 'metal roof', 'roof void'], jsonField: 'roofAccess' },
    { id: 'replacement', label: 'New/Replace', keywords: ['replacement', 'new install', 'existing system', 'remove old', 'replace'], jsonField: 'replacement' },
  ],
  [KEY('hvac', 'evaporative')]: [
    { id: 'units',  label: 'Units',     keywords: [/\b\d+\s*unit/i, 'unit', 'cooler'],                jsonField: 'units' },
    { id: 'pads',   label: 'Pads',      keywords: ['pad', 'celdek', 'chillcel'],                      jsonField: 'pads' },
    { id: 'pump',   label: 'Pump',      keywords: ['pump', 'water pump', 'submersible'],              jsonField: 'pump' },
    { id: 'access', label: 'Roof access', keywords: ['roof access', 'tile roof', 'metal roof', 'crawl board', 'roof'], jsonField: 'roofAccess' },
  ],

  // ============================================
  // ROOFING
  // ============================================
  [KEY('roofing', 'roof_install')]: [
    { id: 'area',     label: 'Area',       keywords: [/\b\d+\s*(m2|m²|sqm)/i, ...SQM_WORDS, 'square metres'],                                       jsonField: 'area' },
    { id: 'existing', label: 'Existing',   keywords: ['tile', 'metal', 'colorbond', 'concrete tile', 'terracotta', 'asbestos super six', 'super six'], jsonField: 'existingMaterial' },
    { id: 'pitch',    label: 'Pitch',      keywords: ['pitch', 'low pitch', 'steep', 'gable', 'hip'],                                                jsonField: 'pitch' },
    { id: 'storeys',  label: 'Storeys',    keywords: ['single storey', 'two storey', 'double storey', 'storey'],                                     jsonField: 'storeys' },
    { id: 'asbestos', label: 'Asbestos',   keywords: ['asbestos', 'super six', 'fibro'],                                                              jsonField: 'asbestos' },
    { id: 'anticon',  label: 'Anticon',    keywords: ['anticon', 'sisalation', 'insulation', 'sarking'],                                              jsonField: 'anticon' },
  ],
  [KEY('roofing', 'roof_repairs')]: [
    { id: 'leak_location', label: 'Leak location', keywords: ['leak', 'water stain', 'ceiling stain', 'damp', 'drip'],                            jsonField: 'leakLocation' },
    { id: 'roof_type',     label: 'Roof type',     keywords: ['tile', 'metal', 'colorbond', 'concrete tile', 'terracotta'],                       jsonField: 'roofType' },
    { id: 'tiles_damaged', label: 'Tiles damaged', keywords: [/\b\d+\s*(tile|broken)/i, 'tile', 'cracked', 'broken', 'damaged', 'chipped'],       jsonField: 'tilesDamaged' },
    { id: 'flashing',      label: 'Flashing',      keywords: ['flashing', 'lead flashing', 'valley', 'ridge', 'capping'],                         jsonField: 'flashing' },
    { id: 'pointing',      label: 'Pointing',      keywords: ['pointing', 're-bed', 'rebed', 'mortar'],                                            jsonField: 'pointing' },
  ],
  [KEY('roofing', 'gutters')]: [
    { id: 'length',    label: 'Length',     keywords: [/\b\d+\s*(m|metre|meter)\b/i, ...M_WORDS, 'length'],                                     jsonField: 'length' },
    { id: 'downpipes', label: 'Downpipes',  keywords: [/\b\d+\s*downpipe/i, 'downpipe', 'down pipe'],                                            jsonField: 'downpipes' },
    { id: 'storeys',   label: 'Storeys',    keywords: ['single storey', 'two storey', 'double storey', 'storey'],                                jsonField: 'storeys' },
    { id: 'profile',   label: 'Profile',    keywords: ['quad', 'half round', 'og', 'fascia gutter', 'box gutter', 'profile'],                    jsonField: 'profile' },
    { id: 'colour',    label: 'Colour',     keywords: ['colorbond', 'woodland grey', 'monument', 'surfmist', 'jasper', 'colour', 'colors'],      jsonField: 'colour' },
    { id: 'fascia',    label: 'Fascia',     keywords: ['fascia', 'pine fascia', 'metal fascia', 'rotten fascia'],                                jsonField: 'fascia' },
  ],

  // ============================================
  // PEST CONTROL
  // ============================================
  [KEY('pest_control', 'general_pest')]: [
    { id: 'rooms',    label: 'Property size', keywords: [/\b\d+\s*bed/i, 'bed', 'bedroom', 'unit', 'townhouse', 'house'],                        jsonField: 'propertySize' },
    { id: 'pests',    label: 'Pests',         keywords: ['cockroach', 'roach', 'ant', 'spider', 'flea', 'silverfish', 'wasp'],                   jsonField: 'pests' },
    { id: 'pets',     label: 'Pets/kids',     keywords: ['pet', 'dog', 'cat', 'kid', 'child', 'baby'],                                            jsonField: 'petsOrKids' },
    { id: 'scope',    label: 'Inside/Outside', keywords: ['inside', 'outside', 'internal', 'external', 'perimeter'],                              jsonField: 'scope' },
    { id: 'roof',     label: 'Roof void',     keywords: ['roof void', 'ceiling space', 'attic'],                                                  jsonField: 'roofVoid' },
  ],
  [KEY('pest_control', 'termites')]: [
    { id: 'perimeter', label: 'Perimeter',    keywords: [/\b\d+\s*(m|metre|meter)\b/i, ...M_WORDS, 'perimeter'],                                  jsonField: 'perimeter' },
    { id: 'edge',      label: 'Edge type',    keywords: ['soil', 'concrete', 'path', 'paver', 'core drill', 'trench'],                            jsonField: 'edgeType' },
    { id: 'slab',      label: 'Slab/Stumps',  keywords: ['slab', 'stump', 'subfloor', 'crawl space'],                                              jsonField: 'slabOrStumps' },
    { id: 'access',    label: 'Access',       keywords: ['roof void', 'subfloor access', 'crawl space', 'access'],                                jsonField: 'access' },
    { id: 'pets',      label: 'Pets',         keywords: ['pet', 'dog', 'cat', 'chicken'],                                                          jsonField: 'pets' },
  ],
  [KEY('pest_control', 'rodents')]: [
    { id: 'location',  label: 'Where',     keywords: ['roof void', 'subfloor', 'inside', 'outside', 'shed', 'garage'],                            jsonField: 'location' },
    { id: 'species',   label: 'Species',   keywords: ['rat', 'mice', 'mouse', 'rodent'],                                                          jsonField: 'species' },
    { id: 'pets',      label: 'Pets/kids', keywords: ['pet', 'dog', 'cat', 'child', 'kid'],                                                       jsonField: 'petsOrKids' },
    { id: 'follow_up', label: 'Follow-up', keywords: ['follow up', 'return visit', 'come back', 'two weeks', 'six weeks', 'follow-up'],            jsonField: 'followUp' },
    { id: 'exclusion', label: 'Exclusion', keywords: ['exclusion', 'seal', 'foam', 'mesh', 'entry point'],                                         jsonField: 'exclusion' },
  ],
};

/**
 * Look up the pill checklist for a given (categoryId, nicheId).
 *
 * When no niche is selected (the Custom job path), returns UNIVERSAL_PILLS
 * so the user still gets a baseline checklist. Niche-specific selections
 * return only their own pills — no universals merged in.
 */
export function getPillsForNiche(categoryId?: string, nicheId?: string): PillSpec[] {
  if (!categoryId || !nicheId) return UNIVERSAL_PILLS;
  return NICHE_PILLS[KEY(categoryId, nicheId)] || [];
}
