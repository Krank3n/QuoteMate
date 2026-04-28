/**
 * Niche-Specific Job Templates
 * Templates based on trade categories and niches for common jobs.
 *
 * Each template carries optional `questionsLine` / `exampleLines` /
 * `voicePromptHint` copy that shapes the job description input on
 * JobDetailsScreen, so the screen feels native to the trade from the
 * very first job.
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
  // FENCING & GATES
  // ============================================
  {
    id: 'fence_install_colorbond',
    categoryId: 'other',
    nicheId: 'fencing',
    name: 'Colorbond Fence',
    description: 'Supply and install Colorbond fencing',
    icon: 'fence',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Fence Length', unit: 'm', defaultValue: 20 },
      { key: 'height', label: 'Fence Height', unit: 'm', defaultValue: 1.8 },
      { key: 'gates', label: 'Number of Gates', unit: '', defaultValue: 0 },
    ],
    defaultMaterials: [
      { name: 'Colorbond Sheet Infill', searchTerm: 'Colorbond fence infill sheet 1.8m per piece', quantityFormula: 'Math.ceil(length / 0.235)', unit: 'each' },
      { name: 'Colorbond Posts', searchTerm: 'Colorbond fence post 75 x 75 x 2.4m', quantityFormula: 'Math.ceil(length / 2.35) + 1 + (gates * 2)', unit: 'each' },
      { name: 'Top Rails', searchTerm: 'Colorbond fence top rail 2.4m', quantityFormula: 'Math.ceil(length / 2.35)', unit: 'each' },
      { name: 'Bottom Rails', searchTerm: 'Colorbond fence bottom rail 2.4m', quantityFormula: 'Math.ceil(length / 2.35)', unit: 'each' },
      { name: 'Post Caps', searchTerm: 'Colorbond fence post cap 75 x 75', quantityFormula: 'Math.ceil(length / 2.35) + 1 + (gates * 2)', unit: 'each' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix rapid set 20kg bag', quantityFormula: '(Math.ceil(length / 2.35) + 1 + (gates * 2)) * 2', unit: 'each' },
      { name: 'Tek Screws', searchTerm: 'Tek screw 10g x 16mm Colorbond colour matched 100 pack', quantityFormula: 'Math.ceil(length / 5)', unit: 'pack' },
      { name: 'Single Gate Kit', searchTerm: 'Colorbond pedestrian gate 900mm kit colour matched', quantityFormula: 'gates', unit: 'each' },
    ],
    estimatedHoursFormula: '(length * 0.6) + (gates * 2) + ((height - 1.8) * length * 0.1)',
    estimatedHoursRange: { min: 4, max: 40 },
    suggestedMaterials: ['Colorbond infill', 'Posts', 'Rails', 'Concrete', 'Caps', 'Gate kit'],
    questionsLine: 'How many linear metres? Height? How many gates? Old fence to remove?',
    exampleLines: '22m of 1.8m Colorbond fencing along the back boundary, one 900mm single gate, customer to remove old timber fence themselves. Sloped ground on the side run.',
    voicePromptHint: 'Tell me about the fence — length, height, gates, access',
  },
  {
    id: 'fence_install_timber',
    categoryId: 'other',
    nicheId: 'fencing',
    name: 'Timber Paling Fence',
    description: 'Supply and install timber paling fence',
    icon: 'fence',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Fence Length', unit: 'm', defaultValue: 20 },
      { key: 'height', label: 'Fence Height', unit: 'm', defaultValue: 1.8 },
      { key: 'gates', label: 'Number of Gates', unit: '', defaultValue: 0 },
    ],
    defaultMaterials: [
      { name: 'Treated Pine Palings', searchTerm: 'Treated pine paling 1.8m x 100 x 12mm', quantityFormula: 'Math.ceil(length * 11)', unit: 'each' },
      { name: 'Treated Pine Posts', searchTerm: 'Treated pine post H4 125 x 75 x 2.4m', quantityFormula: 'Math.ceil(length / 2.4) + 1 + (gates * 2)', unit: 'each' },
      { name: 'Treated Pine Rails', searchTerm: 'Treated pine fence rail 75 x 50 x 2.4m', quantityFormula: 'Math.ceil(length / 2.4) * 3', unit: 'each' },
      { name: 'Capping Rail', searchTerm: 'Treated pine capping rail 90 x 19 x 2.4m', quantityFormula: 'Math.ceil(length / 2.4)', unit: 'each' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix rapid set 20kg bag', quantityFormula: '(Math.ceil(length / 2.4) + 1 + (gates * 2)) * 2', unit: 'each' },
      { name: 'Galvanised Nails', searchTerm: 'Galvanised flat head nails 50mm x 2.8mm 1kg', quantityFormula: 'Math.ceil(length / 5)', unit: 'each' },
      { name: 'Galvanised Bugle Screws', searchTerm: 'Galvanised bugle batten screw 14g x 75mm 100 pack', quantityFormula: 'Math.ceil(length / 8)', unit: 'pack' },
      { name: 'Single Gate Frame Kit', searchTerm: 'Steel gate frame kit 900 x 1800 timber clad', quantityFormula: 'gates', unit: 'each' },
    ],
    estimatedHoursFormula: '(length * 0.7) + (gates * 2.5) + ((height - 1.8) * length * 0.15)',
    estimatedHoursRange: { min: 4, max: 40 },
    suggestedMaterials: ['Treated pine palings', 'Posts', 'Rails', 'Capping', 'Concrete', 'Galv fixings'],
    questionsLine: 'Length? Height? Capped or no cap? Lap-and-cap or butted? Gates?',
    exampleLines: '30m of 1.8m treated pine paling fence, lap-and-cap style with capping rail. Two 900mm gates with steel frame. Existing fence to be removed and disposed of.',
    voicePromptHint: 'Tell me about the fence — length, height, style, gates',
  },
  {
    id: 'fence_repair',
    categoryId: 'other',
    nicheId: 'fencing',
    name: 'Fence Repair',
    description: 'Repair sections of existing fence',
    icon: 'tools',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'palings', label: 'Palings to Replace', unit: '', defaultValue: 8 },
      { key: 'posts', label: 'Posts to Replace', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'Treated Pine Palings', searchTerm: 'Treated pine paling 1.8m x 100 x 12mm', quantityFormula: 'palings', unit: 'each' },
      { name: 'Treated Pine Posts', searchTerm: 'Treated pine post H4 125 x 75 x 2.4m', quantityFormula: 'posts', unit: 'each' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix rapid set 20kg bag', quantityFormula: 'posts * 2', unit: 'each' },
      { name: 'Galvanised Nails', searchTerm: 'Galvanised flat head nails 50mm x 2.8mm 1kg', quantityFormula: '1', unit: 'each' },
      { name: 'Treated Pine Rails (spare)', searchTerm: 'Treated pine fence rail 75 x 50 x 2.4m', quantityFormula: 'Math.max(1, posts)', unit: 'each' },
    ],
    estimatedHoursFormula: '(palings * 0.2) + (posts * 1.5) + 1',
    estimatedHoursRange: { min: 1, max: 8 },
    suggestedMaterials: ['Replacement palings', 'Posts', 'Rails', 'Concrete', 'Galv nails'],
    questionsLine: 'What broke? How many palings/posts to replace? Material match needed?',
    exampleLines: 'Two posts snapped at ground level after the storm, plus about 8 palings to replace. Match existing 1.8m treated pine. Customer keen to keep capping rail.',
    voicePromptHint: 'What needs fixing — posts, palings, gates?',
  },
  {
    id: 'gate_install',
    categoryId: 'other',
    nicheId: 'fencing',
    name: 'Gate Install',
    description: 'Supply and install pedestrian or driveway gate',
    icon: 'gate',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'gates', label: 'Number of Gates', unit: '', defaultValue: 1 },
      { key: 'width', label: 'Gate Width', unit: 'm', defaultValue: 0.9 },
    ],
    defaultMaterials: [
      { name: 'Gate Frame Kit', searchTerm: 'Steel gate frame kit 900 x 1800 powder coated', quantityFormula: 'gates', unit: 'each' },
      { name: 'Gate Hinges (Pair)', searchTerm: 'Gate hinge heavy duty self closing pair', quantityFormula: 'gates', unit: 'each' },
      { name: 'Magnetic Latch', searchTerm: 'Gate magnetic latch child safe Magnalatch', quantityFormula: 'gates', unit: 'each' },
      { name: 'Gate Posts', searchTerm: 'Galvanised steel post 75 x 75 x 2.4m fence', quantityFormula: 'gates * 2', unit: 'each' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix rapid set 20kg bag', quantityFormula: 'gates * 4', unit: 'each' },
      { name: 'Cladding Sheet (Colorbond)', searchTerm: 'Colorbond fence infill sheet 1.8m per piece', quantityFormula: 'Math.ceil(gates * width / 0.235)', unit: 'each' },
    ],
    estimatedHoursFormula: 'gates * (3 + Math.max(0, width - 0.9) * 2)',
    estimatedHoursRange: { min: 2, max: 12 },
    suggestedMaterials: ['Gate frame', 'Hinges', 'Latch/lock', 'Posts', 'Concrete', 'Cladding'],
    questionsLine: 'Single or double? Width? Material? Self-closing? Lock type?',
    exampleLines: 'One 900mm single Colorbond gate to match existing fence, self-closing hinges, magnetic child-safe latch. New steel posts and concrete footings.',
    voicePromptHint: 'Tell me about the gate — width, material, hardware',
  },
  {
    id: 'pool_fence_glass',
    categoryId: 'other',
    nicheId: 'fencing',
    name: 'Pool Fence (Glass)',
    description: 'Supply and install frameless or semi-frameless glass pool fence',
    icon: 'pool',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Fence Length', unit: 'm', defaultValue: 14 },
      { key: 'gates', label: 'Number of Gates', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: '12mm Toughened Glass Panel', searchTerm: 'Toughened glass pool fence panel 12mm 1200 x 1200', quantityFormula: 'Math.ceil(length / 1.2)', unit: 'each' },
      { name: 'Stainless Spigots', searchTerm: 'Pool fence spigot 316 stainless core drill mount', quantityFormula: 'Math.ceil(length / 1.2) * 2', unit: 'each' },
      { name: 'Pool Gate Panel', searchTerm: 'Toughened glass pool gate panel 12mm 900 x 1200', quantityFormula: 'gates', unit: 'each' },
      { name: 'Pool Gate Hinges (Pair)', searchTerm: 'Polaris pool gate hinge soft close pair', quantityFormula: 'gates', unit: 'each' },
      { name: 'Pool Gate Latch', searchTerm: 'Magnalatch pool gate latch top pull series 3', quantityFormula: 'gates', unit: 'each' },
      { name: 'Core Drill Bit Wear', searchTerm: 'Diamond core drill bit 75mm concrete', quantityFormula: 'Math.ceil(length / 10)', unit: 'each' },
      { name: 'Chemical Anchor Resin', searchTerm: 'Chemical anchor resin epoxy 380ml', quantityFormula: 'Math.ceil(length / 5)', unit: 'each' },
      { name: 'Compliance Certificate', searchTerm: 'Pool fence compliance certificate AS1926', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '(length * 1.2) + (gates * 2)',
    estimatedHoursRange: { min: 6, max: 24 },
    suggestedMaterials: ['12mm toughened glass', 'Spigots', 'Gate panel', 'Hinges', 'Latch', 'Anchor resin'],
    questionsLine: 'Linear metres? Frameless or semi-frameless? Number of gates? Mounting surface (concrete/timber deck)?',
    exampleLines: '14m of frameless 12mm glass pool fencing, 1200mm height, mounted on existing concrete slab with core-drilled spigots. One self-closing gate. Compliant with AS1926.1.',
    voicePromptHint: 'Tell me about the pool fence — length, style, surface',
  },

  // ============================================
  // LANDSCAPE & GARDENING
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
    estimatedHoursFormula: 'area / 500',
    estimatedHoursRange: { min: 1, max: 4 },
    suggestedMaterials: ['Fuel', 'Line trimmer cord', 'Waste bags'],
    questionsLine: 'How big is the area? Edging or trimming included? Green waste removal?',
    exampleLines: 'Approx 1500m² of lawn, includes edging around garden beds and driveway. Green waste left bagged at side gate for council pickup.',
    voicePromptHint: 'Tell me about the lawn — size, edging, waste',
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
    estimatedHoursFormula: '(length * height) / 10',
    estimatedHoursRange: { min: 0.5, max: 4 },
    suggestedMaterials: ['Hedge trimmer fuel', 'Waste bags', 'Tarp'],
    questionsLine: 'Length and height of hedge? How overgrown? Waste removal needed?',
    exampleLines: 'About 12m of hedge averaging 2m high, fairly overgrown — last cut 18 months ago. Green waste removed and disposed of.',
    voicePromptHint: 'Tell me about the hedge — length, height, condition',
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
    estimatedHoursFormula: '(area * 0.4) + (plants * 0.15)',
    estimatedHoursRange: { min: 2, max: 8 },
    suggestedMaterials: ['Garden soil', 'Mulch', 'Plants', 'Fertilizer', 'Weed mat', 'Garden edging'],
    questionsLine: 'Bed area? Plant types and quantity? Edging or retaining? Soil delivery or bagged?',
    exampleLines: 'About 8m² new garden bed along the front fence, 15 native shrubs in 200mm pots, mulch top-up, flexible plastic edging. Soil supplied bulk by m³.',
    voicePromptHint: 'Tell me about the garden bed — size, plants, edging',
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
    estimatedHoursFormula: 'area / 10',
    estimatedHoursRange: { min: 2, max: 10 },
    suggestedMaterials: ['Instant turf rolls', 'Top soil', 'Starter fertilizer', 'Soil leveling sand'],
    questionsLine: 'Square metres? Turf variety? Site prep needed (removal, soil top-up)?',
    exampleLines: '60m² Sir Walter buffalo turf, existing lawn to be sprayed and removed first, 50mm topsoil added and levelled before lay.',
    voicePromptHint: 'Tell me about the turf job — area, variety, prep',
  },
  {
    id: 'paving_install',
    categoryId: 'landscape_gardening',
    nicheId: 'landscaping',
    name: 'Paving',
    description: 'Lay paved area or pathway',
    icon: 'view-grid',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Paved Area', unit: 'm²', defaultValue: 30 },
    ],
    defaultMaterials: [
      { name: 'Concrete Pavers', searchTerm: 'Concrete paver 400 x 400 x 40mm grey', quantityFormula: 'Math.ceil(area * 6.6)', unit: 'each' },
      { name: 'Road Base (Bulk)', searchTerm: 'Road base CBR45 bulk per m³', quantityFormula: 'Math.ceil(area * 0.12)', unit: 'm' },
      { name: 'Bedding Sand', searchTerm: 'Washed bedding sand bulk per m³', quantityFormula: 'Math.ceil(area * 0.04)', unit: 'm' },
      { name: 'Joint Filling Sand', searchTerm: 'Polymeric paver joint sand 20kg', quantityFormula: 'Math.ceil(area / 18)', unit: 'each' },
      { name: 'Plastic Edge Restraint', searchTerm: 'Paver edge restraint plastic 2m with spikes', quantityFormula: 'Math.ceil(Math.sqrt(area) * 2)', unit: 'each' },
      { name: 'Geotextile Membrane', searchTerm: 'Geotextile fabric paving 4m x 25m', quantityFormula: 'Math.ceil(area / 80)', unit: 'each' },
      { name: 'Skip Bin (Excavation)', searchTerm: 'Skip bin hire 4m³ soil and turf', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area * 1',
    estimatedHoursRange: { min: 6, max: 30 },
    suggestedMaterials: ['Pavers', 'Road base', 'Bedding sand', 'Joint sand', 'Edge restraints', 'Geotextile'],
    questionsLine: 'Square metres? Paver type/size? Pattern? Existing surface to remove?',
    exampleLines: '32m² of 400x400 concrete pavers in a stretcher pattern, new path and small patio. Existing lawn to be cut out and excavated 100mm. Compacted road base, sand bedding, joint sand finish.',
    voicePromptHint: 'Tell me about the paving — area, paver, pattern, prep',
  },
  {
    id: 'retaining_wall',
    categoryId: 'landscape_gardening',
    nicheId: 'landscaping',
    name: 'Retaining Wall',
    description: 'Build retaining wall (timber, block or concrete sleeper)',
    icon: 'wall',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'length', label: 'Wall Length', unit: 'm', defaultValue: 8 },
      { key: 'height', label: 'Wall Height', unit: 'm', defaultValue: 0.6 },
    ],
    defaultMaterials: [
      { name: 'Concrete Sleepers', searchTerm: 'Concrete sleeper plain grey 2.0m x 200 x 75mm', quantityFormula: 'Math.ceil((height / 0.2) * (length / 2.0))', unit: 'each' },
      { name: 'Galvanised H-Posts', searchTerm: 'Galvanised retaining wall H post 100UC 2.4m', quantityFormula: 'Math.ceil(length / 2.0) + 1', unit: 'each' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix 20kg bag', quantityFormula: '(Math.ceil(length / 2.0) + 1) * 4', unit: 'each' },
      { name: 'Drainage Gravel (Bulk)', searchTerm: '20mm drainage aggregate bulk per m³', quantityFormula: 'Math.ceil(length * height * 0.25)', unit: 'm' },
      { name: 'Ag Pipe', searchTerm: 'Slotted agricultural drain pipe 100mm x 20m roll', quantityFormula: 'Math.ceil(length / 20)', unit: 'each' },
      { name: 'Geotextile / Filter Fabric', searchTerm: 'Geotextile filter fabric 1.8m x 30m drainage', quantityFormula: 'Math.ceil(length / 30)', unit: 'each' },
    ],
    estimatedHoursFormula: '(length * height * 2) + 4',
    estimatedHoursRange: { min: 8, max: 40 },
    suggestedMaterials: ['Sleepers / blocks', 'Galvanised posts', 'Concrete', 'Drainage gravel', 'Ag pipe', 'Geotextile'],
    questionsLine: 'Length and height? Material (timber sleepers, concrete sleepers, block)? Drainage required?',
    exampleLines: '8m of concrete sleeper retaining wall at 600mm high, galv H-posts in concrete footings, ag drain behind with 50mm drainage gravel and geotextile. Backfill with site soil.',
    voicePromptHint: 'Tell me about the wall — length, height, material',
  },

  // ============================================
  // PLUMBING
  // ============================================
  {
    id: 'drain_unblock',
    categoryId: 'plumbing',
    nicheId: 'drain_services',
    name: 'Drain Unblock',
    description: 'Clear blocked drain with electric eel or hydro-jet',
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
    questionsLine: 'Which fixture(s)? How long blocked? CCTV inspection needed? Tree roots suspected?',
    exampleLines: 'Kitchen sink and laundry both backing up — likely one shared blockage. Customer suspects tree roots in the boundary trap. CCTV inspection included after clear.',
    voicePromptHint: 'Tell me about the blockage — fixture, history, suspected cause',
  },
  {
    id: 'toilet_install',
    categoryId: 'plumbing',
    nicheId: 'fixtures_fittings',
    name: 'Toilet Install',
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
    questionsLine: 'How many? Customer supplied or you supply? S-trap or P-trap? Tile floor?',
    exampleLines: 'One close-coupled toilet suite supplied by us, replacing existing S-trap. Tile floor — silicone seal around base. Old suite removed and disposed of.',
    voicePromptHint: 'Tell me about the toilet job — number, supply, trap type',
  },
  {
    id: 'hot_water_install',
    categoryId: 'plumbing',
    nicheId: 'hot_water',
    name: 'Hot Water (Electric Storage)',
    description: 'Install electric storage hot water system',
    icon: 'water-boiler',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'capacity', label: 'Tank Capacity', unit: 'L', defaultValue: 250 },
    ],
    defaultMaterials: [
      { name: 'Electric Storage HWS', searchTerm: 'Rheem Stellar electric hot water system storage tank', quantityFormula: '1', unit: 'each' },
      { name: 'Copper Pipe 15mm', searchTerm: 'Copper pipe 15mm x 3m', quantityFormula: '3', unit: 'each' },
      { name: 'Copper Pipe Fittings Kit', searchTerm: 'Copper pipe fittings assorted pack', quantityFormula: '1', unit: 'pack' },
      { name: 'PTR Valve', searchTerm: 'Pressure temperature relief valve 1/2 inch hot water', quantityFormula: '1', unit: 'each' },
      { name: 'Tempering Valve', searchTerm: 'Tempering valve 50C adjustable 15mm', quantityFormula: '1', unit: 'each' },
      { name: 'Isolating Ball Valves', searchTerm: 'Ball valve isolating 15mm brass lever', quantityFormula: '2', unit: 'each' },
      { name: 'Drain Line', searchTerm: 'Copper drain pipe 15mm x 3m', quantityFormula: '1', unit: 'each' },
      { name: 'Overflow Tray', searchTerm: 'Hot water safe tray plastic 600 x 600', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '4',
    estimatedHoursRange: { min: 3, max: 6 },
    suggestedMaterials: ['Storage tank', 'Copper pipe', 'Fittings', 'PTR valve', 'Tempering valve', 'Isolating valves', 'Overflow tray'],
    questionsLine: 'Tank size? Like-for-like swap or new location? Single or twin element? Old unit removal?',
    exampleLines: '250L electric storage HWS, like-for-like swap in external alcove. New tempering valve, PTR and isolation valves. Old unit removed and taken to scrap.',
    voicePromptHint: 'Tell me about the electric HWS — size, location, swap',
  },
  {
    id: 'hot_water_install_gas_continuous',
    categoryId: 'plumbing',
    nicheId: 'hot_water',
    name: 'Hot Water (Gas Continuous)',
    description: 'Install instantaneous (continuous flow) gas hot water unit',
    icon: 'fire',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'flow_rate', label: 'Flow Rate', unit: 'L/min', defaultValue: 26 },
    ],
    defaultMaterials: [
      { name: 'Gas Continuous Flow HWS', searchTerm: 'Rinnai Infinity continuous flow gas hot water 26L', quantityFormula: '1', unit: 'each' },
      { name: 'Copper Gas Pipe 20mm', searchTerm: 'Copper pipe gas approved 20mm x 3m', quantityFormula: '2', unit: 'each' },
      { name: 'Copper Water Pipe 20mm', searchTerm: 'Copper pipe 20mm x 3m', quantityFormula: '2', unit: 'each' },
      { name: 'Gas Fittings Kit', searchTerm: 'Gas pipe fittings brass assorted pack', quantityFormula: '1', unit: 'pack' },
      { name: 'Tempering Valve', searchTerm: 'Tempering valve 50C adjustable 20mm', quantityFormula: '1', unit: 'each' },
      { name: 'Isolating Ball Valves', searchTerm: 'Ball valve isolating 20mm brass lever', quantityFormula: '2', unit: 'each' },
      { name: 'Gas Isolation Cock', searchTerm: 'Gas cock 20mm AGA approved', quantityFormula: '1', unit: 'each' },
      { name: 'Flue / Vent Kit', searchTerm: 'Flue kit gas continuous flow external', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '4.5',
    estimatedHoursRange: { min: 3, max: 7 },
    suggestedMaterials: ['Continuous flow unit', 'Gas pipe', 'Water pipe', 'Fittings', 'Tempering valve', 'Gas cock', 'Flue kit'],
    questionsLine: 'Flow rate (16/20/26 L/min)? Natural gas or LPG? Internal or external? Like-for-like or new gas run?',
    exampleLines: 'Rinnai Infinity 26 LPG continuous flow, external mount on side wall, like-for-like swap of existing unit. New tempering valve and isolation cocks. Gas tightness test on completion.',
    voicePromptHint: 'Tell me about the gas HWS — size, gas type, location',
  },
  {
    id: 'hot_water_install_heat_pump',
    categoryId: 'plumbing',
    nicheId: 'hot_water',
    name: 'Hot Water (Heat Pump)',
    description: 'Install heat pump hot water system',
    icon: 'water-boiler',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'capacity', label: 'Tank Capacity', unit: 'L', defaultValue: 270 },
    ],
    defaultMaterials: [
      { name: 'Heat Pump HWS', searchTerm: 'Reclaim Energy heat pump hot water system 270L', quantityFormula: '1', unit: 'each' },
      { name: 'Copper Pipe 15mm', searchTerm: 'Copper pipe 15mm x 3m', quantityFormula: '4', unit: 'each' },
      { name: 'Copper Pipe Fittings Kit', searchTerm: 'Copper pipe fittings assorted pack', quantityFormula: '1', unit: 'pack' },
      { name: 'Insulated Refrigerant Line', searchTerm: 'Pre-insulated refrigerant line set heat pump 5m', quantityFormula: '1', unit: 'each' },
      { name: 'PTR Valve', searchTerm: 'Pressure temperature relief valve 1/2 inch hot water', quantityFormula: '1', unit: 'each' },
      { name: 'Tempering Valve', searchTerm: 'Tempering valve 50C adjustable 15mm', quantityFormula: '1', unit: 'each' },
      { name: 'Isolating Ball Valves', searchTerm: 'Ball valve isolating 15mm brass lever', quantityFormula: '2', unit: 'each' },
      { name: 'Condensate Drain Line', searchTerm: 'Condensate drain pipe 13mm 5m', quantityFormula: '1', unit: 'each' },
      { name: 'Concrete Slab Pad', searchTerm: 'Pre-cast concrete pad 600 x 600 x 50mm', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '6',
    estimatedHoursRange: { min: 4, max: 10 },
    suggestedMaterials: ['Heat pump unit', 'Copper pipe', 'Fittings', 'PTR valve', 'Tempering valve', 'Condensate drain', 'Slab pad'],
    questionsLine: 'Integrated or split? Tank size? Slab/pad needed? STC rebate paperwork required? Existing unit removal?',
    exampleLines: 'Reclaim Energy 270L split heat pump, new concrete pad behind garage, refrigerant line set 4m run to tank. STC paperwork handled. Old electric storage taken to scrap.',
    voicePromptHint: 'Tell me about the heat pump — split or integrated, size, location',
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
      { name: 'Wall Tiles', searchTerm: 'Bathroom wall tiles 300x600mm white gloss', quantityFormula: 'Math.ceil(fixtures * 2.5)', unit: 'box' },
      { name: 'Floor Tiles', searchTerm: 'Floor tiles porcelain 600x600mm', quantityFormula: 'Math.ceil(fixtures * 0.9)', unit: 'box' },
      { name: 'Waterproofing Membrane', searchTerm: 'Waterproofing membrane kit bathroom', quantityFormula: '2', unit: 'each' },
      { name: 'Copper Pipe 15mm', searchTerm: 'Copper pipe 15mm x 3m', quantityFormula: 'Math.ceil(fixtures * 2)', unit: 'each' },
      { name: 'PVC Pipe 40mm', searchTerm: 'PVC pipe 40mm x 3m drainage', quantityFormula: 'Math.ceil(fixtures * 1.5)', unit: 'each' },
      { name: 'Plumbing Fittings Kit', searchTerm: 'Plumbing fittings assorted pack', quantityFormula: '2', unit: 'pack' },
    ],
    estimatedHoursFormula: 'fixtures * 4',
    estimatedHoursRange: { min: 16, max: 40 },
    suggestedMaterials: ['Shower mixer', 'Basin mixer', 'Toilet suite', 'Vanity', 'Shower screen', 'Tiles', 'Waterproofing membrane', 'Copper pipe', 'PVC pipe', 'Various fittings'],
    questionsLine: 'Layout change or like-for-like? Fixtures included? Tiles supplied by who? Waterproofing required?',
    exampleLines: 'Full main bathroom strip-out and reno, layout staying the same. New shower, vanity, toilet, mixer taps. Tiles supplied by customer. Waterproofing certified to AS3740.',
    voicePromptHint: 'Tell me about the bathroom — scope, fixtures, tiles, layout',
  },

  // ============================================
  // ELECTRICAL
  // ============================================
  {
    id: 'power_point_install',
    categoryId: 'electrical',
    nicheId: 'power_lighting',
    name: 'Power Points',
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
    questionsLine: 'How many points? Singles or doubles? New circuit or off existing? USB or standard?',
    exampleLines: 'Four new double GPOs in the lounge — two on each end wall — running off the existing power circuit. Standard white 10A, no USB. Wall is gyprock with timber studs.',
    voicePromptHint: 'Tell me about the points — number, location, circuit',
  },
  {
    id: 'led_downlight_pack',
    categoryId: 'electrical',
    nicheId: 'power_lighting',
    name: 'LED Downlights',
    description: 'Install LED downlights',
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
    questionsLine: 'How many lights? New install or replacing halogen? Dimmable? Roof access OK?',
    exampleLines: '12 dimmable 90mm LED downlights replacing existing halogens through living and kitchen. Reuse existing wiring where possible. Tile roof, easy ceiling access.',
    voicePromptHint: 'Tell me about the lights — number, type, replacement or new',
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
    questionsLine: 'Existing pole count? New circuits added? RCDs to AS3000? Asbestos board concern?',
    exampleLines: 'Old ceramic-fuse board to be replaced with 18-pole metal enclosure. RCD-protect every circuit, add surge protector and main switch. Asbestos removal not required (existing board confirmed bakelite).',
    voicePromptHint: 'Tell me about the board — existing setup, new circuits, RCDs',
  },
  {
    id: 'ev_charger_install',
    categoryId: 'electrical',
    nicheId: 'specialty',
    name: 'EV Charger Install',
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
    questionsLine: 'Charger model? Distance from board? Single phase or 3-phase? Customer supplied unit?',
    exampleLines: '7kW Type 2 charger supplied by customer, mounted in garage approx 8m run from board, single phase. Surface conduit on garage wall, dedicated 32A circuit.',
    voicePromptHint: 'Tell me about the EV install — charger, distance, phase',
  },

  // ============================================
  // CARPENTRY
  // ============================================
  {
    id: 'deck_construction',
    categoryId: 'carpentry',
    nicheId: 'outdoor',
    name: 'Deck Build',
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
    questionsLine: 'Square metres? Height off ground? Decking timber? Balustrade or steps?',
    exampleLines: '24m² merbau deck off the back of the house, 600mm off ground. Treated pine substructure, stirrup footings in concrete. One 4-step staircase, no balustrade required (under 1m).',
    voicePromptHint: 'Tell me about the deck — size, height, timber, steps',
  },
  {
    id: 'pergola_build',
    categoryId: 'carpentry',
    nicheId: 'outdoor',
    name: 'Pergola',
    description: 'Build pergola or outdoor roof structure',
    icon: 'home-roof',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Pergola Area', unit: 'm²', defaultValue: 24 },
    ],
    defaultMaterials: [
      { name: 'Treated Pine Posts', searchTerm: 'Treated pine post H4 100 x 100 x 3m', quantityFormula: 'Math.max(4, Math.ceil(area / 6))', unit: 'each' },
      { name: 'LVL Beams', searchTerm: 'LVL beam structural 240 x 45 x 4.8m', quantityFormula: 'Math.ceil(area / 5)', unit: 'each' },
      { name: 'Treated Pine Rafters', searchTerm: 'Treated pine F7 90 x 45 x 4.8m', quantityFormula: 'Math.ceil(area / 2.5)', unit: 'each' },
      { name: 'Colorbond Roof Sheets', searchTerm: 'Colorbond Trimdek roof sheet custom length per m²', quantityFormula: 'Math.ceil(area * 1.1)', unit: 'm' },
      { name: 'Galvanised Post Stirrups', searchTerm: 'Galvanised post stirrup bolt down 100 x 100', quantityFormula: 'Math.max(4, Math.ceil(area / 6))', unit: 'each' },
      { name: 'Concrete Mix', searchTerm: 'Concrete mix 20kg bag', quantityFormula: 'Math.max(4, Math.ceil(area / 6)) * 4', unit: 'each' },
      { name: 'Joist Hangers', searchTerm: 'Joist hanger galvanised 90mm', quantityFormula: 'Math.ceil(area / 1.2)', unit: 'each' },
      { name: 'Bugle Batten Screws', searchTerm: 'Galvanised bugle batten screw 14g x 100mm 100 pack', quantityFormula: 'Math.ceil(area / 8)', unit: 'pack' },
      { name: 'Roofing Screws', searchTerm: 'Roofing screw class 4 65mm 250 pack', quantityFormula: 'Math.ceil(area / 15)', unit: 'pack' },
      { name: 'Bracket Ledger / Top Hats', searchTerm: 'Top hat batten 40mm x 6m galvanised', quantityFormula: 'Math.ceil(area / 4)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area * 1.8',
    estimatedHoursRange: { min: 12, max: 50 },
    suggestedMaterials: ['Posts', 'LVL beams', 'Rafters', 'Roof sheeting', 'Stirrups', 'Concrete', 'Hangers', 'Battens'],
    questionsLine: 'Size and shape? Attached to house or freestanding? Roofing (poly, Colorbond, open battens)?',
    exampleLines: '4x6m attached pergola off rear of house, Colorbond roof on 100x100 treated pine posts in galv stirrups. Double LVL beam, 90x45 rafters at 600 centres. Council certifier required.',
    voicePromptHint: 'Tell me about the pergola — size, attachment, roof',
  },
  {
    id: 'door_hanging',
    categoryId: 'carpentry',
    nicheId: 'doors_windows',
    name: 'Door Hanging',
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
    questionsLine: 'How many doors? Solid or hollow core? Pre-hung or door + frame? Hardware supplied?',
    exampleLines: 'Three internal hollow-core doors, customer supplied. Reuse existing frames and architraves. Supply chrome lever-on-rose hardware and hinges.',
    voicePromptHint: 'Tell me about the doors — number, type, hardware',
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
    questionsLine: 'Internal length and height? Sliding or hinged doors? Drawer count? Hanging vs shelving split?',
    exampleLines: '2.7m wide x 2.4m high built-in wardrobe with 3 mirrored sliding doors. Internal split: half hanging (double rail) and half shelving + 4 drawers. Melamine internals.',
    voicePromptHint: 'Tell me about the wardrobe — size, doors, internals',
  },

  // ============================================
  // PAINTING
  // ============================================
  {
    id: 'interior_walls_paint',
    categoryId: 'painting',
    nicheId: 'interior',
    name: 'Interior Painting',
    description: 'Paint interior walls and ceilings',
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
    estimatedHoursFormula: 'area / 15',
    estimatedHoursRange: { min: 4, max: 20 },
    suggestedMaterials: ['Interior paint', 'Primer/sealer', 'Drop sheets', 'Masking tape', 'Sandpaper', 'Sugar soap', 'Filler'],
    questionsLine: 'Rooms involved? Walls, ceilings, trim? Number of coats? Wall prep needed (filling, sanding)?',
    exampleLines: 'Three bedrooms and hallway — walls and ceilings, two coats low sheen. Minor patch and fill, light sand. Trim to be cut in but not painted. Furniture moved by customer.',
    voicePromptHint: 'Tell me about the paint job — rooms, surfaces, coats',
  },
  {
    id: 'exterior_paint',
    categoryId: 'painting',
    nicheId: 'exterior',
    name: 'Exterior Painting',
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
    estimatedHoursFormula: 'area / 12',
    estimatedHoursRange: { min: 8, max: 30 },
    suggestedMaterials: ['Exterior paint', 'Primer', 'Drop sheets', 'Masking tape', 'Sandpaper', 'Sugar soap', 'Filler', 'Scaffolding'],
    questionsLine: 'Wall area? Material (weatherboard, render, brick)? Single or two storey? Pressure clean and prep?',
    exampleLines: 'Single-storey weatherboard cottage, approx 160m² walls plus eaves and fascias. Pressure wash, scrape and spot prime, two top coats Weathershield. Trims gloss black.',
    voicePromptHint: 'Tell me about the exterior — area, surface, height, prep',
  },
  {
    id: 'epoxy_garage_floor',
    categoryId: 'painting',
    nicheId: 'specialty',
    name: 'Epoxy Floor',
    description: 'Apply epoxy coating to garage or warehouse floor',
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
    estimatedHoursFormula: '(area / 10) + 4',
    estimatedHoursRange: { min: 6, max: 12 },
    suggestedMaterials: ['Epoxy coating kit', 'Primer', 'Concrete grinder discs', 'Roller', 'Brush', 'Paint tray', 'Degreaser'],
    questionsLine: 'Floor area? Existing coating to remove? Colour and flake (decorative chips)?',
    exampleLines: 'Double garage approx 38m². Existing floor bare concrete with oil stains. Diamond grind prep, single colour epoxy in mid-grey with light flake broadcast.',
    voicePromptHint: 'Tell me about the floor — area, prep, colour',
  },

  // ============================================
  // FLOORING
  // ============================================
  {
    id: 'timber_floor_polish',
    categoryId: 'flooring',
    nicheId: 'timber',
    name: 'Sand & Polish',
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
    estimatedHoursFormula: 'area / 8',
    estimatedHoursRange: { min: 6, max: 20 },
    suggestedMaterials: ['Floor polish/varnish', 'Sandpaper (various grits)', 'Wood filler', 'Drop sheets'],
    questionsLine: 'Floor area? Existing finish? Coats and sheen (matte/satin/gloss)? Stain change?',
    exampleLines: 'About 65m² of existing tongue-and-groove pine floor through living and hallway. Heavy sand to bare timber, 3 coats water-based satin polyurethane. Keep natural timber colour.',
    voicePromptHint: 'Tell me about the floor — area, finish, coats',
  },
  {
    id: 'hybrid_flooring_install',
    categoryId: 'flooring',
    nicheId: 'timber',
    name: 'Hybrid Flooring Install',
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
    estimatedHoursFormula: 'area / 12',
    estimatedHoursRange: { min: 4, max: 16 },
    suggestedMaterials: ['Hybrid flooring planks', 'Underlay', 'Scotia/beading', 'Expansion foam', 'Floor adhesive'],
    questionsLine: 'Square metres? Existing floor (lift or overlay)? Plank colour/range? Skirting/scotia?',
    exampleLines: 'About 55m² across living, dining, hallway. Lift existing carpet and tack strip. Hybrid plank 1800x230 in mid-oak, acoustic underlay, scotia bead at edges.',
    voicePromptHint: 'Tell me about the floor — area, existing surface, product',
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
    estimatedHoursFormula: 'area / 15',
    estimatedHoursRange: { min: 3, max: 10 },
    suggestedMaterials: ['Carpet', 'Underlay', 'Gripper strips', 'Joining tape', 'Threshold strips'],
    questionsLine: 'Rooms and total square metres? Carpet type? Stairs included? Old carpet uplift?',
    exampleLines: 'Three bedrooms approx 42m² total, mid-grade twist pile in charcoal. Standard foam underlay. Old carpet and underlay removed and disposed. No stairs.',
    voicePromptHint: 'Tell me about the carpet — rooms, type, uplift',
  },

  // ============================================
  // CLEANING
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
    questionsLine: 'Bedrooms and bathrooms? Carpet steam? Oven, windows, walls included? Furnished?',
    exampleLines: '3 bed, 2 bath unfurnished townhouse. Full end-of-lease including oven, range hood, inside windows, blinds, walls spot-clean. Carpets steam-cleaned by separate sub-contractor.',
    voicePromptHint: 'Tell me about the property — rooms, scope, extras',
  },
  {
    id: 'pressure_clean',
    categoryId: 'cleaning',
    nicheId: 'specialty',
    name: 'Pressure Clean',
    description: 'High-pressure clean of driveway, paths or walls',
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
    estimatedHoursFormula: 'area / 50',
    estimatedHoursRange: { min: 2, max: 8 },
    suggestedMaterials: ['Pressure washer detergent', 'Surface cleaner attachment', 'Fuel'],
    questionsLine: 'Area in m²? Surface (concrete, pavers, tiles, render)? Mould/oil staining?',
    exampleLines: 'Driveway and front path approx 90m² concrete, plus side path pavers 20m². Heavy mould and lichen on shaded sections — chemical pre-treat then surface clean.',
    voicePromptHint: 'Tell me about the area — size, surface, condition',
  },

  // ============================================
  // CONCRETING & RENDERING
  // ============================================
  {
    id: 'concrete_driveway',
    categoryId: 'other',
    nicheId: 'concreting',
    name: 'Concrete Driveway',
    description: 'Pour concrete driveway or slab',
    icon: 'texture-box',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Slab Area', unit: 'm²', defaultValue: 48 },
      { key: 'thickness', label: 'Slab Thickness', unit: 'mm', defaultValue: 100 },
    ],
    defaultMaterials: [
      { name: 'Concrete (32 MPa Bulk)', searchTerm: 'Concrete pre-mix 32 MPa per m³ delivered', quantityFormula: 'Math.ceil((area * thickness / 1000) * 1.05 * 10) / 10', unit: 'm' },
      { name: 'SL82 Reo Mesh', searchTerm: 'SL82 reo mesh sheet 6m x 2.4m', quantityFormula: 'Math.ceil((area / 14.4) * 1.1)', unit: 'each' },
      { name: 'Bar Chairs', searchTerm: 'Plastic bar chair concrete 50mm box of 100', quantityFormula: 'Math.ceil((area * 4) / 100)', unit: 'box' },
      { name: 'Formwork Timber', searchTerm: 'Formwork pine 100 x 25 x 5.4m', quantityFormula: 'Math.ceil(Math.sqrt(area) * 4 / 5.4)', unit: 'each' },
      { name: 'Expansion Joint Foam', searchTerm: 'Expansion joint foam 100 x 10mm x 25m', quantityFormula: 'Math.ceil(Math.sqrt(area) / 5)', unit: 'each' },
      { name: 'Plastic Sheeting', searchTerm: 'Black builders plastic 4m x 50m 200um', quantityFormula: 'Math.ceil(area / 150)', unit: 'each' },
      { name: 'Curing Compound', searchTerm: 'Concrete curing compound spray on 20L', quantityFormula: 'Math.ceil(area / 100)', unit: 'each' },
      { name: 'Concrete Pump Hire', searchTerm: 'Concrete line pump hire half day', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '(area * 0.5) + (thickness * 0.05)',
    estimatedHoursRange: { min: 12, max: 50 },
    suggestedMaterials: ['Concrete', 'SL82 mesh', 'Formwork', 'Bar chairs', 'Expansion joint', 'Plastic sheeting', 'Curing compound'],
    questionsLine: 'Square metres? Thickness? Finish (broom, exposed, plain)? Existing surface to remove?',
    exampleLines: '48m² driveway pour, 100mm thick with SL82 mesh. Plain trowel finish with sawn control joints. Existing gravel driveway to be excavated and compacted road base laid first.',
    voicePromptHint: 'Tell me about the slab — size, thickness, finish, prep',
  },
  {
    id: 'render_acrylic',
    categoryId: 'other',
    nicheId: 'rendering',
    name: 'Acrylic Render',
    description: 'Apply acrylic render coat',
    icon: 'format-color-fill',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Wall Area', unit: 'm²', defaultValue: 80 },
    ],
    defaultMaterials: [
      { name: 'Acrylic Render Pail', searchTerm: 'Acrylic render Rockcote 20kg pail', quantityFormula: 'Math.ceil(area / 10)', unit: 'each' },
      { name: 'Render Primer', searchTerm: 'Render primer sealer Rockcote 15L', quantityFormula: 'Math.ceil(area / 60)', unit: 'each' },
      { name: 'Texture Top Coat', searchTerm: 'Acrylic texture coat sponge finish 15L', quantityFormula: 'Math.ceil(area / 25)', unit: 'each' },
      { name: 'Render Mesh', searchTerm: 'Fibreglass render mesh 1m x 50m roll', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
      { name: 'Corner Beads', searchTerm: 'PVC render corner bead 2.4m', quantityFormula: 'Math.ceil(Math.sqrt(area) / 2.4)', unit: 'each' },
      { name: 'Drop Sheets', searchTerm: 'Drop sheet canvas heavy duty 3.6m x 2.7m', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
      { name: 'Masking Tape Wide', searchTerm: 'Masking tape 48mm x 50m', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area * 0.4',
    estimatedHoursRange: { min: 8, max: 40 },
    suggestedMaterials: ['Acrylic render', 'Primer', 'Texture coat', 'Mesh', 'Corner beads', 'Drop sheets'],
    questionsLine: 'Wall area? Substrate (brick, blockwork, FC sheet)? Texture (sponge, sandstone, smooth)?',
    exampleLines: 'Approx 80m² of brick veneer house, single storey. Primer + acrylic render with sponge finish. Two coats top, rolled finish. Customer to choose colour from Dulux range.',
    voicePromptHint: 'Tell me about the render — area, substrate, texture',
  },

  // ============================================
  // TILING & GYPROCK
  // ============================================
  {
    id: 'tiling_floor',
    categoryId: 'flooring',
    nicheId: 'tiles',
    name: 'Floor Tiling',
    description: 'Lay floor tiles',
    icon: 'grid',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Floor Area', unit: 'm²', defaultValue: 18 },
    ],
    defaultMaterials: [
      { name: 'Floor Tiles', searchTerm: 'Floor tiles porcelain 600x600mm matte', quantityFormula: 'Math.ceil(area / 1.44 * 1.1)', unit: 'box' },
      { name: 'Tile Adhesive', searchTerm: 'Tile adhesive flexible white 20kg bag', quantityFormula: 'Math.ceil(area / 5)', unit: 'each' },
      { name: 'Tile Grout', searchTerm: 'Tile grout flexible charcoal 5kg', quantityFormula: 'Math.ceil(area / 10)', unit: 'each' },
      { name: 'Tile Spacers', searchTerm: 'Tile spacers 3mm 250 pack', quantityFormula: 'Math.ceil(area / 20)', unit: 'pack' },
      { name: 'Levelling System', searchTerm: 'Tile levelling system clips and wedges 100 pack', quantityFormula: 'Math.ceil(area / 15)', unit: 'pack' },
      { name: 'Silicone Sealant', searchTerm: 'Silicone sealant neutral cure 310ml cartridge', quantityFormula: 'Math.ceil(Math.sqrt(area) * 4 / 12)', unit: 'each' },
      { name: 'Tile Primer', searchTerm: 'Tile substrate primer 4L', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
      { name: 'Diamond Wet Tile Blade', searchTerm: 'Diamond wet tile blade 250mm porcelain', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area * 0.6',
    estimatedHoursRange: { min: 6, max: 30 },
    suggestedMaterials: ['Tiles', 'Adhesive', 'Grout', 'Spacers', 'Levelling system', 'Silicone', 'Primer'],
    questionsLine: 'Area? Tile size and material? Substrate prep? Customer or tradie supplies tiles?',
    exampleLines: '18m² 600x600 porcelain tiles in living and hallway, supplied by customer. Substrate is existing concrete slab — clean, prime, level any low spots. Straight lay pattern, 3mm grout joints.',
    voicePromptHint: 'Tell me about the tiling — area, tile, supply',
  },
  {
    id: 'gyprock_install',
    categoryId: 'other',
    nicheId: 'gyprock',
    name: 'Gyprock / Plaster',
    description: 'Hang and set plasterboard walls or ceilings',
    icon: 'wall',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Surface Area', unit: 'm²', defaultValue: 22 },
    ],
    defaultMaterials: [
      { name: 'Plasterboard Sheets', searchTerm: 'Gyprock plasterboard CSR 10mm 1200 x 2400', quantityFormula: 'Math.ceil(area / 2.88 * 1.05)', unit: 'each' },
      { name: 'Cove Cornice', searchTerm: 'Gyprock cove cornice 75mm x 4.8m', quantityFormula: 'Math.ceil((Math.sqrt(area) * 4 * 1.1) / 4.8)', unit: 'each' },
      { name: 'Plaster Joint Compound', searchTerm: 'Gyprock joint compound base coat 20kg bucket', quantityFormula: 'Math.ceil(area / 30)', unit: 'each' },
      { name: 'Plaster Top Coat', searchTerm: 'Gyprock top coat compound 15L bucket', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
      { name: 'Paper Joint Tape', searchTerm: 'Plasterboard paper joint tape 50mm x 75m', quantityFormula: 'Math.ceil(area / 60)', unit: 'each' },
      { name: 'Drywall Screws', searchTerm: 'Drywall screw 30mm 1000 box', quantityFormula: 'Math.ceil(area / 30)', unit: 'box' },
      { name: 'Cornice Cement', searchTerm: 'Cornice cement adhesive 20kg bag', quantityFormula: 'Math.ceil(area / 40)', unit: 'each' },
      { name: 'External Corner Beads', searchTerm: 'Plasterboard external corner bead 2.4m', quantityFormula: 'Math.ceil(area / 25)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area * 0.5',
    estimatedHoursRange: { min: 6, max: 40 },
    suggestedMaterials: ['Plasterboard', 'Cornice', 'Joint compound', 'Top coat', 'Tape', 'Screws', 'Corner beads'],
    questionsLine: 'Walls or ceilings? Square metres? Standard or moisture-resistant board? Cornice required?',
    exampleLines: 'New ceiling in extension — about 22m² standard 10mm plasterboard, 75mm cove cornice all round. Hang, set 3-coat ready for paint.',
    voicePromptHint: 'Tell me about the gyprock — walls or ceilings, area, cornice',
  },

  // ============================================
  // HVAC
  // ============================================
  {
    id: 'split_system_install',
    categoryId: 'hvac',
    nicheId: 'split_systems',
    name: 'Split System Install',
    description: 'Supply and install wall-mounted split system air conditioner',
    icon: 'air-conditioner',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'units', label: 'Number of Units', unit: '', defaultValue: 1 },
      { key: 'pipe_run', label: 'Avg Pipe Run', unit: 'm', defaultValue: 4 },
    ],
    defaultMaterials: [
      { name: 'Split System Unit', searchTerm: 'Mitsubishi split system 5kW reverse cycle inverter', quantityFormula: 'units', unit: 'each' },
      { name: 'Insulated Refrigerant Pipe Set', searchTerm: 'Insulated copper pipe pair coil 1/4 3/8 inch x 5m', quantityFormula: 'Math.ceil(units * pipe_run / 5)', unit: 'each' },
      { name: 'Drain Pipe', searchTerm: 'Air conditioner condensate drain pipe 16mm x 5m', quantityFormula: 'units', unit: 'each' },
      { name: 'Wall Mounting Bracket', searchTerm: 'Air conditioner outdoor unit wall bracket galvanised', quantityFormula: 'units', unit: 'each' },
      { name: 'Electrical Cable', searchTerm: 'Twin and earth cable 2.5mm 100m', quantityFormula: 'Math.ceil(units / 3)', unit: 'each' },
      { name: 'Communication Cable', searchTerm: 'Air conditioner interconnect cable 4 core 1mm 20m', quantityFormula: 'units', unit: 'each' },
      { name: 'Isolator Switch', searchTerm: 'Weatherproof isolator switch 32A 4 pole', quantityFormula: 'units', unit: 'each' },
      { name: 'Wall Penetration Sleeve', searchTerm: 'Wall penetration sleeve PVC 65mm', quantityFormula: 'units', unit: 'each' },
      { name: 'Refrigerant R32', searchTerm: 'Refrigerant R32 cylinder top up', quantityFormula: 'Math.ceil(units * pipe_run / 15)', unit: 'each' },
      { name: 'Armaflex Insulation', searchTerm: 'Armaflex pipe insulation 13mm wall 2m', quantityFormula: 'units', unit: 'each' },
    ],
    estimatedHoursFormula: 'units * (4 + Math.max(0, pipe_run - 4) * 0.4)',
    estimatedHoursRange: { min: 3, max: 12 },
    suggestedMaterials: ['Split system unit', 'Insulated refrigerant pipe', 'Drain pipe', 'Mounting bracket', 'Cable', 'Isolator', 'R32 refrigerant'],
    questionsLine: 'How many units? kW capacity per room? Back-to-back or long pipe run? Power available nearby?',
    exampleLines: 'One 5kW reverse-cycle split in main bedroom, back-to-back install on external wall, approx 3m pipe run. Power off existing GPO via new isolator. Brick veneer wall, single storey.',
    voicePromptHint: 'Tell me about the install — units, kW, pipe run, power',
  },
  {
    id: 'split_system_service',
    categoryId: 'hvac',
    nicheId: 'split_systems',
    name: 'Split System Service',
    description: 'Service, clean and check refrigerant on split system',
    icon: 'air-filter',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'units', label: 'Number of Units', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'Coil Cleaner', searchTerm: 'Air conditioner coil cleaner foaming 500ml', quantityFormula: 'units', unit: 'each' },
      { name: 'Anti-Bacterial Treatment', searchTerm: 'Air conditioner anti bacterial sanitiser spray', quantityFormula: 'Math.ceil(units / 2)', unit: 'each' },
      { name: 'Drain Line Clearer', searchTerm: 'Air conditioner condensate drain cleaner', quantityFormula: 'Math.ceil(units / 2)', unit: 'each' },
      { name: 'Refrigerant R32 Top-Up', searchTerm: 'Refrigerant R32 cylinder top up', quantityFormula: '1', unit: 'each' },
      { name: 'Filter Pack', searchTerm: 'Split system replacement filter universal pair', quantityFormula: 'units', unit: 'each' },
    ],
    estimatedHoursFormula: 'units * 1.25',
    estimatedHoursRange: { min: 1, max: 4 },
    suggestedMaterials: ['Coil cleaner', 'Sanitiser', 'Drain cleaner', 'Refrigerant top-up', 'Filters'],
    questionsLine: 'How many units? Last serviced when? Cooling weak (regas needed)? Filters or full deep clean?',
    exampleLines: 'Two splits — lounge and bedroom. Last serviced 3 years ago. Lounge unit cooling poorly, suspect low gas. Full clean of indoor coils, drain flush, filter swap, leak check and top-up if required.',
    voicePromptHint: 'Tell me about the service — units, age, symptoms',
  },
  {
    id: 'ducted_ac_install',
    categoryId: 'hvac',
    nicheId: 'ducted_systems',
    name: 'Ducted AC Install',
    description: 'Supply and install ducted reverse-cycle air conditioning',
    icon: 'hvac',
    pricingMethod: 'fixed',
    requiredParams: [
      { key: 'zones', label: 'Number of Zones', unit: '', defaultValue: 4 },
      { key: 'kw', label: 'System Capacity', unit: 'kW', defaultValue: 14 },
    ],
    defaultMaterials: [
      { name: 'Ducted AC System', searchTerm: 'Daikin ducted reverse cycle inverter 14kW', quantityFormula: '1', unit: 'each' },
      { name: 'Zone Controller', searchTerm: 'Ducted AC zone controller touchscreen wall', quantityFormula: '1', unit: 'each' },
      { name: 'Zone Motorised Damper', searchTerm: 'Ducted AC motorised zone damper 250mm', quantityFormula: 'zones', unit: 'each' },
      { name: 'Insulated Flexible Duct', searchTerm: 'Insulated flexible ducting R1.0 300mm x 6m', quantityFormula: 'Math.ceil(zones * 1.5)', unit: 'each' },
      { name: 'Ceiling Outlet Grilles', searchTerm: 'Ducted AC ceiling outlet grille white 250mm', quantityFormula: 'zones * 2', unit: 'each' },
      { name: 'Return Air Grille', searchTerm: 'Return air grille filter 600x600 white', quantityFormula: '1', unit: 'each' },
      { name: 'Insulated Refrigerant Pipe', searchTerm: 'Insulated copper pipe pair coil 3/8 5/8 inch x 5m', quantityFormula: 'Math.ceil(kw / 5)', unit: 'each' },
      { name: 'Drain Pump & Line', searchTerm: 'Condensate pump kit ducted air conditioner', quantityFormula: '1', unit: 'each' },
      { name: 'Electrical Cable', searchTerm: 'Twin and earth cable 4mm 50m', quantityFormula: '1', unit: 'each' },
      { name: 'Isolator Switch', searchTerm: 'Weatherproof isolator switch 40A 4 pole', quantityFormula: '1', unit: 'each' },
      { name: 'Refrigerant R32', searchTerm: 'Refrigerant R32 cylinder', quantityFormula: 'Math.ceil(kw / 7)', unit: 'each' },
      { name: 'Roof Penetration Flashing', searchTerm: 'Pipe roof flashing dektite combo', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '12 + (zones * 2) + (kw * 0.3)',
    estimatedHoursRange: { min: 16, max: 40 },
    suggestedMaterials: ['Ducted unit', 'Zone controller', 'Motorised dampers', 'Insulated duct', 'Outlet grilles', 'Return air', 'Refrigerant pipe', 'R32'],
    questionsLine: 'kW capacity? Number of zones? Single or two storey? Roof access? New install or replacement?',
    exampleLines: 'New 14kW Daikin inverter ducted, 4 zones across single-storey 220m² home. Indoor in roof space, condenser on side concrete pad. New return air grille in hallway. Existing ducted system removed and disposed.',
    voicePromptHint: 'Tell me about the ducted — kW, zones, layout, access',
  },
  {
    id: 'evap_cooler_service',
    categoryId: 'hvac',
    nicheId: 'evaporative',
    name: 'Evap Cooler Service',
    description: 'Service evaporative cooling system and replace pads',
    icon: 'water-outline',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'units', label: 'Number of Units', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'Cooling Pads Set', searchTerm: 'Evaporative cooler pads chillcel celdek set', quantityFormula: 'units', unit: 'each' },
      { name: 'Water Pump', searchTerm: 'Evaporative cooler water pump submersible', quantityFormula: 'Math.ceil(units / 2)', unit: 'each' },
      { name: 'Bleed-Off / Drain Valve', searchTerm: 'Evaporative cooler bleed off solenoid valve', quantityFormula: 'Math.ceil(units / 3)', unit: 'each' },
      { name: 'Sanitiser', searchTerm: 'Evaporative cooler sanitiser tablets 12 pack', quantityFormula: 'units', unit: 'pack' },
      { name: 'Belt (V-Belt)', searchTerm: 'Evaporative cooler v belt drive', quantityFormula: 'Math.ceil(units / 2)', unit: 'each' },
    ],
    estimatedHoursFormula: 'units * 2',
    estimatedHoursRange: { min: 1.5, max: 4 },
    suggestedMaterials: ['Cooling pads', 'Water pump', 'Bleed valve', 'Sanitiser', 'Drive belt'],
    questionsLine: 'How many units? Pads age (full replace or just clean)? Pump working? Roof access for pads?',
    exampleLines: 'One Bonaire roof-mounted evap, pads last replaced 4 years ago — full pad set replacement. Pump and bleed valve checked, sanitiser flush. Tile roof with crawl board access.',
    voicePromptHint: 'Tell me about the service — units, pads, access',
  },

  // ============================================
  // ROOFING
  // ============================================
  {
    id: 'reroof_colorbond',
    categoryId: 'roofing',
    nicheId: 'roof_install',
    name: 'Re-Roof (Colorbond)',
    description: 'Strip existing roof and install new Colorbond steel roofing',
    icon: 'home-roof',
    pricingMethod: 'per_sqm',
    requiredParams: [
      { key: 'area', label: 'Roof Area', unit: 'm²', defaultValue: 180 },
    ],
    defaultMaterials: [
      { name: 'Colorbond Roof Sheets', searchTerm: 'Colorbond Trimdek roof sheet custom length per m²', quantityFormula: 'Math.ceil(area * 1.05)', unit: 'm' },
      { name: 'Ridge Capping', searchTerm: 'Colorbond ridge capping 240mm x 3m', quantityFormula: 'Math.ceil(area / 12)', unit: 'each' },
      { name: 'Anticon Blanket Insulation', searchTerm: 'Anticon insulation blanket roof 55mm R1.3', quantityFormula: 'Math.ceil(area / 22)', unit: 'each' },
      { name: 'Roofing Screws', searchTerm: 'Roofing screw class 4 65mm 1000 pack', quantityFormula: 'Math.ceil(area / 60)', unit: 'pack' },
      { name: 'Valley Gutter', searchTerm: 'Colorbond valley gutter 600mm x 3m', quantityFormula: 'Math.ceil(area / 60)', unit: 'each' },
      { name: 'Barge Capping', searchTerm: 'Colorbond barge capping 200mm x 3m', quantityFormula: 'Math.ceil(area / 25)', unit: 'each' },
      { name: 'Foam Closures', searchTerm: 'Roof sheet foam closure strip eaves Trimdek', quantityFormula: 'Math.ceil(area / 8)', unit: 'each' },
      { name: 'Skip Bin (Old Roof Removal)', searchTerm: 'Skip bin hire 4m³ mixed waste', quantityFormula: 'Math.ceil(area / 100)', unit: 'each' },
      { name: 'Safety Mesh', searchTerm: 'Roof safety mesh galvanised 1.8m x 30m', quantityFormula: 'Math.ceil(area / 50)', unit: 'each' },
    ],
    estimatedHoursFormula: 'area * 0.45',
    estimatedHoursRange: { min: 40, max: 120 },
    suggestedMaterials: ['Colorbond sheets', 'Ridge capping', 'Anticon blanket', 'Screws', 'Valley & barge', 'Safety mesh', 'Skip bin'],
    questionsLine: 'Roof area in m²? Tile or metal coming off? Pitch? Single or two storey? Anticon needed? Asbestos suspected?',
    exampleLines: 'Strip and re-roof 185m² single-storey weatherboard, existing Colorbond → new Colorbond Trimdek in Surfmist. R1.3 anticon blanket. Standard 22° pitch, scaffolding required around full perimeter.',
    voicePromptHint: 'Tell me about the re-roof — area, existing material, access',
  },
  {
    id: 'roof_leak_repair',
    categoryId: 'roofing',
    nicheId: 'roof_repairs',
    name: 'Roof Leak / Tile Repair',
    description: 'Diagnose and repair roof leak, replace broken tiles or flashings',
    icon: 'water-off',
    pricingMethod: 'per_unit',
    requiredParams: [
      { key: 'tiles', label: 'Tiles to Replace', unit: '', defaultValue: 6 },
    ],
    defaultMaterials: [
      { name: 'Replacement Tiles', searchTerm: 'Concrete roof tile terracotta replacement', quantityFormula: 'tiles', unit: 'each' },
      { name: 'Roof & Gutter Silicone', searchTerm: 'Roof and gutter silicone neutral cure 300ml', quantityFormula: 'Math.ceil(tiles / 4)', unit: 'each' },
      { name: 'Lead Flashing', searchTerm: 'Lead flashing roll 300mm x 3m', quantityFormula: '1', unit: 'each' },
      { name: 'Storm Sealer', searchTerm: 'Roof flashing sealant Bostik storm seal 600ml', quantityFormula: '1', unit: 'each' },
      { name: 'Bedding & Pointing Mix', searchTerm: 'Flexible pointing compound roof tile 15kg', quantityFormula: 'Math.ceil(tiles / 10)', unit: 'each' },
      { name: 'Roof Screws & Caps', searchTerm: 'Roofing screw class 4 65mm 250 pack', quantityFormula: '1', unit: 'pack' },
    ],
    estimatedHoursFormula: '2 + (tiles * 0.25)',
    estimatedHoursRange: { min: 1.5, max: 8 },
    suggestedMaterials: ['Replacement tiles', 'Roof silicone', 'Lead flashing', 'Storm sealant', 'Pointing compound'],
    questionsLine: 'Where is the leak showing inside? Tile or metal roof? How many tiles cracked? Flashing involved? Pointing needed?',
    exampleLines: 'Leak above ensuite ceiling, terracotta tile roof. Estimate 6 cracked tiles around valley plus failed pointing on ridge. Replace tiles, re-bed and point ridge cap, seal valley flashing. Work weather-dependent.',
    voicePromptHint: 'Tell me about the leak — location, roof type, tiles damaged',
  },
  {
    id: 'gutter_clean',
    categoryId: 'roofing',
    nicheId: 'gutters',
    name: 'Gutter Clean',
    description: 'Clean leaves and debris from gutters and downpipes',
    icon: 'water-off',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Gutter Length', unit: 'm', defaultValue: 40 },
      { key: 'storeys', label: 'Storeys', unit: '', defaultValue: 1 },
    ],
    defaultMaterials: [
      { name: 'Heavy Duty Bin Bags', searchTerm: 'Heavy duty garden waste bag 240L', quantityFormula: 'Math.ceil(length / 20)', unit: 'pack' },
      { name: 'Downpipe Snake / Brush', searchTerm: 'Downpipe cleaning brush flexible', quantityFormula: '1', unit: 'each' },
      { name: 'Tarps', searchTerm: 'Heavy duty tarp 3.6m x 2.7m', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '(length / 25) * (1 + (storeys - 1) * 0.5)',
    estimatedHoursRange: { min: 1, max: 6 },
    suggestedMaterials: ['Bin bags', 'Downpipe brush', 'Tarps'],
    questionsLine: 'Total gutter length? Single or two storey? How blocked (light, heavy, full)? Downpipe flush included?',
    exampleLines: 'Single-storey 3-bedroom home, approx 45m of gutter all round. Heavy leaf load from neighbour\'s gum. Blow out, hand scoop, downpipe flush with hose, debris bagged and removed.',
    voicePromptHint: 'Tell me about the gutters — length, storeys, condition',
  },
  {
    id: 'gutter_replace',
    categoryId: 'roofing',
    nicheId: 'gutters',
    name: 'Gutter Replacement',
    description: 'Remove and replace existing gutters and downpipes',
    icon: 'water',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Gutter Length', unit: 'm', defaultValue: 40 },
      { key: 'downpipes', label: 'Number of Downpipes', unit: '', defaultValue: 4 },
    ],
    defaultMaterials: [
      { name: 'Colorbond Quad Gutter', searchTerm: 'Colorbond quad gutter 115mm x 6m', quantityFormula: 'Math.ceil(length / 6)', unit: 'each' },
      { name: 'Gutter Brackets', searchTerm: 'Gutter bracket Colorbond quad concealed', quantityFormula: 'Math.ceil(length / 0.9)', unit: 'each' },
      { name: 'Internal Joiners', searchTerm: 'Gutter internal joiner Colorbond quad', quantityFormula: 'Math.ceil(length / 6)', unit: 'each' },
      { name: 'Stop Ends Pair', searchTerm: 'Gutter stop end Colorbond quad pair', quantityFormula: '2', unit: 'each' },
      { name: 'External Corners', searchTerm: 'Gutter external corner Colorbond quad', quantityFormula: '4', unit: 'each' },
      { name: 'Downpipe', searchTerm: 'Colorbond downpipe rectangular 100x75 x 3m', quantityFormula: 'Math.ceil(downpipes * 1.5)', unit: 'each' },
      { name: 'Downpipe Brackets', searchTerm: 'Downpipe bracket rectangular 100x75', quantityFormula: 'downpipes * 3', unit: 'each' },
      { name: 'Roof & Gutter Silicone', searchTerm: 'Roof and gutter silicone neutral cure 300ml', quantityFormula: 'Math.ceil(length / 15)', unit: 'each' },
      { name: 'Pop Rivets', searchTerm: 'Pop rivets aluminium 4.8 x 9.5mm 250 pack', quantityFormula: '1', unit: 'pack' },
    ],
    estimatedHoursFormula: '(length * 0.4) + (downpipes * 1)',
    estimatedHoursRange: { min: 8, max: 30 },
    suggestedMaterials: ['Colorbond gutter', 'Brackets', 'Joiners', 'Stop ends', 'Corners', 'Downpipes', 'Silicone'],
    questionsLine: 'Total length? Number of downpipes? Profile (quad, half round, OG)? Colour? Existing fascia OK?',
    exampleLines: '42m of new Colorbond quad gutter in Woodland Grey, 4 downpipes 100x75 rectangular. Existing pine fascia sound — re-use. Old gutter removed and disposed. Single storey, scaffold not required.',
    voicePromptHint: 'Tell me about the gutter job — length, downpipes, colour',
  },
  {
    id: 'leaf_guard_install',
    categoryId: 'roofing',
    nicheId: 'gutters',
    name: 'Leaf Guard Install',
    description: 'Install gutter leaf guard mesh',
    icon: 'leaf',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'length', label: 'Gutter Length', unit: 'm', defaultValue: 40 },
    ],
    defaultMaterials: [
      { name: 'Aluminium Leaf Mesh', searchTerm: 'Gutter leaf guard aluminium mesh 300mm x 30m', quantityFormula: 'Math.ceil(length / 30)', unit: 'each' },
      { name: 'Saddle Clips', searchTerm: 'Gutter mesh saddle clip Colorbond colour matched', quantityFormula: 'Math.ceil(length * 4)', unit: 'each' },
      { name: 'Trim Screws', searchTerm: 'Hex head screw 10g x 16mm Colorbond 100 pack', quantityFormula: 'Math.ceil(length / 30)', unit: 'pack' },
      { name: 'Valley Mesh', searchTerm: 'Valley leaf guard mesh aluminium 600mm x 5m', quantityFormula: 'Math.ceil(length / 50)', unit: 'each' },
    ],
    estimatedHoursFormula: 'length / 8',
    estimatedHoursRange: { min: 3, max: 12 },
    suggestedMaterials: ['Aluminium mesh', 'Saddle clips', 'Screws', 'Valley mesh'],
    questionsLine: 'Total length? Tile or metal roof? Valleys included? Colour match? Ember-rated (BAL zone)?',
    exampleLines: 'Approx 40m of gutter on tile roof. Aluminium mesh 4mm aperture in Monument, valleys included. Customer in BAL-12.5 area — non-combustible mesh required.',
    voicePromptHint: 'Tell me about the leaf guard — length, roof type, BAL zone',
  },

  // ============================================
  // PEST CONTROL
  // ============================================
  {
    id: 'general_pest_spray',
    categoryId: 'pest_control',
    nicheId: 'general_pest',
    name: 'General Pest Treatment',
    description: 'Internal and external general pest spray treatment',
    icon: 'spray',
    pricingMethod: 'fixed',
    requiredParams: [
      { key: 'bedrooms', label: 'Number of Bedrooms', unit: '', defaultValue: 3 },
    ],
    defaultMaterials: [
      { name: 'Residual Insecticide', searchTerm: 'Bifenthrin residual insecticide concentrate 1L', quantityFormula: 'Math.ceil(bedrooms / 4)', unit: 'each' },
      { name: 'Cockroach Gel', searchTerm: 'Cockroach gel bait Maxforce 30g', quantityFormula: 'Math.ceil(bedrooms / 2)', unit: 'each' },
      { name: 'Ant Bait Stations', searchTerm: 'Ant bait station outdoor weatherproof 6 pack', quantityFormula: '1', unit: 'pack' },
      { name: 'Spider Powder Dust', searchTerm: 'Insecticide dust roof void Coopex 500g', quantityFormula: 'Math.ceil(bedrooms / 4)', unit: 'each' },
      { name: 'PPE & Safety Sign Pack', searchTerm: 'Pest control warning signs vinyl pack', quantityFormula: '1', unit: 'pack' },
    ],
    estimatedHoursFormula: '1 + (bedrooms * 0.5)',
    estimatedHoursRange: { min: 1, max: 4 },
    suggestedMaterials: ['Residual insecticide', 'Cockroach gel', 'Ant bait', 'Roof void dust', 'PPE / signs'],
    questionsLine: 'Bedrooms / property size? Specific pests (roaches, ants, spiders, fleas)? Pets or kids on site? Inside, outside or both?',
    exampleLines: '3-bed brick home, full general treatment — internal skirtings and wet areas, external perimeter spray, roof void dust, cockroach gel in kitchen and laundry. Ant bait stations outside. 12-month warranty on common pests.',
    voicePromptHint: 'Tell me about the property — size, pests, pets',
  },
  {
    id: 'termite_inspection',
    categoryId: 'pest_control',
    nicheId: 'termites',
    name: 'Termite Inspection',
    description: 'AS3660.2 timber pest inspection with thermal and moisture',
    icon: 'shield-bug',
    pricingMethod: 'fixed',
    requiredParams: [],
    defaultMaterials: [
      { name: 'Inspection Report Folio', searchTerm: 'Inspection report folio printed binder', quantityFormula: '1', unit: 'each' },
      { name: 'Replacement Borescope Tip', searchTerm: 'Borescope camera replacement tip', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: '2.5',
    estimatedHoursRange: { min: 1.5, max: 4 },
    suggestedMaterials: ['Inspection report', 'Borescope tip', 'Calibration consumables'],
    questionsLine: 'Single or two storey? Subfloor access? Roof void access? Active termites visible? Pre-purchase or annual?',
    exampleLines: 'Pre-purchase timber pest inspection on single-storey weatherboard with full subfloor access and tile roof void. Thermal, moisture meter, borescope to suspect areas. Written AS3660.2 report within 24 hours.',
    voicePromptHint: 'Tell me about the inspection — property, access, purpose',
  },
  {
    id: 'termite_barrier',
    categoryId: 'pest_control',
    nicheId: 'termites',
    name: 'Termite Barrier (Chemical)',
    description: 'Trench and treat chemical termite barrier around perimeter',
    icon: 'shield-bug',
    pricingMethod: 'per_linear_m',
    requiredParams: [
      { key: 'perimeter', label: 'Perimeter', unit: 'm', defaultValue: 50 },
    ],
    defaultMaterials: [
      { name: 'Termiticide Concentrate', searchTerm: 'Termidor SC termiticide 1L', quantityFormula: 'Math.ceil(perimeter / 25)', unit: 'each' },
      { name: 'Mixing Tank / Drum', searchTerm: 'Spray tank trolley 100L pest control', quantityFormula: '1', unit: 'each' },
      { name: 'Trench Backfill (Sand)', searchTerm: 'Brickies sand 20kg bag', quantityFormula: 'Math.ceil(perimeter / 4)', unit: 'each' },
      { name: 'Concrete Repair Mix', searchTerm: 'Rapid set concrete 20kg bag', quantityFormula: 'Math.ceil(perimeter / 10)', unit: 'each' },
      { name: 'Durable Notice / Sticker', searchTerm: 'Termite barrier durable notice meter box sticker', quantityFormula: '1', unit: 'each' },
    ],
    estimatedHoursFormula: 'perimeter * 0.2',
    estimatedHoursRange: { min: 6, max: 24 },
    suggestedMaterials: ['Termiticide concentrate', 'Spray tank', 'Trench sand', 'Concrete repair', 'Durable notice'],
    questionsLine: 'Perimeter length? Soil or concrete edge (trench vs core-drill)? Slab or stumps? Pets to relocate?',
    exampleLines: 'Approx 48m perimeter around brick veneer slab home. ~30m soil trench (300 deep), ~18m concrete path requiring core drilling at 200 centres. Termidor SC chemical, 8-year warranty with annual inspection.',
    voicePromptHint: 'Tell me about the barrier — perimeter, edge type, slab',
  },
  {
    id: 'rodent_treatment',
    categoryId: 'pest_control',
    nicheId: 'rodents',
    name: 'Rodent Treatment',
    description: 'Bait, trap and exclusion programme for rats and mice',
    icon: 'rat',
    pricingMethod: 'fixed',
    requiredParams: [
      { key: 'stations', label: 'Bait Stations', unit: '', defaultValue: 6 },
    ],
    defaultMaterials: [
      { name: 'Lockable Bait Stations', searchTerm: 'Lockable rodent bait station outdoor', quantityFormula: 'stations', unit: 'each' },
      { name: 'Rodenticide Blocks', searchTerm: 'Rodent bait block second generation 1kg', quantityFormula: 'Math.ceil(stations / 4)', unit: 'each' },
      { name: 'Snap Traps', searchTerm: 'Rat snap trap T-Rex Bell Labs', quantityFormula: 'Math.ceil(stations / 2)', unit: 'each' },
      { name: 'Exclusion Mesh / Steel Wool', searchTerm: 'Rodent exclusion stainless steel wool roll', quantityFormula: '1', unit: 'each' },
      { name: 'Expanding Foam', searchTerm: 'Expanding foam gap filler 750ml', quantityFormula: '2', unit: 'each' },
    ],
    estimatedHoursFormula: '2 + (stations * 0.25)',
    estimatedHoursRange: { min: 2, max: 6 },
    suggestedMaterials: ['Lockable bait stations', 'Rodenticide blocks', 'Snap traps', 'Exclusion mesh', 'Foam sealant'],
    questionsLine: 'Activity inside or outside? Pets or kids on site (lockable required)? Roof void / subfloor access? Follow-up visits?',
    exampleLines: 'Active rats in roof void and along side fence. 6 lockable external bait stations, 4 snap traps in roof void, exclusion of two visible entry points around eaves. Two follow-up visits at 2 and 6 weeks included.',
    voicePromptHint: 'Tell me about the rodent job — location, pets, access',
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

/**
 * Build the job description placeholder from a selected template, falling
 * back to a generic prompt when the template lacks copy or none is selected.
 */
export function getDescriptionPlaceholder(template: JobTemplate | null | undefined): string {
  if (!template) {
    return 'Describe the job — what, where, how big. Talk through it like you would on the phone with the customer.';
  }
  const sections: string[] = [];
  if (template.questionsLine) {
    // One question per line — easier to scan than a single dense run.
    const bulleted = template.questionsLine
      .split('?')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => `• ${s}?`)
      .join('\n');
    if (bulleted) sections.push(bulleted);
  }
  if (template.exampleLines) {
    sections.push(`e.g., ${template.exampleLines}`);
  }
  if (sections.length === 0 && template.description) {
    return template.description;
  }
  return sections.join('\n\n');
}

/**
 * Voice prompt sub-label for the record button, derived from the selected template.
 */
export function getVoicePromptHint(template: JobTemplate | null | undefined): string {
  if (template?.voicePromptHint) return template.voicePromptHint;
  return 'Tell me about the job — what, where, how big';
}
