/**
 * End-to-end replay audit for recent quotes:
 *   Firestore recent quote -> Gemini Pro material regeneration -> Bunnings scraper
 *   live price fetch -> pack-aware priced replay -> production reconcile pass
 *   (shared prompt + deterministic coverage sweep) -> Gemini Pro comparison
 *
 * Read-only: does not write to Firestore.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/replayRecentQuotesWithPrices.ts --limit=10
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { checkDocumentIntegrity } from '../src/shared/document/integrityCheck';
import { pickBestCandidate, RankableCandidate } from '../../src/services/candidateRanker';
import { parsePackInfo } from '../../src/utils/parsePackInfo';
import { isNonRetailTradeRow, tradeFallbackUnitPrice } from '../../src/utils/tradeFallback';
import { buildReconcilePrompt, ReconcileDecision } from '../src/reconcile.helpers';
import { buildReconcileItems, applyReconcileDecisions, finalCoverageSweep, rescueRejectedRows, ReplayPricedRow } from './replayReconcile';
import { normalizeGapKind, replayDeterministicIssues, capVerdict } from './replayOracle.helpers';

// Same model + token budget as production's reconcile endpoint (callGeminiLiteJson).
const RECONCILE_MODEL = 'gemini-3.1-flash-lite';

interface Args { limit: number; project: string; model: string; out: string; uid?: string; diverse: boolean; perUser: number; numbers?: Set<string>; noOracle: boolean }
interface DocLike { id: string; uid: string; number?: string; type?: string; stage?: string; createdAt?: any; job?: any; materials?: any[]; sections?: any[]; total?: number; materialsSubtotal?: number; laborHours?: number; laborTotal?: number; [k: string]: any }
interface ReplayMaterial { name: string; searchTerm: string; quantity: number; unit: string; reasoning?: string }
interface ScraperProduct { productName: string; description?: string; price: number; priceIncGst?: number; unit?: string; itemNumber?: string; productUrl?: string; confidence?: string; packSize?: number; packUnit?: string }

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  return {
    limit: Math.max(1, Math.min(parseInt(get('limit') || '10', 10), 25)),
    project: get('project') || process.env.GCLOUD_PROJECT || 'hansendev',
    model: get('model') || process.env.GEMINI_AUDIT_MODEL || 'gemini-3.1-pro',
    out: get('out') || path.resolve(__dirname, '..', '..', 'quote-replay-priced-audit.json'),
    uid: get('uid'),
    diverse: (get('diverse') || 'false') === 'true',
    perUser: Math.max(1, Math.min(parseInt(get('per-user') || '2', 10), 10)),
    // Retry filter: only replay these quote numbers (e.g. re-running quotes a
    // previous run lost to transient network errors).
    numbers: get('numbers') ? new Set(get('numbers')!.split(',').map(s => s.trim()).filter(Boolean)) : undefined,
    // Row-level validations (did routing/pricing behave) don't need the LLM
    // judge — skip it to save cost and verdict noise.
    noOracle: (get('no-oracle') || 'false') === 'true',
  };
}
function tsToMs(t: any): number { return typeof t?.toMillis === 'function' ? t.toMillis() : typeof t?._seconds === 'number' ? t._seconds * 1000 : typeof t === 'number' ? t : 0; }
function normUnit(u: string | undefined): string | undefined { return ({ pack: 'each', box: 'each', each: 'each', m: 'm', 'm²': 'm²', m2: 'm²', 'm³': 'm³', m3: 'm³', kg: 'kg', L: 'L' } as any)[u || '']; }

function parseLooseJson(text: string): any {
  const trimmed = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return JSON.parse(trimmed); } catch {}

  // Some preview models occasionally append commentary after a valid JSON
  // object despite responseMimeType. Extract the first balanced object.
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error(`No JSON object found: ${trimmed.slice(0, 120)}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error(`Could not parse JSON: ${trimmed.slice(0, 240)}`);
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function isTransientGeminiError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|aborted|timeout|503|502|504|429/i.test(msg);
}

async function geminiJsonOnce(apiKey: string, model: string, prompt: string, maxOutputTokens = 16000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let res: any;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal as any,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens, responseMimeType: 'application/json' } }),
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 800)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no JSON text');
  return parseLooseJson(text);
}

async function geminiJson(apiKey: string, model: string, prompt: string, maxOutputTokens = 16000): Promise<any> {
  let lastErr: any;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await geminiJsonOnce(apiKey, model, prompt, maxOutputTokens);
    } catch (err: any) {
      lastErr = err;
      if (!isTransientGeminiError(err) || attempt === 4) break;
      const backoff = 1500 * attempt * attempt;
      console.warn(`Gemini transient error on ${model} attempt ${attempt}; retrying in ${backoff}ms: ${String(err?.message || err).replace(/key=[^\s&]+/g, 'key=REDACTED')}`);
      await sleep(backoff);
    }
  }
  if (lastErr?.message) lastErr.message = String(lastErr.message).replace(/key=[^\s&]+/g, 'key=REDACTED');
  throw lastErr;
}

async function geminiJsonWithFallback(apiKey: string, model: string, prompt: string, maxOutputTokens = 16000): Promise<any> {
  try {
    return await geminiJson(apiKey, model, prompt, maxOutputTokens);
  } catch (err) {
    if (model === 'gemini-2.5-pro') throw err;
    try {
      return await geminiJson(apiKey, 'gemini-2.5-pro', prompt, maxOutputTokens);
    } catch (fallbackErr: any) {
      if (fallbackErr?.message) fallbackErr.message = String(fallbackErr.message).replace(/key=[^\s&]+/g, 'key=REDACTED');
      throw fallbackErr;
    }
  }
}

function generationPrompt(d: DocLike): string {
  return `You are an expert Australian tradie estimator. Regenerate a clean materials list for this quote scope. Return ONLY JSON:
{ "estimatedHours": number, "materials": [ { "name": string, "searchTerm": string, "quantity": number, "unit": "each|m|m²|m³|kg|L", "reasoning": string } ] }

Rules:
- Use smallest physical requirement units, not guessed packs: screws/nails as each, gravel/sand as kg, oil as L, weed mat as m², timber length as m except decking boards as each.
- Include named primary materials, all major consumables, and explicitly requested equipment/hire/service rows (e.g. concrete pump, skip bin, disposal/tipping, fuel).
- Discrete structural members that cannot be safely spliced from offcuts (posts, studs, joists, rafters, beams, steel RHS/SHS gate rails/posts) must be emitted as piece count with unit "each" and member length in name/searchTerm, not pooled total metres.
- Quantity derivations must be realistic and conservative with 10-15% waste, not 3-10×.
- Estimate labour realistically.

Stored quote scope:
${JSON.stringify({ job: d.job, existingSections: (d.sections || []).map((s: any) => ({ name: s.name, hours: s.laborHoursTotal || s.laborHours, total: s.laborTotal })), existingMaterialNames: (d.materials || []).map((m: any) => m.name) }, null, 2)}`;
}

async function fetchRecent(args: Args): Promise<DocLike[]> {
  if (!admin.apps.length) admin.initializeApp({ projectId: args.project });
  const db = admin.firestore();
  const users = args.uid ? [await db.collection('users').doc(args.uid).get()] : (await db.collection('users').get()).docs;
  const all: DocLike[] = [];
  for (const u of users) {
    if (!u.exists) continue;
    const snap = await db.collection('users').doc(u.id).collection('documents').orderBy('createdAt', 'desc').limit(20).get();
    for (const ds of snap.docs) {
      const d = { id: ds.id, uid: u.id, ...(ds.data() as any) } as DocLike;
      if (d.type && d.type !== 'quote') continue;
      if (!d.job?.description) continue;
      if (args.numbers && !args.numbers.has(d.number || '')) continue;
      all.push(d);
    }
  }
  const sorted = all.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  if (!args.diverse) return sorted.slice(0, args.limit);
  const picked: DocLike[] = [];
  const perUser = new Map<string, number>();
  for (const d of sorted) {
    const n = perUser.get(d.uid) || 0;
    if (n >= args.perUser) continue;
    picked.push(d);
    perUser.set(d.uid, n + 1);
    if (picked.length >= args.limit) break;
  }
  return picked;
}

async function scraperBatch(terms: string[]): Promise<Map<string, ScraperProduct[]>> {
  const url = process.env.BUNNINGS_SCRAPER_URL;
  const key = process.env.BUNNINGS_SCRAPER_API_KEY;
  if (!url || !key) throw new Error('Missing BUNNINGS_SCRAPER_URL / BUNNINGS_SCRAPER_API_KEY');
  const out = new Map<string, ScraperProduct[]>();
  for (let i = 0; i < terms.length; i += 10) {
    const searches = terms.slice(i, i + 10).map(searchTerm => ({ searchTerm, limit: 5, sortBy: 'relevance' }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);
    let res: any;
    try {
      res = await fetch(`${url.replace(/\/$/, '')}/api/batch-search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, signal: controller.signal as any, body: JSON.stringify({ searches }) });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`Scraper batch ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json();
    for (const item of data.results || []) out.set(item.searchTerm, item.success ? item.results || [] : []);
    for (const s of searches) if (!out.has(s.searchTerm)) out.set(s.searchTerm, []);
  }
  return out;
}



function firstMetreLengthText(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*m\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && n <= 20 ? n : null;
}

function priceReplay(materials: ReplayMaterial[], candidates: Map<string, ScraperProduct[]>): any[] {
  return materials.map(m => {
    if (isNonRetailTradeRow(`${m.searchTerm} ${m.name}`, m.unit, m.quantity)) {
      const fallback = tradeFallbackUnitPrice(`${m.searchTerm} ${m.name}`, m.unit);
      if (fallback && fallback > 0) return { ...m, price: fallback, totalPrice: Math.round(fallback * m.quantity * 100) / 100, priceStatus: 'estimated-trade', candidates: [] };
      // Route-to-trade means NEVER retail — a table-less row stays unpriced
      // rather than matching a keyword-adjacent SKU (the umbrella-base bug).
      return { ...m, price: 0, totalPrice: 0, priceStatus: 'unpriced-trade', candidates: [] };
    }
    const ranked = (candidates.get(m.searchTerm) || []).filter(p => p.price > 0).sort((a, b) => {
      const score = (x: ScraperProduct) => x.confidence === 'high' ? 0 : x.confidence === 'medium' ? 1 : 2;
      return score(a) - score(b) || a.price - b.price;
    });
    const chosen = pickBestCandidate(ranked as RankableCandidate[], { name: m.name, searchTerm: m.searchTerm }) as ScraperProduct | null;
    if (!chosen) {
      const fallback = tradeFallbackUnitPrice(`${m.searchTerm} ${m.name}`, m.unit);
      if (fallback && fallback > 0) return { ...m, price: fallback, totalPrice: Math.round(fallback * m.quantity * 100) / 100, priceStatus: 'estimated', candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
      return { ...m, price: 0, totalPrice: 0, priceStatus: 'unpriced', candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
    }
    const titlePack = parsePackInfo(chosen.productName);
    const rawSuppliedPack = chosen.packSize && chosen.packUnit ? { packSize: chosen.packSize, packUnit: chosen.packUnit } : null;
    const suspiciousSuppliedEachPack = rawSuppliedPack?.packUnit === 'each' && rawSuppliedPack.packSize > 100 && !/\b(?:pack|box|pcs?|pieces?|jar|tub|carton|case)\b/i.test(chosen.productName || '');
    const suppliedPack = suspiciousSuppliedEachPack ? null : rawSuppliedPack;
    const compatible = (a?: string, b?: string) => normUnit(a) === normUnit(b) || (/(?:pointing|compound|mortar|adhesive|marking\s+paint|spray\s+paint|line\s+marking)/i.test(`${m.name} ${chosen.productName}`) && ((normUnit(a) === 'L' && normUnit(b) === 'kg') || (normUnit(a) === 'kg' && normUnit(b) === 'L')));
    const nominalLengthPerEach = firstMetreLengthText(`${m.name} ${m.searchTerm}`);
    const lengthEachToMetres = m.unit === 'each' && nominalLengthPerEach && /track|gutter|downpipe|pipe|conduit|rail|length/i.test(`${m.name} ${m.searchTerm} ${chosen.productName}`);
    const compatibleWithLength = (unit?: string, packUnit?: string) => compatible(unit, packUnit) || (!!lengthEachToMetres && normUnit(packUnit) === 'm');
    const suppliedCompatible = suppliedPack && compatibleWithLength(m.unit, suppliedPack.packUnit);
    const titleCompatible = titlePack && compatibleWithLength(m.unit, titlePack.packUnit);
    const pack = titleCompatible ? titlePack : suppliedCompatible ? suppliedPack : titlePack || suppliedPack || parsePackInfo(`${chosen.productName} ${chosen.description || ''}`);
    const unitPrice = chosen.priceIncGst || chosen.price;
    let purchaseCount = m.quantity;
    let purchaseUnit = m.unit;
    if (pack && pack.packSize > 0 && compatibleWithLength(m.unit, pack.packUnit)) {
      const effectiveRequired = lengthEachToMetres ? m.quantity * nominalLengthPerEach! : m.quantity;
      purchaseCount = Math.max(1, Math.ceil(effectiveRequired / pack.packSize));
      purchaseUnit = ['m', 'm²', 'm³'].includes(pack.packUnit) ? 'each' : 'pack';
    } else if (/screws?|nails?|brads?|staples?|(?:wire|lever)\s+connectors?|wago\s+connectors?/i.test(m.name) && m.quantity >= 10 && unitPrice >= 5) {
      purchaseCount = Math.max(1, Math.ceil(m.quantity / (unitPrice >= 80 ? 500 : 100)));
      purchaseUnit = 'pack';
    }
    return { ...m, requiredQty: m.quantity, requiredUnit: m.unit, quantity: purchaseCount, unit: purchaseUnit, price: unitPrice, totalPrice: Math.round(unitPrice * purchaseCount * 100) / 100, priceStatus: 'priced', chosen: { name: chosen.productName, price: unitPrice, confidence: chosen.confidence, itemNumber: chosen.itemNumber, pack }, candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
  });
}

function comparePrompt(stored: any, replay: any): string {
  return `You are Gemini Pro reviewing a QuoteMate MATERIAL/PRICING regression replay.

Important scope: the replay JSON is intentionally a PARTIAL replay containing regenerated materials, live/estimated material prices, material subtotal, and estimatedHours. It is NOT expected to include full QuoteMate document schema, customer metadata, nested pricing totals, sections, markup, GST, or final quote total. Do NOT flag missing quote schema/metadata/pricing object as a failure.

Compare the stored quote's materials/labour to the freshly regenerated-and-live-priced material replay. Identify actionable gaps in material generation, supplier product matching, pack/unit conversion, fallback estimates, and labour realism. Return ONLY JSON:
{ "verdict": "pass"|"review"|"fail", "summary": string, "gaps": [ { "kind": "product_match"|"quantity"|"unit_conversion"|"pack_conversion"|"pricing"|"fallback_estimate"|"missing_material"|"material_generation"|"labour"|"other", "severity": "low"|"medium"|"high", "item": string, "stored": string, "replay": string, "recommendation": string } ], "testAssertions": string[] }

"kind" MUST be exactly one of the ten enum values above — do not invent variants. Pick the closest: wrong product category matched → product_match; wrong count → quantity; wrong unit maths → unit_conversion; wrong pack size maths → pack_conversion; wrong or implausible price → pricing; a bad general-knowledge fallback price → fallback_estimate; a material the job needs but the list lacks → missing_material; a poorly structured/decomposed materials list → material_generation; unrealistic hours → labour; anything else → other.

Verdict guidance:
- pass: replay materially improves or matches the stored quote; only low/medium notes.
- review: replay is usable but has medium issues or needs human verification.
- fail: high-severity material/product/unit/labour issue that would materially mislead the quote.

Stored quote:
${JSON.stringify(stored, null, 2)}

Fresh partial material replay with fetched prices:
${JSON.stringify(replay, null, 2)}`;
}

async function main() {
  const args = parseArgs();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('Missing GEMINI_API_KEY');
  console.log(`Replay audit: ${args.limit} quotes, model=${args.model}`);
  const docs = await fetchRecent(args);
  const results: any[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    process.stdout.write(`\n[${i + 1}/${docs.length}] ${d.number || d.id} regenerate... `);
    try {
      let gen = await geminiJsonWithFallback(geminiKey, args.model, generationPrompt(d));
      let rawMats = gen.materials || gen.items || gen.materialsList || [];
      if (!Array.isArray(rawMats) || rawMats.length === 0) {
        // Preview models sometimes ignore the requested shape. Retry once with
        // the stable Pro model before counting this quote as a replay failure.
        gen = await geminiJson(geminiKey, 'gemini-2.5-pro', generationPrompt(d));
        rawMats = gen.materials || gen.items || gen.materialsList || [];
      }
      const mats: ReplayMaterial[] = (Array.isArray(rawMats) ? rawMats : []).filter((m: any) => m.name && m.searchTerm && m.quantity > 0).slice(0, 30);
      if (mats.length === 0) throw new Error('Regeneration returned no materials');
      process.stdout.write(`${mats.length} mats, fetch prices... `);
      const cand = await scraperBatch([...new Set(mats.map(m => m.searchTerm))]);
      const priced = priceReplay(mats, cand) as ReplayPricedRow[];

      // ── Production reconcile pass (same prompt/model as the deployed
      // endpoint) + deterministic coverage sweep. Best-effort like production:
      // an LLM failure leaves rows as the per-row pack-aware pricing set them,
      // but is recorded so runs that skipped reconcile are visible.
      let reconciled = priced;
      const reconcileMeta: any = { attempted: 0, applied: 0, estimated: 0, rejected: 0 };
      const { items: reconcileItems, candidatesById } = buildReconcileItems(priced, cand);
      reconcileMeta.attempted = reconcileItems.length;
      if (reconcileItems.length > 0) {
        process.stdout.write(`reconcile ${reconcileItems.length}... `);
        try {
          const parsed = await geminiJson(geminiKey, RECONCILE_MODEL, buildReconcilePrompt(reconcileItems, d.job?.name, d.job?.description), 8000);
          const decisions: ReconcileDecision[] = Array.isArray(parsed?.results) ? parsed.results : [];
          reconciled = applyReconcileDecisions(priced, decisions, candidatesById);
          for (const dec of decisions) {
            if (dec.decision === 'apply') reconcileMeta.applied++;
            else if (dec.decision === 'estimate') reconcileMeta.estimated++;
            else if (dec.decision === 'reject') reconcileMeta.rejected++;
          }
        } catch (err: any) {
          reconcileMeta.error = String(err?.message || err);
        }
      }

      // Rejected-row rescue — simplified-term retry + visible fallback,
      // mirroring production. Best-effort like the reconcile pass itself.
      try {
        const rescue = await rescueRejectedRows(reconciled, {
          fetchCandidates: scraperBatch,
          reconcile: async items => {
            const parsed = await geminiJson(geminiKey, RECONCILE_MODEL, buildReconcilePrompt(items, d.job?.name, d.job?.description), 8000);
            return Array.isArray(parsed?.results) ? parsed.results : [];
          },
          fallbackUnitPrice: row => tradeFallbackUnitPrice(`${row.searchTerm} ${row.name}`, row.unit),
        });
        reconciled = rescue.rows;
        reconcileMeta.rescue = rescue.meta;
      } catch (err: any) {
        reconcileMeta.rescueError = String(err?.message || err);
      }

      finalCoverageSweep(reconciled, d.job?.description);

      const replay = { estimatedHours: gen.estimatedHours, reconcile: reconcileMeta, materialsSubtotal: Math.round(reconciled.reduce((s, m) => s + (m.totalPrice || 0), 0) * 100) / 100, materials: reconciled };
      process.stdout.write('compare... ');
      const stored = { id: d.id, number: d.number, stage: d.stage, job: { name: d.job?.name, description: d.job?.description, template: d.job?.template, estimatedHours: d.job?.estimatedHours }, pricing: { total: d.total, materialsSubtotal: d.materialsSubtotal, laborHours: d.laborHours, laborTotal: d.laborTotal }, sections: (d.sections || []).map((s: any) => ({ name: s.name, hours: s.laborHoursTotal || s.laborHours, total: s.laborTotal })), materials: (d.materials || []).map((m: any) => ({ name: m.name, quantity: m.quantity, unit: m.unit, price: m.price, totalPrice: m.totalPrice, requiredQty: m.requiredQty, packSize: m.packSize, packUnit: m.packUnit, pricingSource: m.pricingSource, priceConfidence: m.priceConfidence })) };
      let oracle: any = null;
      if (!args.noOracle) {
        oracle = await geminiJsonWithFallback(geminiKey, args.model, comparePrompt(stored, replay));
        if (Array.isArray(oracle?.gaps)) for (const g of oracle.gaps) g.kind = normalizeGapKind(g.kind);
      }
      const replayIssues = replayDeterministicIssues(replay);
      if (oracle) capVerdict(oracle, replayIssues);
      console.log(oracle ? oracle.verdict + (oracle.rawVerdict ? ` (capped from ${oracle.rawVerdict})` : '') : `no-oracle (${replayIssues.length} deterministic issues)`);
      results.push({ id: d.id, number: d.number, stage: d.stage, deterministicIssues: checkDocumentIntegrity(d as any), replayDeterministicIssues: replayIssues, oracle, storedRedacted: { ...stored, job: { ...stored.job, description: undefined, descriptionLength: d.job?.description?.length || 0 } }, replay: { ...replay, materials: replay.materials.map((m: any) => ({ ...m, candidates: undefined })) } });
    } catch (err: any) {
      console.log(`ERROR ${err.message}`);
      results.push({ id: d.id, number: d.number, error: err.message });
    }
  }
  const summary = { generatedAt: new Date().toISOString(), model: args.model, count: results.length, verdictCounts: results.reduce((a: any, r) => { const v = r.oracle?.verdict || (r.error ? 'error' : 'unknown'); a[v] = (a[v] || 0) + 1; return a; }, {}) };
  fs.writeFileSync(args.out, JSON.stringify({ summary, results }, null, 2));
  console.log(`\nWrote ${args.out}`);
  console.log(summary);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
