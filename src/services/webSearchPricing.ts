/**
 * Web Search Pricing Service
 * Uses Claude AI with web search to find material prices from hardware stores
 */

import { ANTHROPIC_API_KEY } from '@env';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';
import { normaliseEstimateResponse, type EstimateResult } from '../../shared/pricing/estimate';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Firebase Functions URL configuration
// Always use production URL unless explicitly running emulator
const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';


// The answer shape and its coercions live in shared/pricing/estimate so the
// server-side pricing run reads an estimate exactly as the app does.
type PriceSearchResult = EstimateResult;
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
    return { price: null };
  }

  try {
    const storeList = hardwareStoreUrls.join(', ');

    const prompt = `You are a pricing expert for Australian hardware stores like Bunnings.

Material: "${materialName}"
Store context: ${storeList}

Based on your knowledge of typical Australian hardware store pricing, estimate a reasonable price for this material.
Consider typical Australian hardware store pricing from 2024.

Return ONLY a JSON object in this exact format (no other text):
{
  "price": <number>,
  "productName": "<material name>",
  "packSize": <number>,
  "packUnit": "<each|m|m2|kg|L>",
  "store": "Hardware Store (AI estimate)",
  "confidence": "<low|medium|high>"
}

"price" is what ONE purchase costs, so packSize/packUnit must say what that one
purchase contains (a "90m roll" is packSize 90, packUnit "m"; a "20kg bag" is
20, "kg"). For goods a store really does price per metre or per m2, use
packSize 1 with that unit. Omit only if you genuinely cannot tell.

Important:
- Return the price as a number only (e.g., 12.50, not "$12.50")
- Base your estimate on typical hardware store pricing
- Return ONLY valid JSON, no markdown, no other text

Plenty a tradie quotes is not sold at a hardware store — ducted air
conditioners, switchboards, hot water units, trade-only fixings. Price those at
what an Australian TRADE SUPPLIER would charge rather than returning null: a
null sends the line to a nominal placeholder, which put $25 against a 14kW
ducted system. Only return { "price": null } when the material is too vague to
identify at all ("misc bits"), never merely because it is not retail.

Example:
{"price": 15.90, "productName": "Treated Pine H3 90x45mm 2.4m", "store": "Hardware Store (AI estimate)", "confidence": "medium"}`;


    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
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
    } else {
    }

    return normaliseEstimateResponse(result);
  } catch (error) {
    if (error instanceof Error) {
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

    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/searchMaterialPrice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
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
    } else {
    }

    return normaliseEstimateResponse(data);
  } catch (error) {
    if (error instanceof Error) {
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
    }
  }


  return priceMap;
}
