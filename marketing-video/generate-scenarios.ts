/**
 * Scenario generator — turns each niche template into a marketing-video scenario.
 *
 * Derives the structural fields from the template (trade, params, jobDescription
 * = exampleLines, materials via backend pricing later) and LLM-generates the
 * natural Aussie tradie <-> Mate conversation + two-voice voiceover + a Veo
 * backdrop. Writes scenarios/<templateId>.json.
 *
 *   tsx generate-scenarios.ts [slug ...]      (default: all templates)
 *   tsx generate-scenarios.ts --force         (overwrite existing)
 *
 * Reads GEMINI_API_KEY from ../../functions/.env.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NicheJobTemplate } from '../src/data/nicheTemplates';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
const SCEN = join(ROOT, 'scenarios');
const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.GEN_MODEL || 'gemini-2.5-flash';

// Niches already hand-authored as polished heroes — don't regenerate.
const SKIP = new Set(['fence_install_colorbond', 'door_hanging', 'led_downlight_pack']);

let NICHE_TEMPLATES: NicheJobTemplate[];
async function loadTemplates(): Promise<void> {
  const m: any = await import('../src/data/nicheTemplates');
  NICHE_TEMPLATES = m.NICHE_TEMPLATES ?? m.default?.NICHE_TEMPLATES;
}

function geminiKey(): string {
  const env = readFileSync(resolve(ROOT, '..', 'functions', '.env'), 'utf8');
  const key = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.replace(/['"\r]/g, '').trim();
  if (!key) throw new Error('GEMINI_API_KEY not found in functions/.env');
  return key;
}

const CATEGORY_NAMES: Record<string, string> = {
  electrical: 'Electrical', plumbing: 'Plumbing', carpentry: 'Carpentry',
  cabinet_making: 'Cabinetry', landscape_gardening: 'Landscaping', painting: 'Painting',
  flooring: 'Flooring', hvac: 'Air Conditioning', pest_control: 'Pest Control',
  cleaning: 'Cleaning', roofing: 'Roofing', other: 'Trades',
};
const INDOOR = new Set(['electrical', 'plumbing', 'cabinet_making', 'flooring', 'painting', 'cleaning', 'pest_control']);

const SUBURBS = ['Brunswick', 'Coburg', 'Thornbury', 'Preston', 'Northcote', 'Reservoir', 'Footscray', 'Yarraville', 'Moonee Ponds', 'Essendon', 'Pascoe Vale', 'Fitzroy North', 'Carnegie', 'Bentleigh', 'Hampton'];
const POSTCODES = ['3056', '3058', '3071', '3072', '3070', '3073', '3011', '3013', '3039', '3040', '3044', '3068', '3163', '3204', '3188'];
const CUSTOMERS = ['Sam Whitlock', 'Priya Nand', 'Daniel Okafor', 'Elise Carter', 'Marco Bianchi', 'Hayley Dorn', 'Liam Brooks', 'Aisha Khan', 'Tom Reilly', 'Mia Donnelly', 'Jack Forsyth', 'Nadia Rahman', 'Cooper Vance', 'Ruby Saleh', 'Ben Trent'];

function rot<T>(arr: T[], i: number): T { return arr[i % arr.length]; }

interface Convo {
  request: string; mateAck: string; clarifyingQuestion: string; clarifyingAnswer: string; reveal: string;
  vo: { ask: string; reply: string; answer: string; reveal: string; pdf: string };
  setting: string;
}

async function genConvo(t: NicheJobTemplate, key: string): Promise<Convo> {
  const cat = CATEGORY_NAMES[t.categoryId] || 'Trades';
  const indoorHint = INDOOR.has(t.categoryId)
    ? 'an indoor home interior (e.g. a hallway, kitchen, living room) appropriate to the job'
    : 'an outdoor residential job site appropriate to the job (e.g. a backyard, driveway, roofline) — not just a plain lawn';
  const prompt =
    `You are scripting a ~50s marketing demo for "QuoteMate", an Australian tradie quoting app whose assistant is called "Mate".\n` +
    `Trade: ${cat} — ${t.name}.\n` +
    `The customer's job (scope): "${t.exampleLines || t.description}".\n` +
    `Must-ask clarifying questions the app would check: "${t.questionsLine || ''}".\n\n` +
    `Write a SHORT, natural conversation between a TRADIE (asking Mate for a quote) and MATE (the assistant), plus a voiceover script.\n` +
    `Rules: authentically Australian, warm and casual, gender-neutral (no "guys/blokes/mate-y" clichés overused), NEVER use the word "AI". Keep each line to ONE sentence. In the voiceover, SPELL OUT all numbers and units (e.g. "twenty-two metres", "ninety mil", "six hundred millimetres").\n\n` +
    `Return ONLY JSON with this exact shape:\n` +
    `{"request":"","mateAck":"","clarifyingQuestion":"","clarifyingAnswer":"","reveal":"","vo":{"ask":"","reply":"","answer":"","reveal":"","pdf":""},"setting":""}\n` +
    `- request: the tradie casually asks Mate for the quote.\n` +
    `- mateAck: exactly "Good one. I'll sort a ${t.name} quote for you now."\n` +
    `- clarifyingQuestion: Mate asks the key must-have(s) in one line, opening with a VARIED phrase (rotate, don't always use "Quick one") such as "Righto —", "Just to confirm —", "Let me get this right —", "Cool —".\n` +
    `- clarifyingAnswer: the tradie answers that question naturally.\n` +
    `- reveal: starts "Here's the quote — " then a one-line summary of what's included.\n` +
    `- vo.ask = the request text. vo.reply = mateAck + " " + clarifyingQuestion (numbers spelled out). vo.answer = the clarifyingAnswer (numbers spelled out). vo.reveal = a spoken one-line "Here's your quote — ..." summary. vo.pdf = exactly "And there's the full quote — real prices, every line itemised, ready to send. Too easy."\n` +
    `- setting: a short Veo backdrop describing the tradie ${indoorHint}.`;

  const res = await fetch(`${API}/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`gen ${t.id} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  const c = JSON.parse(text) as Convo;
  if (!c.request || !c.vo?.reply || !c.setting) throw new Error(`gen ${t.id}: incomplete JSON`);
  return c;
}

function buildScenario(t: NicheJobTemplate, c: Convo, i: number): any {
  const cat = CATEGORY_NAMES[t.categoryId] || 'Trades';
  const suburb = rot(SUBURBS, i);
  const postcode = rot(POSTCODES, i);
  const slugWord = t.name.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 10);
  const params: Record<string, number> = {};
  for (const p of (t.requiredParams ?? [])) params[p.key] = p.defaultValue as number;
  return {
    slug: t.id,
    title: `${t.name} quote, real prices, under a minute`,
    trade: { categoryId: t.categoryId, nicheId: t.nicheId, categoryName: cat, nicheName: t.name },
    templateId: t.id,
    params,
    jobDescription: t.exampleLines || t.description,
    labour: { rate: 90, unit: 'hours', hoursOverride: null, materialMarkupPercent: 30, laborMarkupPercent: 0 },
    customer: { name: rot(CUSTOMERS, i), address: `${suburb} VIC ${postcode}` },
    business: {
      businessName: `${suburb} ${cat}`,
      phone: `04${String(10 + (i % 89))} ${String(100 + (i * 7) % 900)} ${String(100 + (i * 13) % 900)}`,
      email: `jobs@${slugWord}${suburb.toLowerCase().replace(/\s/g, '')}.com.au`,
      abn: `${10 + (i % 89)} ${String(100 + (i * 3) % 900)} ${String(100 + (i * 9) % 900)} ${String(100 + (i * 11) % 900)}`,
      address: `${suburb} VIC ${postcode}`,
      pdfTemplate: 'bold',
      brandColor: '#0a0f1a',
    },
    workingDetail: (t.suggestedMaterials ?? []).slice(0, 4).join(', ') || 'Materials, fixings and hardware',
    conversation: {
      request: c.request,
      mateAck: c.mateAck,
      clarifyingQuestion: c.clarifyingQuestion,
      clarifyingAnswer: c.clarifyingAnswer,
      matePricing: 'Sweet — pricing it up now with live supplier rates…',
      reveal: c.reveal,
    },
    presenter: { intro: 'request', answer: 'clarifyingAnswer', reaction: "That's the lot — real prices and everything. Sorted.", setting: c.setting },
    voiceover: {
      voices: { tradie: 'Charon', mate: 'Puck' },
      lines: {
        ask: { voice: 'tradie', text: c.vo.ask },
        reply: { voice: 'mate', text: c.vo.reply },
        answer: { voice: 'tradie', text: c.vo.answer },
        reveal: { voice: 'mate', text: c.vo.reveal },
        pdf: { voice: 'tradie', text: c.vo.pdf },
      },
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.filter((a) => !a.startsWith('--'));
  await loadTemplates();
  const key = geminiKey();
  mkdirSync(SCEN, { recursive: true });

  let list = NICHE_TEMPLATES.filter((t) => !SKIP.has(t.id));
  if (only.length) list = list.filter((t) => only.includes(t.id));

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const out = join(SCEN, `${t.id}.json`);
    if (existsSync(out) && !force) { console.log(`= skip ${t.id} (exists)`); skip++; continue; }
    try {
      let c: Convo | null = null;
      for (let attempt = 1; attempt <= 3 && !c; attempt++) {
        try { c = await genConvo(t, key); } catch (e) {
          if (attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
      writeFileSync(out, JSON.stringify(buildScenario(t, c!, i), null, 2));
      console.log(`✓ ${t.id}  (${CATEGORY_NAMES[t.categoryId]} — ${t.name})`);
      ok++;
    } catch (e) {
      console.warn(`✗ ${t.id}: ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`\nscenarios: ${ok} written, ${skip} skipped, ${fail} failed (of ${list.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
