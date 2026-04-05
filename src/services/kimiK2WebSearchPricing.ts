/**
 * Kimi K2 Web Search Pricing Service
 * Uses Kimi K2's powerful tool calling and web search capabilities
 * More reliable and cost-effective than OpenAI for product pricing
 */

import { Platform } from 'react-native';
import { KIMI_API_KEY, KIMI_PROJECT_ID } from '@env';

const KIMI_API_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = 'kimi-k2-turbo-preview'; // 60-100 tokens/s, 256K context


export interface KimiK2ProductMatch {
  productName: string;
  description?: string;
  price: number; // per unit, inc GST (0 if price not found but product found)
  unit?: string;
  itemNumber?: string;
  brand?: string;
  store: string;
  confidence: 'high' | 'medium' | 'low';
  sourceUrl?: string;
  imageUrl?: string;
  citations?: string[];
  priceUnavailable?: boolean;
  priceNote?: string;
}

export interface KimiK2PricingResult {
  match: KimiK2ProductMatch | null;
  searchTerm: string;
  stores: string[];
  rawOutput?: string;
  triedQueries?: string[];
}

/**
 * Parse a product name to extract key components
 */
interface ParsedProductName {
  brand?: string;
  model?: string;
  type?: string;
  size?: string;
  rawName: string;
}

function parseProductName(name: string): ParsedProductName {
  const result: ParsedProductName = { rawName: name };

  // Common Australian brands
  const brands = ['caroma', 'bunnings', 'flexseal', 'flexfit', 'ramset', 'makita', 'ozito',
                  'holman', 'pope', 'deta', 'arlec', 'saxon', 'zenith', 'accent', 'craftright',
                  'dulux', 'british paints', 'taubmans', 'solver', 'white knight', 'hills',
                  'absco', 'spear & jackson', 'trojan', 'cyclone', 'grunt', 'everdure', 'weber',
                  'matador', 'hurricane', 'bynorm', 'pinnacle', 'rinnai', 'rheem', 'bosch',
                  'dewalt', 'milwaukee', 'ryobi', 'black & decker', 'stanley', 'kinetic'];

  const lowerName = name.toLowerCase();

  // Extract brand
  for (const brand of brands) {
    if (lowerName.includes(brand)) {
      result.brand = brand.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }

  // Extract size/dimensions
  const sizeMatch = name.match(/\b(\d+(?:\.\d+)?)\s*(mm|cm|m|l|kg|g|ml)\b/i);
  if (sizeMatch) {
    result.size = sizeMatch[0];
  }

  // Extract model number
  const modelMatch = name.match(/\b([A-Z]{2,}\d+[A-Z\d]*|\d{3,}[A-Z]*)\b/);
  if (modelMatch && modelMatch[0].length >= 3) {
    result.model = modelMatch[0];
  }

  // Extract product type
  const types = ['toilet', 'tap', 'sink', 'basin', 'connector', 'pipe', 'valve',
                 'fitting', 'elbow', 'adapter', 'coupling', 'drill', 'saw', 'hammer',
                 'screwdriver', 'spanner', 'wrench', 'pliers', 'paint', 'brush', 'roller',
                 'hose', 'inlet', 'braided', 'flexible'];
  for (const type of types) {
    if (lowerName.includes(type)) {
      result.type = type.charAt(0).toUpperCase() + type.slice(1);
      break;
    }
  }

  return result;
}

/**
 * Generate search query variations
 */
function generateSearchVariations(name: string, parsed: ParsedProductName): string[] {
  const queries: string[] = [];

  // Strategy 1: Exact name
  queries.push(name);

  // Strategy 2: Brand + Model (if both exist)
  if (parsed.brand && parsed.model) {
    queries.push(`${parsed.brand} ${parsed.model}`);
  }

  // Strategy 3: Brand + Type (if both exist)
  if (parsed.brand && parsed.type) {
    queries.push(`${parsed.brand} ${parsed.type}`);
  }

  // Limit to 3 strategies to avoid excessive API calls
  return [...new Set(queries)].slice(0, 3);
}

/**
 * Search for a product using Kimi K2's web search capabilities
 * Kimi K2 is specifically designed for reliable tool calling and multi-step reasoning
 */
export async function searchMaterialWithKimiK2(
  materialName: string,
  searchTerm: string | undefined,
  quantity: number,
  unit: string,
  storeUrls: string[],
  apiKey?: string,
  postcode?: string
): Promise<KimiK2PricingResult> {
  const key = apiKey || KIMI_API_KEY;

  if (!key) {
    return { match: null, searchTerm: materialName, stores: storeUrls };
  }

  const locationPostcode = postcode || '2000';
  const requestedName = searchTerm || materialName;
  const parsed = parseProductName(requestedName);
  const searchVariations = generateSearchVariations(requestedName, parsed);


  // Format domains
  let allowedDomains = storeUrls.map(url => {
    return url
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .split('/')[0];
  });

  // Prioritize Bunnings (better price visibility)
  allowedDomains = allowedDomains.sort((a, b) => {
    if (a.includes('bunnings')) return -1;
    if (b.includes('bunnings')) return 1;
    return 0;
  });

  const hasMitre10 = allowedDomains.some(d => d.includes('mitre10'));
  const hasBunnings = allowedDomains.some(d => d.includes('bunnings'));

  if (hasMitre10 && !hasBunnings) {
  }


  const triedQueries: string[] = [];

  // Try each search variation
  for (let i = 0; i < searchVariations.length; i++) {
    const searchQuery = searchVariations[i];
    triedQueries.push(searchQuery);


    try {
      // Use Kimi K2's chat completions with built-in web search
      // Note: Kimi K2 has web search built into the model, not as a separate tool
      const response = await fetch(`${KIMI_API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: KIMI_MODEL,
          messages: [
            {
              role: 'system',
              content: `You are an expert Australian hardware product pricing assistant with web search capabilities.

Your task is to search the web and find REAL current prices for products from ${allowedDomains.join(' or ')}.

CRITICAL WEB SEARCH INSTRUCTIONS:
1. Search the web for "${searchQuery}" on these specific sites: ${allowedDomains.map(d => `site:${d}`).join(' OR ')}
2. Look for current prices in Sydney, NSW ${locationPostcode}, Australia
3. When you find product pages, extract prices from:
   - JSON-LD structured data in <script type="application/ld+json">
   - Meta tags (og:price, product:price:amount)
   - HTML data attributes (data-price, data-product-price)
   - Visible text showing dollar amounts
4. If exact product "${requestedName}" not found, find similar/alternative products (same brand, type, size)
5. Return ONLY valid JSON (no markdown, no code blocks):

For products WITH price:
{
  "productName": "Full Product Name",
  "description": "Brief description",
  "price": 245.00,
  "unit": "each",
  "itemNumber": "SKU123",
  "brand": "Brand Name",
  "store": "Store Name",
  "sourceUrl": "https://...",
  "imageUrl": "https://...",
  "confidence": "high"
}

For products WITHOUT price (but found):
{
  "productName": "Full Product Name",
  "price": 0,
  "priceUnavailable": true,
  "priceNote": "Price requires postcode selection",
  "sourceUrl": "https://...",
  "itemNumber": "SKU123",
  "confidence": "medium"
}

If NO products found: {"price": null}

BE FLEXIBLE: Finding alternatives is GOOD! Australian hardware stores often have different stock.`,
            },
            {
              role: 'user',
              content: `🔍 WEB SEARCH REQUEST:

Search these websites: ${allowedDomains.join(' and ')}
Product to find: "${searchQuery}"
Original request: "${requestedName}"
Location: Sydney, NSW ${locationPostcode}
Quantity: ${quantity} ${unit}

SEARCH INSTRUCTIONS:
1. Use web search to find this product on the specified Australian hardware store websites
2. Look for current pricing information (inc GST)
3. If exact product not available, find similar alternatives
4. Return the JSON structure as specified in your system instructions

Start your web search now and return the JSON result.`,
            },
          ],
          temperature: 0.6, // Kimi K2 recommended temperature
          max_tokens: 2048,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        continue;
      }

      const data = await response.json();

      // Extract the assistant's response
      const message = data.choices?.[0]?.message;
      if (!message || !message.content) {
        continue;
      }

      // Parse JSON from response
      let jsonStr = message.content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);

      // Check if we got a valid result
      if (parsed.price === null || parsed.price === undefined) {
        continue;
      }

      // Accept products even without prices if we have metadata
      const hasPrice = parsed.price && parsed.price > 0;
      const hasProductInfo = parsed.productName && (parsed.itemNumber || parsed.sourceUrl);

      if (!hasPrice && !hasProductInfo) {
        continue;
      }

      const match: KimiK2ProductMatch = {
        productName: parsed.productName || requestedName,
        description: parsed.description,
        price: parsed.price ? parseFloat(parsed.price) : 0,
        unit: parsed.unit || unit,
        itemNumber: parsed.itemNumber,
        brand: parsed.brand,
        store: parsed.store || allowedDomains[0],
        confidence: parsed.confidence || 'medium',
        sourceUrl: parsed.sourceUrl,
        imageUrl: parsed.imageUrl,
        priceUnavailable: parsed.priceUnavailable || !hasPrice,
        priceNote: parsed.priceNote || (hasPrice ? undefined : 'Price not visible in search results'),
      };

      if (match.price > 0) {
        if (match.sourceUrl) {
        }
        if (match.imageUrl) {
        }

        return {
          match,
          searchTerm: requestedName,
          stores: storeUrls,
          triedQueries,
        };
      } else if (match.priceUnavailable && match.sourceUrl) {
        // Continue to next strategy
      }

      // Delay between strategies to avoid rate limits
      if (i < searchVariations.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (error instanceof Error) {
      }
      continue;
    }
  }


  return {
    match: null,
    searchTerm: requestedName,
    stores: storeUrls,
    triedQueries,
  };
}
