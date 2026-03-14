/**
 * LLM Service - Uses Claude API to analyze job descriptions
 * Generates materials lists from natural language descriptions
 */

import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from '@env';
import { Material } from '../types';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';

// For web, use Firebase Functions URL
// For mobile, call Anthropic API directly
// Always use production URL unless explicitly running emulator
const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

console.log('🔧 LLM Service Config:', {
  platform: Platform.OS,
  hasAnthropicKey: !!ANTHROPIC_API_KEY,
  hasGeminiKey: !!GEMINI_API_KEY,
  useEmulator: USE_EMULATOR,
  functionsUrl: FIREBASE_FUNCTIONS_URL,
});

interface LLMMaterial {
  name: string;
  searchTerm: string;
  quantity: number;
  unit: string;
  reasoning?: string;
  section?: string;
}

interface LLMResponse {
  materials: LLMMaterial[];
  estimatedHours: number;
  jobSummary: string;
}

/**
 * Analyze a job description and generate a materials list
 * @param jobDescription - Natural language description of the job
 * @param tradeContext - Optional trade category and niche information
 * @param retryCount - Number of retry attempts (default: 3)
 * @returns Materials list and estimated hours
 */
export async function analyzeJobDescription(
  jobDescription: string,
  tradeContext?: {
    categoryName?: string;
    nicheName?: string;
    suggestedMaterials?: string[];
    pricingMethod?: string;
    selectedStore?: string; // Which store will be used for pricing
  },
  retryCount: number = 3,
  photoUrls?: string[]
): Promise<LLMResponse> {
  // On web, use Firebase Functions to avoid CORS issues
  if (Platform.OS === 'web') {
    return analyzeViaFirebaseFunction(jobDescription, tradeContext, retryCount);
  }

  // On mobile, call Anthropic API directly
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set');
    throw new Error('API key not configured');
  }

  let lastError: Error | null = null;

  // Retry loop
  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const prompt = createPrompt(jobDescription, tradeContext);

      // Build message content - text only or text + images (Pro vision)
      const messageContent: any[] = [];

      // Add photo images for vision analysis if provided
      if (photoUrls?.length) {
        for (const url of photoUrls) {
          messageContent.push({
            type: 'image',
            source: {
              type: 'url',
              url,
            },
          });
        }
      }

      messageContent.push({
        type: 'text',
        text: photoUrls?.length
          ? `${prompt}\n\nI've also attached ${photoUrls.length} site photo(s). Please examine them carefully to better understand the scope of work, identify specific materials visible, and refine your material estimates based on what you see.`
          : prompt,
      });

      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: messageContent,
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

  // All Claude retries failed, try Gemini as fallback
  console.log('🔄 Claude API failed after retries, trying Gemini fallback...');
  try {
    return await analyzeViaGemini(jobDescription, tradeContext);
  } catch (geminiError) {
    console.error('Gemini fallback also failed:', geminiError);
  }

  // All retries failed
  throw new Error(
    lastError?.message || 'Failed to analyze job description after multiple attempts'
  );
}

/**
 * Analyze job description via Firebase Cloud Function (for web)
 */
async function analyzeViaFirebaseFunction(
  jobDescription: string,
  tradeContext?: {
    categoryName?: string;
    nicheName?: string;
    suggestedMaterials?: string[];
    pricingMethod?: string;
    selectedStore?: string; // Which store will be used for pricing
  },
  retryCount: number = 3
): Promise<LLMResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/analyzeJobDescription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ jobDescription, tradeContext }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API returned ${response.status}`);
      }

      const data = await response.json();
      return {
        materials: data.materials || [],
        estimatedHours: data.estimatedHours || 8,
        jobSummary: data.jobSummary || '',
      };
    } catch (error) {
      lastError = error as Error;
      console.error(`Firebase Function attempt ${attempt + 1} failed:`, error);

      if (attempt < retryCount - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Try Gemini as fallback
  console.log('🔄 Claude API failed, trying Gemini fallback...');
  try {
    return await analyzeViaGemini(jobDescription, tradeContext);
  } catch (geminiError) {
    console.error('Gemini fallback also failed:', geminiError);
  }

  throw new Error(
    lastError?.message || 'Failed to analyze job description after multiple attempts'
  );
}

/**
 * Analyze job description via Google Gemini API (fallback)
 */
async function analyzeViaGemini(
  jobDescription: string,
  tradeContext?: {
    categoryName?: string;
    nicheName?: string;
    suggestedMaterials?: string[];
    pricingMethod?: string;
    selectedStore?: string;
  }
): Promise<LLMResponse> {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const prompt = createPrompt(jobDescription, tradeContext);

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('No content in Gemini response');
  }

  console.log('✅ Gemini fallback succeeded');
  return parseResponse(content);
}

/**
 * Create the prompt for the LLM
 */
function createPrompt(
  jobDescription: string,
  tradeContext?: {
    categoryName?: string;
    nicheName?: string;
    suggestedMaterials?: string[];
    pricingMethod?: string;
    selectedStore?: string; // Which store will be used for pricing
  }
): string {
  let contextSection = '';

  if (tradeContext) {
    contextSection = '\n\nTrade Context:';
    if (tradeContext.categoryName) {
      contextSection += `\n- Trade Category: ${tradeContext.categoryName}`;
    }
    if (tradeContext.nicheName) {
      contextSection += `\n- Specialty/Niche: ${tradeContext.nicheName}`;
    }
    if (tradeContext.pricingMethod) {
      contextSection += `\n- Typical Pricing Method: ${tradeContext.pricingMethod}`;
    }
    if (tradeContext.suggestedMaterials && tradeContext.suggestedMaterials.length > 0) {
      contextSection += `\n- Common Materials for This Type of Job: ${tradeContext.suggestedMaterials.join(', ')}`;
      contextSection += '\n  (Consider these materials, but also include any others that would be needed)';
    }
  }

  // Determine which store will be used for pricing
  const selectedStore = tradeContext?.selectedStore || 'bunnings';
  let storeName = 'Bunnings';
  if (selectedStore === 'mitre10') storeName = 'Mitre 10';
  if (selectedStore === 'reece') storeName = 'Reece';
  if (selectedStore === 'bunnings') storeName = 'Bunnings';

  return `You are an expert Australian tradie assistant specializing in construction and trade work. Analyze the following job description and generate a detailed materials list with generic search terms that work across multiple hardware stores.

Job Description: "${jobDescription}"${contextSection}

Hardware Store for pricing: ${storeName}

Provide a JSON response with the following structure:
{
  "jobSummary": "Short job title, 3-7 words max (e.g. 'Deck Construction', 'Bathroom Renovation', 'Timber Fence Installation')",
  "estimatedHours": <number of hours>,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Generic product search term (material type, size, specs - NOT brand-specific)",
      "quantity": <number>,
      "unit": "each|m|L|kg|box|pack",
      "section": "Work area this material belongs to (e.g. Concreting, Timber Framing, Roofing, Plumbing, Electrical, Painting, Demolition, Site Prep, etc.)",
      "reasoning": "Why this material is needed"
    }
  ]
}

Guidelines:
- Group materials into logical work sections using the "section" field. Use short, clear labels like "Concreting", "Timber Framing", "Roofing", "Finishing", etc. Materials that belong to the same area of work should share the same section name.
- Use GENERIC product terms suitable for ${storeName}
- Specify material type, size, and specs but avoid brand-specific names
- GOOD examples: "brass stop valve 15mm quarter turn", "treated pine H3 90x45 2.4m", "PTFE thread tape 12mm"
- BAD examples: "Kinetic valve", "Ozito drill", "Ramset anchor" (these are brand-specific)
- Use common material specifications: timber grades (H3/H4), dimensions, thread sizes, capacities
- Include all materials needed: primary materials, fasteners, adhesives, finishes, etc.
- Be realistic with quantities - round up for waste (typically 10-15% extra)
- Include safety/prep materials if relevant (sandpaper, drop sheets, cleaning supplies, etc.)
- Estimate labor hours realistically for an experienced tradie in this specialty
- Consider the suggested materials but don't limit yourself to only those
- Think about what a professional ${tradeContext?.nicheName || 'tradie'} would need for this job

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
 * Generate a professional email body for sending a quote to a client
 * Pro only - free users get a clean default template
 */
export async function generateQuoteEmail(params: {
  jobName: string;
  jobDescription: string;
  materials: { name: string; quantity: number; unit: string }[];
  laborHours: number;
  total: number;
  businessName: string;
  customerName: string;
  photoDescriptions?: string[];
}): Promise<string> {
  const { jobName, jobDescription, materials, laborHours, total, businessName, customerName, photoDescriptions } = params;

  const prompt = createEmailPrompt(params);

  // On web, use Firebase Functions
  if (Platform.OS === 'web') {
    return generateEmailViaFirebaseFunction(prompt);
  }

  // On mobile, call Anthropic API directly
  if (!ANTHROPIC_API_KEY) {
    throw new Error('API key not configured');
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.content[0].text;
    return parseEmailResponse(content);
  } catch (error) {
    console.error('Email generation with Claude failed:', error);

    // Try Gemini fallback
    try {
      return await generateEmailViaGemini(prompt);
    } catch (geminiError) {
      console.error('Gemini fallback also failed:', geminiError);
    }

    // Final fallback - return a basic template
    return getDefaultEmailBody(customerName, jobName, total, businessName);
  }
}

function createEmailPrompt(params: {
  jobName: string;
  jobDescription: string;
  materials: { name: string; quantity: number; unit: string }[];
  laborHours: number;
  total: number;
  businessName: string;
  customerName: string;
  photoDescriptions?: string[];
}): string {
  const { jobName, jobDescription, materials, laborHours, total, businessName, customerName, photoDescriptions } = params;

  let photosSection = '';
  if (photoDescriptions?.length) {
    photosSection = `\n\nSite photos have been attached showing: ${photoDescriptions.join('; ')}`;
  }

  const materialsSummary = materials.slice(0, 10).map(m => `${m.name} (${m.quantity} ${m.unit})`).join(', ');

  return `You are writing a professional email body for an Australian tradie sending a quote to their client. Write ONLY the email body text (no subject line, no greeting, no sign-off - those are added separately).

Job: ${jobName}
Description: ${jobDescription}
Key materials: ${materialsSummary}
Estimated labour: ${laborHours} hours
Total: $${total.toFixed(2)} (inc GST)
Business: ${businessName}
Client: ${customerName}${photosSection}

Guidelines:
- Write 2-3 short paragraphs summarising the scope of work
- Be professional but friendly, in plain Australian English
- Mention key materials/work areas without listing every item
- Be strictly factual - do NOT add any details, claims, or promises not in the description
- Do NOT include pricing (it's shown separately in the email template)
- Do NOT include greetings or sign-offs (they're added by the template)
- Keep it concise - under 150 words

Return ONLY the email body text, no JSON wrapping or quotes.`;
}

async function generateEmailViaFirebaseFunction(prompt: string): Promise<string> {
  const idToken = await auth.currentUser?.getIdToken();
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/generateQuoteEmail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Firebase function returned ${response.status}`);
  }

  const data = await response.json();
  return data.emailBody || '';
}

async function generateEmailViaGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No content in Gemini response');

  return parseEmailResponse(content);
}

function parseEmailResponse(content: string): string {
  // Strip any markdown code blocks or JSON wrapping
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.replace(/```[a-z]*\n?/g, '').replace(/\n?```$/g, '');
  }
  // Remove wrapping quotes if present
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text.trim();
}

/**
 * Default email body for free users (no AI)
 */
export function getDefaultEmailBody(
  customerName: string,
  jobName: string,
  total: number,
  businessName: string
): string {
  return `Please find attached your quotation for ${jobName}.\n\nThis quote includes all materials and labour required to complete the work as discussed. The total amount is $${total.toFixed(2)} (inc GST).\n\nThis quote is valid for 30 days from the date of issue. If you have any questions, please don't hesitate to get in touch.`;
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
    unit: m.unit as 'each' | 'm' | 'L' | 'kg' | 'box' | 'pack',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...(m.section && { section: m.section }),
  }));
}

/**
 * Clean up transcribed text and generate a job title
 * @param transcribedText - Raw text from voice transcription
 * @returns Cleaned description and suggested title
 */
export async function cleanupTranscriptionAndGenerateTitle(
  transcribedText: string
): Promise<{ cleanedDescription: string; suggestedTitle: string }> {
  // On web, use Firebase Functions
  if (Platform.OS === 'web') {
    return cleanupViaFirebaseFunction(transcribedText);
  }

  // On mobile, call Anthropic API directly
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set');
    throw new Error('API key not configured');
  }

  try {
    const prompt = createCleanupPrompt(transcribedText);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
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
    const result = parseCleanupResponse(content);
    return result;
  } catch (error) {
    console.error('Text cleanup with Claude failed:', error);

    // Try Gemini as fallback
    try {
      console.log('🔄 Trying Gemini fallback for text cleanup...');
      return await cleanupViaGemini(transcribedText);
    } catch (geminiError) {
      console.error('Gemini fallback also failed:', geminiError);
    }

    // Final fallback: return original text with a basic title
    return {
      cleanedDescription: transcribedText,
      suggestedTitle: extractSimpleTitle(transcribedText),
    };
  }
}

/**
 * Clean up transcription via Firebase Cloud Function (for web)
 */
async function cleanupViaFirebaseFunction(
  transcribedText: string
): Promise<{ cleanedDescription: string; suggestedTitle: string }> {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/cleanupTranscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ transcribedText }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `API returned ${response.status}`);
    }

    const data = await response.json();
    return {
      cleanedDescription: data.cleanedDescription || transcribedText,
      suggestedTitle: data.suggestedTitle || '',
    };
  } catch (error) {
    console.error('Firebase cleanup function failed:', error);

    // Try Gemini as fallback
    try {
      console.log('🔄 Trying Gemini fallback for text cleanup...');
      return await cleanupViaGemini(transcribedText);
    } catch (geminiError) {
      console.error('Gemini fallback also failed:', geminiError);
    }

    return {
      cleanedDescription: transcribedText,
      suggestedTitle: extractSimpleTitle(transcribedText),
    };
  }
}

/**
 * Clean up transcription via Google Gemini API (fallback)
 */
async function cleanupViaGemini(
  transcribedText: string
): Promise<{ cleanedDescription: string; suggestedTitle: string }> {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const prompt = createCleanupPrompt(transcribedText);

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 1000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('No content in Gemini response');
  }

  console.log('✅ Gemini cleanup fallback succeeded');
  return parseCleanupResponse(content);
}

/**
 * Create the prompt for text cleanup and title generation
 */
function createCleanupPrompt(transcribedText: string): string {
  return `You are a helpful assistant for Australian tradies. Clean up the following voice-transcribed job description and generate a concise job title. The cleaned description will appear on an invoice sent to the customer, so it must be written professionally. Do NOT add any details, claims, or information that are not present in the original text.

Transcribed Text: "${transcribedText}"

Tasks:
1. Fix any transcription errors or unclear phrases
2. Rewrite the description in a professional, customer-facing tone suitable for an invoice
3. Keep all important details (measurements, materials, locations, etc.) but do not invent or add any new details
4. Generate a short, professional job title (3-7 words)

Provide a JSON response with this structure:
{
  "cleanedDescription": "The cleaned and formatted description",
  "suggestedTitle": "Short Job Title"
}

Return ONLY valid JSON, no other text.`;
}

/**
 * Parse the cleanup response
 */
function parseCleanupResponse(content: string): { cleanedDescription: string; suggestedTitle: string } {
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
      cleanedDescription: parsed.cleanedDescription || '',
      suggestedTitle: parsed.suggestedTitle || '',
    };
  } catch (error) {
    console.error('Failed to parse cleanup response:', error);
    throw new Error('Invalid response from LLM');
  }
}

/**
 * Extract a simple title from text as fallback
 */
function extractSimpleTitle(text: string): string {
  // Take first sentence or first 50 chars, whichever is shorter
  const firstSentence = text.split(/[.!?]/)[0];
  const title = firstSentence.length > 50 ? firstSentence.substring(0, 47) + '...' : firstSentence;
  return title || 'Custom Job';
}
