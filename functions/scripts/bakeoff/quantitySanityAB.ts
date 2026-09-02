/**
 * Paired eval for the quantity sanity pass.
 *
 * Real quotes shipped 48 posts on a 2x5 m deck and 140 posts on a 24 m fence
 * THROUGH this pass — its prompt carries the right derivation rules
 * (posts = ceil(span/centres)+1) but it runs on the flash-lite tier with a
 * "when in doubt, keep" bias. Before any fix ships, this measures variants the
 * way the reconcile lesson demands:
 *
 *  - ONE raw generation per job (cached), every variant reviews the SAME list;
 *  - deterministic geometry references derived from dimensions the customer
 *    actually stated (a 24 m fence at 2.7 m centres is ~10 posts — no judge);
 *  - collateral damage counted: a variant must not "fix" lines that were
 *    already right.
 *
 * Usage:
 *   cd functions && set -a; source ../.env; source .env; set +a
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node scripts/bakeoff/quantitySanityAB.ts \
 *     --corpus=~/.quotemate-bakeoff/customer-jobs-corpus.json --limit=20
 */
import './preload';
import * as fs from 'fs';
import * as os from 'os';
import fetch from 'node-fetch';
import { askJson } from './claude';
import { buildMaterialsPrompt } from '../../src/materialsPrompt';
import {
  buildQuantitySanityPrompt,
  applySanityDecisions,
  indexMaterialsForSanity,
} from '../../src/quantitySanity';

const expand = (p: string) => p.replace(/^~/, os.homedir());
const B = expand('~/.quotemate-bakeoff');

// ── geometry the customer stated, parsed deterministically ──
interface Geometry { kind: 'fence' | 'deck'; lengthM?: number; wM?: number; lM?: number }
export function parseGeometry(desc: string): Geometry | null {
  const d = desc.toLowerCase();
  const dims = d.match(/(\d+(?:\.\d+)?)\s*m(?:etres?)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*m/);
  if (dims && /deck/.test(d)) return { kind: 'deck', wM: parseFloat(dims[1]), lM: parseFloat(dims[2]) };
  const flen = d.match(/(\d+(?:\.\d+)?)\s*(?:lineal\s*)?m(?:etres?)?[^.]{0,40}fence|fence[^.]{0,40}?(\d+(?:\.\d+)?)\s*m(?:etres?)?/);
  if (flen && /fence|paling|colorbond/.test(d)) {
    const L = parseFloat(flen[1] || flen[2]);
    if (L >= 5 && L <= 200) return { kind: 'fence', lengthM: L };
  }
  return null;
}

interface Band { low: number; high: number; what: string }
/**
 * v2 matcher. v1 was the Cat6-$1-a-metre lesson at scale: it judged 1,370 kg
 * of CONCRETE against a stump-count band, paling NAILS against the paling
 * band, joist TAPE against the joist band, and read 67.2 METRES of post
 * timber as 67 posts because it never looked at the unit. A reference is only
 * a reference when the line counts the same thing in the same unit:
 *  - count bands apply ONLY to unit 'each' lines;
 *  - the thing itself, never its fixings, footings, coatings or accessories.
 */
const NOT_THE_THING = /concrete|mix|footing|post\s*hole|nail|screw|bolt|bracket|stirrup|anchor|cap\b|hanger|tape|protection|sealer|paint|oil|stain|hire|bin|skip|cement|mortar|support|plinth|rail\b/;
export function referenceBand(g: Geometry, materialName: string, unit: string): Band | null {
  if ((unit || '').toLowerCase() !== 'each') return null;
  const n = materialName.toLowerCase();
  if (NOT_THE_THING.test(n)) return null;
  if (g.kind === 'fence' && /\bposts?\b/.test(n)) {
    const ref = Math.ceil(g.lengthM! / 2.7) + 1; // 2.4–2.7 m bays
    return { low: ref * 0.7, high: ref * 1.8, what: `~${ref} posts for ${g.lengthM}m` };
  }
  if (g.kind === 'fence' && /paling|picket/.test(n)) {
    const ref = g.lengthM! / 0.1; // 100 mm boards, butted
    return { low: ref * 0.75, high: ref * 1.6, what: `~${Math.round(ref)} palings` };
  }
  if (g.kind === 'deck' && /\b(posts?|stumps?)\b/.test(n)) {
    const lo = (Math.ceil(g.wM! / 2.0) + 1) * (Math.ceil(g.lM! / 2.0) + 1);
    const hi = (Math.ceil(g.wM! / 1.2) + 1) * (Math.ceil(g.lM! / 1.2) + 1);
    return { low: lo * 0.5, high: hi * 1.5, what: `${lo}–${hi} for ${g.wM}x${g.lM}m` };
  }
  if (g.kind === 'deck' && /\bjoists?\b/.test(n)) {
    const span = Math.max(g.wM!, g.lM!);
    const ref = Math.ceil(span / 0.45) + 1;
    return { low: ref * 0.5, high: ref * 2.2, what: `~${ref} joists` };
  }
  return null;
}

/** Whole-line quantity, section multiplier included. */
const effQty = (m: any) => (m.quantity || 0) * (m.sectionMultiplier || 1);

async function geminiSanity(prompt: string): Promise<any> {
  for (let a = 1; a <= 3; a++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 120_000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctl.signal as any,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: 'application/json' },
          }),
        },
      );
      if (!res.ok) throw new Error(`gemini ${res.status}`);
      const data: any = await res.json();
      return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    } catch (err) {
      if (a === 3) throw err;
      await new Promise((r) => setTimeout(r, 4000 * a));
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Variant D: the widened charter, built by TRANSFORMING the production prompt
 * so every other word stays byte-identical and the measured variable is the
 * charter alone. What the corrected eval showed the current charter cannot
 * touch: under-counts (2 posts for a 100 m fence — "reduce excessive" cannot
 * raise anything), and elements split across lines (line posts 9 + end posts 1
 * judged separately against a ~76-post fence). If production's passages drift,
 * the asserts here fail loudly rather than silently measuring a stale hybrid.
 */
function buildWidenedSanityPrompt(jobDescription: string, tradeContext: any, indexed: any[]): string {
  let prompt = buildQuantitySanityPrompt(jobDescription, tradeContext, indexed);

  const oldDecide = `For each material, decide:
- "keep" — quantity is reasonable for the scope (within 30% over for waste is fine).
- "adjust" — quantity is clearly excessive (roughly 2× or more over what the scope requires). Reduce to a sensible count.`;
  const newDecide = `For each material, decide:
- "keep" — quantity is reasonable for the scope (within 30% over for waste is fine).
- "adjust" — quantity is clearly WRONG IN EITHER DIRECTION for the stated scope: excessive (roughly 2× or more over) OR clearly short of what the stated dimensions require (a 100 m fence cannot be built with 2 posts). Set newQuantity to the figure you derive.

DERIVE, don't eyeball: when the job states a length, area or count, COMPUTE the count for repeating structural elements (posts, palings, pickets, joists, sheets, panels) from those dimensions using the rules below, and adjust to your derived figure when the listed quantity is off by more than ~30% either way.

ELEMENTS SPLIT ACROSS LINES: when several lines are the SAME physical element in variants (line posts + end posts + corner posts; several paling lines), judge them TOGETHER — derive the TOTAL the job needs, check the SUM of those lines against it, and set each line so the sum comes out right (ends/corners keep their small counts; the line-post line carries the remainder).`;
  if (!prompt.includes(oldDecide)) throw new Error('production decide-block drifted — update variant D');
  prompt = prompt.replace(oldDecide, newDecide);

  const oldCrit = 'CRITICAL — be conservative. A 20-30% over-spec is normal for waste; do NOT adjust those. Only adjust when the count is clearly disproportionate. When in doubt, keep.';
  const newCrit = 'CRITICAL — for quantities you cannot derive from stated dimensions, stay conservative: a 20-30% over-spec is normal waste, only adjust the clearly disproportionate, and when in doubt keep. For quantities you CAN derive, the derivation wins — in both directions.';
  if (!prompt.includes(oldCrit)) throw new Error('production conservative-block drifted — update variant D');
  return prompt.replace(oldCrit, newCrit);
}

const SANITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: { results: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['index', 'decision'],
    properties: {
      index: { type: 'integer' }, decision: { type: 'string', enum: ['keep', 'adjust'] },
      newQuantity: { type: 'number' }, reasoning: { type: 'string' },
    } } } },
} as const;

const GEN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['materials'],
  properties: { materials: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['name', 'quantity', 'unit'],
    properties: {
      name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' },
      section: { type: 'string' }, sectionMultiplier: { type: 'number' },
    } } } },
} as const;

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const corpus = JSON.parse(fs.readFileSync(expand(get('corpus')!), 'utf8'));
  const limit = parseInt(get('limit') || '20', 10);

  const jobs: any[] = [];
  const perUid: Record<string, number> = {};
  for (const r of corpus.rows) {
    const g = parseGeometry(r.jobDescription || '');
    if (!g) continue;
    if ((perUid[r.uid] || 0) >= 2) continue;
    perUid[r.uid] = (perUid[r.uid] || 0) + 1;
    jobs.push({ ...r, geometry: g });
    if (jobs.length >= limit) break;
  }
  console.log(`${jobs.length} geometry-checkable jobs (${jobs.filter((j) => j.geometry.kind === 'fence').length} fence, ${jobs.filter((j) => j.geometry.kind === 'deck').length} deck)`);

  // ── phase 1: one raw generation per job, cached ──
  const genPath = `${B}/sanity-raw-gen.json`;
  const gen: Record<string, any[]> = fs.existsSync(genPath) ? JSON.parse(fs.readFileSync(genPath, 'utf8')) : {};
  for (const [i, j] of jobs.entries()) {
    if (gen[j.docId]) continue;
    process.stdout.write(`gen [${i + 1}/${jobs.length}] ${j.number} `);
    const prompt = buildMaterialsPrompt({
      jobDescription: j.jobDescription, hasExisting: false, storeName: 'Bunnings',
      contextSection: '', existingMaterialsSection: '', templateReferenceSection: '',
      savedRatesSection: '', reeceCatalogueSection: '', tradeContext: null,
    });
    try {
      const { value } = await askJson<any>(prompt, GEN_SCHEMA as any, { effort: 'high', maxTokens: 32000 });
      gen[j.docId] = value.materials || [];
      console.log(`${gen[j.docId].length} materials`);
      fs.writeFileSync(genPath, JSON.stringify(gen, null, 1));
    } catch (err: any) { console.log(`ERR ${String(err?.message).slice(0, 60)}`); }
  }

  // ── phase 2: variants over identical lists ──
  // Variants take (job, indexed) so charter variants can rebuild their own
  // prompt; A runs production's prompt on production's model as the baseline.
  const VARIANTS: Array<{ key: string; run: (job: any, indexed: any[]) => Promise<any> }> = [
    { key: 'A prod (flash)', run: (j2, idx) => geminiSanity(buildQuantitySanityPrompt(j2.jobDescription, null, idx)) },
    { key: 'D charter (flash)', run: (j2, idx) => geminiSanity(buildWidenedSanityPrompt(j2.jobDescription, null, idx)) },
    { key: 'D charter (sonnet5)', run: async (j2, idx) =>
      (await askJson<any>(buildWidenedSanityPrompt(j2.jobDescription, null, idx), SANITY_SCHEMA as any, { model: 'claude-sonnet-5', maxTokens: 16000 })).value },
  ];

  const tally: Record<string, { inBand: number; out: number; excess: number[]; collateral: number; adjusted: number }> = {};
  for (const v of VARIANTS) tally[v.key] = { inBand: 0, out: 0, excess: [], collateral: 0, adjusted: 0 };
  let rawInBand = 0, rawOut = 0;
  const detail: string[] = [];

  for (const [i, j] of jobs.entries()) {
    const materials = gen[j.docId];
    if (!materials?.length) continue;
    const indexed = indexMaterialsForSanity(materials);
    const outcomes: Record<string, any[]> = {};
    let variantFailed = false;
    await Promise.all(VARIANTS.map(async (v) => {
      try {
        const parsed = await v.run(j, indexed);
        outcomes[v.key] = applySanityDecisions(JSON.parse(JSON.stringify(materials)), parsed.results || []);
        tally[v.key].adjusted += (parsed.results || []).filter((r: any) => r.decision === 'adjust').length;
      } catch (err: any) {
        // A silently skipped variant unpairs the whole comparison — the first
        // run scored each variant on a DIFFERENT subset and produced a table
        // whose rows did not even sum to the same line count. Fail loudly and
        // drop the JOB for everyone, never just for the variant that errored.
        console.log(`\n  ${j.number} ${v.key} FAILED: ${String(err?.message).slice(0, 90)}`);
        variantFailed = true;
      }
    }));
    if (variantFailed) continue;
    for (const [mi, m] of materials.entries()) {
      const band = referenceBand(j.geometry, m.name || '', String(m.unit || ''));
      if (!band) continue;
      const q0 = effQty(m);
      const rawOk = q0 >= band.low && q0 <= band.high;
      rawOk ? rawInBand++ : rawOut++;
      let line = `${j.number} ${String(m.name).slice(0, 34).padEnd(34)} raw=${q0}${rawOk ? '' : ' ✗'} [${band.what}]`;
      for (const v of VARIANTS) {
        const adj = outcomes[v.key]?.[mi];
        if (!adj) continue;
        const q = effQty(adj);
        const ok = q >= band.low && q <= band.high;
        if (ok) tally[v.key].inBand++;
        else { tally[v.key].out++; tally[v.key].excess.push(Math.abs(Math.log(Math.max(q, 0.1) / ((band.low + band.high) / 2)))); }
        if (rawOk && !ok) tally[v.key].collateral++;
        line += ` | ${v.key.split(' ')[0]}=${q}${ok ? '' : '✗'}`;
      }
      detail.push(line);
    }
    process.stdout.write(`sanity [${i + 1}/${jobs.length}]\r`);
  }

  console.log(`\n\nGEOMETRY-CHECKABLE LINES (bands from stated dimensions)`);
  console.log(`raw generation: ${rawInBand} in band, ${rawOut} out\n`);
  console.log(`${'variant'.padEnd(24)}${'inBand'.padStart(8)}${'out'.padStart(6)}${'collateral'.padStart(12)}${'adjustments'.padStart(13)}`);
  for (const v of VARIANTS) {
    const t = tally[v.key];
    console.log(`${v.key.padEnd(24)}${String(t.inBand).padStart(8)}${String(t.out).padStart(6)}${String(t.collateral).padStart(12)}${String(t.adjusted).padStart(13)}`);
  }
  console.log('\nper-line detail:');
  for (const l of detail) console.log('  ' + l);
  fs.writeFileSync(`${B}/sanity-ab.json`, JSON.stringify({ tally, rawInBand, rawOut, detail }, null, 1));
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
