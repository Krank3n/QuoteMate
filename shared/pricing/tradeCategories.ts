/**
 * Comprehensive Trade Categories and Service Niches
 * Based on master trade service templates for Australian trades
 */

export interface TradeNiche {
  id: string;
  name: string;
  description: string;
  icon: string;
  pricingMethods: PricingMethod[];
  commonServices: string[];
}

export interface PricingMethod {
  id: string;
  label: string;
  unit: string;
  description: string;
}

export interface TradeCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  niches: TradeNiche[];
}

// Pricing method templates
export const PRICING_METHODS = {
  PER_SQM: { id: 'per_sqm', label: 'Per m²', unit: 'm²', description: 'Charged per square metre' },
  PER_LINEAR_M: { id: 'per_linear_m', label: 'Per Linear Metre', unit: 'lm', description: 'Charged per linear metre' },
  PER_UNIT: { id: 'per_unit', label: 'Per Unit', unit: 'unit', description: 'Fixed price per item' },
  HOURLY: { id: 'hourly', label: 'Hourly Rate', unit: 'hr', description: 'Charged per hour' },
  FIXED: { id: 'fixed', label: 'Fixed Price', unit: 'job', description: 'Single fixed price' },
  PER_CUBIC_M: { id: 'per_cubic_m', label: 'Per m³', unit: 'm³', description: 'Charged per cubic metre' },
  PER_POINT: { id: 'per_point', label: 'Per Point', unit: 'point', description: 'Charged per electrical/plumbing point' },
  DAILY: { id: 'daily', label: 'Daily Rate', unit: 'day', description: 'Charged per day' },
};

export const TRADE_CATEGORIES: TradeCategory[] = [
  {
    id: 'general',
    name: 'General / All Trades',
    icon: 'hammer-wrench',
    description: 'All trades and general services',
    color: '#6B7280',
    niches: [
      {
        id: 'all',
        name: 'All Services',
        description: 'General trade services',
        icon: 'briefcase',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.FIXED, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Repairs', 'Maintenance', 'Custom Work', 'Handyman Services'],
      },
    ],
  },
  {
    id: 'landscape_gardening',
    name: 'Landscape & Gardening',
    icon: 'tree',
    description: 'Lawn care, hedges, trees, gardens',
    color: '#10B981',
    niches: [
      {
        id: 'all',
        name: 'All Landscape Services',
        description: 'General landscape and gardening',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_SQM],
        commonServices: ['General Landscaping', 'Garden Maintenance', 'Yard Work'],
      },
      {
        id: 'lawn_care',
        name: 'Lawn Care',
        description: 'Mowing, edging, maintenance',
        icon: 'grass',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.HOURLY],
        commonServices: ['Mowing (ride-on)', 'Mowing (push)', 'Edging', 'Fertilizing'],
      },
      {
        id: 'hedge_tree',
        name: 'Hedge & Tree Services',
        description: 'Trimming, pruning, removal',
        icon: 'tree-outline',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.PER_UNIT],
        commonServices: ['Hedge Trimming (<2m)', 'Hedge Trimming (>2m)', 'Tree Pruning', 'Tree Removal'],
      },
      {
        id: 'garden_install',
        name: 'Garden Installation',
        description: 'Beds, plants, irrigation',
        icon: 'flower',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_UNIT],
        commonServices: ['Garden Bed Prep', 'Planting', 'Mulch Spread', 'Turf Laying', 'Irrigation'],
      },
      {
        id: 'landscaping',
        name: 'Landscaping',
        description: 'Retaining walls, pathways',
        icon: 'image-filter-hdr',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_LINEAR_M],
        commonServices: ['Retaining Wall', 'Paving', 'Decking', 'Garden Edging'],
      },
    ],
  },
  {
    id: 'plumbing',
    name: 'Plumbing',
    icon: 'pipe-wrench',
    description: 'Pipes, drains, hot water, gas',
    color: '#3B82F6',
    niches: [
      {
        id: 'all',
        name: 'All Plumbing Services',
        description: 'General plumbing services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Plumbing', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'drain_services',
        name: 'Drain Services',
        description: 'Blockages, repairs, cleaning',
        icon: 'pipe',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.PER_LINEAR_M],
        commonServices: ['Drain Unblock (snaking)', 'Drain Unblock (hydro-jet)', 'Pipe Relining', 'CCTV Inspection'],
      },
      {
        id: 'fixtures_fittings',
        name: 'Fixtures & Fittings',
        description: 'Taps, toilets, basins',
        icon: 'water',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Tap Replacement', 'Toilet Install', 'Basin Install', 'Mixer Install'],
      },
      {
        id: 'hot_water',
        name: 'Hot Water Systems',
        description: 'Install, repair, service',
        icon: 'water-boiler',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['HWS Electric Install', 'HWS Gas Install', 'HWS Repair', 'Heat Pump Install'],
      },
      {
        id: 'gas_services',
        name: 'Gas Services',
        description: 'Connections, repairs, testing',
        icon: 'fire',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Gas Appliance Connect', 'Gas Leak Repair', 'Gas Line Install'],
      },
      {
        id: 'bathroom_reno',
        name: 'Bathroom Renovations',
        description: 'Full bathroom upgrades',
        icon: 'shower',
        pricingMethods: [PRICING_METHODS.FIXED, PRICING_METHODS.PER_SQM],
        commonServices: ['Full Bathroom Reno', 'Shower Install', 'Bath Install', 'Vanity Install'],
      },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical',
    icon: 'lightning-bolt',
    description: 'Wiring, lights, power, switchboards',
    color: '#F59E0B',
    niches: [
      {
        id: 'all',
        name: 'All Electrical Services',
        description: 'General electrical services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_POINT],
        commonServices: ['General Electrical', 'Repairs', 'Installations', 'Testing'],
      },
      {
        id: 'power_lighting',
        name: 'Power & Lighting',
        description: 'Points, switches, lights',
        icon: 'lightbulb',
        pricingMethods: [PRICING_METHODS.PER_POINT, PRICING_METHODS.PER_UNIT],
        commonServices: ['Power Point Install', 'Light Fitting', 'LED Downlights', 'Dimmer Switch'],
      },
      {
        id: 'smoke_alarms',
        name: 'Smoke Alarms',
        description: 'Hardwired and battery alarms, interconnect',
        icon: 'smoke-detector',
        pricingMethods: [PRICING_METHODS.PER_POINT, PRICING_METHODS.PER_UNIT],
        commonServices: ['Smoke Alarm Install', 'Smoke Alarm Replacement', 'Interconnect Upgrade', 'Compliance Check'],
      },
      {
        id: 'switchboards',
        name: 'Switchboards & Safety',
        description: 'Upgrades, RCDs, testing',
        icon: 'toggle-switch',
        pricingMethods: [PRICING_METHODS.FIXED, PRICING_METHODS.PER_UNIT],
        commonServices: ['Switchboard Upgrade', 'Safety Switch (RCD)', 'Circuit Breaker', 'Fault Finding'],
      },
      {
        id: 'data_comms',
        name: 'Data & Communications',
        description: 'Internet, phone, TV',
        icon: 'network',
        pricingMethods: [PRICING_METHODS.PER_POINT, PRICING_METHODS.PER_UNIT],
        commonServices: ['Data Point (Cat6)', 'TV Antenna', 'Phone Point', 'NBN Connection'],
      },
      {
        id: 'specialty',
        name: 'Specialty Electrical',
        description: 'Fans, EV chargers, solar',
        icon: 'flash',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Ceiling Fan', 'EV Charger', 'Solar Install', 'Pool Equipment'],
      },
    ],
  },
  {
    id: 'hvac',
    name: 'HVAC',
    icon: 'air-conditioner',
    description: 'Heating, cooling, ventilation',
    color: '#06B6D4',
    niches: [
      {
        id: 'all',
        name: 'All HVAC Services',
        description: 'General HVAC services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General HVAC', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'split_systems',
        name: 'Split Systems',
        description: 'Install, service, repair',
        icon: 'air-conditioner',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Split System Install (<7kW)', 'Split System Service', 'Gas Regassing'],
      },
      {
        id: 'ducted_systems',
        name: 'Ducted Systems',
        description: 'Full home climate control',
        icon: 'hvac',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Ducted AC Install', 'Ducted Heating', 'Zone Install', 'Duct Cleaning'],
      },
      {
        id: 'evaporative',
        name: 'Evaporative Cooling',
        description: 'Natural cooling systems',
        icon: 'water-outline',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Evap Cooler Service', 'Pad Replacement', 'Evap Install'],
      },
    ],
  },
  {
    id: 'carpentry',
    name: 'Carpentry & Joinery',
    icon: 'hammer',
    description: 'Framing, doors, decking, built-ins',
    color: '#8B5CF6',
    niches: [
      {
        id: 'all',
        name: 'All Carpentry Services',
        description: 'General carpentry services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Carpentry', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'framing',
        name: 'Framing',
        description: 'Walls, structures, framework',
        icon: 'wall',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_LINEAR_M],
        commonServices: ['Stud Wall Framing', 'Roof Framing', 'Floor Framing'],
      },
      {
        id: 'doors_windows',
        name: 'Doors & Windows',
        description: 'Hanging, frames, hardware',
        icon: 'door',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Door Hanging (internal)', 'Door Hanging (external)', 'Window Install', 'Architrave'],
      },
      {
        id: 'outdoor',
        name: 'Outdoor Structures',
        description: 'Decks, pergolas, fences',
        icon: 'home-outline',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_LINEAR_M],
        commonServices: ['Decking', 'Pergola', 'Fence Build', 'Gazebo'],
      },
      {
        id: 'custom_joinery',
        name: 'Custom Joinery',
        description: 'Built-ins, cabinetry',
        icon: 'cupboard',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED],
        commonServices: ['Built-in Wardrobe', 'Shelving', 'Custom Cabinets', 'Staircase'],
      },
    ],
  },
  {
    id: 'cabinet_making',
    name: 'Cabinet Making',
    icon: 'cupboard',
    description: 'Kitchens, wardrobes, vanities, custom cabinetry',
    color: '#A16207',
    niches: [
      {
        id: 'all',
        name: 'All Cabinet Making Services',
        description: 'General cabinet making and joinery',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED, PRICING_METHODS.HOURLY],
        commonServices: ['Custom Cabinets', 'Built-ins', 'Repairs', 'Installations'],
      },
      {
        id: 'kitchens',
        name: 'Kitchens',
        description: 'Custom kitchen cabinetry and benchtops',
        icon: 'silverware-fork-knife',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED],
        commonServices: ['Kitchen Design', 'Cabinet Install', 'Benchtop Install', 'Splashback', 'Kitchen Renovation'],
      },
      {
        id: 'wardrobes',
        name: 'Wardrobes & Storage',
        description: 'Built-in wardrobes, walk-ins, storage solutions',
        icon: 'wardrobe',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED],
        commonServices: ['Built-in Wardrobe', 'Walk-in Wardrobe', 'Sliding Doors', 'Shelving', 'Storage Solutions'],
      },
      {
        id: 'vanities_laundry',
        name: 'Vanities & Laundry',
        description: 'Bathroom vanities and laundry cabinets',
        icon: 'shower',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED, PRICING_METHODS.PER_UNIT],
        commonServices: ['Bathroom Vanity', 'Laundry Cabinets', 'Mirror Cabinets', 'Benchtop Install'],
      },
      {
        id: 'entertainment_office',
        name: 'Entertainment & Office',
        description: 'TV units, desks, home office joinery',
        icon: 'desk',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED],
        commonServices: ['TV Unit', 'Entertainment Cabinet', 'Home Office Desk', 'Bookshelves', 'Display Cabinet'],
      },
      {
        id: 'commercial_joinery',
        name: 'Commercial Joinery',
        description: 'Shopfit, reception desks, commercial fitouts',
        icon: 'office-building',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.FIXED, PRICING_METHODS.HOURLY],
        commonServices: ['Shopfit', 'Reception Desk', 'Retail Display', 'Commercial Fitout'],
      },
      {
        id: 'repairs_refacing',
        name: 'Repairs & Refacing',
        description: 'Door replacement, refacing, repairs',
        icon: 'wrench',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.HOURLY, PRICING_METHODS.FIXED],
        commonServices: ['Cabinet Door Replacement', 'Cabinet Refacing', 'Hinge Replacement', 'Drawer Repair'],
      },
    ],
  },
  {
    id: 'painting',
    name: 'Painting & Decorating',
    icon: 'format-paint',
    description: 'Interior, exterior, specialty',
    color: '#EC4899',
    niches: [
      {
        id: 'all',
        name: 'All Painting Services',
        description: 'General painting services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Painting', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'interior',
        name: 'Interior Painting',
        description: 'Walls, ceilings, trim',
        icon: 'home-city',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Interior Walls (2-coat)', 'Ceilings', 'Doors & Frames', 'Skirting'],
      },
      {
        id: 'exterior',
        name: 'Exterior Painting',
        description: 'Weatherboards, render, roofs',
        icon: 'home',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Exterior Weatherboards', 'Roof Spray', 'Fence Painting', 'Render Paint'],
      },
      {
        id: 'specialty',
        name: 'Specialty Finishes',
        description: 'Epoxy, wallpaper, textures',
        icon: 'palette',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Epoxy Garage Floor', 'Wallpaper Hang', 'Feature Walls', 'Anti-Graffiti'],
      },
    ],
  },
  {
    id: 'roofing',
    name: 'Roofing',
    icon: 'home-roof',
    description: 'Re-roofing, repairs, gutters',
    color: '#EF4444',
    niches: [
      {
        id: 'all',
        name: 'All Roofing Services',
        description: 'General roofing services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Roofing', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'roof_install',
        name: 'Roof Installation',
        description: 'New roofs, re-roofing',
        icon: 'home-roof',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Colorbond Re-Roof', 'Tile Roof', 'Metal Roofing', 'Ridge Capping'],
      },
      {
        id: 'roof_repairs',
        name: 'Roof Repairs',
        description: 'Leaks, tiles, flashings',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Tile Replacement', 'Leak Repair', 'Flashing Repair', 'Roof Screw Fix'],
      },
      {
        id: 'gutters',
        name: 'Gutters & Downpipes',
        description: 'Install, clean, repair',
        icon: 'water-off',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.PER_UNIT],
        commonServices: ['Gutter Replacement', 'Gutter Clean', 'Downpipe Install', 'Leaf Guard'],
      },
    ],
  },
  {
    id: 'flooring',
    name: 'Flooring',
    icon: 'floor-plan',
    description: 'Timber, carpet, tiles, vinyl',
    color: '#78350F',
    niches: [
      {
        id: 'all',
        name: 'All Flooring Services',
        description: 'General flooring services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Flooring', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'timber',
        name: 'Timber Flooring',
        description: 'Sand, polish, install',
        icon: 'set-square',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Timber Sand & Polish', 'Hybrid Flooring', 'Laminate Install'],
      },
      {
        id: 'carpet',
        name: 'Carpet',
        description: 'Supply, lay, repair',
        icon: 'rug',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Carpet Supply & Lay', 'Carpet Tiles', 'Underlay', 'Carpet Repair'],
      },
      {
        id: 'tiles',
        name: 'Tile Laying',
        description: 'Ceramic, porcelain, mosaic',
        icon: 'grid',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Floor Tiling', 'Wall Tiling', 'Splashback', 'Mosaic'],
      },
      {
        id: 'concrete',
        name: 'Concrete Floors',
        description: 'Polish, grind, seal',
        icon: 'texture-box',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Concrete Grind & Seal', 'Polish Concrete', 'Epoxy Coating'],
      },
    ],
  },
  {
    id: 'cleaning',
    name: 'Cleaning Services',
    icon: 'broom',
    description: 'Residential, commercial, specialty',
    color: '#14B8A6',
    niches: [
      {
        id: 'all',
        name: 'All Cleaning Services',
        description: 'General cleaning services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Cleaning', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'residential',
        name: 'Residential Cleaning',
        description: 'Homes, end of lease',
        icon: 'home-variant',
        pricingMethods: [PRICING_METHODS.FIXED, PRICING_METHODS.HOURLY],
        commonServices: ['End-of-Lease Clean', 'Regular Clean', 'Deep Clean', 'Spring Clean'],
      },
      {
        id: 'commercial',
        name: 'Commercial Cleaning',
        description: 'Offices, buildings, builders',
        icon: 'office-building',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.HOURLY],
        commonServices: ['Office Clean', 'Builders Clean', 'Strata Clean', 'Medical Clean'],
      },
      {
        id: 'specialty',
        name: 'Specialty Cleaning',
        description: 'Carpets, windows, pressure',
        icon: 'spray-bottle',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_UNIT],
        commonServices: ['Carpet Steam Clean', 'Window Clean', 'Pressure Clean', 'Solar Panel Clean'],
      },
    ],
  },
  {
    id: 'pest_control',
    name: 'Pest Control',
    icon: 'bug',
    description: 'Termites, general pests, rodents',
    color: '#DC2626',
    niches: [
      {
        id: 'all',
        name: 'All Pest Control Services',
        description: 'General pest control services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Pest Control', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'general_pest',
        name: 'General Pest Control',
        description: 'Spray treatments, prevention',
        icon: 'spray',
        pricingMethods: [PRICING_METHODS.FIXED, PRICING_METHODS.PER_SQM],
        commonServices: ['General Pest Spray', 'Cockroach Treatment', 'Spider Treatment', 'Ant Treatment'],
      },
      {
        id: 'termites',
        name: 'Termite Control',
        description: 'Barriers, baits, treatment',
        icon: 'shield-bug',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.PER_UNIT],
        commonServices: ['Termite Barrier', 'Bait Stations', 'Termite Inspection', 'Treatment'],
      },
      {
        id: 'rodents',
        name: 'Rodent Control',
        description: 'Baiting, trapping, exclusion',
        icon: 'rat',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Rodent Baiting', 'Rodent Trapping', 'Exclusion Work'],
      },
    ],
  },
  {
    id: 'other',
    name: 'Other Trades',
    icon: 'tools',
    description: 'Various specialized trades',
    color: '#6B7280',
    niches: [
      {
        id: 'all',
        name: 'All Other Trade Services',
        description: 'General other trade services',
        icon: 'tools',
        pricingMethods: [PRICING_METHODS.HOURLY, PRICING_METHODS.PER_UNIT],
        commonServices: ['General Other Trades', 'Repairs', 'Installations', 'Maintenance'],
      },
      {
        id: 'tiling',
        name: 'Tiling',
        description: 'Floor, wall, waterproofing',
        icon: 'grid',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Floor Tiling', 'Wall Tiling', 'Waterproofing', 'Tile Removal'],
      },
      {
        id: 'gyprock',
        name: 'Gyprock / Plastering',
        description: 'Sheeting, cornices, fixing',
        icon: 'wall',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_LINEAR_M],
        commonServices: ['Wall Sheeting', 'Ceiling Sheeting', 'Cornice', 'Flush/Setting'],
      },
      {
        id: 'bricklaying',
        name: 'Bricklaying',
        description: 'Bricks, blocks, repointing',
        icon: 'wall-sconce',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_UNIT],
        commonServices: ['Face Brick', 'Blockwork', 'Repointing', 'Brick Cleaning'],
      },
      {
        id: 'concreting',
        name: 'Concreting',
        description: 'Slabs, driveways, footings',
        icon: 'texture-box',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_CUBIC_M],
        commonServices: ['House Slab', 'Driveway', 'Footings', 'Exposed Aggregate'],
      },
      {
        id: 'rendering',
        name: 'Rendering',
        description: 'Acrylic, cement, texture',
        icon: 'format-color-fill',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.FIXED],
        commonServices: ['Acrylic Render', 'Cement Render', 'Texture Coat', 'Bagging'],
      },
      {
        id: 'fencing',
        name: 'Fencing & Gates',
        description: 'Colorbond, timber, pool',
        icon: 'fence',
        pricingMethods: [PRICING_METHODS.PER_LINEAR_M, PRICING_METHODS.PER_UNIT],
        commonServices: ['Colorbond Fence', 'Timber Fence', 'Pool Glass Fence', 'Gates'],
      },
      {
        id: 'locksmith',
        name: 'Locksmith',
        description: 'Locks, keys, security',
        icon: 'key',
        pricingMethods: [PRICING_METHODS.PER_UNIT, PRICING_METHODS.FIXED],
        commonServices: ['Lock Re-Key', 'Deadlock Install', 'Digital Lock', 'Safe Install'],
      },
      {
        id: 'glazing',
        name: 'Glazing',
        description: 'Windows, shower screens, glass',
        icon: 'window-closed',
        pricingMethods: [PRICING_METHODS.PER_SQM, PRICING_METHODS.PER_UNIT],
        commonServices: ['Double Glazing', 'Shower Screen', 'Mirror Install', 'Glass Balustrade'],
      },
    ],
  },
];

/**
 * Get trade category by ID
 */
export function getTradeCategoryById(id: string): TradeCategory | undefined {
  return TRADE_CATEGORIES.find(cat => cat.id === id);
}

/**
 * Get trade niche by ID
 */
export function getTradeNicheById(categoryId: string, nicheId: string): TradeNiche | undefined {
  const category = getTradeCategoryById(categoryId);
  return category?.niches.find(niche => niche.id === nicheId);
}

/**
 * Get all niches across all categories
 */
export function getAllNiches(): TradeNiche[] {
  return TRADE_CATEGORIES.flatMap(cat => cat.niches);
}

/**
 * Search trade categories and niches
 */
export function searchTrades(query: string): { category: TradeCategory; niche: TradeNiche }[] {
  const lowerQuery = query.toLowerCase();
  const results: { category: TradeCategory; niche: TradeNiche }[] = [];

  TRADE_CATEGORIES.forEach(category => {
    category.niches.forEach(niche => {
      const matchesCategory = category.name.toLowerCase().includes(lowerQuery);
      const matchesNiche = niche.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = niche.description.toLowerCase().includes(lowerQuery);
      const matchesService = niche.commonServices.some(s => s.toLowerCase().includes(lowerQuery));

      if (matchesCategory || matchesNiche || matchesDescription || matchesService) {
        results.push({ category, niche });
      }
    });
  });

  return results;
}
