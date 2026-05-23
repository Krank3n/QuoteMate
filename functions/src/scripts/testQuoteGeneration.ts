/* eslint-disable no-console */
/**
 * Standalone harness that calls Gemini with the SAME prompt the production
 * `analyzeJobDescription` cloud function uses, then runs the response through
 * the equivalent of `convertLLMMaterialsToMaterials` + the new section-
 * multiplier logic from MaterialsListScreen. Reports the multipliers Gemini
 * emitted and what labor/material totals each test case would compute to.
 *
 * Run: npx ts-node functions/src/scripts/testQuoteGeneration.ts
 * Requires GEMINI_API_KEY in functions/.env
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const CLAUDE_MODEL = 'claude-opus-4-6';
const DEFAULT_LABOR_RATE = 85;

type LLMMaterial = {
  name: string;
  searchTerm?: string;
  quantity: number;
  unit: string;
  section?: string;
  sectionMultiplier?: number;
  sectionLaborHours?: number;
  reasoning?: string;
};

type LLMResponse = {
  jobSummary?: string;
  estimatedHours?: number;
  materials: LLMMaterial[];
};

type ConvertedMaterial = {
  name: string;
  quantity: number;
  unit: string;
  section?: string;
  sectionMultiplier: number;
  sectionLaborHours?: number;
};

type Section = {
  name: string;
  multiplier: number;
  laborHours: number;
  laborUnit: 'hours' | 'days';
  laborRate: number;
  laborTotal: number;
};

function buildPrompt(jobDescription: string, storeName = 'Bunnings'): string {
  // Mirror of the prompt in functions/src/index.ts (kept in sync manually).
  return `You are an expert Australian tradie assistant specializing in construction and trade work. Analyze the following job description and generate a detailed materials list with generic search terms that work across multiple hardware stores.

Job Description: "${jobDescription}"

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
      "unit": "each|m|m²|m³|L|kg|box|pack",
      "section": "Descriptive section name (e.g. Colorbond Fence Bay, Merbau Deck Section, Concrete Footings)",
      "sectionMultiplier": 1,
      "sectionLaborHours": 1.5,
      "reasoning": "Why this material is needed AND the derivation math for any per-area, per-volume, or repeating-unit quantity (e.g. 'Pavers: 25m² ÷ 0.16m²-per-paver × 1.1 waste = 172'). For simple one-off items a short justification is fine."
    }
  ]
}

- "sectionLaborHours" is the estimated labor hours PER UNIT of that section (e.g. 1.5 hours per fence bay). All materials in the same section should have the same sectionLaborHours value. The sum of (sectionLaborHours × sectionMultiplier) across all sections should roughly equal estimatedHours.

CRITICAL — emit quantities in the SMALLEST PHYSICAL UNIT, not in guessed packs/bags:
- Screws / nails / clips / fasteners → emit the individual count and unit "each".
- BULK AGGREGATES → emit TOTAL MASS in kg with unit "kg".
- SHEET / ROLL MATERIALS sold by area → emit total area in m² with unit "m²".
- Timber / decking / fascia → emit linear metres and unit "m".
- Paint / oil / sealer → emit total litres and unit "L".

DO NOT set sectionMultiplier equal to a material's own quantity — sectionMultiplier is the count of repeating WORK UNITS (bays, footings, square metres of deck), not the count of items.

SANITY-CHECK every quantity before returning. For ANY job in ANY trade, derive each quantity from a structural anchor — never guess:
- REPEATING LINEAR ELEMENTS (joists, posts, studs): count = ceil(span / centres) + 1.
- PER-AREA ELEMENTS (tiles, sheets, pavers): count = area × density.
- ONE-PER-UNIT ITEMS: count = N units × items_per_unit (usually 1-3).
- FASTENERS / CONSUMABLES: tie to a structural anchor.

Guidelines:
- Group materials into REPEATING WORK UNITS where possible.
- For each section, specify materials with PER-UNIT quantities and a "sectionMultiplier" for how many units the job needs.
- Non-repeating items should have sectionMultiplier: 1.
- All materials in the same section MUST have the same sectionMultiplier value.
- Use GENERIC product terms suitable for ${storeName}.
- Be realistic with quantities - round up for waste (typically 10-15% extra).

Return ONLY valid JSON, no other text.`;
}

async function callGemini(apiKey: string, prompt: string): Promise<LLMResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No content in Gemini response');
  return JSON.parse(content);
}

async function callClaude(apiKey: string, prompt: string): Promise<LLMResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('No content in Claude response');
  // Claude may wrap JSON in markdown fences or append trailing text.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Extract just the outermost JSON object.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in Claude response');
  return JSON.parse(candidate.slice(start, end + 1));
}

// Mirror of convertLLMMaterialsToMaterials in src/services/llmService.ts
function convertMaterials(llmMaterials: LLMMaterial[]): ConvertedMaterial[] {
  return llmMaterials.map((m) => {
    const multiplier = m.sectionMultiplier || 1;
    const finalQuantity = Math.round(m.quantity * multiplier * 1000) / 1000;
    return {
      name: m.name,
      quantity: finalQuantity,
      unit: m.unit,
      section: m.section,
      sectionMultiplier: multiplier,
      sectionLaborHours: m.sectionLaborHours,
    };
  });
}

// Mirror of the FIXED section-multiplier logic from MaterialsListScreen.
function buildSections(materials: ConvertedMaterial[], estimatedHours: number): Section[] {
  const candidates = new Map<string, Set<number>>();
  const sectionLaborHours = new Map<string, number>();

  materials.forEach((m) => {
    if (m.section) {
      const candidate = m.sectionMultiplier && m.sectionMultiplier > 0 ? m.sectionMultiplier : 1;
      const set = candidates.get(m.section) || new Set<number>();
      set.add(candidate);
      candidates.set(m.section, set);
    }
    if (m.section && m.sectionLaborHours && m.sectionLaborHours > 0) {
      sectionLaborHours.set(m.section, m.sectionLaborHours);
    }
  });

  const sectionMultipliers = new Map<string, number>();
  candidates.forEach((set, sectionName) => {
    const values = Array.from(set);
    sectionMultipliers.set(sectionName, Math.min(...values));
  });

  const totalMultipliers = Array.from(sectionMultipliers.values()).reduce((a, b) => a + b, 0);
  const fallbackPerUnitHours = totalMultipliers > 0 ? (estimatedHours || 8) / totalMultipliers : 1;

  const sections: Section[] = [];
  sectionMultipliers.forEach((multiplier, sectionName) => {
    const perUnitHours = sectionLaborHours.get(sectionName) || fallbackPerUnitHours;
    const useDays = perUnitHours >= 5;
    const laborRate = useDays ? DEFAULT_LABOR_RATE * 8 : DEFAULT_LABOR_RATE;
    const laborHoursValue = useDays ? perUnitHours / 8 : perUnitHours;
    sections.push({
      name: sectionName,
      multiplier,
      laborHours: laborHoursValue,
      laborUnit: useDays ? 'days' : 'hours',
      laborRate,
      laborTotal: laborHoursValue * laborRate * multiplier,
    });
  });

  return sections;
}

type TestCase = {
  description: string;
  expectations: {
    laborBallpark: [number, number]; // expected labor cost range (AUD)
    notes: string;
  };
};

const TEST_CASES: TestCase[] = [
  {
    description: '6m2 bathroom renovation',
    expectations: {
      laborBallpark: [2000, 8000],
      notes: 'Original bug case. Single bathroom, so multipliers should mostly be 1. Labor in $2-8k range for ~40h.',
    },
  },
  {
    description: 'repair two plaster holes 100mm each',
    expectations: {
      laborBallpark: [50, 200],
      notes: 'Known-good simple job. Expect 1-2 sections, multiplier 1 or 2, labor ~$100.',
    },
  },
  {
    description: '20m colorbond fence with 2.4m bays, no gate',
    expectations: {
      laborBallpark: [800, 2000],
      notes: 'Legitimately repeating: ~9 bays. Sections should have multiplier 9. Labor 1-2k.',
    },
  },
  {
    description: 'build a 5x4m merbau deck on existing concrete slab',
    expectations: {
      laborBallpark: [2000, 6000],
      notes: 'Per-area work, 20 m². Multiplier might be 20 (per m²) or 1 (whole deck).',
    },
  },
  {
    description: 'install 6 downlights in lounge ceiling',
    expectations: {
      laborBallpark: [300, 900],
      notes: 'Repeating units: 6 downlights. Multiplier 6 expected.',
    },
  },
];

function summarize(jobDescription: string, llm: LLMResponse, expected: TestCase['expectations']): void {
  const converted = convertMaterials(llm.materials || []);
  const sections = buildSections(converted, llm.estimatedHours || 8);
  const laborTotal = sections.reduce((sum, s) => sum + s.laborTotal, 0);

  // Per-section multiplier audit
  const rawByMaterial = (llm.materials || []).map((m) => ({
    name: m.name,
    section: m.section,
    qty: m.quantity,
    rawMultiplier: m.sectionMultiplier,
  }));
  const perSectionMultipliers = new Map<string, Set<number>>();
  rawByMaterial.forEach((m) => {
    if (m.section) {
      const set = perSectionMultipliers.get(m.section) || new Set<number>();
      set.add(m.rawMultiplier ?? 1);
      perSectionMultipliers.set(m.section, set);
    }
  });

  console.log('═'.repeat(80));
  console.log(`JOB: ${jobDescription}`);
  console.log(`Job summary: ${llm.jobSummary} | estimatedHours: ${llm.estimatedHours}`);
  console.log('─'.repeat(80));
  console.log(`SECTIONS (${sections.length}):`);
  sections.forEach((s) => {
    const raw = perSectionMultipliers.get(s.name);
    const rawStr = raw ? Array.from(raw).join(',') : '?';
    const flag = raw && raw.size > 1 ? ' ⚠️ MIXED' : '';
    console.log(
      `  • ${s.name.padEnd(40)} mult=${s.multiplier} (raw: [${rawStr}])${flag}  ` +
      `${s.laborHours.toFixed(2)} ${s.laborUnit} × $${s.laborRate} = $${s.laborTotal.toFixed(2)}`,
    );
  });

  console.log('─'.repeat(80));
  console.log(`MATERIALS (${converted.length}):`);
  converted.slice(0, 30).forEach((m) => {
    console.log(`  • ${m.name.padEnd(45)} ${String(m.quantity).padStart(8)} ${m.unit.padEnd(4)}  (raw qty × mult=${m.sectionMultiplier})`);
  });
  if (converted.length > 30) console.log(`  ... and ${converted.length - 30} more`);

  console.log('─'.repeat(80));
  console.log(`LABOR TOTAL: $${laborTotal.toFixed(2)}`);
  console.log(`EXPECTED RANGE: $${expected.laborBallpark[0]} - $${expected.laborBallpark[1]}`);
  const inRange = laborTotal >= expected.laborBallpark[0] && laborTotal <= expected.laborBallpark[1];
  console.log(`VERDICT: ${inRange ? '✅ in range' : '❌ out of range'}`);
  console.log(`NOTES: ${expected.notes}`);
  console.log('═'.repeat(80));
  console.log('');
}

async function main(): Promise<void> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey && !claudeKey) {
    console.error('No GEMINI_API_KEY or ANTHROPIC_API_KEY set. Source functions/.env first.');
    process.exit(1);
  }

  for (const tc of TEST_CASES) {
    try {
      const prompt = buildPrompt(tc.description);
      let llm: LLMResponse | null = null;
      let provider = '';
      if (geminiKey) {
        try {
          llm = await callGemini(geminiKey, prompt);
          provider = 'gemini';
        } catch (err: any) {
          console.warn(`  ↳ Gemini failed (${err.message.slice(0, 60)}); falling back to Claude`);
        }
      }
      if (!llm && claudeKey) {
        llm = await callClaude(claudeKey, prompt);
        provider = 'claude';
      }
      if (!llm) throw new Error('Both providers failed');
      console.log(`(via ${provider})`);
      summarize(tc.description, llm, tc.expectations);
    } catch (err: any) {
      console.error(`FAILED: "${tc.description}" — ${err.message}`);
      console.error('');
    }
  }
}

main().catch((err) => {
  console.error('Test harness failed:', err);
  process.exit(1);
});
