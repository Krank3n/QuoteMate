/**
 * Bunnings Scraper API Client
 *
 * Connects to your separate Bunnings scraper microservice
 * to fetch real product data and pricing.
 */

import { BUNNINGS_SCRAPER_URL, BUNNINGS_SCRAPER_API_KEY } from '@env';

// Defensive fallbacks for production builds
const SCRAPER_API_URL = BUNNINGS_SCRAPER_URL || 'http://165.22.151.190';
const SCRAPER_API_KEY = BUNNINGS_SCRAPER_API_KEY || '666d9a00cd10ee9a034215ec3cebc188cbf3e21c789093128e8bc1829c9b3266';

// Log configuration on module load (only once)
console.log('🔧 Bunnings Scraper Config:', {
  url: SCRAPER_API_URL,
  hasApiKey: !!SCRAPER_API_KEY,
  apiKeyLength: SCRAPER_API_KEY?.length || 0,
});

export interface ScraperProduct {
  productName: string;
  description?: string;
  price: number;
  priceIncGst: number;
  unit: string;
  dimensions?: string;
  itemNumber: string;
  brand?: string;
  stockLevel: 'in-stock' | 'low-stock' | 'out-of-stock' | 'unknown';
  stockCheckedAt?: string; // ISO timestamp of when stock was checked
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
 * Search for products using the Bunnings scraper API
 */
export async function searchBunningsProducts(
  searchTerm: string,
  limit: number = 5
): Promise<ScraperSearchResponse> {
  try {
    const response = await fetch(`${SCRAPER_API_URL}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': SCRAPER_API_KEY,
      },
      body: JSON.stringify({
        searchTerm,
        limit,
        sortBy: 'relevance',
      }),
    });

    if (!response.ok) {
      throw new Error(`Scraper API returned ${response.status}: ${response.statusText}`);
    }

    const data: ScraperSearchResponse = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Search failed');
    }

    console.log(`✅ Bunnings scraper found ${data.results.length} products for "${searchTerm}"`);
    console.log(`   Cached: ${data.cached}, Response time: ${data.cached ? '<100ms' : '~20s'}`);

    return data;
  } catch (error) {
    console.error('Bunnings scraper API error:', error);
    throw error;
  }
}

/**
 * Get specific product details by item number
 */
export async function getBunningsProduct(itemNumber: string): Promise<ScraperProduct | null> {
  try {
    const response = await fetch(`${SCRAPER_API_URL}/api/product/${itemNumber}`, {
      headers: {
        'X-API-Key': SCRAPER_API_KEY,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Scraper API returned ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.product : null;
  } catch (error) {
    console.error('Error fetching product details:', error);
    return null;
  }
}

/**
 * Check if scraper API is healthy
 */
export async function checkScraperHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SCRAPER_API_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Scraper health check failed: ${response.status}`);
      return false;
    }

    const data = await response.json();
    const isHealthy = data.success && data.status === 'healthy';

    if (isHealthy) {
      console.log('✅ Bunnings scraper is healthy');
    } else {
      console.warn('⚠️ Bunnings scraper is unhealthy:', data);
    }

    return isHealthy;
  } catch (error) {
    console.error('Scraper health check error:', error);
    return false;
  }
}

/**
 * Search and get the best match for a material
 */
export async function findBestMatchForMaterial(
  materialName: string
): Promise<ScraperProduct | null> {
  try {
    const response = await searchBunningsProducts(materialName, 5);

    if (!response.success || response.results.length === 0) {
      return null;
    }

    // Filter for high confidence matches with prices
    const goodMatches = response.results.filter(
      (p) => p.confidence === 'high' && p.price > 0
    );

    if (goodMatches.length > 0) {
      return goodMatches[0]; // Return best match
    }

    // Fallback to medium confidence
    const mediumMatches = response.results.filter(
      (p) => p.confidence === 'medium' && p.price > 0
    );

    if (mediumMatches.length > 0) {
      return mediumMatches[0];
    }

    // Last resort: return first result even if price is 0
    return response.results[0];
  } catch (error) {
    console.error('Error finding best match:', error);
    return null;
  }
}
