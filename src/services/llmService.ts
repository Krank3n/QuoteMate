/**
 * LLM Service - Uses Claude API to analyze job descriptions
 * Generates materials lists from natural language descriptions
 */

import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from '@env';
import { Material, FloorplanAnalysis } from '../types';
import { normaliseFloorplanAnalysis } from './floorplanNormalise';
import { clampMaterialQuantity } from '../../shared/ai/validateAiOutput';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';
// Lazy-import FileSystem (only available on native). try/catch so the module
// stays importable where the native package can't load (e.g. unit tests) —
// every use site already null-guards.
let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS !== 'web') {
  try {
    FileSystem = require('expo-file-system');
  } catch {
    FileSystem = null;
  }
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
  // Quality tier inferred from the job description. Drives candidate
  // selection in materialsPipeline (see candidateRanker.pickBestCandidate)
  // — e.g. "premium" pushes the picker toward the high end of the price
  // band instead of always grabbing the cheapest scraper hit.
  qualityTier?: 'budget' | 'standard' | 'premium';
  // Per-unit labour hours for this material's section. The LLM is asked to populate
  // this in the prompt; if it omits it (LLMs are unreliable), MaterialsListScreen
  // falls back to distributing analysis.estimatedHours across sections by multiplier.
  sectionLaborHours?: number;
  // Set by LLM when matched to a user's saved supplier rate.
  savedRateName?: string;
  pricingSource?: string;
  // Set by the analyzeJobDescription backend when the LLM matched this row
  // directly to a Reece catalogue product (Phase 2 price-file flow). When
  // present, price/reeceItemNumber/pricingSource are pre-stamped server-side
  // so the client's pricing pass skips the search round trip.
  reeceProductId?: number;
  reeceItemNumber?: string;
  price?: number;
  imageUrl?: string;
}

interface LLMResponse {
  materials: LLMMaterial[];
  estimatedHours: number;
  jobSummary: string;
  // Overall quality tier inferred from the job description. Falls back to
  // 'standard' on the consumer side when undefined. Inherited by any
  // material that didn't get an explicit qualityTier of its own.
  jobQualityTier?: 'budget' | 'standard' | 'premium';
  // Geometry read off an attached architectural plan, when one is detected
  // among the photos. Undefined for ordinary site photos / no photos.
  floorplanAnalysis?: FloorplanAnalysis;
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

/** Read a Blob's bytes as a bare base64 string (no data: prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a photo URL to base64, cross-platform:
 *  - native + local file:// → read directly off disk (fast, no network)
 *  - remote https (Firebase Storage) or web blob/data URL → fetch the bytes
 * Returns null on failure so one bad photo doesn't sink the whole request.
 */
async function photoUrlToBase64(url: string): Promise<string | null> {
  try {
    if (Platform.OS !== 'web' && FileSystem && url.startsWith('file://')) {
      return await FileSystem.readAsStringAsync(url, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    const res = await fetch(url);
    const blob = await res.blob();
    return await blobToBase64(blob);
  } catch {
    return null;
  }
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
  // Photos reach the server two ways, both handled here AND on web:
  //  - remote https (Firebase Storage) URLs → send as `photoUrls`; the function
  //    fetches the bytes server-side. Avoids browser CORS on the web app and
  //    means no large base64 payloads from the client.
  //  - local file:// URIs (rare — pre-upload) → convert to base64 here (native).
  // The old path was native-only + FileSystem-only, so it never ran on web and
  // silently dropped the remote Storage URLs quote photos actually use.
  let photoBase64: string[] | undefined;
  let remotePhotoUrls: string[] | undefined;
  if (photoUrls?.length) {
    const remote = photoUrls.filter(u => /^https?:\/\//i.test(u));
    const local = photoUrls.filter(u => !/^https?:\/\//i.test(u));
    if (remote.length) remotePhotoUrls = remote;
    if (local.length) {
      const converted = await Promise.all(local.map(photoUrlToBase64));
      const usable = converted.filter((b): b is string => !!b);
      if (usable.length) photoBase64 = usable;
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
      photoUrls: remotePhotoUrls,
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
  // Apply the same client-side validation we run on the Gemini fallback path.
  // The server doesn't dedupe or sanity-check sectionMultiplier values, so
  // without this pass a sentinel-equal-quantity multiplier (e.g. 100 for "100
  // bags concrete") would slip through and blow up section labour totals.
  const jobQualityTier =
    data.jobQualityTier === 'budget' ||
    data.jobQualityTier === 'standard' ||
    data.jobQualityTier === 'premium'
      ? data.jobQualityTier
      : undefined;
  const floorplanAnalysis = normaliseFloorplanAnalysis(data.floorplanAnalysis);
  return {
    materials: validateMaterials(data.materials || []),
    estimatedHours: Math.max(1, Math.min(data.estimatedHours || 8, 200)),
    jobSummary: data.jobSummary || '',
    ...(jobQualityTier && { jobQualityTier }),
    ...(floorplanAnalysis && { floorplanAnalysis }),
  };
}

// Coercion lives in a pure, dependency-free module so it stays unit-testable
// without dragging react-native/firebase into the test runner. Re-exported
// here for existing callers.
export { normaliseFloorplanAnalysis };

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
      "qualityTier": "budget|standard|premium",
      "reasoning": "Why this material is needed"
    }
  ],
  "jobQualityTier": "budget|standard|premium"
}

RESPECT THE JOB DESCRIPTION — NAMED MATERIALS AND QUANTITIES ARE MANDATORY:
- If the job description explicitly names a material (a product type, spec, R-value, grade, brand, colour, or dimension — e.g. "R2.5 HD thermal insulation batts", "90x45 H3 treated pine", "Colorbond Surfmist sheets"), that material MUST appear as a line item with the exact spec the tradie wrote, unless it is already in the existing materials listed above. NEVER drop a named primary material and return only consumables, fasteners, or PPE.
- If the job description states a quantity for a material (e.g. "12 batts", "6 sheets", "20 litres"), use EXACTLY that quantity and unit — do not recompute, round, or override it.
- If a material is named but no quantity is given, derive the quantity from the area, length, or count in the description using its coverage (e.g. "10 m² of R2.5 batts" → batt pack coverage → packs needed) and show the derivation in "reasoning".
- The named primary material is the core of the job — supporting items (fasteners, tape, PPE, blades) are ADDITIONAL to it, never a substitute for it.

EXCLUSIONS AND REPLACEMENT-ONLY SCOPE ARE HARD CONSTRAINTS:
- Treat phrases such as "only", "no ... included", "do not quote", "exclude", "existing ... to remain", and "condition unknown" as binding scope limits. Never add the excluded work as a precaution or assumption.
- Surface replacement is NOT a rebuild. If the scope says decking boards only / no subfloor structure, do NOT include posts, footings, concrete, bearers, joists, framing screws, weed mat, fascia, or other subfloor materials.
- Include every explicitly requested supporting cost/item: demolition labour, rubbish removal, tip/disposal fees, fixings/clips, blades and other named consumables. A demolition/disposal section may use the explicit tip/disposal allowance as its row and carry the demolition sectionLaborHours.
- Do not emit builder's margin, markup or GST as material rows — the app applies those after materials and labour.

DECK-BOARD REPLACEMENT CHECK:
- Derive board quantity from deck area, installed board cover width (board width + gap), available stock length and sensible cutting layout, then add only 10–15% waste. State the calculation in reasoning.
- Hidden clips/fixings must be derived from deck area or joist intersections and emitted as individual each-counts; the pricing layer converts them into packs.
- Keep demolition/disposal labour separate from installation labour when both are requested.

- "sectionLaborHours" is the estimated labor hours PER UNIT of that section (e.g. 1.5 hours per fence bay). All materials in the same section should have the same sectionLaborHours value. The sum of (sectionLaborHours × sectionMultiplier) across all sections should roughly equal estimatedHours.

QUALITY TIER DETECTION — read the job description for tier qualifiers and set both "jobQualityTier" (top-level, one per job) and "qualityTier" (per-material, inherits jobQualityTier when omitted). This is what makes the pricing layer pick the RIGHT product out of the supplier search results instead of always grabbing the cheapest hit:
- "premium", "high quality", "high-end", "luxury", "designer", "architectural", "top of the range", "custom", brand names like Phoenix/Miele/Fisher & Paykel → jobQualityTier: "premium". Search terms for fittings/finishes in these jobs should include words like "premium" or "professional" (e.g. "premium stainless steel undermount sink", not just "sink").
- "budget", "cheap", "basic", "entry level", "investment property", "rental fit-out" → jobQualityTier: "budget".
- Anything else, or no signal at all → jobQualityTier: "standard".
- Per-material override: when only SOME items are called out as premium (e.g. "high quality fittings and sink" in an otherwise standard reno), set qualityTier: "premium" on just those rows (taps, mixers, sinks, handles, hinges) and leave the rest standard. The rule of thumb: which line items would a customer notice if they were cheap? Those carry the called-out tier.
- Cabinetry/joinery descriptors map to tier too: "custom timber cabinetry", "solid timber doors", "marble benchtop", "stone benchtop", "engineered stone" all imply premium for those rows even if the job header doesn't say "premium".

CRITICAL — emit quantities in the SMALLEST INDIVIDUAL UNIT, not in guessed packs:
- Screws / nails / clips / fasteners → emit the individual count and unit "each" (e.g. 750 each, NOT "1 pack").
- Concrete / sand / cement → emit the count of bags and unit "each" (e.g. 20 each for 20 bags).
- Timber/decking/fascia sold as continuous coverage → emit linear metres and unit "m" (e.g. 75 m).
- Discrete structural members that cannot be safely spliced from offcuts (posts, studs, joists, rafters, beams, steel RHS/SHS gate rails/posts) → emit the required piece count and unit "each", and include the required member length in the name/searchTerm (e.g. "14 each 65x65 galvanised steel post 2.4m", not "25.2 m steel post").
- Tape sold by length → emit linear metres and unit "m" (e.g. 50 m).
- Membrane / sarking / building wrap / vapour barrier / geotextile → emit covered area and unit "m²" (e.g. 58 m²), not roll count.
- Sheet goods (plasterboard, fibre cement, villaboard, cladding sheets, plywood) → emit required covered area and unit "m²" unless the tradie explicitly gave a sheet count.
- Paint / oil / sealer → emit total litres and unit "L" (e.g. 8 L).
The pricing layer reads pack/length size from the product page (e.g. "Box of 500", "5.4m length", "20m roll") and computes how many packs to buy. If you guess pack counts yourself you will get them wrong — you have no way to know how many clips are in a pack.

DO NOT use units "pack" or "box" in the materials output unless the item is genuinely sold and counted as discrete packs (e.g. one mixed wall-plug pack). Default to "each", "m", "kg", or "L".

DO NOT set sectionMultiplier equal to a material's own quantity — sectionMultiplier is the count of repeating WORK UNITS (bays, footings, square metres of deck), not the count of items.

SANITY-CHECK every quantity before returning. The most common failure is over-spec'ing repeating elements by 3-10×. For ANY job in ANY trade, derive each quantity from a structural anchor — never guess:

- REPEATING LINEAR ELEMENTS (deck joists, fence posts, wall studs, ceiling battens, roof rafters): count = ceil(span / centres) + 1. A 5m-wide deck with joists at 450mm = 12 joists, NOT 60. A 30m fence at 2.4m bays = 13 posts, NOT 30. Because these are discrete structural members, output them as each with member length; do NOT pool total metres and assume offcuts can be spliced.
- PER-AREA ELEMENTS (decking clips, tiles, plasterboard sheets, paving, downlights, GPOs): count = area × density. Hidden deck clips ~17/m². 600x600 tiles ~2.78/m². Don't multiply density by 5.
- LINEAR MATERIAL FROM AREA (decking boards, weatherboard, cladding): linear metres = area / board_width. 50m² of 137mm decking = ~365 lm, NOT 1000+.
- ONE-PER-UNIT ITEMS (hinges per door, taps per basin, downpipes per roof side, post stirrups per post): count = N units × items_per_unit (usually 1-3).
- FASTENERS / CONSUMABLES: tie to a structural anchor too — nails per joist hanger × hangers, screws per metre of trim × metres, sealer at coverage rate × area. Never invent thousands.
- VOLUMETRIC (concrete bags, sand, gravel): bags = volume / bag_yield. A 0.054m³ footing = 3 × 20kg bags, NOT 12.

Round up by 10-15% for waste, not by 5-10×. After listing each material ask yourself: "Did I derive this from a structural anchor or did I guess?" If guessed, redo it.

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
- Include all materials/equipment explicitly requested in the scope, including hire/service rows like concrete pump, skip bin, disposal/tipping, fuel, stump grinder teeth/chains. These should be line items even if they will use fallback/trade estimates.
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
    // Remove items missing required fields or with bad quantities.
    // Retail items need a searchTerm to price; saved-rate and Reece-matched
    // rows are priced off savedRateName / reeceProductId and are told by the
    // prompt to leave searchTerm empty, so don't drop those for a blank term.
    .filter(
      m =>
        m.name &&
        m.quantity > 0 &&
        (m.searchTerm || m.savedRateName || m.pricingSource === 'saved_rate' || m.reeceProductId)
    )
    // Clamp and normalise values. Normalise the unit FIRST — the quantity
    // clamp is unit-aware, so an unrecognised unit has to fall back to 'each'
    // before we decide whether a fraction is meaningful.
    .map(m => {
      const unit = VALID_UNITS.includes(m.unit) ? m.unit : 'each';
      return {
        ...m,
        qualityTier:
          m.qualityTier === 'budget' || m.qualityTier === 'standard' || m.qualityTier === 'premium'
            ? m.qualityTier
            : undefined,
        quantity: clampMaterialQuantity(m.quantity, unit),
        sectionMultiplier: m.sectionMultiplier
          ? Math.min(Math.max(Math.round(m.sectionMultiplier), 1), 200)
          : undefined,
        unit,
      };
    });

  // Enforce consistent multiplier per section.
  //
  // The LLM occasionally duplicates a material's quantity into its
  // sectionMultiplier (e.g. emits "100 bags concrete" with multiplier=100),
  // which then gets picked up as the section's "how many work units" count.
  // That blew up section labour by 10×–100× in real quotes, so drop any
  // sectionMultiplier value that exactly equals its own quantity before
  // taking the mode.
  const sectionMultipliers = new Map<string, number>();
  for (const m of filtered) {
    if (!m.section) continue;
    const existing = sectionMultipliers.get(m.section);
    if (!existing) {
      const sectionMats = filtered.filter(x => x.section === m.section);
      const validVotes = sectionMats
        .filter(x => !(x.sectionMultiplier && x.sectionMultiplier === x.quantity))
        .map(x => x.sectionMultiplier || 1);
      const votes = validVotes.length > 0 ? validVotes : [1];
      sectionMultipliers.set(m.section, mode(votes));
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

    const jobQualityTier =
      parsed.jobQualityTier === 'budget' ||
      parsed.jobQualityTier === 'standard' ||
      parsed.jobQualityTier === 'premium'
        ? parsed.jobQualityTier
        : undefined;
    return {
      materials: validateMaterials(parsed.materials || []),
      estimatedHours: Math.max(1, Math.min(parsed.estimatedHours || 8, 200)),
      jobSummary: parsed.jobSummary || '',
      ...(jobQualityTier && { jobQualityTier }),
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
  gstRegistered?: boolean;
}): Promise<string> {
  const { jobName, total, businessName, customerName, gstRegistered } = params;

  const prompt = createEmailPrompt(params);

  // All platforms route through the Firebase Function. The client bundle
  // deliberately ships no LLM API keys (removed after the July 2026 key
  // leak), so a direct-API path here can never work on device — it silently
  // dropped every mobile Pro user to the generic template.
  try {
    return await generateEmailViaFirebaseFunction(prompt);
  } catch (error) {
    // Fallback - return a basic template
    return getDefaultEmailBody(customerName, jobName, total, businessName, gstRegistered);
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
  gstRegistered?: boolean;
}): string {
  const { jobName, jobDescription, materials, laborHours, total, businessName, customerName, photoDescriptions, gstRegistered } = params;

  let photosSection = '';
  if (photoDescriptions?.length) {
    photosSection = `\n\nSite photos have been attached showing: ${photoDescriptions.join('; ')}`;
  }

  const materialsSummary = materials.slice(0, 10).map(m => `${m.name} (${m.quantity} ${m.unit})`).join(', ');

  return `You are writing a professional email body for an Australian tradie sending a quote to their client. Write ONLY the email body text (no subject line, no greeting, no sign-off - those are added separately).

Job: ${jobName}
Description: ${jobDescription}
Key materials: ${materialsSummary}
Total: $${total.toFixed(2)}${gstRegistered === false ? '' : ' (inc GST)'}
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

/**
 * Written email body for a service report, matching what quotes and invoices
 * already get. Reports were the odd one out: the send flow handed the tradie
 * an empty note box, so a report either went out bare or the tradie wrote the
 * covering note themselves on a phone, on site.
 *
 * Grounded strictly in what they recorded on the visit — a report is a record
 * of work done, and a covering note that embellishes it is worse than none.
 */
export async function generateReportEmail(params: {
  businessName: string;
  customerName: string;
  serviceType: string;
  workCarriedOut?: string;
  recommendedWork?: string;
  natureOfProblem?: string;
}): Promise<string> {
  const { businessName, customerName, serviceType } = params;
  try {
    return await generateEmailViaFirebaseFunction(createReportEmailPrompt(params));
  } catch {
    return getDefaultReportEmailBody(customerName, serviceType, businessName);
  }
}

function createReportEmailPrompt(params: {
  businessName: string;
  customerName: string;
  serviceType: string;
  workCarriedOut?: string;
  recommendedWork?: string;
  natureOfProblem?: string;
}): string {
  const { businessName, customerName, serviceType, workCarriedOut, recommendedWork, natureOfProblem } = params;
  return `You are writing a short email body for an Australian tradie sending a completed service report to their client. Write ONLY the email body text (no subject line, no greeting, no sign-off - those are added separately).

Service: ${serviceType}
Business: ${businessName}
Client: ${customerName}
${natureOfProblem ? `Reported problem: ${natureOfProblem}` : ''}
${workCarriedOut ? `Work carried out: ${workCarriedOut}` : ''}
${recommendedWork ? `Recommended follow-up: ${recommendedWork}` : ''}

Guidelines:
- 1-2 short paragraphs. The full detail is in the attached report, so summarise, don't repeat it
- Plain Australian English, professional but not stiff
- Be strictly factual — describe only work recorded above. Never state that something was tested, cleared or found safe unless it says so
- If there is recommended follow-up, mention that it's noted in the report; do NOT quote a price or promise a timeframe
- Do NOT include greetings or sign-offs (the template adds them)
- Under 100 words

Return ONLY the email body text, no JSON wrapping or quotes.`;
}

/** Plain template used when generation is unavailable. */
export function getDefaultReportEmailBody(
  customerName: string,
  serviceType: string,
  businessName: string,
): string {
  return `Please find attached the service report from our recent visit${serviceType ? ` for ${serviceType.toLowerCase()}` : ''}.\n\nIt covers what was checked and the work carried out on the day, along with anything we've recommended following up. If you have any questions about it, get in touch.`;
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
  return stripLeadingGreeting(data.emailBody || '');
}

// The email template always renders "Hi {customerName}," above the body, so any
// greeting the model emits — despite being told not to — would double up. Also
// trips when a tradie writes their own greeting after the prefilled one. Match
// only a single leading greeting line; anything mid-body is left alone.
function stripLeadingGreeting(text: string): string {
  const greetingLine = /^\s*(hi|hello|hey|g'?day|dear|good (?:morning|afternoon|evening))\b[^\n]*[,!.:]?\s*\n+/i;
  return text.replace(greetingLine, '').trimStart();
}

/**
 * Default email body for free users (no AI)
 */
export function getDefaultEmailBody(
  customerName: string,
  jobName: string,
  total: number,
  businessName: string,
  gstRegistered?: boolean
): string {
  const totalSuffix = gstRegistered === false ? '' : ' (inc GST)';
  return `Please find attached your quotation for ${jobName}.\n\nThis quote includes all materials and labour required to complete the work as discussed. The total amount is $${total.toFixed(2)}${totalSuffix}.\n\nThis quote is valid for 30 days from the date of issue. If you have any questions, please don't hesitate to get in touch.`;
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
  gstRegistered?: boolean;
}): Promise<string> {
  const { jobName, jobDescription, materials, laborHours, total, businessName, customerName, dueDate, invoiceNumber, gstRegistered } = params;

  const materialsSummary = materials.slice(0, 10).map(m => `${m.name} (${m.quantity} ${m.unit})`).join(', ');

  const prompt = `You are writing a professional email body for an Australian tradie sending an invoice to their client. Write ONLY the email body text (no subject line, no greeting, no sign-off - those are added separately).

Job: ${jobName}
Description: ${jobDescription}
Key materials: ${materialsSummary}
Labour: ${laborHours} hours
Total: $${total.toFixed(2)}${gstRegistered === false ? '' : ' (inc GST)'}
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

  // All platforms route through the Firebase Function — see generateQuoteEmail.
  try {
    return await generateEmailViaFirebaseFunction(prompt);
  } catch (error) {
    return getDefaultInvoiceEmailBody(customerName, jobName, total, businessName, dueDate, gstRegistered);
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
  dueDate: string,
  gstRegistered?: boolean
): string {
  const dueDateFormatted = new Date(dueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const totalSuffix = gstRegistered === false ? '' : ' (inc GST)';
  return `Please find attached your invoice for ${jobName}.\n\nThis invoice covers all materials and labour for the completed work as agreed. The total amount is $${total.toFixed(2)}${totalSuffix}.\n\nPayment is due by ${dueDateFormatted}. If you have any questions about this invoice, please don't hesitate to get in touch.`;
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
export function convertLLMMaterialsToMaterials(llmMaterials: LLMMaterial[]): (Partial<Material> & { sectionMultiplier?: number; sectionLaborHours?: number; savedRateName?: string; qualityTier?: 'budget' | 'standard' | 'premium' })[] {
  return llmMaterials.map((m) => {
    const multiplier = m.sectionMultiplier || 1;
    let finalQuantity = Math.round(m.quantity * multiplier * 1000) / 1000;
    // Backstop against the per-unit × multiplier explosion, and the ONLY cap
    // that decides what gets stored. validateMaterials caps per-unit qty at
    // 5000 and the multiplier at 200 independently, so their PRODUCT can reach
    // 1M (real stored cases: 500 × 25 = 12,500 and 42,957 "each" decking
    // screws). Bulk units (kg/L/m/m²/m³) can legitimately be large, so only cap
    // discrete COUNT units; the downstream pack-aware + coverage passes then
    // collapse this to the real number of packs to buy.
    // Keep this in step with MAX_DISCRETE_QUANTITY in shared/ai/validateAiOutput:
    // the per-unit ceiling is deliberately set to this same value so a correct
    // whole-job count in a multiplier-1 section is never truncated on the way in.
    const COUNT_UNITS = ['each', 'pack', 'box'];
    if (COUNT_UNITS.includes(m.unit) && finalQuantity > 5000) {
      finalQuantity = 5000;
    }
    // When the backend has already resolved a Reece catalogue match, trust
    // the pre-stamped price/itemNumber/pricingSource — the reece pricing
    // pass in MaterialsListScreen skips materials that already carry these.
    const hasReeceMatch = m.pricingSource === 'api' && !!m.reeceItemNumber && typeof m.price === 'number' && m.price > 0;
    const unitPrice = hasReeceMatch ? (m.price as number) : 0;
    return {
      name: m.name,
      searchTerm: m.searchTerm,
      templateBaseQuantity: multiplier > 1 ? m.quantity : undefined,
      quantity: finalQuantity,
      unit: m.unit as Material['unit'],
      price: unitPrice,
      totalPrice: unitPrice * finalQuantity,
      manualPriceOverride: false,
      ...(m.section && { section: m.section }),
      ...(m.savedRateName && { savedRateName: m.savedRateName }),
      ...(hasReeceMatch && {
        reeceItemNumber: m.reeceItemNumber,
        pricingSource: 'api' as const,
        ...(m.imageUrl && { imageUrl: m.imageUrl }),
      }),
      sectionMultiplier: multiplier,
      ...(m.sectionLaborHours && m.sectionLaborHours > 0 && { sectionLaborHours: m.sectionLaborHours }),
      ...(m.qualityTier && { qualityTier: m.qualityTier }),
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

export interface PillSpecInput {
  id: string;
  label: string;
}

export type PillStateResult = Record<string, boolean>;

export async function cleanupTranscriptionAndGenerateTitle(
  transcribedText: string,
  templates?: TemplateMatchInput[],
  pillSpec?: PillSpecInput[]
): Promise<{ cleanedDescription: string; suggestedTitle: string; templateSuggestions?: TemplateSuggestionResult[]; pills?: PillStateResult }> {
  // Server first, on EVERY platform. The Anthropic key lives in Firebase
  // Functions, never in the app bundle — mobile used to go straight to Gemini
  // with a bundled key, and when that key was pulled from .env after the July
  // leak (see .env.backup-pre-key-removal) `allowUndefined: true` in
  // babel.config.js turned the import into `undefined` instead of failing the
  // build. Both client paths then threw, nobody noticed, and every job title
  // silently became extractSimpleTitle's truncation — which is what shipped to
  // customers on the PDF, the email subject and the PDF filename (QU-178692).
  try {
    return await callCleanupFunction(transcribedText, pillSpec);
  } catch (functionError) {
    // Server unreachable — fall through to the client-side ladder below.
  }

  // Legacy client-side paths. These only do anything when a key is present in
  // the bundle; they are kept so a build that still carries one kicks in
  // offline, and because Gemini is the only path that returns
  // templateSuggestions. Prefer deleting them once no such build is live.
  try {
    return await cleanupViaGemini(transcribedText, templates, true, pillSpec);
  } catch (geminiError) {
    // Gemini unavailable — try Claude.
  }

  if (ANTHROPIC_API_KEY) {
    try {
      const prompt = createCleanupPrompt(transcribedText, templates, pillSpec);

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

/**
 * Clean up transcription via the Firebase Cloud Function, which holds the
 * Anthropic key server-side. THROWS on any failure — the caller owns the
 * fallback ladder, so this must not quietly return a degraded result.
 */
async function callCleanupFunction(
  transcribedText: string,
  pillSpec?: PillSpecInput[]
): Promise<{ cleanedDescription: string; suggestedTitle: string; pills?: PillStateResult }> {
  const idToken = await auth.currentUser?.getIdToken();
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/cleanupTranscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ transcribedText, pillSpec }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API returned ${response.status}`);
  }

  const data = await response.json();
  // An empty title is a failed generation, not a valid answer — say so, so the
  // ladder moves on instead of handing the caller a title-less result.
  if (!isNonEmptyString(data.cleanedDescription) || !isNonEmptyString(data.suggestedTitle)) {
    throw new Error('cleanupTranscription returned an incomplete result');
  }
  return {
    cleanedDescription: data.cleanedDescription,
    suggestedTitle: data.suggestedTitle,
    pills: data.pills,
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Clean up transcription via Google Gemini API (fallback)
 */
async function cleanupViaGemini(
  transcribedText: string,
  templates?: TemplateMatchInput[],
  useLiteModel: boolean = false,
  pillSpec?: PillSpecInput[]
): Promise<{ cleanedDescription: string; suggestedTitle: string; templateSuggestions?: TemplateSuggestionResult[]; pills?: PillStateResult }> {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const prompt = createCleanupPrompt(transcribedText, templates, pillSpec);
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
        maxOutputTokens: 3000,
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
function createCleanupPrompt(transcribedText: string, templates?: TemplateMatchInput[], pillSpec?: PillSpecInput[]): string {
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

  let pillSection = '';
  if (pillSpec && pillSpec.length > 0) {
    const pillList = pillSpec.map((p, i) => `${i + 1}. id="${p.id}" — ${p.label}`).join('\n');
    pillSection = `

The tradie's checklist for this job type:
${pillList}

For each checklist item, decide whether the transcript supports it being part of THIS job. Mark true ONLY if the transcript clearly mentions the item or scope. Mark false if the tradie excludes it ("no oven", "skip windows", "not the bathroom") or doesn't mention it. Return one entry per checklist id.

Include in your response:
"pills": { "id_1": true|false, "id_2": true|false, ... }`;
  }

  return `You are a helpful assistant for Australian tradies. Clean up the following voice-transcribed job description and generate a concise job title. The cleaned description will appear on an invoice sent to the customer, so it must read professionally. Do NOT add any details, claims, or information that are not present in the original text.

Transcribed Text: "${transcribedText}"

Tasks:
1. Fix transcription errors, slang, filler words ("yeah", "so", "like", "reckon"), and unclear phrases
2. Preserve EVERY detail from the original — measurements, materials, locations, conditions, causes, customer remarks, brand names, colours, quantities, timeframes mentioned, and any qualifiers ("if", "when", "subject to"). Do NOT shorten, summarise, omit, or merge details. If the input is long, the cleaned output should be similarly long or longer. Word count is NOT a goal — completeness is. Your job is grammar, readability, and structure — not compression.
3. Format for readability on an invoice:
   - Use short paragraphs separated by blank lines for distinct phases or topics (e.g. existing condition, scope of work, materials, finish).
   - Where the work has a list of discrete items (multiple tasks, materials, or fixtures), use a bullet list with "- " at the start of each line.
   - Keep sentences plain and factual.
4. Do not invent details, do not add warranties, claims, or assurances that were not in the original.
5. Generate a short, professional job title (3-7 words)${templateSection}${pillSection}

Provide a JSON response with this structure:
{
  "cleanedDescription": "The cleaned and formatted description (use \\n for line breaks and \\n\\n between paragraphs)",
  "suggestedTitle": "Short Job Title"${templates && templates.length > 0 ? ',\n  "templateSuggestions": [{ "templateId": "...", "suggestedQuantity": 1, "reasoning": "..." }]' : ''}${pillSpec && pillSpec.length > 0 ? ',\n  "pills": { "id_1": true, "id_2": false }' : ''}
}

Return ONLY valid JSON, no other text.`;
}

/**
 * Parse the cleanup response
 */
function parseCleanupResponse(content: string): { cleanedDescription: string; suggestedTitle: string; templateSuggestions?: TemplateSuggestionResult[]; pills?: PillStateResult } {
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

    let pills: PillStateResult | undefined;
    if (parsed.pills && typeof parsed.pills === 'object' && !Array.isArray(parsed.pills)) {
      pills = {};
      for (const [k, v] of Object.entries(parsed.pills)) {
        pills[k] = !!v;
      }
    }

    return {
      cleanedDescription: parsed.cleanedDescription || '',
      suggestedTitle: parsed.suggestedTitle || '',
      templateSuggestions,
      pills,
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

// ---------------------------------------------------------------------------
// Reconcile priced materials — given each row's requirement and the matched
// product, ask Gemini Flash Lite to compute the right purchase count and
// total. Catches wrong-SKU matches and pack-as-unit-price bugs uniformly
// across trades, where regex parsing of pack info from titles can't.
// ---------------------------------------------------------------------------

export interface ReconcileCandidate {
  name?: string;
  price: number;
  url?: string;
  description?: string;
  /** Pack/volume size the price covers (e.g. 500 each, 10 L), when known.
   *  Lets the reconcile pass compute packs-needed instead of guessing. */
  packSize?: number;
  packUnit?: string;
}

export interface ReconcileItem {
  id: string;
  name: string;
  requirement: number;
  requirementUnit: string;
  /** Ranked candidates from the price search; reconciliation picks one (or rejects all). */
  candidates: ReconcileCandidate[];
}

export interface ReconcileResult {
  id: string;
  decision: 'apply' | 'estimate' | 'reject';
  chosenIndex?: number;
  /** Per-purchase price when decision='estimate' (no candidate matched). */
  estimatedUnitPrice?: number;
  /** Set only when the LLM deliberately corrected an inflated round-1
   *  requirement (REQUIREMENT SANITY). Same units as the stated requirement.
   *  The coverage floor uses this instead of requiredQty so legitimate
   *  corrections aren't undone. */
  correctedRequirement?: number;
  purchaseCount?: number;
  purchaseUnit?: string;
  totalPrice?: number;
  coverageNote?: string;
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  rejectReason?: string;
}

export async function reconcilePricedMaterials(
  items: ReconcileItem[],
  jobContext?: { jobName?: string; jobDescription?: string },
): Promise<ReconcileResult[]> {
  if (!items || items.length === 0) return [];
  const idToken = await auth.currentUser?.getIdToken();
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/reconcilePricedMaterials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      items,
      jobName: jobContext?.jobName,
      jobDescription: jobContext?.jobDescription,
    }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Reconcile API returned ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * Extract supplier price list from PDF or photos via Firebase Function.
 * Mirrors the proxy / retry pattern used by analyzeJobDescription.
 */
export interface ExtractedSupplierItem {
  name: string;
  price: number;
  unit: string;
  qty?: number;
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
    mode?: 'priceList' | 'invoice';
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
 * Model-assisted spreadsheet column mapping.
 *
 * For supplier price lists whose headers our deterministic auto-detect can't
 * confidently map (arbitrary 30-column exports, multi-column names, per-unit
 * prices), send ONLY the headers + a few sample rows to the backend, which
 * asks the model which columns hold what. Never uploads the whole file.
 *
 * Returns a best-guess mapping in the same shape as ColumnMapping (name may be
 * a single header or an ordered list of columns to compose). The caller still
 * shows the column mapper for confirmation — this only pre-fills it.
 */
export interface SuggestedColumnMapping {
  name?: string | string[];
  price?: string;
  unit?: string;
  qty?: string;
  coveragePerUnit?: string;
  coverageUnit?: string;
  keywords?: string;
  dimensions?: string | string[];
  itemNumber?: string;
  notes?: string | string[];
}

export async function suggestSupplierColumnMapping(payload: {
  headers: string[];
  sampleRows: Record<string, string>[];
}): Promise<SuggestedColumnMapping | null> {
  if (!payload.headers?.length) return null;
  try {
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/mapSupplierColumns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        headers: payload.headers,
        // Cap the sample so we never ship a 12,800-row file to the model.
        sampleRows: payload.sampleRows.slice(0, 20),
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const m = data?.mapping;
    if (!m || typeof m !== 'object') return null;
    // Only keep keys that name real headers (the model occasionally invents one).
    const valid = new Set(payload.headers);
    const keep = (v: unknown): string | string[] | undefined => {
      if (typeof v === 'string') return valid.has(v) ? v : undefined;
      if (Array.isArray(v)) {
        const cols = v.filter((h): h is string => typeof h === 'string' && valid.has(h));
        return cols.length ? cols : undefined;
      }
      return undefined;
    };
    const single = (v: unknown): string | undefined => {
      const k = keep(v);
      return typeof k === 'string' ? k : Array.isArray(k) ? k[0] : undefined;
    };
    return {
      name: keep(m.name),
      price: single(m.price),
      unit: single(m.unit),
      qty: single(m.qty),
      coveragePerUnit: single(m.coveragePerUnit),
      coverageUnit: single(m.coverageUnit),
      keywords: single(m.keywords),
      dimensions: keep(m.dimensions),
      itemNumber: single(m.itemNumber),
      notes: keep(m.notes),
    };
  } catch {
    return null;
  }
}

/**
 * Extract a simple title from text as fallback
 */
const TITLE_MAX_CHARS = 50;

/** Words a title must never end on — cutting mid-phrase leaves them dangling. */
const TRAILING_STOP_WORDS = new Set([
  // articles + conjunctions
  'a', 'an', 'the', 'and', 'or', 'but', 'plus', 'as', 'than', 'that', 'which',
  // copulas
  'is', 'was', 'are', 'were', 'be',
  // prepositions
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto',
  'over', 'under', 'near', 'up', 'down', 'out', 'off', 'about', 'around',
  'across', 'along', 'through', 'between', 'behind', 'beside', 'within',
  'against', 'during', 'including', 'per', 'via', 'upon', 'toward', 'towards',
]);

/**
 * Last-ditch title when every model path is unavailable.
 *
 * This runs far more often than "last-ditch" suggests, and whatever it returns
 * is printed on the customer's PDF, used as the email subject and baked into
 * the attachment filename. It used to be `substring(0, 47) + '...'`, so a real
 * quote went out titled "Replace the left boundary paling fence at a sin..."
 * (QU-178692). A truncation is acceptable; an obviously-broken one is not.
 *
 * So: cut on a word boundary, never mid-word, and never emit an ellipsis. Then
 * back off any trailing preposition/article run so the title reads as a phrase
 * ("…paling fence") rather than a severed one ("…fence at a single").
 */
function extractSimpleTitle(text: string): string {
  const firstSentence = (text.split(/[.!?\n]/)[0] || '').replace(/\s+/g, ' ').trim();
  if (!firstSentence) return 'Custom Job';
  // Short enough to use whole — nothing was severed, so nothing to repair.
  // "Construction of 2m x 4m Deck" keeps its "of".
  if (firstSentence.length <= TITLE_MAX_CHARS) return firstSentence.replace(/[\s,;:–—-]+$/, '');

  const words = firstSentence.split(' ');
  const kept: string[] = [];
  for (const word of words) {
    const candidate = kept.length === 0 ? word : `${kept.join(' ')} ${word}`;
    if (candidate.length > TITLE_MAX_CHARS) break;
    kept.push(word);
  }
  // A single word longer than the cap has no word boundary to cut on; a hard
  // slice is the only option left and still beats an ellipsis.
  if (kept.length === 0) return firstSentence.slice(0, TITLE_MAX_CHARS);

  return healSeveredTail(kept) || kept.join(' ');
}

/** How far back from the cut a dangling preposition can be and still be one. */
const SEVERED_TAIL_WINDOW = 3;

/**
 * Repair a phrase the length cut severed mid-clause.
 *
 * Only the last few words can be the damage: if a preposition or article sits
 * in that window, the clause it opened got cut off with it, so drop from there
 * — "…paling fence at a single" → "…paling fence". Words further back are load
 * bearing and stay put, which is why this looks at a window and not the whole
 * phrase ("Supply and install…" must not collapse to "Supply").
 *
 * Returns '' when nothing meaningful survives, so the caller keeps its cut.
 */
function healSeveredTail(words: string[]): string {
  let end = words.length;
  for (let i = Math.max(1, words.length - SEVERED_TAIL_WINDOW); i < words.length; i++) {
    if (TRAILING_STOP_WORDS.has(stripPunctuation(words[i]))) {
      end = i;
      break;
    }
  }
  const trimmed = words.slice(0, end).join(' ').replace(/[\s,;:–—-]+$/, '');
  // Never trim away the whole phrase or leave a bare stub.
  return end >= 2 && trimmed.length >= 3 ? trimmed : '';
}

function stripPunctuation(word: string): string {
  return word.replace(/[^a-z]/gi, '').toLowerCase();
}
