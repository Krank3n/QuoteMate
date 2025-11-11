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
