/**
 * Web Search Pricing Service
 * Uses Claude AI with web search to find material prices from hardware stores
 */

import { ANTHROPIC_API_KEY } from '@env';
import { Platform } from 'react-native';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Firebase Functions URL configuration
// Always use production URL unless explicitly running emulator
const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

console.log('🔧 Web Search Pricing Config:', {
  platform: Platform.OS,
  useEmulator: USE_EMULATOR,
  functionsUrl: FIREBASE_FUNCTIONS_URL,
});

interface PriceSearchResult {
  price: number | null;
  productName?: string;
  store?: string;
  url?: string;
}

/**
 * Search for material price using Claude AI WITHOUT web search
 * This uses Claude's training data to estimate prices - not real-time web search
 * For accurate pricing, use the Bunnings API option in settings
 * @param materialName - Name of the material to search for
 * @param hardwareStoreUrls - Array of hardware store URLs (informational only)
 * @returns Price information or null
 */
export async function searchMaterialPrice(
  materialName: string,
  hardwareStoreUrls: string[]
): Promise<PriceSearchResult> {
  // On web, use Firebase Functions to avoid CORS issues
  if (Platform.OS === 'web') {
    return searchPriceViaFirebaseFunction(materialName, hardwareStoreUrls);
  }

  // On mobile, call Anthropic API directly
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set');
    return { price: null };
  }

  try {
    const storeList = hardwareStoreUrls.join(', ');

    const prompt = `You are a pricing expert for Australian hardware stores like Bunnings.

Material: "${materialName}"
Store context: ${storeList}

Based on your knowledge of typical Australian hardware store pricing, estimate a reasonable price for this material.
Consider typical Bunnings/hardware store pricing from 2024.

Return ONLY a JSON object in this exact format (no other text):
{
  "price": <number>,
  "productName": "<material name>",
  "store": "Bunnings (estimated)",
  "confidence": "<low|medium|high>"
}

Important:
- Return the price as a number only (e.g., 12.50, not "$12.50")
- Base your estimate on typical hardware store pricing
- If you cannot estimate, return { "price": null }
- Return ONLY valid JSON, no markdown, no other text

Example:
{"price": 15.90, "productName": "Treated Pine H3 90x45mm 2.4m", "store": "Bunnings (estimated)", "confidence": "medium"}`;

    console.log('🔍 Estimating price for:', materialName);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API error:', response.status, errorText);
      return { price: null };
    }

    const data = await response.json();

    // Handle different response formats
    let textContent = '';
    if (data.content && Array.isArray(data.content)) {
      const textBlock = data.content.find((block: any) => block.type === 'text');
      if (textBlock) {
        textContent = textBlock.text;
      }
    }

    if (!textContent) {
      console.error('❌ No text content in response');
      return { price: null };
    }

    // Parse JSON response
    let jsonStr = textContent.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(jsonStr);

    if (result.price !== null) {
      console.log('✅ Estimated price:', materialName, '→ $' + result.price, `(${result.confidence || 'unknown'} confidence)`);
    } else {
      console.log('⚠️  Could not estimate price for:', materialName);
    }

    return {
      price: result.price || null,
      productName: result.productName,
      store: result.store || 'Bunnings (estimated)',
      url: undefined,
    };
  } catch (error) {
    console.error('❌ Price estimation error:', materialName, error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    return { price: null };
  }
}

/**
 * Search material price via Firebase Cloud Function (for web)
 */
async function searchPriceViaFirebaseFunction(
  materialName: string,
  hardwareStoreUrls: string[]
): Promise<PriceSearchResult> {
  try {
    console.log('🔍 Estimating price via Firebase Function for:', materialName);

    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/searchMaterialPrice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        materialName,
        hardwareStoreUrls
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.price !== null) {
      console.log('✅ Estimated price:', materialName, '→ $' + data.price);
    } else {
      console.log('⚠️  Could not estimate price for:', materialName);
    }

    return {
      price: data.price || null,
      productName: data.productName,
      store: data.store || 'Bunnings (estimated)',
      url: data.url,
    };
  } catch (error) {
    console.error('❌ Price estimation error:', materialName, error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    return { price: null };
  }
}

/**
 * Search prices for multiple materials
 * @param materials - Array of material names
 * @param hardwareStoreUrls - Array of hardware store URLs
 * @returns Map of material names to prices
 */
export async function searchMultiplePrices(
  materials: string[],
  hardwareStoreUrls: string[]
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();

  console.log(`🔍 Searching prices for ${materials.length} materials using web search...`);

  // Search each material sequentially to avoid rate limits
  for (const materialName of materials) {
    try {
      const result = await searchMaterialPrice(materialName, hardwareStoreUrls);

      if (result.price !== null) {
        priceMap.set(materialName, result.price);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to search price for ${materialName}:`, error);
    }
  }

  console.log(`✅ Found ${priceMap.size} prices out of ${materials.length} materials`);

  return priceMap;
}
