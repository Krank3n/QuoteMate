/**
 * Niche-Specific Quote Templates
 * Templates based on trade categories and niches for common jobs
 */

import { JobTemplate } from '../types';

/**
 * Template for each common service within a niche
 */
export interface NicheJobTemplate extends JobTemplate {
  categoryId: string;
  nicheId: string;
  pricingMethod: string; // References pricing method from tradeCategories
  suggestedMaterials: string[]; // Common materials for this job type
  estimatedHoursRange: { min: number; max: number };
  promptQuestions?: string[];  // Guiding hints shown to tradie before describing job
  aiContext?: string;          // Domain knowledge injected into AI prompt for accurate estimation
}

export const NICHE_TEMPLATES: NicheJobTemplate[] = [
  // ============================================
  // LANDSCAPE & GARDENING TEMPLATES
  // ============================================
  {
    id: 'lawn_mowing_ride_on',
    categoryId: 'landscape_gardening',
    nicheId: 'lawn_care',
    name: 'Lawn Mowing (Ride-On)',
    description: 'Large area lawn mowing with ride-on mower',
    icon: 'tractor',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Lawn Area', unit: 'm²', defaultValue: 500 },
    ],
    defaultMaterials: [
      { name: 'Fuel (Petrol)', searchTerm: 'Petrol fuel can 10L', quantityFormula: 'Math.ceil(area / 2500)', unit: 'each' },
      { name: 'Line Trimmer Cord', searchTerm: 'Line trimmer cord 2.4mm', quantityFormula: 'Math.ceil(area / 1000)', unit: 'each' },
      { name: 'Green Waste Bags', searchTerm: 'Green waste bags', quantityFormula: 'Math.ceil(area / 200)', unit: 'pack' },
    ],
    estimatedHoursFormula: 'area / 500', // 500 m² per hour with ride-on
    estimatedHoursRange: { min: 1, max: 4 },
    suggestedMaterials: ['Fuel', 'Line trimmer cord', 'Waste bags'],
    promptQuestions: [
      'How big is the lawn roughly? (metres or just small/medium/large)',
      'Is the ground flat or on a slope?',
      'Any obstacles? (trees, garden beds, play equipment)',
      'Edges need doing too?',
    ],
    aiContext: 'Ride-on mowing covers ~500m2/hr on flat ground, ~350m2/hr on slopes. Edge trimming adds 15-30min depending on perimeter. Obstacle-heavy blocks take ~30% longer. Fuel usage ~1L per 2500m2. Typical residential block: 400-800m2 lawn area.',
  },
  {
    id: 'hedge_trimming',
    categoryId: 'landscape_gardening',
    nicheId: 'hedge_tree',
    name: 'Hedge Trimming',
    description: 'Trim and shape hedges',
    icon: 'content-cut',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Hedge Length', unit: 'm', defaultValue: 10 },
      { key: 'height', label: 'Average Height', unit: 'm', defaultValue: 1.5 },
    ],
    defaultMaterials: [
      { name: 'Hedge Trimmer Fuel Mix', searchTerm: '2 stroke fuel mix 5L', quantityFormula: 'Math.ceil((length * height) / 50)', unit: 'each' },
      { name: 'Green Waste Bags', searchTerm: 'Green waste bags Large', quantityFormula: 'Math.ceil((length * height) / 10)', unit: 'pack' },
      { name: 'Tarp', searchTerm: 'Heavy duty tarp 3.6m x 2.7m', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '(length * height) / 5', // 5 m² per hour
    estimatedHoursRange: { min: 0.5, max: 3 },
    suggestedMaterials: ['Hedge trimmer fuel', 'Waste bags', 'Tarp'],
    promptQuestions: [
      'How long is the hedge roughly?',
      'How tall? (waist height, head height, above head)',
      'What type of hedge? (if you know)',
      'Green waste removal needed?',
    ],
    aiContext: 'Hedge trimming rate ~5m2 face area per hour. Taller hedges (above head height) need a ladder and take ~40% longer. Dense species (box hedge, murraya) produce more waste. Green waste: ~1 bag per 10m2 of hedge face. Disposal adds time if tip run is needed.',
  },
  {
    id: 'garden_bed_install',
    categoryId: 'landscape_gardening',
    nicheId: 'garden_install',
    name: 'Garden Bed Installation',
    description: 'Prepare and install garden bed with plants',
    icon: 'flower',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Garden Bed Area', unit: 'm²', defaultValue: 10 },
      { key: 'plants', label: 'Number of Plants', unit: '', defaultValue: 20 },
    ],
    defaultMaterials: [
      { name: 'Premium Garden Soil', searchTerm: 'Premium garden soil 25L bag', quantityFormula: 'Math.ceil(area * 3)', unit: 'each' },
      { name: 'Garden Mulch', searchTerm: 'Garden mulch wood chip 25L bag', quantityFormula: 'Math.ceil(area * 4)', unit: 'each' },
      { name: 'Garden Plants', searchTerm: 'Garden plants assorted 140mm pot', quantityFormula: 'plants', unit: 'each' },
      { name: 'Slow Release Fertilizer', searchTerm: 'Slow release fertilizer all purpose 2.5kg', quantityFormula: 'Math.ceil(area / 5)', unit: 'each' },
      { name: 'Weed Mat', searchTerm: 'Weed mat landscape fabric 1.83m x 10m', quantityFormula: 'Math.ceil(area / 15)', unit: 'each' },
      { name: 'Garden Edging', searchTerm: 'Garden edging flexible plastic 150mm x 10m', quantityFormula: 'Math.ceil(area * 0.5)', unit: 'each' },
    ],
    estimatedHoursFormula: '(area * 2) + (plants * 0.25)',
    estimatedHoursRange: { min: 2, max: 8 },
    suggestedMaterials: ['Garden soil', 'Mulch', 'Plants', 'Fertilizer', 'Weed mat', 'Garden edging'],
    promptQuestions: [
      'How big is the garden bed area?',
      'How many plants roughly?',
      'Any existing plants/lawn to remove first?',
      'Irrigation/dripper system needed?',
    ],
    aiContext: 'Garden bed install: ~3 bags of soil per m2 (50mm depth), ~4 bags mulch per m2 (75mm depth). Plant spacing depends on species — typically 3-5 per m2 for groundcover, 1 per m2 for shrubs. Existing lawn removal adds ~1hr per 10m2. Irrigation/dripper adds materials and ~1hr per 10m run.',
  },
  {
    id: 'turf_laying',
    categoryId: 'landscape_gardening',
    nicheId: 'garden_install',
    name: 'Turf Supply & Lay',
    description: 'Supply and lay instant turf',
    icon: 'grass',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Turf Area', unit: 'm²', defaultValue: 50 },
    ],
    defaultMaterials: [
      { name: 'Instant Turf Rolls', searchTerm: 'Instant turf roll sir walter DNA certified', quantityFormula: 'area', unit: 'm' },
      { name: 'Premium Top Soil', searchTerm: 'Premium top soil 25L bag', quantityFormula: 'Math.ceil(area * 2)', unit: 'each' },
      { name: 'Lawn Starter Fertilizer', searchTerm: 'Lawn starter fertilizer 4kg', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
      { name: 'Leveling Sand', searchTerm: 'Brickies sand 20kg bag', quantityFormula: 'Math.ceil(area / 2)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 10', // 10 m² per hour
    estimatedHoursRange: { min: 2, max: 10 },
    suggestedMaterials: ['Instant turf rolls', 'Top soil', 'Starter fertilizer', 'Soil leveling sand'],
    promptQuestions: [
      'How big is the area?',
      'Is the existing surface lawn, dirt, or something else?',
      'Any levelling needed?',
      'What type of turf? (sir walter, couch, buffalo)',
    ],
    aiContext: 'Turf laying rate ~10m2/hr including prep. Existing lawn removal adds ~1hr per 20m2. Levelling with sand/soil adds ~2 bags per m2. Turf rolls are typically 1m2 each. Order 5-10% extra for cuts/waste. Starter fertilizer coverage ~40m2 per 4kg bag. Water heavily after install.',
  },

  // ============================================
  // PLUMBING TEMPLATES
  // ============================================
  {
    id: 'drain_unblock',
    categoryId: 'plumbing',
    nicheId: 'drain_services',
    name: 'Drain Unblock (Snaking)',
    description: 'Clear blocked drain with electric eel',
    icon: 'pipe',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'fixtures', label: 'Number of Fixtures', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'Drain Cleaner', searchTerm: 'Drain cleaner liquid 1L', quantityFormula: 'fixtures', unit: 'each' },
      { name: 'Plumbers Teflon Tape', searchTerm: 'Plumbers teflon tape PTFE 12mm', quantityFormula: 'Math.ceil(fixtures / 2)', unit: 'each' },
      { name: 'Cotton Rags', searchTerm: 'Cotton cleaning rags pack of 10', quantityFormula: '1', unit: 'pack' },
    ],
    estimatedHoursFormula: 'fixtures * 1',
    estimatedHoursRange: { min: 0.5, max: 2 },
    suggestedMaterials: ['Drain cleaner', 'Plumbing tape', 'Rags'],
    promptQuestions: [
      'How many blocked drains?',
      'Which fixtures? (toilet, shower, kitchen sink, floor waste)',
      'Has it been blocked before?',
      'Any CCTV inspection needed?',
    ],
    aiContext: 'Drain unblocking: ~1hr per fixture with electric eel. Recurring blockages may indicate tree root intrusion — CCTV adds ~$150-300. Kitchen blockages often need grease treatment. Multiple fixtures on the same line usually share one blockage point. Floor waste blockages are often hair/soap — simpler fix.',
  },
  {
    id: 'toilet_install',
    categoryId: 'plumbing',
    nicheId: 'fixtures_fittings',
    name: 'Toilet Suite Installation',
    description: 'Remove old toilet and install new suite',
    icon: 'toilet',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'toilets', label: 'Number of Toilets', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'Close Coupled Toilet Suite', searchTerm: 'Close coupled toilet suite white ceramic', quantityFormula: 'toilets', unit: 'each' },
      { name: 'Flexible Connector', searchTerm: 'Toilet flexible connector 400mm braided', quantityFormula: 'toilets', unit: 'each' },
      { name: 'Cistern Inlet Washer', searchTerm: 'Cistern inlet washer 12mm', quantityFormula: 'toilets', unit: 'each' },
      { name: 'Pan Collar', searchTerm: 'Pan collar rubber seal 100mm', quantityFormula: 'toilets', unit: 'each' },
      { name: 'Silicone Sealant', searchTerm: 'Silicone sealant clear 310ml cartridge', quantityFormula: 'toilets', unit: 'each' },
      { name: 'Plumbers Putty', searchTerm: 'Plumbers putty 500g tub', quantityFormula: 'Math.ceil(toilets / 2)', unit: 'each' },
    ],
    estimatedHoursFormula: 'toilets * 2',
    estimatedHoursRange: { min: 1.5, max: 3 },
    suggestedMaterials: ['Toilet suite', 'Flexible connector', 'Cistern washer', 'Pan collar', 'Silicone sealant', 'Plumbers putty'],
    promptQuestions: [
      'How many toilets?',
      'Replacing existing or new location?',
      'Any preference on style? (close-coupled, wall-hung, back-to-wall)',
      'Floor or wall outlet?',
    ],
    aiContext: 'Toilet install: ~2hrs per unit for straight replacement. New location adds rough-in plumbing (~4hrs extra). Wall-hung toilets need concealed cistern frame — significantly more labour and materials. Back-to-wall requires accurate set-out. Floor outlet is standard; wall outlet may need pan converter.',
  },
  {
    id: 'hot_water_install',
    categoryId: 'plumbing',
    nicheId: 'hot_water',
    name: 'Hot Water System Install (Electric)',
    description: 'Install new electric hot water system',
    icon: 'water-boiler',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'capacity', label: 'System Capacity', unit: 'L', defaultValue: 250 },
    ],
    defaultMaterials: [
      { name: 'Electric Hot Water System', searchTerm: 'Electric hot water system ' + 'capacity' + 'L storage tank', quantityFormula: '1', unit: 'each' },
      { name: 'Copper Pipe 15mm', searchTerm: 'Copper pipe 15mm x 3m', quantityFormula: '4', unit: 'each' },
      { name: 'Copper Pipe Fittings Kit', searchTerm: 'Copper pipe fittings assorted pack', quantityFormula: '1', unit: 'pack' },
      { name: 'PRV Valve', searchTerm: 'Pressure relief valve 1/2 inch', quantityFormula: '1', unit: 'each' },
      { name: 'Tempering Valve', searchTerm: 'Tempering valve adjustable 15mm', quantityFormula: '1', unit: 'each' },
      { name: 'Isolating Ball Valves', searchTerm: 'Ball valve isolating 15mm brass', quantityFormula: '2', unit: 'each' },
      { name: 'Overflow Tray', searchTerm: 'Hot water overflow tray plastic', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '4',
    estimatedHoursRange: { min: 3, max: 6 },
    suggestedMaterials: ['Hot water system', 'Copper pipe', 'Pipe fittings', 'PRV valve', 'Tempering valve', 'Isolating valves', 'Overflow tray'],
    promptQuestions: [
      'What size system? (number of people in house)',
      'Electric or gas?',
      'Replacing existing or new install?',
      'Indoor or outdoor location?',
    ],
    aiContext: 'Hot water install: ~4hrs for like-for-like replacement, 6-8hrs for new install or fuel type change. Size guide: 1-2 people ~125L, 3-4 people ~250L, 5+ people ~315-400L. Gas to electric or vice versa requires additional pipework. Tempering valve is mandatory in Australia. PRV and expansion valve required. Indoor installs need overflow tray and drain.',
  },
  {
    id: 'bathroom_renovation',
    categoryId: 'plumbing',
    nicheId: 'bathroom_reno',
    name: 'Bathroom Renovation',
    description: 'Full bathroom plumbing renovation',
    icon: 'shower',
    pricingMethod: 'fixed',
    requiredParams: [
      { key: 'fixtures', label: 'Number of Fixtures', unit: '', defaultValue: 5 },
    ],
    defaultMaterials: [
      { name: 'Shower Mixer Set', searchTerm: 'Shower mixer set chrome rail', quantityFormula: '1', unit: 'each' },
      { name: 'Basin Mixer Tap', searchTerm: 'Basin mixer tap chrome', quantityFormula: '1', unit: 'each' },
      { name: 'Toilet Suite', searchTerm: 'Close coupled toilet suite white', quantityFormula: '1', unit: 'each' },
      { name: 'Bathroom Vanity', searchTerm: 'Bathroom vanity 900mm white', quantityFormula: '1', unit: 'each' },
      { name: 'Shower Screen', searchTerm: 'Shower screen semi frameless 900mm', quantityFormula: '1', unit: 'each' },
      { name: 'Wall Tiles', searchTerm: 'Bathroom wall tiles 300x600mm white gloss', quantityFormula: 'Math.ceil(fixtures * 3)', unit: 'box' },
      { name: 'Floor Tiles', searchTerm: 'Floor tiles porcelain 600x600mm', quantityFormula: 'Math.ceil(fixtures * 2)', unit: 'box' },
      { name: 'Waterproofing Membrane', searchTerm: 'Waterproofing membrane kit bathroom', quantityFormula: '2', unit: 'each' },
      { name: 'Copper Pipe 15mm', searchTerm: 'Copper pipe 15mm x 3m', quantityFormula: 'Math.ceil(fixtures * 2)', unit: 'each' },
      { name: 'PVC Pipe 40mm', searchTerm: 'PVC pipe 40mm x 3m drainage', quantityFormula: 'Math.ceil(fixtures * 1.5)', unit: 'each' },
      { name: 'Plumbing Fittings Kit', searchTerm: 'Plumbing fittings assorted pack', quantityFormula: '2', unit: 'pack' },
    ],
    estimatedHoursFormula: 'fixtures * 4',
    estimatedHoursRange: { min: 16, max: 40 },
    suggestedMaterials: ['Shower mixer', 'Basin mixer', 'Toilet suite', 'Vanity', 'Shower screen', 'Tiles', 'Waterproofing membrane', 'Copper pipe', 'PVC pipe', 'Various fittings'],
    promptQuestions: [
      'How big is the bathroom roughly?',
      'What\'s being replaced? (shower, bath, vanity, toilet, all of it)',
      'Tiling needed? (floor, walls, both)',
      'Any structural changes? (moving walls, plumbing relocations)',
    ],
    aiContext: 'Bathroom reno is the most variable job. Full gut and reno: 4-6 weeks. Waterproofing is mandatory for wet areas (AS3740). Tile quantities: wall tiles ~3 boxes per m2 wall, floor tiles ~2 boxes per m2 floor. Allow 10-15% tile waste. Moving plumbing adds significant cost. Typical small bathroom ~4m2, standard ~6-8m2, large ~10m2+.',
  },

  // ============================================
  // ELECTRICAL TEMPLATES
  // ============================================
  {
    id: 'power_point_install',
    categoryId: 'electrical',
    nicheId: 'power_lighting',
    name: 'Power Point Installation',
    description: 'Install new power points',
    icon: 'power-socket-au',
    pricingMethod: 'per_point',
    requiredParams: [
      { key: 'points', label: 'Number of Points', unit: '', defaultValue: 4 },
    ],
    defaultMaterials: [
      { name: 'Double Power Points', searchTerm: 'Double power point GPO 10A white', quantityFormula: 'points', unit: 'each' },
      { name: 'Electrical Cable', searchTerm: 'Twin and earth cable 2.5mm 100m', quantityFormula: 'Math.ceil(points / 5)', unit: 'each' },
      { name: 'Cable Clips', searchTerm: 'Cable clips white 100 pack', quantityFormula: 'Math.ceil(points / 20)', unit: 'pack' },
      { name: 'Wall Plates', searchTerm: 'Single gang wall plate white', quantityFormula: 'points', unit: 'each' },
      { name: 'Junction Boxes', searchTerm: 'Electrical junction box plastic', quantityFormula: 'points', unit: 'each' },
    ],
    estimatedHoursFormula: 'points * 0.5',
    estimatedHoursRange: { min: 1, max: 4 },
    suggestedMaterials: ['Power points', 'Electrical cable', 'Cable clips', 'Wall plates', 'Junction boxes'],
    promptQuestions: [
      'How many power points?',
      'Which rooms?',
      'Single or double GPOs?',
      'Any outdoor or weatherproof ones?',
    ],
    aiContext: 'Power point install: ~30min per point for standard internal, ~45min for external weatherproof. Cable run length varies — internal walls ~5m avg, external ~8m. Outdoor GPOs need IP54-rated enclosures. Each point needs its own junction box. Cable: 2.5mm twin+earth for GPO circuits.',
  },
  {
    id: 'led_downlight_pack',
    categoryId: 'electrical',
    nicheId: 'power_lighting',
    name: 'LED Downlight Pack (10)',
    description: 'Install pack of 10 LED downlights',
    icon: 'lightbulb',
    pricingMethod: 'fixed',
    requiredParams: [
      { key: 'packs', label: 'Number of Packs (10 lights each)', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'LED Downlights 10 Pack', searchTerm: 'LED downlight 90mm white dimmable 10 pack', quantityFormula: 'packs', unit: 'pack' },
      { name: 'Electrical Cable', searchTerm: 'Twin and earth cable 1.5mm 100m', quantityFormula: 'Math.ceil(packs / 2)', unit: 'each' },
      { name: 'Junction Boxes', searchTerm: 'Electrical junction box round 70mm', quantityFormula: 'packs * 10', unit: 'each' },
      { name: 'Hole Saw 90mm', searchTerm: 'Hole saw 90mm for downlights', quantityFormula: '1', unit: 'each' },
      { name: 'Cable Clips', searchTerm: 'Cable clips white 100 pack', quantityFormula: 'packs', unit: 'pack' },
    ],
    estimatedHoursFormula: 'packs * 3',
    estimatedHoursRange: { min: 2, max: 5 },
    suggestedMaterials: ['LED downlights (10 pack)', 'Electrical cable', 'Junction boxes', 'Hole saw', 'Cable clips'],
    promptQuestions: [
      'How many downlights roughly?',
      'Which rooms?',
      'Replacing existing or new holes in ceiling?',
      'Dimmer switches needed?',
    ],
    aiContext: 'LED downlight install: ~15-20min per light for new holes, ~10min for replacing existing fittings. New holes need hole saw (90mm standard). Dimmer switches add ~$30-50 per switch and ~15min install each. Cable: 1.5mm twin+earth for lighting circuits. Max ~10 lights per circuit.',
  },
  {
    id: 'switchboard_upgrade',
    categoryId: 'electrical',
    nicheId: 'switchboards',
    name: 'Switchboard Upgrade',
    description: 'Upgrade main switchboard',
    icon: 'toggle-switch',
    pricingMethod: 'fixed',
    requiredParams: [],
    defaultMaterials: [
      { name: 'Switchboard Enclosure', searchTerm: 'Switchboard enclosure 18 pole metal', quantityFormula: '1', unit: 'each' },
      { name: 'Circuit Breakers 16A', searchTerm: 'Circuit breaker single pole 16A', quantityFormula: '8', unit: 'each' },
      { name: 'Circuit Breakers 20A', searchTerm: 'Circuit breaker single pole 20A', quantityFormula: '4', unit: 'each' },
      { name: 'RCD Safety Switches', searchTerm: 'RCD safety switch 30mA double pole', quantityFormula: '2', unit: 'each' },
      { name: 'Surge Protector', searchTerm: 'Surge protector Type 2 switchboard', quantityFormula: '1', unit: 'each' },
      { name: 'Electrical Cable', searchTerm: 'Single core cable 6mm 100m', quantityFormula: '1', unit: 'each' },
      { name: 'Circuit Labels', searchTerm: 'Circuit breaker labels pack', quantityFormula: '1', unit: 'pack' },
    ],
    estimatedHoursFormula: '6',
    estimatedHoursRange: { min: 4, max: 8 },
    suggestedMaterials: ['Switchboard enclosure', 'Circuit breakers', 'RCDs', 'Surge protector', 'Cable', 'Labels'],
    promptQuestions: [
      'How old is the current switchboard?',
      'How many circuits roughly?',
      'Any known issues? (tripping, flickering)',
      'Surge protection wanted?',
    ],
    aiContext: 'Switchboard upgrade: 4-8hrs depending on complexity. Old ceramic fuse boards take longer to decommission. Typical house: 12-18 circuits. RCDs are mandatory (min 2). Surge protector is optional but recommended. Older homes may need main earth upgrade. If asbestos backing board is present, licensed removal required — flag this.',
  },
  {
    id: 'ev_charger_install',
    categoryId: 'electrical',
    nicheId: 'specialty',
    name: 'EV Charger Installation',
    description: 'Install electric vehicle charger',
    icon: 'ev-station',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'chargers', label: 'Number of Chargers', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'EV Charger Unit', searchTerm: 'EV charger 7kW Type 2 smart', quantityFormula: 'chargers', unit: 'each' },
      { name: 'Heavy Duty Cable', searchTerm: 'Heavy duty cable 6mm twin and earth 50m', quantityFormula: 'chargers', unit: 'each' },
      { name: 'Circuit Breaker 32A', searchTerm: 'Circuit breaker 32A double pole', quantityFormula: 'chargers', unit: 'each' },
      { name: 'Electrical Conduit', searchTerm: 'Electrical conduit heavy duty 25mm 3m', quantityFormula: 'chargers * 5', unit: 'each' },
      { name: 'Mounting Bracket', searchTerm: 'EV charger wall mount bracket', quantityFormula: 'chargers', unit: 'each' },
    ],
    estimatedHoursFormula: 'chargers * 4',
    estimatedHoursRange: { min: 3, max: 6 },
    suggestedMaterials: ['EV charger unit', 'Heavy duty cable', 'Circuit breaker', 'Conduit', 'Mounting bracket'],
    promptQuestions: [
      'How many chargers?',
      'How far from the switchboard to the install location?',
      'Wall-mounted or pedestal?',
      'What amperage/kW? (7kW standard, 22kW fast)',
    ],
    aiContext: 'EV charger install: ~4hrs per unit. Cable run length is the main variable — 6mm twin+earth for 7kW (32A), 10mm for 22kW. Longer runs need heavier cable to manage voltage drop. 22kW chargers may require switchboard upgrade. Dedicated 32A circuit breaker per charger. Conduit for exposed runs. Pedestal installs need concrete base.',
  },

  // ============================================
  // CARPENTRY TEMPLATES
  // ============================================
  {
    id: 'deck_construction',
    categoryId: 'carpentry',
    nicheId: 'outdoor',
    name: 'Deck Construction',
    description: 'Build timber deck',
    icon: 'home-outline',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Deck Area', unit: 'm²', defaultValue: 20 },
      { key: 'height', label: 'Height from Ground', unit: 'm', defaultValue: 0.5 },
    ],
    defaultMaterials: [
      { name: 'Merbau Decking Boards', searchTerm: 'Merbau decking boards 90mm x 19mm x 5.4m', quantityFormula: 'Math.ceil(area * 0.8)', unit: 'each' },
      { name: 'Treated Pine Joists', searchTerm: 'Treated pine F7 90mm x 45mm x 4.8m', quantityFormula: 'Math.ceil(area * 0.6)', unit: 'each' },
      { name: 'Treated Pine Posts', searchTerm: 'Treated pine post 100mm x 100mm x 3m', quantityFormula: 'Math.ceil(area / 2 + height * 2)', unit: 'each' },
      { name: 'Galvanized Joist Hangers', searchTerm: 'Joist hanger galvanized 90mm', quantityFormula: 'Math.ceil(area * 2)', unit: 'each' },
      { name: 'Deck Screws', searchTerm: 'Deck screws stainless steel 10g x 65mm 500 pack', quantityFormula: 'Math.ceil(area / 5)', unit: 'pack' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix 20kg bag', quantityFormula: 'Math.ceil((area / 2 + height * 2) * 2)', unit: 'each' },
      { name: 'Post Stirrups', searchTerm: 'Post stirrup galvanized 100mm', quantityFormula: 'Math.ceil(area / 2 + height * 2)', unit: 'each' },
    ],
    estimatedHoursFormula: '(area * 2) + (height * area * 0.5)',
    estimatedHoursRange: { min: 16, max: 60 },
    suggestedMaterials: ['Merbau decking boards', 'Treated pine joists', 'Galvanized joist hangers', 'Deck screws', 'Concrete footings', 'Stirrups', 'Posts'],
    promptQuestions: [
      'How big roughly? (length x width or just small/medium/large)',
      'How high off the ground?',
      'What timber? (merbau, treated pine, composite)',
      'Steps or stairs needed?',
      'Handrails/balustrade needed?',
    ],
    aiContext: 'Deck construction: ~2hrs per m2 for standard height, add 50% for elevated decks. Merbau costs ~2x treated pine but lasts longer. Composite costs ~3x pine. Post footings: 2 bags concrete per post. Joist spacing 450mm centres. Decking boards: ~0.8 boards per m2 (90mm wide). Handrails/balustrades mandatory if >1m off ground. Steps add ~2hrs per step.',
  },
  {
    id: 'door_hanging',
    categoryId: 'carpentry',
    nicheId: 'doors_windows',
    name: 'Internal Door Hanging',
    description: 'Hang internal doors with hardware',
    icon: 'door',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'doors', label: 'Number of Doors', unit: '', defaultValue: 3 },
    ],
    defaultMaterials: [
      { name: 'Internal Doors', searchTerm: 'Internal door hollow core 2040 x 820mm white', quantityFormula: 'doors', unit: 'each' },
      { name: 'Door Hinges', searchTerm: 'Door hinges chrome 100mm pair', quantityFormula: 'doors * 2', unit: 'each' },
      { name: 'Door Handles', searchTerm: 'Door handle lever on rose chrome privacy', quantityFormula: 'doors', unit: 'each' },
      { name: 'Striker Plates', searchTerm: 'Door striker plate chrome', quantityFormula: 'doors', unit: 'each' },
      { name: 'Door Stops', searchTerm: 'Door stop spring chrome', quantityFormula: 'doors', unit: 'each' },
      { name: 'Architrave', searchTerm: 'Pine architrave 66mm x 18mm x 5.4m primed', quantityFormula: 'doors * 3', unit: 'each' },
    ],
    estimatedHoursFormula: 'doors * 2',
    estimatedHoursRange: { min: 2, max: 8 },
    suggestedMaterials: ['Doors', 'Hinges', 'Door handles', 'Striker plates', 'Door stops', 'Architrave'],
    promptQuestions: [
      'How many doors?',
      'Replacing existing or new openings?',
      'Any special doors? (barn door, cavity slider, French doors)',
      'New architraves/frames needed too?',
    ],
    aiContext: 'Door hanging: ~2hrs per standard hinged door replacement, ~3-4hrs for new openings (framing required). Cavity sliders need ~4hrs each including track install. Barn doors need header rail and stoppers. Standard door is 2040x820mm. Each door needs 3 hinges (100mm), 1 handle set, 1 striker plate. Architrave: 3 lengths per door (2 sides + head).',
  },
  {
    id: 'wardrobe_builtin',
    categoryId: 'carpentry',
    nicheId: 'custom_joinery',
    name: 'Built-in Wardrobe',
    description: 'Custom built-in wardrobe',
    icon: 'cupboard',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Wardrobe Length', unit: 'm', defaultValue: 2.5 },
      { key: 'height', label: 'Wardrobe Height', unit: 'm', defaultValue: 2.4 },
    ],
    defaultMaterials: [
      { name: 'MDF Sheets', searchTerm: 'MDF sheet 2400 x 1200 x 18mm', quantityFormula: 'Math.ceil(length * height / 2.5)', unit: 'each' },
      { name: 'Melamine Board White', searchTerm: 'Melamine board white 2400 x 600 x 16mm', quantityFormula: 'Math.ceil(length * 3)', unit: 'each' },
      { name: 'Hanging Rails Chrome', searchTerm: 'Wardrobe hanging rail chrome 25mm', quantityFormula: 'Math.ceil(length * 2)', unit: 'each' },
      { name: 'Drawer Runners', searchTerm: 'Drawer runners soft close 450mm', quantityFormula: 'Math.ceil(length * 2)', unit: 'each' },
      { name: 'Shelf Pins', searchTerm: 'Shelf support pins nickel 5mm 100 pack', quantityFormula: '1', unit: 'pack' },
      { name: 'Sliding Door Tracks', searchTerm: 'Sliding door track 2.4m white', quantityFormula: 'Math.ceil(length / 1.2)', unit: 'each' },
      { name: 'Cabinet Handles', searchTerm: 'Cabinet handles chrome 128mm', quantityFormula: 'Math.ceil(length * 4)', unit: 'each' },
      { name: 'Cabinet Screws', searchTerm: 'Cabinet screws 4mm x 30mm 200 pack', quantityFormula: 'Math.ceil(length)', unit: 'pack' },
      { name: 'Edging Tape White', searchTerm: 'Iron on edging tape white 22mm x 10m', quantityFormula: 'Math.ceil(length * 2)', unit: 'each' },
    ],
    estimatedHoursFormula: 'length * height * 3',
    estimatedHoursRange: { min: 12, max: 30 },
    suggestedMaterials: ['MDF sheets', 'Melamine boards', 'Hanging rails', 'Drawer runners', 'Shelf pins', 'Door tracks', 'Handles', 'Screws', 'Edging tape'],
    promptQuestions: [
      'How wide and tall?',
      'Sliding doors or hinged?',
      'How many drawers/shelves/hanging sections?',
      'What finish? (melamine, painted MDF, timber veneer)',
    ],
    aiContext: 'Built-in wardrobe: ~3hrs per m2 of wardrobe face area. Sliding doors are quicker to install than hinged. Drawers add ~1hr each (including runners). Standard wardrobe height 2.4m. MDF sheets for structure, melamine for visible surfaces. Edging tape for all exposed board edges. Typical layout: 60% hanging, 20% shelves, 20% drawers.',
  },

  // ============================================
  // PAINTING TEMPLATES
  // ============================================
  {
    id: 'interior_walls_paint',
    categoryId: 'painting',
    nicheId: 'interior',
    name: 'Interior Wall Painting (2-coat)',
    description: 'Paint interior walls with 2 coats',
    icon: 'format-paint',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Wall Area', unit: 'm²', defaultValue: 100 },
    ],
    defaultMaterials: [
      { name: 'Interior Paint', searchTerm: 'Interior paint low sheen white 10L', quantityFormula: 'Math.ceil(area / 70)', unit: 'each' },
      { name: 'Primer Sealer', searchTerm: 'Primer sealer undercoat 10L', quantityFormula: 'Math.ceil(area / 80)', unit: 'each' },
      { name: 'Drop Sheets', searchTerm: 'Drop sheet canvas heavy duty 3.6m x 2.7m', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
      { name: 'Masking Tape', searchTerm: 'Masking tape 24mm x 50m', quantityFormula: 'Math.ceil(area / 25)', unit: 'each' },
      { name: 'Sandpaper Assorted', searchTerm: 'Sandpaper assorted pack 120-240 grit', quantityFormula: 'Math.ceil(area / 50)', unit: 'pack' },
      { name: 'Sugar Soap', searchTerm: 'Sugar soap powder 500g', quantityFormula: 'Math.ceil(area / 100)', unit: 'each' },
      { name: 'Wall Filler', searchTerm: 'Wall filler interior ready mixed 1L', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 15', // 15 m² per hour
    estimatedHoursRange: { min: 4, max: 20 },
    suggestedMaterials: ['Interior paint', 'Primer/sealer', 'Drop sheets', 'Masking tape', 'Sandpaper', 'Sugar soap', 'Filler'],
    promptQuestions: [
      'How many rooms? Or roughly how much wall area?',
      'Walls only or ceilings and trim too?',
      'Current wall condition? (good, needs patching, needs stripping)',
      'Any colour change? (light to dark or dark to light)',
    ],
    aiContext: 'Interior painting: ~15m2/hr for 2-coat system on good walls. Ceiling adds ~30% more time. Trim/skirting adds ~20%. Poor condition walls needing heavy patching double prep time. Dark-to-light colour changes need extra primer coat (3 coats total). Paint coverage: ~14m2/L for wall paint, ~12m2/L for ceiling. Typical room: ~40m2 wall area.',
  },
  {
    id: 'exterior_paint',
    categoryId: 'painting',
    nicheId: 'exterior',
    name: 'Exterior Weatherboard Painting',
    description: 'Paint exterior weatherboards',
    icon: 'home',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Wall Area', unit: 'm²', defaultValue: 150 },
    ],
    defaultMaterials: [
      { name: 'Exterior Paint', searchTerm: 'Exterior paint weathershield low sheen 10L', quantityFormula: 'Math.ceil(area / 60)', unit: 'each' },
      { name: 'Exterior Primer', searchTerm: 'Exterior primer sealer 10L', quantityFormula: 'Math.ceil(area / 70)', unit: 'each' },
      { name: 'Drop Sheets', searchTerm: 'Drop sheet canvas heavy duty 3.6m x 2.7m', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
      { name: 'Masking Tape Wide', searchTerm: 'Masking tape 48mm x 50m', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
      { name: 'Sandpaper Coarse', searchTerm: 'Sandpaper assorted pack 60-120 grit', quantityFormula: 'Math.ceil(area / 40)', unit: 'pack' },
      { name: 'Sugar Soap', searchTerm: 'Sugar soap powder 1kg', quantityFormula: 'Math.ceil(area / 100)', unit: 'each' },
      { name: 'Exterior Filler', searchTerm: 'Exterior filler flexible 1L', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 12', // Slower than interior
    estimatedHoursRange: { min: 8, max: 30 },
    suggestedMaterials: ['Exterior paint', 'Primer', 'Drop sheets', 'Masking tape', 'Sandpaper', 'Sugar soap', 'Filler', 'Scaffolding'],
    promptQuestions: [
      'How big is the house roughly? (single/double storey)',
      'What\'s the surface? (weatherboard, render, brick)',
      'Current condition? (peeling, chalky, good)',
      'Scaffolding needed?',
    ],
    aiContext: 'Exterior painting: ~12m2/hr, slower than interior due to prep and access. Weatherboards need more prep (scraping, filling). Render is faster to paint but may need crack repair. Double-storey needs scaffolding — add hire cost and setup time (~2hrs). Paint coverage: ~12m2/L exterior grade. Typical single-storey house: ~150m2 wall area.',
  },
  {
    id: 'epoxy_garage_floor',
    categoryId: 'painting',
    nicheId: 'specialty',
    name: 'Epoxy Garage Floor',
    description: 'Apply epoxy coating to garage floor',
    icon: 'garage',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Floor Area', unit: 'm²', defaultValue: 40 },
    ],
    defaultMaterials: [
      { name: 'Epoxy Coating Kit', searchTerm: 'Epoxy garage floor coating kit 10L', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
      { name: 'Epoxy Primer', searchTerm: 'Epoxy primer concrete 4L', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
      { name: 'Concrete Grinder Discs', searchTerm: 'Diamond grinding disc concrete 100mm', quantityFormula: 'Math.ceil(area / 20)', unit: 'each' },
      { name: 'Epoxy Roller', searchTerm: 'Epoxy roller 270mm with frame', quantityFormula: '2', unit: 'each' },
      { name: 'Paint Brush', searchTerm: 'Paint brush 75mm synthetic', quantityFormula: '2', unit: 'each' },
      { name: 'Paint Tray', searchTerm: 'Paint tray large with liner', quantityFormula: '1', unit: 'each' },
      { name: 'Concrete Degreaser', searchTerm: 'Concrete degreaser cleaner 5L', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
    ],
    estimatedHoursFormula: '(area / 10) + 4', // Prep takes time
    estimatedHoursRange: { min: 6, max: 12 },
    suggestedMaterials: ['Epoxy coating kit', 'Primer', 'Concrete grinder discs', 'Roller', 'Brush', 'Paint tray', 'Degreaser'],
    promptQuestions: [
      'How big is the garage? (single, double, triple)',
      'Current floor condition? (bare concrete, painted, stained)',
      'Flake/chip finish or plain colour?',
      'Any cracks to repair?',
    ],
    aiContext: 'Epoxy garage floor: significant prep time (~4hrs for grinding/degreasing). Single garage ~36m2, double ~54m2, triple ~72m2. Epoxy kit covers ~40m2 per kit. Previously painted floors need extra grinding. Flake finish adds ~$50-100 in materials. Crack repair with epoxy filler adds prep time. Must be done over 2 days (primer day 1, topcoat day 2).',
  },

  // ============================================
  // FLOORING TEMPLATES
  // ============================================
  {
    id: 'timber_floor_polish',
    categoryId: 'flooring',
    nicheId: 'timber',
    name: 'Timber Floor Sand & Polish',
    description: 'Sand and polish timber floors',
    icon: 'set-square',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Floor Area', unit: 'm²', defaultValue: 50 },
    ],
    defaultMaterials: [
      { name: 'Floor Polish', searchTerm: 'Floor polish polyurethane gloss 4L', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
      { name: 'Sanding Discs Coarse', searchTerm: 'Sanding disc 40 grit 200mm 5 pack', quantityFormula: 'Math.ceil(area / 30)', unit: 'pack' },
      { name: 'Sanding Discs Medium', searchTerm: 'Sanding disc 80 grit 200mm 5 pack', quantityFormula: 'Math.ceil(area / 30)', unit: 'pack' },
      { name: 'Sanding Discs Fine', searchTerm: 'Sanding disc 120 grit 200mm 5 pack', quantityFormula: 'Math.ceil(area / 30)', unit: 'pack' },
      { name: 'Wood Filler', searchTerm: 'Wood filler timber interior 500g', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
      { name: 'Drop Sheets', searchTerm: 'Drop sheet canvas 3.6m x 2.7m', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 8', // 8 m² per hour
    estimatedHoursRange: { min: 6, max: 20 },
    suggestedMaterials: ['Floor polish/varnish', 'Sandpaper (various grits)', 'Wood filler', 'Drop sheets'],
    promptQuestions: [
      'How big is the area?',
      'What type of timber? (if you know)',
      'Current condition? (original, previously coated, damaged)',
      'What finish? (gloss, satin, matte)',
    ],
    aiContext: 'Timber floor sand & polish: ~8m2/hr including 3 sanding passes (40, 80, 120 grit). Previously coated floors take longer to strip. Damaged boards may need replacement before sanding. Polish coverage: ~10m2/L per coat, 3 coats standard. Must allow 24hrs between coats. Typical house hallway+lounge: ~40-60m2.',
  },
  {
    id: 'hybrid_flooring_install',
    categoryId: 'flooring',
    nicheId: 'timber',
    name: 'Hybrid Flooring Installation',
    description: 'Install hybrid floating floor',
    icon: 'floor-plan',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Floor Area', unit: 'm²', defaultValue: 60 },
    ],
    defaultMaterials: [
      { name: 'Hybrid Flooring Planks', searchTerm: 'Hybrid flooring planks waterproof 1800mm pack', quantityFormula: 'Math.ceil(area / 2)', unit: 'pack' },
      { name: 'Flooring Underlay', searchTerm: 'Flooring underlay acoustic 2mm roll', quantityFormula: 'Math.ceil(area / 10)', unit: 'each' },
      { name: 'Scotia Beading', searchTerm: 'Scotia quad beading pine 19mm x 19mm x 5.4m', quantityFormula: 'Math.ceil(area * 0.5)', unit: 'each' },
      { name: 'Expansion Foam', searchTerm: 'Expansion foam gap filler 750ml', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
      { name: 'Floor Adhesive', searchTerm: 'Floor adhesive hybrid flooring 15kg', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 12', // 12 m² per hour
    estimatedHoursRange: { min: 4, max: 16 },
    suggestedMaterials: ['Hybrid flooring planks', 'Underlay', 'Scotia/beading', 'Expansion foam', 'Floor adhesive'],
    promptQuestions: [
      'How big is the area?',
      'What\'s being removed? (carpet, tiles, nothing)',
      'Any transitions to other flooring types?',
      'Underfloor heating?',
    ],
    aiContext: 'Hybrid flooring install: ~12m2/hr for floating install. Carpet removal adds ~1hr per 20m2. Tile removal is much slower (~4m2/hr) and adds disposal costs. Transition strips needed at doorways and flooring changes. Underfloor heating is compatible with most hybrid — check manufacturer specs. Allow 5-10% waste on planks. Underlay roll covers ~10m2.',
  },
  {
    id: 'carpet_install',
    categoryId: 'flooring',
    nicheId: 'carpet',
    name: 'Carpet Supply & Lay',
    description: 'Supply and install carpet',
    icon: 'rug',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Floor Area', unit: 'm²', defaultValue: 40 },
    ],
    defaultMaterials: [
      { name: 'Carpet', searchTerm: 'Carpet plush twist pile beige 3.66m wide per m', quantityFormula: 'Math.ceil(area / 3.5)', unit: 'm' },
      { name: 'Carpet Underlay', searchTerm: 'Carpet underlay foam 9mm roll', quantityFormula: 'Math.ceil(area / 10)', unit: 'each' },
      { name: 'Gripper Strips', searchTerm: 'Carpet gripper strip timber 1.2m', quantityFormula: 'Math.ceil(area * 0.5)', unit: 'each' },
      { name: 'Carpet Joining Tape', searchTerm: 'Carpet joining tape heat activated 50mm x 15m', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
      { name: 'Threshold Strips', searchTerm: 'Carpet threshold strip aluminium 900mm', quantityFormula: 'Math.ceil(area / 20)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 15', // 15 m² per hour
    estimatedHoursRange: { min: 3, max: 10 },
    suggestedMaterials: ['Carpet', 'Underlay', 'Gripper strips', 'Joining tape', 'Threshold strips'],
    promptQuestions: [
      'How big is the area? How many rooms?',
      'Replacing existing carpet or new?',
      'Any stairs?',
      'Preference on carpet type? (plush, twist, loop)',
    ],
    aiContext: 'Carpet install: ~15m2/hr for flat areas. Stairs are much slower — ~20min per step. Existing carpet removal adds ~1hr per 20m2. Carpet sold by linear metre in standard widths (3.66m). Underlay: 1 roll per ~10m2. Gripper strips around all perimeters. Joins needed where room width exceeds carpet width. Threshold strips at every doorway.',
  },

  // ============================================
  // CLEANING TEMPLATES
  // ============================================
  {
    id: 'end_of_lease_clean',
    categoryId: 'cleaning',
    nicheId: 'residential',
    name: 'End-of-Lease Clean',
    description: 'Full end-of-tenancy clean',
    icon: 'broom',
    pricingMethod: 'fixed',
    requiredParams: [
      { key: 'bedrooms', label: 'Number of Bedrooms', unit: '', defaultValue: 3 },
      { key: 'bathrooms', label: 'Number of Bathrooms', unit: '', defaultValue: 2 },
    ],
    defaultMaterials: [
      { name: 'All-Purpose Cleaner', searchTerm: 'All purpose cleaner spray 1L', quantityFormula: 'Math.ceil((bedrooms + bathrooms) / 3)', unit: 'each' },
      { name: 'Glass Cleaner', searchTerm: 'Glass cleaner spray streak free 500ml', quantityFormula: 'Math.ceil((bedrooms + bathrooms) / 4)', unit: 'each' },
      { name: 'Bathroom Cleaner', searchTerm: 'Bathroom cleaner mould and mildew 1L', quantityFormula: 'bathrooms', unit: 'each' },
      { name: 'Oven Cleaner', searchTerm: 'Oven cleaner heavy duty 500ml', quantityFormula: '1', unit: 'each' },
      { name: 'Microfiber Cloths', searchTerm: 'Microfiber cleaning cloths pack of 10', quantityFormula: 'Math.ceil((bedrooms + bathrooms) / 3)', unit: 'pack' },
      { name: 'Mop Head', searchTerm: 'Mop head microfiber replacement', quantityFormula: '1', unit: 'each' },
      { name: 'Vacuum Bags', searchTerm: 'Vacuum cleaner bags universal pack of 5', quantityFormula: '1', unit: 'pack' },
    ],
    estimatedHoursFormula: '(bedrooms * 1.5) + (bathrooms * 2) + 4',
    estimatedHoursRange: { min: 6, max: 12 },
    suggestedMaterials: ['All-purpose cleaner', 'Glass cleaner', 'Bathroom cleaner', 'Oven cleaner', 'Microfiber cloths', 'Mop', 'Vacuum bags'],
    promptQuestions: [
      'How many bedrooms and bathrooms?',
      'Carpet steam clean included?',
      'Oven and rangehood clean?',
      'Any outdoor areas? (balcony, garage)',
    ],
    aiContext: 'End-of-lease clean: ~1.5hrs per bedroom, ~2hrs per bathroom, +4hrs for kitchen/common areas. Carpet steam clean adds ~$30-50 per room and ~30min each. Oven deep clean adds ~1hr. Rangehood filter clean adds ~30min. Outdoor areas (balcony sweep/mop) add ~30min each. Must meet real estate inspection standards.',
  },
  {
    id: 'pressure_clean',
    categoryId: 'cleaning',
    nicheId: 'specialty',
    name: 'High-Pressure Clean',
    description: 'Pressure wash driveway, paths, walls',
    icon: 'water-pump',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Area to Clean', unit: 'm²', defaultValue: 100 },
    ],
    defaultMaterials: [
      { name: 'Pressure Washer Detergent', searchTerm: 'Pressure washer detergent concentrate 5L', quantityFormula: 'Math.ceil(area / 200)', unit: 'each' },
      { name: 'Surface Cleaner Attachment', searchTerm: 'Pressure washer surface cleaner 300mm', quantityFormula: '1', unit: 'each' },
      { name: 'Petrol Fuel', searchTerm: 'Petrol fuel can 20L', quantityFormula: 'Math.ceil(area / 300)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area / 50', // 50 m² per hour
    estimatedHoursRange: { min: 2, max: 8 },
    suggestedMaterials: ['Pressure washer detergent', 'Surface cleaner attachment', 'Fuel'],
    promptQuestions: [
      'What\'s being cleaned? (driveway, paths, walls, roof)',
      'How big roughly?',
      'What surface? (concrete, pavers, brick, tile, colorbond)',
      'How dirty? (light, moderate, hasn\'t been done in years)',
      'Sealer coat after?',
    ],
    aiContext: 'High-pressure cleaning rates depend on surface type and grime level. Concrete handles standard high pressure; pavers and sandstone need lower pressure. Oil stains need degreaser pre-treatment. Sealer coat adds ~50% more time and materials. Estimate 30-50m2 per hour depending on grime. Typical driveway: 30-60m2. Chemical usage: ~1L detergent concentrate per 200m2.',
  },

  // --- NEW: AI-guided cleaning templates (no requiredParams — description-driven) ---
  {
    id: 'roof_clean',
    categoryId: 'cleaning',
    nicheId: 'specialty',
    name: 'Roof Cleaning',
    description: 'Clean roof surface including moss and lichen removal',
    icon: 'home-roof',
    pricingMethod: 'per_sqm',
    requiredParams: [],
    defaultMaterials: [
      { name: 'Roof Cleaning Solution', searchTerm: 'Roof cleaning solution concentrate 5L', quantityFormula: '2', unit: 'each' },
      { name: 'Moss & Lichen Killer', searchTerm: 'Moss lichen killer concentrate 5L', quantityFormula: '1', unit: 'each' },
      { name: 'Pressure Washer Detergent', searchTerm: 'Pressure washer detergent concentrate 5L', quantityFormula: '1', unit: 'each' },
      { name: 'Safety Harness', searchTerm: 'Safety harness roof anchor kit', quantityFormula: '1', unit: 'each' },
      { name: 'Petrol Fuel', searchTerm: 'Petrol fuel can 20L', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '6',
    estimatedHoursRange: { min: 3, max: 12 },
    suggestedMaterials: ['Roof cleaning solution', 'Moss/lichen killer', 'Pressure washer detergent', 'Safety harness', 'Fuel'],
    promptQuestions: [
      'What type of roof? (tile, colorbond, tin, flat)',
      'How big roughly? (metres or just small/medium/large house)',
      'How many stories?',
      'How bad is the moss/dirt/lichen?',
      'Gutters need doing too?',
    ],
    aiContext: 'Roof cleaning materials depend heavily on roof type. Tile roofs need more moss/lichen killer and softer pressure settings. Colorbond needs less chemicals but more care to avoid scratching. Estimate ~1L cleaning solution per 30m2 for moderate conditions, 1L per 20m2 for heavy. Add 1-2hrs for gutter cleaning. 2+ storey jobs need safety harness and take ~50% longer. Typical area: single storey house ~150m2 roof, double storey ~120m2 upper roof.',
  },
  {
    id: 'house_wash',
    categoryId: 'cleaning',
    nicheId: 'specialty',
    name: 'House Wash (Exterior Walls)',
    description: 'Wash exterior walls and surfaces',
    icon: 'home',
    pricingMethod: 'per_sqm',
    requiredParams: [],
    defaultMaterials: [
      { name: 'House Wash Solution', searchTerm: 'House wash cleaning solution concentrate 5L', quantityFormula: '2', unit: 'each' },
      { name: 'Mould Treatment', searchTerm: 'Mould remover exterior spray 5L', quantityFormula: '1', unit: 'each' },
      { name: 'Pressure Washer Detergent', searchTerm: 'Pressure washer detergent concentrate 5L', quantityFormula: '1', unit: 'each' },
      { name: 'Petrol Fuel', searchTerm: 'Petrol fuel can 20L', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '5',
    estimatedHoursRange: { min: 3, max: 10 },
    suggestedMaterials: ['House wash solution', 'Mould treatment', 'Pressure washer detergent', 'Fuel'],
    promptQuestions: [
      'What are the walls made of? (brick, render, weatherboard, vinyl)',
      'How big is the house roughly?',
      'How many stories?',
      'How dirty? (light dust, moderate grime, heavy mould)',
      'Windows need cleaning too?',
    ],
    aiContext: 'Wall material determines chemical selection and pressure settings. Brick and render handle high pressure; weatherboard and vinyl need softer wash. Estimate ~1L house wash solution per 50m2. Rendered walls often need mould treatment. Window cleaning adds ~30min per 10 windows. Typical house perimeter: 40-60 linear metres, wall height per storey ~2.7m.',
  },
  {
    id: 'driveway_pressure_wash',
    categoryId: 'cleaning',
    nicheId: 'specialty',
    name: 'Driveway/Patio Pressure Wash',
    description: 'Pressure wash driveway or patio surface',
    icon: 'water-pump',
    pricingMethod: 'per_sqm',
    requiredParams: [],
    defaultMaterials: [
      { name: 'Pressure Washer Detergent', searchTerm: 'Pressure washer detergent concentrate 5L', quantityFormula: '1', unit: 'each' },
      { name: 'Concrete Degreaser', searchTerm: 'Concrete degreaser cleaner 5L', quantityFormula: '1', unit: 'each' },
      { name: 'Concrete Sealer', searchTerm: 'Concrete sealer clear 10L', quantityFormula: '1', unit: 'each' },
      { name: 'Petrol Fuel', searchTerm: 'Petrol fuel can 20L', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '4',
    estimatedHoursRange: { min: 2, max: 8 },
    suggestedMaterials: ['Pressure washer detergent', 'Concrete degreaser', 'Concrete sealer', 'Fuel'],
    promptQuestions: [
      'What surface? (concrete, pavers, sandstone, exposed aggregate)',
      'How big roughly? (metres or car spaces)',
      'How dirty? (light, moderate, oil stains, heavy grime)',
      'Sealer coat wanted after?',
    ],
    aiContext: 'Surface type determines detergent and technique. Concrete and exposed aggregate handle standard high pressure. Sandstone and pavers need lower pressure and specific cleaners. Oil stains need degreaser pre-treatment. Sealer coat adds materials and ~50% more time. Typical driveway: 30-60m2. Typical patio: 15-30m2. Estimate 30-50m2 per hour depending on grime level.',
  },
];

/**
 * Get templates for a specific niche
 */
export function getTemplatesForNiche(categoryId: string, nicheId: string): NicheJobTemplate[] {
  return NICHE_TEMPLATES.filter(
    template => template.categoryId === categoryId && template.nicheId === nicheId
  );
}

/**
 * Get all templates for a category
 */
export function getTemplatesForCategory(categoryId: string): NicheJobTemplate[] {
  return NICHE_TEMPLATES.filter(template => template.categoryId === categoryId);
}

/**
 * Get template by ID
 */
export function getNicheTemplateById(id: string): NicheJobTemplate | undefined {
  return NICHE_TEMPLATES.find(template => template.id === id);
}

/**
 * Search templates by name or description
 */
export function searchNicheTemplates(query: string): NicheJobTemplate[] {
  const lowerQuery = query.toLowerCase();
  return NICHE_TEMPLATES.filter(
    template =>
      template.name.toLowerCase().includes(lowerQuery) ||
      template.description.toLowerCase().includes(lowerQuery) ||
      template.suggestedMaterials.some(m => m.toLowerCase().includes(lowerQuery))
  );
}
