/**
 * Web Scraping-based Material Pricing Service
 *
 * Fetches real hardware store search results and uses Claude AI to parse
 * HTML and intelligently match products with automatic quantity adjustments.
 */

import { Platform } from 'react-native';

const FIREBASE_FUNCTION_URL = 'https://us-central1-hansendev.cloudfunctions.net';

// Hardware store search URL templates
const STORE_SEARCH_URLS: Record<string, (searchTerm: string) => string> = {
  'bunnings.com.au': (term) =>
    `https://www.bunnings.com.au/search/products?q=${encodeURIComponent(term)}&sort=BoostOrder`,
  'mitre10.com.au': (term) =>
    `https://www.mitre10.com.au/catalogsearch/result?q=${encodeURIComponent(term)}&viewType=GRID&flag=product`,
  'reece.com.au': (term) =>
    `https://www.reece.com.au/search?query=${encodeURIComponent(term)}`,
  'middy.com.au': (term) =>
    `https://www.middy.com.au/search?q=${encodeURIComponent(term)}`,
  'flexihire.com.au': (term) =>
    `https://www.flexihire.com.au/equipment?q=${encodeURIComponent(term)}`,
  'hometimber.com.au': (term) =>
    `https://www.hometimber.com.au/search?q=${encodeURIComponent(term)}`,
  'plumbingplus.com.au': (term) =>
    `https://www.plumbingplus.com.au/search?q=${encodeURIComponent(term)}`,
  'plumberssupplies.com.au': (term) =>
    `https://www.plumberssupplies.com.au/search?q=${encodeURIComponent(term)}`,
  'voltex.co.nz': (term) =>
    `https://www.voltex.co.nz/search?q=${encodeURIComponent(term)}`,
};

export interface ProductMatch {
  productName: string;
  description?: string;
  price: number; // per unit, inc GST
  pricePerUnit?: string; // e.g., "$12.50 / metre"
  unit?: string; // each, m, L, kg, pack
  dimensions?: string; // e.g., "2.4m length" or "90x45mm"
  itemNumber?: string;
  brand?: string;
  stockLevel?: 'in-stock' | 'low-stock' | 'out-of-stock' | 'unknown';
  stockCheckedAt?: string; // ISO timestamp of when stock was checked
  productUrl?: string;
  imageUrl?: string; // Product image URL
  store: string;
  confidence: 'high' | 'medium' | 'low'; // How well it matches the search
}

export interface QuantityAdjustment {
  originalQuantity: number;
  adjustedQuantity: number;
  reason: string; // e.g., "Need 3m but sold in 2.4m lengths, buying 2 pieces"
}

export interface PricingResult {
  matches: ProductMatch[];
  quantityAdjustment?: QuantityAdjustment;
  searchTerm: string;
  store: string;
}

/**
 * Fetch HTML from a hardware store search URL
 */
async function fetchStoreSearchHTML(
  searchUrl: string,
  store: string
): Promise<string | null> {
  try {
    // Enhanced headers to appear more like a real browser
    const realisticHeaders: Record<string, string> = {
      'User-Agent':
        Platform.OS === 'web'
          ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-AU,en-US;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      Connection: 'keep-alive',
      DNT: '1',
      'Upgrade-Insecure-Requests': '1',
    };

    // Add browser-specific headers for web
    if (Platform.OS === 'web') {
      realisticHeaders['Sec-Fetch-Dest'] = 'document';
      realisticHeaders['Sec-Fetch-Mode'] = 'navigate';
      realisticHeaders['Sec-Fetch-Site'] = 'none';
      realisticHeaders['Sec-Fetch-User'] = '?1';
    }

    console.log(`Attempting direct fetch from ${store} with enhanced headers...`);

    // Try direct fetch first (works on mobile, sometimes on web)
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: realisticHeaders,
    });

    if (!response.ok) {
      console.warn(`Direct fetch failed from ${store}: ${response.status} ${response.statusText}`);

      // Try Firebase Function as fallback (has even more bypass strategies)
      console.log('Attempting Firebase Function fallback with anti-scraping bypass...');
      const fbResponse = await fetch(`${FIREBASE_FUNCTION_URL}/fetchStoreHTML`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: searchUrl }),
      });

      if (!fbResponse.ok) {
        console.error(`Firebase Function also failed: ${fbResponse.status}`);
        return null;
      }

      const data = await fbResponse.json();
      if (data.html) {
        console.log(`✅ Firebase Function succeeded using method: ${data.method || 'unknown'}`);
        return data.html;
      }

      return null;
    }

    const html = await response.text();
    console.log(`✅ Direct fetch succeeded from ${store}, HTML length: ${html.length}`);
    return html;
  } catch (error) {
    console.error(`Error fetching HTML from ${store}:`, error);

    // Last attempt: Try Firebase Function
    try {
      console.log('Last attempt: Firebase Function...');
      const fbResponse = await fetch(`${FIREBASE_FUNCTION_URL}/fetchStoreHTML`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: searchUrl }),
      });

      if (fbResponse.ok) {
        const data = await fbResponse.json();
        if (data.html) {
          console.log(`✅ Firebase Function fallback succeeded`);
          return data.html;
        }
      }
    } catch (fbError) {
      console.error('Firebase Function fallback also failed:', fbError);
    }

    return null;
  }
}

/**
 * Use Claude AI to parse HTML and extract product matches
 */
async function parseProductsWithClaude(
  html: string,
  searchTerm: string,
  store: string,
  requestedQuantity: number,
  requestedUnit: string
): Promise<PricingResult> {
  try {
    // Use Firebase Function for both web and mobile to avoid React Native compatibility issues
    const response = await fetch(`${FIREBASE_FUNCTION_URL}/parseProductsHTML`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        searchTerm,
        store,
        requestedQuantity,
        requestedUnit,
      }),
    });

    if (!response.ok) {
      throw new Error(`Firebase function failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.parsed;

    // Parse JSON from Claude's response (handle markdown code blocks)
    const jsonMatch = result.match(/```json\n?([\s\S]*?)\n?```/) || result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Could not extract JSON from Claude response:', result);
      return { matches: [], searchTerm, store };
    }

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    // Add store to each match
    const matches = (parsed.matches || []).map((match: any) => ({
      ...match,
      store,
    }));

    return {
      matches,
      quantityAdjustment: parsed.quantityAdjustment || undefined,
      searchTerm,
      store,
    };
  } catch (error) {
    console.error('Error parsing products with Claude:', error);
    return { matches: [], searchTerm, store };
  }
}

/**
 * Search for a material across hardware stores and return best matches
 */
export async function searchMaterialWithWebScraping(
  materialName: string,
  searchTerm: string | undefined,
  quantity: number,
  unit: string,
  storeUrls: string[]
): Promise<PricingResult[]> {
  const term = searchTerm || materialName;
  const results: PricingResult[] = [];

  for (const storeUrl of storeUrls) {
    // Extract store domain
    const store = storeUrl.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    // Get search URL template
    const searchUrlFn = STORE_SEARCH_URLS[store];
    if (!searchUrlFn) {
      console.warn(`No search URL template for store: ${store}`);
      continue;
    }

    const searchUrl = searchUrlFn(term);
    console.log(`Searching ${store} for "${term}":`, searchUrl);

    // Fetch HTML
    const html = await fetchStoreSearchHTML(searchUrl, store);
    if (!html) {
      console.warn(`Failed to fetch HTML from ${store}`);
      continue;
    }

    // Parse with Claude
    const result = await parseProductsWithClaude(html, term, store, quantity, unit);
    if (result.matches.length > 0) {
      results.push(result);
    }

    // Add delay between stores to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
}

/**
 * Get the best single match from multiple pricing results
 * Prioritizes: high confidence > in-stock > lowest price
 */
export function getBestMatch(results: PricingResult[]): ProductMatch | null {
  const allMatches = results.flatMap((r) => r.matches);
  if (allMatches.length === 0) return null;

  // Sort by: confidence (high first), stock (in-stock first), price (low first)
  const sorted = allMatches.sort((a, b) => {
    const confScore = { high: 3, medium: 2, low: 1 };
    const stockScore = { 'in-stock': 3, unknown: 2, 'low-stock': 1, 'out-of-stock': 0 };

    const confDiff = confScore[b.confidence] - confScore[a.confidence];
    if (confDiff !== 0) return confDiff;

    const stockDiff = stockScore[b.stockLevel || 'unknown'] - stockScore[a.stockLevel || 'unknown'];
    if (stockDiff !== 0) return stockDiff;

    return a.price - b.price;
  });

  return sorted[0];
}
