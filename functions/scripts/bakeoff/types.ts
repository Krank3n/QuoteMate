/** Shared shapes for the quoting bake-off. */

export type Unit = 'each' | 'pack' | 'box' | 'm' | 'm²' | 'm³' | 'kg' | 'L';

/** A real customer job scope (no customer identity — scope text only). */
export interface CorpusJob {
  uid: string;
  docId: string;
  number?: string;
  jobName?: string;
  jobDescription: string;
  trade: string;
  storedMaterialCount: number;
  storedMaterialsSubtotal?: number;
  storedTotal?: number;
}

/** What the Bunnings scraper actually returns. NOTE: no packSize/packUnit — */
/** pack information exists only inside productName/description strings.     */
export interface ScraperProduct {
  productName: string;
  description?: string[] | string;
  price: number;
  priceIncGst?: number;
  unit?: string;
  itemNumber?: string;
  brand?: string;
  productUrl?: string;
  confidence?: string;
  stockCheckedAt?: string;
  packSize?: number;
  packUnit?: string;
}

/** One quote line, normalised across all three arms so scoring is identical. */
export interface QuoteLine {
  name: string;
  searchTerm?: string;
  /** What the JOB needs (e.g. 440 kg of concrete). */
  requiredQty: number;
  requiredUnit: Unit;
  /** What the arm says to BUY (e.g. 22 bags). */
  quantity: number;
  unit: Unit;
  /** Price of ONE purchasable item. */
  unitPrice: number;
  totalPrice: number;
  /** Identifies the real SKU, when the arm picked one. */
  productName?: string;
  itemNumber?: string;
  priceSource: 'scraped' | 'estimated' | 'model-knowledge' | 'unpriced';
  note?: string;
}

export interface ArmResult {
  arm: 'app' | 'app-fixed' | 'claude-direct' | 'claude-candidates';
  lines: QuoteLine[];
  estimatedHours?: number;
  materialsSubtotal: number;
  /** Wall-clock and cost, so "better" can be weighed against "affordable". */
  ms: number;
  error?: string;
  /** Arm A only: whether the reconcile safety pass actually completed. */
  reconcile?: { requested: number; applied: number; error?: string };
}

/** Ground truth about a SKU: what exactly do you get for one purchase? */
export interface ProductFacts {
  itemNumber?: string;
  productName: string;
  /** Buying ONE of this yields this much of this unit. "20kg bag" -> 20 kg. */
  yieldAmount: number;
  yieldUnit: Unit;
  /** For multi-piece packs ("5 Pack") — pieces per purchase, else null. */
  piecesPerPurchase: number | null;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}
