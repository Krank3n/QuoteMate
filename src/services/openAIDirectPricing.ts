/**
 * OpenAI Direct Pricing Service
 * Uses OpenAI's GPT-4o to directly estimate prices based on web knowledge
 * This is simpler and more reliable than HTML scraping
 */

import { Platform } from 'react-native';
import { OPENAI_API_KEY, OPENAI_ORG_ID, OPENAI_PROJECT_ID } from '@env';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

console.log('🔧 OpenAI Direct Pricing Config:', {
  platform: Platform.OS,
  hasApiKey: !!OPENAI_API_KEY,
  hasOrgId: !!OPENAI_ORG_ID,
  hasProjectId: !!OPENAI_PROJECT_ID,
});

export interface OpenAIDirectProductMatch {
  productName: string;
  description?: string;
  price: number; // per unit, inc GST
  unit?: string;
  itemNumber?: string;
  brand?: string;
  store: string;
  confidence: 'high' | 'medium' | 'low';
  searchUrl?: string;
}

export interface OpenAIDirectPricingResult {
  match: OpenAIDirectProductMatch | null;
  searchTerm: string;
  stores: string[];
}

/**
 * Use OpenAI to search for and price a material directly
 */
export async function searchMaterialWithOpenAIDirect(
  materialName: string,
  searchTerm: string | undefined,
  quantity: number,
  unit: string,
  storeUrls: string[],
  apiKey?: string
): Promise<OpenAIDirectPricingResult> {
  const key = apiKey || OPENAI_API_KEY;

  if (!key) {
    console.error('❌ OpenAI API key not configured');
    return { match: null, searchTerm: materialName, stores: storeUrls };
  }

  const term = searchTerm || materialName;

  // Extract store names
  const storeNames = storeUrls.map(url => {
    const domain = url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    if (domain.includes('bunnings')) return 'Bunnings';
    if (domain.includes('mitre10')) return 'Mitre 10';
    if (domain.includes('reece')) return 'Reece';
    if (domain.includes('middy')) return 'Middy\'s';
    if (domain.includes('flexihire')) return 'Flexihire';
    if (domain.includes('hometimber')) return 'Home Timber & Hardware';
    if (domain.includes('plumbingplus')) return 'Plumbing Plus';
    if (domain.includes('voltex')) return 'Voltex';
    return domain;
  });

  const prompt = `You are a product pricing expert for Australian hardware and building supply stores.

Task: Find the current price for this product in Australian dollars (AUD).

Product: "${term}"
Quantity needed: ${quantity} ${unit}
Preferred stores: ${storeNames.join(', ')}

Please search your knowledge and provide:
1. The most accurate current product name and price from one of these stores
2. Product details (brand, dimensions, item/SKU number if known)
3. Your confidence level in the price accuracy

IMPORTANT:
- Prices must include GST (Australian goods and services tax)
- Return the price per single unit (e.g., per piece, per metre, per litre)
- If the product is sold in packs, convert to per-unit price
- Use the first store from the list where the product is available
- If you don't have current pricing data, estimate based on typical ${new Date().getFullYear()} Australian prices

Return ONLY a JSON object in this EXACT format (no markdown, no code blocks):
{
  "productName": "Full product name",
  "description": "Brief description with key specs",
  "price": 0.00,
  "unit": "each/m/L/kg/pack",
  "itemNumber": "SKU or item number if known",
  "brand": "Brand name if known",
  "store": "Store name from the list",
  "confidence": "high/medium/low",
  "searchUrl": "Store search URL if known"
}

If you cannot find or estimate a price, return:
{
  "productName": null,
  "price": null,
  "confidence": "low"
}`;

  try {
    console.log(`🤖 Asking OpenAI directly for "${term}" pricing...`);

    // Build headers with organization and project IDs
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    };

    if (OPENAI_ORG_ID) {
      headers['OpenAI-Organization'] = OPENAI_ORG_ID;
    }

    if (OPENAI_PROJECT_ID) {
      headers['OpenAI-Project'] = OPENAI_PROJECT_ID;
    }

    // Retry logic for rate limits
    let retries = 0;
    const maxRetries = 2;
    let response: Response | null = null;

    while (retries <= maxRetries) {
      response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a product pricing expert for Australian hardware stores. Return only valid JSON, no markdown formatting.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      // If success, break out of retry loop
      if (response.ok) {
        break;
      }

      // If rate limited, wait and retry
      if (response.status === 429 && retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 2000; // Exponential backoff: 2s, 4s
        console.log(`⏳ Rate limited, waiting ${waitTime/1000}s before retry ${retries + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries++;
        continue;
      }

      // Other error, break
      break;
    }

    if (!response || !response.ok) {
      const errorText = await response?.text();
      console.error('❌ OpenAI API error:', response?.status, errorText);
      return { match: null, searchTerm: term, stores: storeUrls };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from OpenAI's response
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr);

    // Check if we got a valid result
    if (!parsed.price || parsed.price === null) {
      console.log(`⚠️ OpenAI could not find/estimate price for "${term}"`);
      return { match: null, searchTerm: term, stores: storeUrls };
    }

    const match: OpenAIDirectProductMatch = {
      productName: parsed.productName || term,
      description: parsed.description,
      price: parseFloat(parsed.price),
      unit: parsed.unit || unit,
      itemNumber: parsed.itemNumber,
      brand: parsed.brand,
      store: parsed.store || storeNames[0],
      confidence: parsed.confidence || 'medium',
      searchUrl: parsed.searchUrl,
    };

    console.log(`✅ OpenAI found: ${match.productName} - $${match.price} (${match.confidence} confidence)`);

    return {
      match,
      searchTerm: term,
      stores: storeUrls,
    };
  } catch (error) {
    console.error('❌ OpenAI direct pricing error:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    return { match: null, searchTerm: term, stores: storeUrls };
  }
}
