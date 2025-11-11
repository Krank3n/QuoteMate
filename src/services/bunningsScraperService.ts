/**
 * Bunnings Scraper Service
 * Integrates with the standalone Bunnings scraper API for fast, reliable product pricing
 */

import { BUNNINGS_SCRAPER_URL, BUNNINGS_SCRAPER_API_KEY } from '@env';

export interface ScraperProduct {
  productName: string;
  description: string;
  price: number;
  priceIncGst: number;
  unit: string;
  dimensions?: string;
  itemNumber: string;
  brand: string;
  stockLevel: 'in-stock' | 'low-stock' | 'out-of-stock' | 'unknown';
  stockCheckedAt: string;
  productUrl: string;
  imageUrl?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ScraperSearchResponse {
  success: boolean;
  results: ScraperProduct[];
  searchUrl: string;
  cached: boolean;
  timestamp: string;
  error?: string;
}

/**
 * Check if the scraper is available and configured
 */
export function isScraperAvailable(): boolean {
  const available = !!(BUNNINGS_SCRAPER_URL && BUNNINGS_SCRAPER_API_KEY);

  if (!available) {
    console.log('⚠️ Bunnings scraper not configured - will use OpenAI web search fallback');
  }

  return available;
}

/**
 * Search for a product using the Bunnings scraper API
 * @param searchTerm - Product search term
 * @param limit - Maximum number of results (default: 10)
 * @returns Search results or null if scraper fails
 */
export async function searchProductWithScraper(
  searchTerm: string,
  limit: number = 10
): Promise<ScraperSearchResponse | null> {
  if (!isScraperAvailable()) {
    return null;
  }

  try {
    console.log(`🔍 Searching Bunnings scraper for: "${searchTerm}"`);

    const response = await fetch(`${BUNNINGS_SCRAPER_URL}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': BUNNINGS_SCRAPER_API_KEY,
      },
      body: JSON.stringify({
        searchTerm,
        limit,
        sortBy: 'relevance',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Scraper API error (${response.status}): ${errorText}`);
      return null;
    }

    const data: ScraperSearchResponse = await response.json();

    if (data.success && data.results && data.results.length > 0) {
      console.log(`✅ Scraper found ${data.results.length} product(s) (cached: ${data.cached})`);
      return data;
    } else {
      console.log(`⚠️ Scraper found no results for "${searchTerm}"`);
      return null;
    }
  } catch (error) {
    console.error('❌ Scraper request failed:', error);
    return null;
  }
}

/**
 * Get the best matching product from scraper results using Claude AI
 * @param products - Array of products from scraper
 * @param requestedProductName - What the user originally requested
 * @returns Best matching product or null
 */
export function selectBestScraperProduct(
  products: ScraperProduct[],
  requestedProductName: string
): { product: ScraperProduct; reasoning: string } | null {
  if (products.length === 0) {
    return null;
  }

  if (products.length === 1) {
    return {
      product: products[0],
      reasoning: 'Only one product found',
    };
  }

  // Sort by confidence first, then by how well the name matches
  const sortedProducts = [...products].sort((a, b) => {
    // Confidence weights
    const confidenceWeight = { high: 3, medium: 2, low: 1 };
    const scoreA = confidenceWeight[a.confidence];
    const scoreB = confidenceWeight[b.confidence];

    if (scoreA !== scoreB) {
      return scoreB - scoreA; // Higher confidence first
    }

    // If same confidence, check name similarity
    const reqLower = requestedProductName.toLowerCase();
    const aNameLower = a.productName.toLowerCase();
    const bNameLower = b.productName.toLowerCase();

    // Count matching words
    const reqWords = reqLower.split(/\s+/);
    const aMatches = reqWords.filter(word => aNameLower.includes(word)).length;
    const bMatches = reqWords.filter(word => bNameLower.includes(word)).length;

    return bMatches - aMatches; // More matches first
  });

  const bestProduct = sortedProducts[0];

  return {
    product: bestProduct,
    reasoning: `Selected based on ${bestProduct.confidence} confidence match. Stock: ${bestProduct.stockLevel}`,
  };
}

/**
 * Convert scraper product to Material format for the app
 */
export function convertScraperProductToMaterial(
  product: ScraperProduct,
  quantity: number,
  unit: string
): {
  name: string;
  searchTerm: string;
  quantity: number;
  unit: string;
  price: number;
  totalPrice: number;
  imageUrl?: string;
  productUrl?: string;
  itemNumber?: string;
  brand?: string;
  stockLevel?: string;
} {
  return {
    name: product.productName,
    searchTerm: product.productName,
    quantity,
    unit,
    price: product.price,
    totalPrice: product.price * quantity,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    itemNumber: product.itemNumber,
    brand: product.brand,
    stockLevel: product.stockLevel,
  };
}

/**
 * Health check for the scraper API
 * @returns true if scraper is healthy and responsive
 */
export async function checkScraperHealth(): Promise<boolean> {
  if (!isScraperAvailable()) {
    return false;
  }

  try {
    const response = await fetch(`${BUNNINGS_SCRAPER_URL}/health`, {
      method: 'GET',
      headers: {
        'X-API-Key': BUNNINGS_SCRAPER_API_KEY,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Bunnings scraper is healthy:', data.status);
      return true;
    }

    return false;
  } catch (error) {
    console.error('❌ Scraper health check failed:', error);
    return false;
  }
}
