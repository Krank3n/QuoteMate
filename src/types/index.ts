// Core data models for QuoteMate

export interface Material {
  id: string;
  name: string;
  quantity: number;
  unit: 'each' | 'm' | 'L' | 'kg' | 'box' | 'pack';
  bunningsItemNumber?: string;
  price: number; // per unit
  totalPrice: number;
  manualPriceOverride: boolean;
  searchTerm?: string;
  productUrl?: string; // Link to the actual product page
  favoriteProduct?: FavoriteProductMapping; // User's preferred product for this material
  // Pricing and product metadata
  pricingSource?: 'scraper' | 'api' | 'ai' | 'manual'; // Where the price came from
  imageUrl?: string; // Product image URL
  description?: string; // Product description
  brand?: string; // Product brand
  stockLevel?: string; // Stock availability (deprecated, use stockCheckedAt)
  stockCheckedAt?: string; // ISO timestamp of when stock was last checked
}

export interface FavoriteProductMapping {
  productName: string;
  store: string;
  productUrl?: string;
  itemNumber?: string;
  dimensions?: string;
  unit?: string;
  price?: number; // Last known price
  imageUrl?: string; // Product image
}

export interface Job {
  id: string;
  name: string;
  description: string;
  template?: 'stairs' | 'deck' | 'fence' | 'pergola' | 'custom';
  estimatedHours?: number;
  customParams?: Record<string, number>; // e.g., { steps: 15, length: 10 }
}

export interface Quote {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job: Job;
  materials: Material[];
  laborRate: number; // $/hour
  laborHours: number;
  laborTotal: number;
  materialsSubtotal: number;
  markup: number; // percentage
  markupAmount: number;
  subtotal: number;
  gst: number;
  total: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  notes?: string;
  aiSkipped?: boolean; // Flag to indicate AI analysis was intentionally skipped
}

export interface JobTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  defaultMaterials: TemplateMaterial[];
  estimatedHoursFormula: string; // e.g., "steps * 0.5"
  requiredParams: TemplateParam[]; // e.g., [{ key: 'steps', label: 'Number of steps', unit: '' }]
}

export interface TemplateMaterial {
  name: string;
  searchTerm: string; // what to search in Bunnings
  quantityFormula: string; // e.g., "steps * 2"
  unit: 'each' | 'm' | 'L' | 'kg' | 'box';
}

export interface TemplateParam {
  key: string;
  label: string;
  unit?: string;
  defaultValue?: number;
}

export type TradeType = 'all' | 'carpenter' | 'plumber' | 'electrician' | 'cleaner';

export interface HardwareStore {
  name: string;
  url: string;
  description: string;
}

export interface BusinessSettings {
  businessName: string;
  abn?: string;
  email?: string;
  phone?: string;
  address?: string;
  logoUri?: string; // Local file URI for company logo
  defaultLaborRate: number;
  defaultMarkup: number;
  // Trade type
  tradeType?: TradeType; // Default: 'all'
  // New: Trade category and niche for improved targeting (multi-select)
  tradeCategories?: string[]; // e.g., ['plumbing', 'carpentry']
  tradeNiches?: string[]; // e.g., ['drain_services', 'outdoor']
  // Legacy single-select fields (kept for backwards compatibility)
  tradeCategory?: string;
  tradeNiche?: string;
  // Price fetching settings
  useBunningsApi?: boolean; // If true, use Bunnings API. If false/undefined, use AI estimation (default: false)
  useReeceApi?: boolean; // If true and tradeType is plumber, use Reece API for plumbing supplies
  selectedStore?: string; // Single selected hardware store (e.g., 'bunnings', 'mitre10')
  // Legacy fields (kept for backwards compatibility)
  hardwareStores?: string[]; // DEPRECATED - use selectedStore instead
  customStores?: string[]; // DEPRECATED - Custom store URLs added by user
}

// Bunnings API types
export interface BunningsAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface BunningsItem {
  itemNumber: string;
  description: string;
  productName: string;
  brand?: string;
  uom?: string; // unit of measure
}

export interface BunningsPrice {
  itemNumber: string;
  price: number;
  priceIncGst: number;
  currency: string;
}

export interface BunningsInventory {
  itemNumber: string;
  locationCode: string;
  quantityAvailable: number;
  quantityOnHand: number;
}

// Quote calculation result
export interface QuoteCalculation {
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  markupAmount: number;
  gst: number;
  total: number;
}

// Subscription
export interface SubscriptionStatus {
  isPro: boolean;
  quotesThisMonth: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  freeQuotesLimit: number;
}

export type SubscriptionPlan = 'free' | 'pro';
