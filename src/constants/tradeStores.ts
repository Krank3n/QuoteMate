/**
 * Trade-specific hardware stores configuration
 * Predefined store lists based on trade type
 */

import { TradeType, HardwareStore } from '../types';

// General Hardware Stores (for all trades)
export const GENERAL_HARDWARE_STORES: HardwareStore[] = [
  {
    name: 'Bunnings Warehouse',
    url: 'bunnings.com.au',
    description: "Australia's largest hardware chain - tools, paint, timber, plumbing, electrical",
  },
  {
    name: 'Flexihire',
    url: 'flexihire.com.au',
    description: 'Equipment hire and tools for trades and construction',
  },
  {
    name: 'Mitre 10',
    url: 'mitre10.com.au',
    description: 'Independent network of 400+ stores for trade and DIY hardware',
  },
  {
    name: 'Home Timber & Hardware',
    url: 'hth.com.au',
    description: 'Specializes in timber, tools, and building materials for tradies',
  },
  {
    name: 'Total Tools',
    url: 'totaltools.com.au',
    description: 'Trade-focused for power tools, hardware, and accessories',
  },
];

// Plumbing-specific stores
export const PLUMBING_STORES: HardwareStore[] = [
  {
    name: 'Reece Plumbing',
    url: 'reece.com.au',
    description: 'Largest specialist plumbing wholesaler - pipes, hot water systems, fixtures',
  },
  {
    name: 'Plumbing Plus',
    url: 'plumbingplus.com.au',
    description: 'Network of 320+ independent resellers for trade-only plumbing products',
  },
  {
    name: 'Plumbers Supplies',
    url: 'plumbersupplies.com.au',
    description: 'Online trade supplier of brassware, copper fittings, and consumables',
  },
  {
    name: 'Cooks Plumbing Supplies',
    url: 'cooksplumbing.com.au',
    description: 'Trade supplier with 13 stores in Sydney/QLD',
  },
  // Include general hardware stores too
  ...GENERAL_HARDWARE_STORES.slice(0, 3), // Bunnings, Flexihire, and Mitre 10
];

// Electrical-specific stores
export const ELECTRICAL_STORES: HardwareStore[] = [
  {
    name: "Middy's",
    url: 'middys.com.au',
    description: 'Major electrical wholesaler - cables, switchgear, and LED lighting',
  },
  {
    name: 'Voltex',
    url: 'voltex.com.au',
    description: 'Trade electrical supplier with app-based ordering',
  },
  {
    name: 'Tradezone',
    url: 'tradezone.com.au',
    description: 'Online wholesaler for electrical, solar, and HVAC',
  },
  {
    name: 'Sparky Direct',
    url: 'sparkydirect.com.au',
    description: 'Online electrical store for tradies - tools, power points, cables',
  },
  // Include general hardware stores too
  ...GENERAL_HARDWARE_STORES.slice(0, 2),
];

// Carpenter-specific stores (mainly general hardware)
export const CARPENTER_STORES: HardwareStore[] = [
  ...GENERAL_HARDWARE_STORES,
  {
    name: 'Sydney Solvents',
    url: 'sydneysolvents.com.au',
    description: 'Timber, hardware, and trade supplies',
  },
];

// Cleaner-specific stores
export const CLEANER_STORES: HardwareStore[] = [
  {
    name: 'Bunnings Warehouse',
    url: 'bunnings.com.au',
    description: "Australia's largest hardware chain - cleaning supplies and equipment",
  },
  {
    name: 'Mitre 10',
    url: 'mitre10.com.au',
    description: 'Cleaning products and equipment',
  },
  {
    name: 'Total Tools',
    url: 'totaltools.com.au',
    description: 'Professional cleaning equipment and tools',
  },
];

/**
 * Get hardware stores for a specific trade type
 */
export function getStoresForTrade(tradeType: TradeType): HardwareStore[] {
  switch (tradeType) {
    case 'plumber':
      return PLUMBING_STORES;
    case 'electrician':
      return ELECTRICAL_STORES;
    case 'carpenter':
      return CARPENTER_STORES;
    case 'cleaner':
      return CLEANER_STORES;
    case 'all':
    default:
      return GENERAL_HARDWARE_STORES;
  }
}

/**
 * Get default selected stores for a trade
 */
export function getDefaultStoresForTrade(tradeType: TradeType): string[] {
  switch (tradeType) {
    case 'plumber':
      // Default to Reece only for plumbers
      return ['reece.com.au'];
    case 'carpenter':
    case 'all':
      // Default to Bunnings and Flexihire for carpenters and all trades
      return ['bunnings.com.au', 'flexihire.com.au'];
    default:
      // For other trades, use first 2 stores
      const stores = getStoresForTrade(tradeType);
      return stores.slice(0, 2).map(store => store.url);
  }
}

/**
 * Trade type display names
 */
export const TRADE_TYPE_LABELS: Record<TradeType, string> = {
  all: 'All Trades',
  carpenter: 'Carpenter',
  plumber: 'Plumber',
  electrician: 'Electrician',
  cleaner: 'Cleaner',
};
