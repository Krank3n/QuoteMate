/**
 * LLM Service - Uses Claude API to analyze job descriptions
 * Generates materials lists from natural language descriptions
 */

import { ANTHROPIC_API_KEY } from '@env';
import { Material } from '../types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

console.log('🔧 Anthropic API Config:', {
  hasApiKey: !!ANTHROPIC_API_KEY,
  keyLength: ANTHROPIC_API_KEY?.length || 0,
});

interface LLMMaterial {
  name: string;
  searchTerm: string;
  quantity: number;
  unit: string;
  reasoning?: string;
}

interface LLMResponse {
  materials: LLMMaterial[];
  estimatedHours: number;
  jobSummary: string;
}

/**
 * Analyze a job description and generate a materials list
 * @param jobDescription - Natural language description of the job
 * @param retryCount - Number of retry attempts (default: 3)
 * @returns Materials list and estimated hours
 */
export async function analyzeJobDescription(
  jobDescription: string,
  retryCount: number = 3
): Promise<LLMResponse> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set, using fallback');
    throw new Error('API key not configured');
  }

  let lastError: Error | null = null;

  // Retry loop
  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const prompt = createPrompt(jobDescription);

      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
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
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const content = data.content[0].text;

      // Parse the JSON response
      const result = parseResponse(content);
      return result;
    } catch (error) {
      lastError = error as Error;
      console.error(`LLM analysis attempt ${attempt + 1} failed:`, error);

      // If this isn't the last attempt, wait before retrying
      if (attempt < retryCount - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  throw new Error(
    lastError?.message || 'Failed to analyze job description after multiple attempts'
  );
}

/**
 * Create the prompt for the LLM
 */
function createPrompt(jobDescription: string): string {
  return `You are an expert Australian tradie assistant. Analyze the following job description and generate a detailed materials list with Bunnings search terms.

Job Description: "${jobDescription}"

Provide a JSON response with the following structure:
{
  "jobSummary": "A brief summary of the job",
  "estimatedHours": <number of hours>,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Specific Bunnings search term (be very specific with brands/sizes)",
      "quantity": <number>,
      "unit": "each|m|L|kg|box|pack",
      "reasoning": "Why this material is needed"
    }
  ]
}

Guidelines:
- Use specific Bunnings product terms (e.g., "treated pine H3 90x45 2.4m" not just "timber")
- Include all materials: timber, screws, nails, stain/paint, concrete, etc.
- Be realistic with quantities - round up for waste
- Include safety/prep materials if relevant (sandpaper, drop sheets, etc.)
- Estimate labor hours realistically for an experienced tradie
- Common Australian brands: Bunnings, Ozito, Ramset, Selleys, Dunlop, etc.

Return ONLY valid JSON, no other text.`;
}

/**
 * Parse the LLM response
 */
function parseResponse(content: string): LLMResponse {
  try {
    // Extract JSON from potential markdown code blocks
    let jsonStr = content.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr);

    return {
      materials: parsed.materials || [],
      estimatedHours: parsed.estimatedHours || 8,
      jobSummary: parsed.jobSummary || '',
    };
  } catch (error) {
    console.error('Failed to parse LLM response:', error);
    throw new Error('Invalid response from LLM');
  }
}

/**
 * Fallback response when LLM is not available
 */
function getFallbackResponse(jobDescription: string): LLMResponse {
  return {
    jobSummary: jobDescription,
    estimatedHours: 8,
    materials: [
      {
        name: 'Timber - General Purpose',
        searchTerm: 'treated pine 90x45',
        quantity: 10,
        unit: 'each',
        reasoning: 'General structural timber',
      },
      {
        name: 'Screws - Deck/Construction',
        searchTerm: 'deck screws 75mm 500g',
        quantity: 2,
        unit: 'pack',
        reasoning: 'General fasteners',
      },
      {
        name: 'Timber Stain/Sealer',
        searchTerm: 'timber stain 4L',
        quantity: 1,
        unit: 'each',
        reasoning: 'Finishing/protection',
      },
    ],
  };
}

/**
 * Convert LLM materials to app Material format
 */
export function convertLLMMaterialsToMaterials(llmMaterials: LLMMaterial[]): Partial<Material>[] {
  return llmMaterials.map((m) => ({
    name: m.name,
    searchTerm: m.searchTerm,
    quantity: m.quantity,
    unit: m.unit,
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
  }));
}
