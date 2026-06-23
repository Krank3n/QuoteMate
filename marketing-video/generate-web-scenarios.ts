/**
 * Website-keyed scenario generator — one scenario per /templates/[slug] SEO page,
 * built from the template's OWN data (name, trade, materials, description) so each
 * page gets a video about its real topic. Backend pricing runs off the generated
 * jobDescription + the website trade context; the app templateId is only attached
 * for a valid lookup (labour comes from an LLM hoursOverride).
 *
 *   tsx generate-web-scenarios.ts [slug ...]      (default: all uncovered)
 *   tsx generate-web-scenarios.ts --force
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCEN = join(HERE, 'scenarios');
const WEB = '/Users/tom/Documents/GitHub/QuoteMateAppWebsite/seo/data.json';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.GEN_MODEL || 'gemini-2.5-flash';

// Exact matches already covered by the strict-21 renders — reuse those, don't regen.
const REUSE = new Set([
  'concrete-driveway-quote-template', 'end-of-lease-cleaning-quote-template',
  'gutter-replacement-quote-template', 'render-house-quote-template',
  'timber-floor-sanding-quote-template', 'wardrobe-fitout-quote-template',
  'plasterboard-installation-quote-template', 'termite-treatment-quote-template',
]);

function geminiKey(): string {
  const env = readFileSync(resolve(HERE, '..', 'functions', '.env'), 'utf8');
  const key = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.replace(/['"\r]/g, '').trim();
  if (!key) throw new Error('GEMINI_API_KEY not in functions/.env');
  return key;
}

const SUBURBS = ['Brunswick', 'Coburg', 'Thornbury', 'Preston', 'Northcote', 'Reservoir', 'Footscray', 'Yarraville', 'Moonee Ponds', 'Essendon', 'Pascoe Vale', 'Fitzroy North', 'Carnegie', 'Bentleigh', 'Hampton'];
const POSTCODES = ['3056', '3058', '3071', '3072', '3070', '3073', '3011', '3013', '3039', '3040', '3044', '3068', '3163', '3204', '3188'];
const CUSTOMERS = ['Sam Whitlock', 'Priya Nand', 'Daniel Okafor', 'Elise Carter', 'Marco Bianchi', 'Hayley Dorn', 'Liam Brooks', 'Aisha Khan', 'Tom Reilly', 'Mia Donnelly', 'Jack Forsyth', 'Nadia Rahman', 'Cooper Vance', 'Ruby Saleh', 'Ben Trent'];
const rot = <T,>(a: T[], i: number): T => a[i % a.length];

const INDOOR_TRADES = new Set(['electricians', 'plumbers', 'painters', 'tilers', 'cleaners', 'pest-controllers', 'flooring-installers', 'glaziers', 'cabinet-makers', 'renderers']);

interface Gen {
  jobDescription: string; hours: number;
  request: string; mateAck: string; clarifyingQuestion: string; clarifyingAnswer: string; reveal: string;
  vo: { ask: string; reply: string; answer: string; reveal: string; pdf: string };
  setting: string;
}

async function genFor(t: any, tradeName: string, key: string): Promise<Gen> {
  const indoor = INDOOR_TRADES.has(t.trade);
  const mats = (t.materials || []).slice(0, 6).join('; ');
  const prompt =
    `You are scripting a ~50s marketing demo for "QuoteMate", an Australian tradie quoting app whose assistant is "Mate".\n` +
    `Trade: ${tradeName}. Job type: ${t.name.replace(/ Quote Template$/i, '')}.\n` +
    `Typical materials for this job: ${mats}.\n` +
    `Context: ${(t.description || '').slice(0, 200)}.\n\n` +
    `Produce ONE realistic, specific Australian job for this trade and a demo script.\n` +
    `Rules: authentically Australian, warm, casual, gender-neutral, NEVER the word "AI". One sentence per line. In the voiceover SPELL OUT numbers/units ("six point six kay double-u", "twenty-two metres").\n\n` +
    `Return ONLY JSON:\n` +
    `{"jobDescription":"","hours":0,"request":"","mateAck":"","clarifyingQuestion":"","clarifyingAnswer":"","reveal":"","vo":{"ask":"","reply":"","answer":"","reveal":"","pdf":""},"setting":""}\n` +
    `- jobDescription: a detailed, specific scope WITH concrete quantities/sizes/specs (this is what gets priced — be precise, e.g. counts, square metres, linear metres, model/size).\n` +
    `- hours: realistic on-site labour hours (number) for this job.\n` +
    `- request: the tradie casually asks Mate for the quote.\n` +
    `- mateAck: exactly "Good one. I'll sort a ${t.name.replace(/ Quote Template$/i, '')} quote for you now."\n` +
    `- clarifyingQuestion: Mate asks the key must-have(s), opening with a VARIED phrase ("Righto —", "Just to confirm —", "Let me get this right —", "Cool —").\n` +
    `- clarifyingAnswer: the tradie answers naturally.\n` +
    `- reveal: starts "Here's the quote — " then a one-line summary.\n` +
    `- vo.ask=request; vo.reply=mateAck+" "+clarifyingQuestion; vo.answer=clarifyingAnswer; vo.reveal=spoken "Here's your quote — ..."; vo.pdf="And there's the full quote — real prices, every line itemised, ready to send. Too easy."\n` +
    `- setting: a short Veo backdrop with the tradie at ${indoor ? 'an indoor home interior suited to the job' : 'an outdoor residential job site suited to the job (not a plain lawn)'}.`;

  const res = await fetch(`${API}/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } }),
  });
  if (!res.ok) throw new Error(`${t.slug} -> ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  const g = JSON.parse(j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '') as Gen;
  if (!g.jobDescription || !g.vo?.reply || !g.setting) throw new Error(`${t.slug}: incomplete`);
  return g;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.filter((a) => !a.startsWith('--'));
  const data = JSON.parse(readFileSync(WEB, 'utf8'));
  const tradeName: Record<string, string> = {};
  for (const tr of (data.trades || [])) tradeName[tr.slug] = tr.name;
  const webMap: Record<string, string> = {};
  for (const m of JSON.parse(readFileSync(join(HERE, 'out', '_web_map.json'), 'utf8'))) webMap[m.web] = m.app;
  const key = geminiKey();
  mkdirSync(SCEN, { recursive: true });

  let list = data.quoteTemplates.filter((t: any) => !REUSE.has(t.slug));
  if (only.length) list = list.filter((t: any) => only.includes(t.slug));

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const out = join(SCEN, `${t.slug}.json`);
    if (existsSync(out) && !force) { console.log(`= skip ${t.slug}`); skip++; continue; }
    const appId = (webMap[t.slug] && webMap[t.slug] !== '-') ? webMap[t.slug] : 'pressure_clean';
    const tn = tradeName[t.trade] || 'Trades';
    try {
      let g: Gen | null = null;
      for (let a = 1; a <= 3 && !g; a++) {
        try { g = await genFor(t, tn, key); } catch (e) { if (a === 3) throw e; await new Promise((r) => setTimeout(r, 4000)); }
      }
      const suburb = rot(SUBURBS, i), pc = rot(POSTCODES, i);
      const sw = t.slug.replace(/-quote-template$/, '').replace(/-/g, '').slice(0, 12);
      const scenario = {
        slug: t.slug,
        title: `${t.name.replace(/ Quote Template$/i, '')} quote, real prices, under a minute`,
        trade: { categoryId: t.trade, nicheId: t.slug, categoryName: tn, nicheName: t.name.replace(/ Quote Template$/i, '') },
        templateId: appId,
        params: {},
        jobDescription: g!.jobDescription,
        labour: { rate: 90, unit: 'hours', hoursOverride: Math.max(1, Math.round(g!.hours || 4)), materialMarkupPercent: 30, laborMarkupPercent: 0 },
        customer: { name: rot(CUSTOMERS, i), address: `${suburb} VIC ${pc}` },
        business: {
          businessName: `${suburb} ${tn.replace(/s$/, '')}`,
          phone: `04${String(10 + (i % 89))} ${String(100 + (i * 7) % 900)} ${String(100 + (i * 13) % 900)}`,
          email: `jobs@${sw}${suburb.toLowerCase().replace(/\s/g, '')}.com.au`,
          abn: `${10 + (i % 89)} ${String(100 + (i * 3) % 900)} ${String(100 + (i * 9) % 900)} ${String(100 + (i * 11) % 900)}`,
          address: `${suburb} VIC ${pc}`, pdfTemplate: 'bold', brandColor: '#0a0f1a',
        },
        workingDetail: (t.materials || []).slice(0, 4).join(', ') || 'Materials, fixings and hardware',
        conversation: {
          request: g!.request, mateAck: g!.mateAck, clarifyingQuestion: g!.clarifyingQuestion,
          clarifyingAnswer: g!.clarifyingAnswer, matePricing: 'Sweet — pricing it up now with live supplier rates…', reveal: g!.reveal,
        },
        presenter: { intro: 'request', answer: 'clarifyingAnswer', reaction: "That's the lot — real prices and everything. Sorted.", setting: g!.setting },
        voiceover: {
          voices: { tradie: 'Charon', mate: 'Puck' },
          lines: {
            ask: { voice: 'tradie', text: g!.vo.ask }, reply: { voice: 'mate', text: g!.vo.reply },
            answer: { voice: 'tradie', text: g!.vo.answer }, reveal: { voice: 'mate', text: g!.vo.reveal }, pdf: { voice: 'tradie', text: g!.vo.pdf },
          },
        },
      };
      writeFileSync(out, JSON.stringify(scenario, null, 2));
      console.log(`✓ ${t.slug}  (${tn})`);
      ok++;
    } catch (e) { console.warn(`✗ ${t.slug}: ${(e as Error).message}`); fail++; }
  }
  console.log(`\nweb-scenarios: ${ok} written, ${skip} skipped, ${fail} failed (of ${list.length})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
