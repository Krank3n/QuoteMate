/**
 * LLM Service - Uses Claude API to analyze job descriptions
 * Generates materials lists from natural language descriptions
 */

import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from '@env';
import { Material } from '../types';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';
// Lazy-import FileSystem (only available on native)
let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
}

// All platforms route through Firebase Functions so API keys stay server-side.
// Direct API keys are still used for secondary features (email gen, cleanup, etc.)
// Always use production URL unless explicitly running emulator
const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const GEMINI_LITE_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';


interface LLMMaterial {
  name: string;
  searchTerm: string;
  quantity: number;
  unit: string;
  reasoning?: string;
  section?: string;
  sectionMultiplier?: number;
  // Per-unit labour hours for this material's section. The LLM is asked to populate
  // this in the prompt; if it omits it (LLMs are unreliable), MaterialsListScreen
  // falls back to distributing analysis.estimatedHours across sections by multiplier.
  sectionLaborHours?: number;
  // Set by LLM when matched to a user's saved supplier rate.
  savedRateName?: string;
  pricingSource?: string;
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
    // Template-guided fields
    templateName?: string;
    promptQuestions?: string[];
    aiContext?: string;
    estimatedHoursRange?: { min: number; max: number };
  },
  photoUrls?: string[],
  existingMaterials?: { name: string; quantity: number; unit: string; section?: string }[],
  availableTemplates?: { name: string; materials: { name: string; quantity: number; unit: string }[]; laborHours: number }[],
  userSavedRates?: Array<{
    name: string;
    store?: string;
    unit: string;
    price: number;
    coveragePerUnit?: number;
    coverageUnit?: string;
    keywords?: string[];
    notes?: string;
  }>
): Promise<LLMResponse> {
  // All platforms route through Firebase Functions so API keys stay server-side
  return analyzeViaFirebaseFunction(jobDescription, tradeContext, photoUrls, existingMaterials, availableTemplates, userSavedRates);
}

/**
 * Analyze job description via Firebase Cloud Function
 * All platforms use this path so API keys stay server-side.
 */
async function analyzeViaFirebaseFunction(
  jobDescription: string,
  tradeContext?: {
    categoryName?: string;
    nicheName?: string;
    suggestedMaterials?: string[];
    pricingMethod?: string;
    selectedStore?: string;
    // Template-guided fields
    templateName?: string;
    promptQuestions?: string[];
    aiContext?: string;
    estimatedHoursRange?: { min: number; max: number };
  },
  photoUrls?: string[],
  existingMaterials?: { name: string; quantity: number; unit: string; section?: string }[],
  availableTemplates?: { name: string; materials: { name: string; quantity: number; unit: string }[]; laborHours: number }[],
  userSavedRates?: Array<{
    name: string;
    store?: string;
    unit: string;
    price: number;
    coveragePerUnit?: number;
    coverageUnit?: string;
    keywords?: string[];
    notes?: string;
  }>
): Promise<LLMResponse> {
  // Convert local photo URIs to base64 for sending to the server
  let photoBase64: string[] | undefined;
  if (photoUrls?.length && Platform.OS !== 'web' && FileSystem) {
    photoBase64 = [];
    for (const uri of photoUrls) {
      try {
        const base64Data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        photoBase64.push(base64Data);
      } catch (err) {
        // silently ignore failed photo read
      }
    }
  }

  // Single attempt — the server already handles Gemini → Claude fallback internally,
  // so client-side retries just produce duplicate admin failure emails.
  const idToken = await auth.currentUser?.getIdToken();
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/analyzeJobDescription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      jobDescription,
      tradeContext,
      photoBase64,
      existingMaterials,
      availableTemplates,
      userSavedRates,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API returned ${response.status}`);
  }

  const data = await response.json();
  return {
    materials: data.materials || [],
    estimatedHours: data.estimatedHours || 8,
    jobSummary: data.jobSummary || '',
  };
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
        temperature: 0.2,
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
    // Template-guided fields
    templateName?: string;
    promptQuestions?: string[];
    aiContext?: string;
    estimatedHoursRange?: { min: number; max: number };
  },
  existingMaterials?: { name: string; quantity: number; unit: string; section?: string }[],
  availableTemplates?: { name: string; materials: { name: string; quantity: number; unit: string }[]; laborHours: number }[]
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

    // Template-guided context
    if (tradeContext.templateName) {
      contextSection += `\n\nJob Type: ${tradeContext.templateName}`;
    }
    if (tradeContext.promptQuestions && tradeContext.promptQuestions.length > 0) {
      contextSection += `\n\nThe user was prompted to mention these details:\n${tradeContext.promptQuestions.map(q => `- ${q}`).join('\n')}`;
      contextSection += '\n\nExtract these details from the description where mentioned, and use them to generate accurate material quantities and labor estimates.';
    }
    if (tradeContext.aiContext) {
      contextSection += `\n\nExpert context for this job type:\n${tradeContext.aiContext}`;
    }
    if (tradeContext.estimatedHoursRange) {
      contextSection += `\n\nExpected hours range: ${tradeContext.estimatedHoursRange.min}-${tradeContext.estimatedHoursRange.max} hours`;
    }
  }

  // Determine which store will be used for pricing
  const selectedStore = tradeContext?.selectedStore || 'bunnings';
  let storeName = 'Bunnings';
  if (selectedStore === 'mitre10') storeName = 'Mitre 10';
  if (selectedStore === 'reece') storeName = 'Reece';
  if (selectedStore === 'bunnings') storeName = 'Bunnings';

  let existingMaterialsSection = '';
  if (existingMaterials && existingMaterials.length > 0) {
    const materialsList = existingMaterials.map(m =>
      `- ${m.quantity} ${m.unit} of ${m.name}${m.section ? ` (${m.section})` : ''}`
    ).join('\n');
    existingMaterialsSection = `\n\nIMPORTANT - The following materials are ALREADY included in this quote (loaded from templates). Do NOT include these or similar items again. Only suggest ADDITIONAL materials that are missing:\n${materialsList}\n`;
  }

  let templateReferenceSection = '';
  if (availableTemplates && availableTemplates.length > 0) {
    const templateDescriptions = availableTemplates.map((t, i) => {
      const matList = t.materials.slice(0, 8).map(m => `${m.quantity}x ${m.name}`).join(', ');
      return `${i + 1}. "${t.name}" — Materials: ${matList} | Labor: ${t.laborHours}hrs`;
    }).join('\n');
    templateReferenceSection = `\n\nSAVED TEMPLATES (use as reference for section names and materials when they match the job):\n${templateDescriptions}\n\nWhen a saved template closely matches a section of this job:\n- Use the template's exact name as the section name\n- Use the template's material names where applicable (you can adjust quantities)\n- Set the sectionMultiplier to match the job scope\n`;
  }

  return `You are an expert Australian tradie assistant specializing in construction and trade work. ${existingMaterials && existingMaterials.length > 0 ? 'Some materials have already been added from templates. Analyze the job and suggest only the ADDITIONAL materials needed to complete the job.' : 'Analyze the following job description and generate a detailed materials list with generic search terms that work across multiple hardware stores.'}

Job Description: "${jobDescription}"${contextSection}${existingMaterialsSection}${templateReferenceSection}

Hardware Store for pricing: ${storeName}

Provide a JSON response with the following structure:
{
  "jobSummary": "Short job title, 3-7 words max (e.g. 'Deck Construction', 'Bathroom Renovation', 'Timber Fence Installation')",
  "estimatedHours": 8,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Generic product search term (material type, size, specs - NOT brand-specific)",
      "quantity": 2,
      "unit": "each|m|L|kg|box|pack",
      "section": "Descriptive section name (e.g. Colorbond Fence Bay, Merbau Deck Section, Concrete Footings)",
      "sectionMultiplier": 8,
      "sectionLaborHours": 1.5,
      "reasoning": "Why this material is needed"
    }
  ]
}

- "sectionLaborHours" is the estimated labor hours PER UNIT of that section (e.g. 1.5 hours per fence bay). All materials in the same section should have the same sectionLaborHours value. The sum of (sectionLaborHours × sectionMultiplier) across all sections should roughly equal estimatedHours.

Guidelines:
- Group materials into REPEATING WORK UNITS where possible. Identify the smallest repeating unit for each section (e.g. one fence bay, one square metre of decking, one staircase riser).
- For each section, specify materials with PER-UNIT quantities and a "sectionMultiplier" for how many units the job needs. Example: a 20m fence with 2.4m bays → each material has per-bay quantity, sectionMultiplier = 9.
- Non-repeating items (one-off materials like a single gate latch) should have sectionMultiplier: 1.
- Use descriptive section names that include context from the job (e.g. "Colorbond Fence Bay" not just "Fencing", "Merbau Deck Section" not just "Decking").
- All materials in the same section MUST have the same sectionMultiplier value.
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

EXAMPLE 1 — Repeating sections:
Job: "20m colorbond fence 1.8m high"
{
  "jobSummary": "Colorbond Fence Installation",
  "estimatedHours": 16,
  "materials": [
    { "name": "Steel Fence Post 50x50 2.4m", "searchTerm": "steel fence post 50x50 2400mm", "quantity": 2, "unit": "each", "section": "Colorbond Fence Bay", "sectionMultiplier": 9, "sectionLaborHours": 1.5, "reasoning": "2 posts per 2.4m bay, 20m / 2.4m ≈ 9 bays" },
    { "name": "Colorbond Fence Sheet 1.8m", "searchTerm": "colorbond fence sheet 1800mm", "quantity": 3, "unit": "each", "section": "Colorbond Fence Bay", "sectionMultiplier": 9, "sectionLaborHours": 1.5, "reasoning": "3 sheets per bay width" },
    { "name": "Post Cap 50x50", "searchTerm": "fence post cap 50x50mm", "quantity": 1, "unit": "each", "section": "Colorbond Fence Bay", "sectionMultiplier": 9, "sectionLaborHours": 1.5, "reasoning": "1 cap per post per bay" },
    { "name": "Concrete Mix 20kg", "searchTerm": "concrete mix 20kg bag", "quantity": 2, "unit": "each", "section": "Concrete Footings", "sectionMultiplier": 10, "sectionLaborHours": 0.25, "reasoning": "2 bags per post hole, 10 posts total" }
  ]
}

EXAMPLE 2 — Single section (no repeating unit):
Job: "Install garden gate with latch"
{
  "jobSummary": "Garden Gate Installation",
  "estimatedHours": 3,
  "materials": [
    { "name": "Timber Garden Gate 900mm", "searchTerm": "timber garden gate 900mm", "quantity": 1, "unit": "each", "section": "Garden Gate", "sectionMultiplier": 1, "sectionLaborHours": 3, "reasoning": "Single gate" },
    { "name": "Gate Hinges Heavy Duty", "searchTerm": "gate hinges heavy duty pair", "quantity": 1, "unit": "pack", "section": "Garden Gate", "sectionMultiplier": 1, "sectionLaborHours": 3, "reasoning": "One pair of hinges" },
    { "name": "Gate Latch", "searchTerm": "gate latch lockable", "quantity": 1, "unit": "each", "section": "Garden Gate", "sectionMultiplier": 1, "sectionLaborHours": 3, "reasoning": "Single latch for the gate" }
  ]
}

Return ONLY valid JSON, no other text.`;
}

const VALID_UNITS = ['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack'];

/**
 * Find the most common value in an array
 */
function mode(arr: number[]): number {
  const freq = new Map<number, number>();
  let maxCount = 0;
  let modeVal = arr[0];
  for (const v of arr) {
    const count = (freq.get(v) || 0) + 1;
    freq.set(v, count);
    if (count > maxCount) {
      maxCount = count;
      modeVal = v;
    }
  }
  return modeVal;
}

/**
 * Validate and sanitize LLM materials output
 */
function validateMaterials(materials: LLMMaterial[]): LLMMaterial[] {
  const filtered = materials
    // Remove items missing required fields or with bad quantities
    .filter(m => m.name && m.searchTerm && m.quantity > 0)
    // Clamp and normalise values
    .map(m => ({
      ...m,
      quantity: Math.min(Math.max(Math.round(m.quantity), 1), 999),
      sectionMultiplier: m.sectionMultiplier
        ? Math.min(Math.max(Math.round(m.sectionMultiplier), 1), 200)
        : undefined,
      unit: VALID_UNITS.includes(m.unit) ? m.unit : 'each',
    }));

  // Enforce consistent multiplier per section
  const sectionMultipliers = new Map<string, number>();
  for (const m of filtered) {
    if (!m.section) continue;
    const existing = sectionMultipliers.get(m.section);
    if (!existing) {
      const sectionMats = filtered.filter(x => x.section === m.section);
      const multipliers = sectionMats.map(x => x.sectionMultiplier || 1);
      sectionMultipliers.set(m.section, mode(multipliers));
    }
  }

  return filtered
    .map(m => {
      if (!m.section) return m;
      return { ...m, sectionMultiplier: sectionMultipliers.get(m.section) };
    })
    // Deduplicate very similar names within same section
    .filter((m, i, arr) => {
      const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const earlier = arr.slice(0, i).find(
        x => x.section === m.section && normalise(x.name) === normalise(m.name)
      );
      return !earlier;
    });
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
      materials: validateMaterials(parsed.materials || []),
      estimatedHours: Math.max(1, Math.min(parsed.estimatedHours || 8, 200)),
      jobSummary: parsed.jobSummary || '',
    };
  } catch (error) {
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
    // Try Gemini fallback
    try {
      return await generateEmailViaGemini(prompt);
    } catch (geminiError) {
      // Gemini fallback also failed
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
Total: $${total.toFixed(2)} (inc GST)
Business: ${businessName}
Client: ${customerName}${photosSection}

Guidelines:
- Write 2-3 short paragraphs summarising the scope of work
- Be professional but friendly, in plain Australian English
- Mention key materials/work areas without listing every item
- Be strictly factual - do NOT add any details, claims, or promises not in the description
- Do NOT include pricing (it's shown separately in the email template)
- Do NOT include specific labour hours or timeframes — just mention that labour is included
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
 * Generate a professional email body for sending an invoice to a client
 * Pro only - free users get a clean default template
 */
export async function generateInvoiceEmail(params: {
  jobName: string;
  jobDescription: string;
  materials: { name: string; quantity: number; unit: string }[];
  laborHours: number;
  total: number;
  businessName: string;
  customerName: string;
  dueDate: string;
  invoiceNumber?: string;
}): Promise<string> {
  const { jobName, jobDescription, materials, laborHours, total, businessName, customerName, dueDate, invoiceNumber } = params;

  const materialsSummary = materials.slice(0, 10).map(m => `${m.name} (${m.quantity} ${m.unit})`).join(', ');

  const prompt = `You are writing a professional email body for an Australian tradie sending an invoice to their client. Write ONLY the email body text (no subject line, no greeting, no sign-off - those are added separately).

Job: ${jobName}
Description: ${jobDescription}
Key materials: ${materialsSummary}
Labour: ${laborHours} hours
Total: $${total.toFixed(2)} (inc GST)
Business: ${businessName}
Client: ${customerName}
${invoiceNumber ? `Invoice #: ${invoiceNumber}` : ''}
Payment due: ${new Date(dueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}

Guidelines:
- Write 2-3 short paragraphs about the completed work and payment
- Be professional but friendly, in plain Australian English
- Mention the work has been completed (or is ready for invoicing)
- Be strictly factual - do NOT add any details not in the description
- Do NOT include pricing or due dates (they're shown separately in the email template)
- Do NOT include greetings or sign-offs (they're added by the template)
- Keep it concise - under 120 words

Return ONLY the email body text, no JSON wrapping or quotes.`;

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
    try {
      return await generateEmailViaGemini(prompt);
    } catch (geminiError) {
      // Gemini fallback also failed
    }

    return getDefaultInvoiceEmailBody(customerName, jobName, total, businessName, dueDate);
  }
}

/**
 * Default invoice email body for free users (no AI)
 */
export function getDefaultInvoiceEmailBody(
  customerName: string,
  jobName: string,
  total: number,
  businessName: string,
  dueDate: string
): string {
  const dueDateFormatted = new Date(dueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Please find attached your invoice for ${jobName}.\n\nThis invoice covers all materials and labour for the completed work as agreed. The total amount is $${total.toFixed(2)} (inc GST).\n\nPayment is due by ${dueDateFormatted}. If you have any questions about this invoice, please don't hesitate to get in touch.`;
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
export function convertLLMMaterialsToMaterials(llmMaterials: LLMMaterial[]): (Partial<Material> & { sectionMultiplier?: number; sectionLaborHours?: number; savedRateName?: string })[] {
  return llmMaterials.map((m) => {
    const multiplier = m.sectionMultiplier || 1;
    return {
      name: m.name,
      searchTerm: m.searchTerm,
      templateBaseQuantity: multiplier > 1 ? m.quantity : undefined,
      quantity: Math.round(m.quantity * multiplier * 1000) / 1000,
      unit: m.unit as Material['unit'],
      price: 0,
      totalPrice: 0,
      manualPriceOverride: false,
      ...(m.section && { section: m.section }),
      ...(m.savedRateName && { savedRateName: m.savedRateName }),
      sectionMultiplier: multiplier,
      ...(m.sectionLaborHours && m.sectionLaborHours > 0 && { sectionLaborHours: m.sectionLaborHours }),
    };
  });
}

/**
 * Clean up transcribed text and generate a job title
 * @param transcribedText - Raw text from voice transcription
 * @returns Cleaned description and suggested title
 */
export interface TemplateMatchInput {
  id: string;
  name: string;
  description?: string;
  materialCount: number;
  laborSummary: string;
}

export interface TemplateSuggestionResult {
  templateId: string;
  templateName: string;
  suggestedQuantity: number;
  reasoning: string;
}

export async function cleanupTranscriptionAndGenerateTitle(
  transcribedText: string,
  templates?: TemplateMatchInput[]
): Promise<{ cleanedDescription: string; suggestedTitle: string; templateSuggestions?: TemplateSuggestionResult[] }> {
  // On web, use Firebase Functions
  if (Platform.OS === 'web') {
    return cleanupViaFirebaseFunction(transcribedText);
  }

  // On mobile, try Gemini Flash Lite first (fast + cheap), then Claude as fallback
  try {
    return await cleanupViaGemini(transcribedText, templates, true);
  } catch (geminiError) {

    // Try Claude as fallback
    if (ANTHROPIC_API_KEY) {
      try {
        const prompt = createCleanupPrompt(transcribedText, templates);

        const response = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 1500,
            temperature: 0.2,
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
        return parseCleanupResponse(content);
      } catch (claudeError) {
        // Claude fallback also failed
      }
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
    // Try Gemini as fallback
    try {
      return await cleanupViaGemini(transcribedText);
    } catch (geminiError) {
      // Gemini fallback also failed
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
  transcribedText: string,
  templates?: TemplateMatchInput[],
  useLiteModel: boolean = false
): Promise<{ cleanedDescription: string; suggestedTitle: string; templateSuggestions?: TemplateSuggestionResult[] }> {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const prompt = createCleanupPrompt(transcribedText, templates);
  const apiUrl = useLiteModel ? GEMINI_LITE_API_URL : GEMINI_API_URL;

  const response = await fetch(`${apiUrl}?key=${GEMINI_API_KEY}`, {
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
        temperature: 0.2,
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

  return parseCleanupResponse(content);
}

/**
 * Create the prompt for text cleanup and title generation
 */
function createCleanupPrompt(transcribedText: string, templates?: TemplateMatchInput[]): string {
  let templateSection = '';
  if (templates && templates.length > 0) {
    const templateList = templates.map((t, i) =>
      `${i + 1}. "${t.name}" (ID: ${t.id}) - ${t.materialCount} materials${t.description ? `, ${t.description}` : ''}, ${t.laborSummary}`
    ).join('\n');
    templateSection = `

Also, the user has these saved job templates. Analyze the job description and determine which templates are relevant and how many of each are needed:
${templateList}

For each relevant template, calculate the quantity based on the job scope (e.g. if the job is "20m fence" and a template covers ~2.4m per bay, suggest ~9). Only include templates that are actually relevant to this job.

Include in your response:
"templateSuggestions": [
  { "templateId": "the-template-id", "suggestedQuantity": <number>, "reasoning": "Brief explanation of quantity calculation" }
]
If no templates are relevant, return "templateSuggestions": []`;
  }

  return `You are a helpful assistant for Australian tradies. Clean up the following voice-transcribed job description and generate a concise job title. The cleaned description will appear on an invoice sent to the customer, so it must be written professionally. Do NOT add any details, claims, or information that are not present in the original text.

Transcribed Text: "${transcribedText}"

Tasks:
1. Fix any transcription errors or unclear phrases
2. Rewrite the description in a professional, customer-facing tone suitable for an invoice
3. Keep all important details (measurements, materials, locations, etc.) but do not invent or add any new details
4. Generate a short, professional job title (3-7 words)${templateSection}

Provide a JSON response with this structure:
{
  "cleanedDescription": "The cleaned and formatted description",
  "suggestedTitle": "Short Job Title"${templates && templates.length > 0 ? ',\n  "templateSuggestions": [{ "templateId": "...", "suggestedQuantity": 1, "reasoning": "..." }]' : ''}
}

Return ONLY valid JSON, no other text.`;
}

/**
 * Parse the cleanup response
 */
function parseCleanupResponse(content: string): { cleanedDescription: string; suggestedTitle: string; templateSuggestions?: TemplateSuggestionResult[] } {
  try {
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr);

    // Parse template suggestions if present
    let templateSuggestions: TemplateSuggestionResult[] | undefined;
    if (parsed.templateSuggestions && Array.isArray(parsed.templateSuggestions)) {
      templateSuggestions = parsed.templateSuggestions
        .filter((s: any) => s.templateId && s.suggestedQuantity > 0)
        .map((s: any) => ({
          templateId: s.templateId,
          templateName: s.templateName || '',
          suggestedQuantity: Math.max(1, Math.round(s.suggestedQuantity)),
          reasoning: s.reasoning || '',
        }));
    }

    return {
      cleanedDescription: parsed.cleanedDescription || '',
      suggestedTitle: parsed.suggestedTitle || '',
      templateSuggestions,
    };
  } catch (error) {
    throw new Error('Invalid response from LLM');
  }
}

/**
 * Standalone template matching — used when description cleanup was skipped.
 * Lightweight AI call that just matches templates to the job description.
 */
export async function matchTemplatesToJob(
  jobDescription: string,
  templates: TemplateMatchInput[]
): Promise<TemplateSuggestionResult[]> {
  if (!ANTHROPIC_API_KEY || templates.length === 0) return [];

  const templateList = templates.map((t, i) =>
    `${i + 1}. "${t.name}" (ID: ${t.id}) - ${t.materialCount} materials${t.description ? `, ${t.description}` : ''}, ${t.laborSummary}`
  ).join('\n');

  const prompt = `You are a helpful assistant for Australian tradies. Given this job description and available templates, determine which templates are relevant and how many of each are needed.

Job Description: "${jobDescription}"

Available Templates:
${templateList}

For each relevant template, calculate the quantity based on the job scope. Only include templates that are actually relevant.

Return ONLY valid JSON, no explanation text:
{
  "templateSuggestions": [
    { "templateId": "actual-template-id", "suggestedQuantity": 1, "reasoning": "Brief explanation" }
  ]
}`;

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
        max_tokens: 500,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const content = data.content[0].text;

    // Robust JSON extraction — find the JSON object anywhere in the response
    let jsonStr = content.trim();
    // Strip markdown code blocks
    jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    // Try to find a JSON object with templateSuggestions
    const jsonMatch = jsonStr.match(/\{[\s\S]*"templateSuggestions"[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
    if (!parsed.templateSuggestions || !Array.isArray(parsed.templateSuggestions)) return [];

    return parsed.templateSuggestions
      .filter((s: any) => s.templateId && s.suggestedQuantity > 0)
      .map((s: any) => ({
        templateId: s.templateId,
        templateName: s.templateName || '',
        suggestedQuantity: Math.max(1, Math.round(s.suggestedQuantity)),
        reasoning: s.reasoning || '',
      }));
  } catch (error) {
    return [];
  }
}

/**
 * Extract supplier price list from PDF or photos via Firebase Function.
 * Mirrors the proxy / retry pattern used by analyzeJobDescription.
 */
export interface ExtractedSupplierItem {
  name: string;
  price: number;
  unit: string;
  coveragePerUnit?: number;
  coverageUnit?: 'm²' | 'm³' | 'm';
  keywords?: string[];
  confidence?: 'high' | 'medium' | 'low';
  rawLine?: string;
}

export interface ExtractedSupplierContact {
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
}

export interface SupplierExtractionResponse {
  supplierName: string;
  supplierContact?: ExtractedSupplierContact | null;
  items: ExtractedSupplierItem[];
}

export async function extractSupplierPriceList(
  payload: {
    pdfBase64?: string;
    imageBase64?: string[];
    supplierName?: string;
    defaultUnit?: string;
  },
  retryCount: number = 3,
): Promise<SupplierExtractionResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/extractSupplierPriceList`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API returned ${response.status}`);
      }

      const data = await response.json();
      return {
        supplierName: data.supplierName || payload.supplierName || '',
        supplierContact:
          data.supplierContact && typeof data.supplierContact === 'object'
            ? data.supplierContact
            : null,
        items: Array.isArray(data.items) ? data.items : [],
      };
    } catch (error) {
      lastError = error as Error;
      if (attempt < retryCount - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(lastError?.message || 'Failed to extract price list after multiple attempts');
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
