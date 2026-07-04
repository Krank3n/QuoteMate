/**
 * End-to-end-ish replay audit for recent quotes:
 *   Firestore recent quote -> Gemini Pro material regeneration -> Bunnings scraper
 *   live price fetch -> simple pack-aware priced replay -> Gemini Pro comparison
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

interface Args { limit: number; project: string; model: string; out: string; uid?: string }
interface DocLike { id: string; uid: string; number?: string; type?: string; stage?: string; createdAt?: any; job?: any; materials?: any[]; sections?: any[]; total?: number; materialsSubtotal?: number; laborHours?: number; laborTotal?: number; [k: string]: any }
interface ReplayMaterial { name: string; searchTerm: string; quantity: number; unit: string; reasoning?: string }
interface ScraperProduct { productName: string; description?: string; price: number; priceIncGst?: number; unit?: string; itemNumber?: string; productUrl?: string; confidence?: string; packSize?: number; packUnit?: string }

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const PACK_PATTERNS: Array<{ re: RegExp; unit: string }> = [
  { re: new RegExp(String.raw`\b(?:box|pack|packet|bag|tub|carton|case)\s+of\s+${NUM}\b`, 'i'), unit: 'each' },
  { re: new RegExp(String.raw`\b${NUM}\s*[- ]?(?:pack|pk)\b`, 'i'), unit: 'each' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:pieces|piece|pcs|pc)\b`, 'i'), unit: 'each' },
  { re: new RegExp(String.raw`${NUM}\s*(?:m²|m2|sqm|sq\s*m|square\s+(?:metres?|meters?))\b`, 'i'), unit: 'm²' },
  { re: new RegExp(String.raw`${NUM}\s*(?:m³|m3|cubic\s+(?:metres?|meters?))\b`, 'i'), unit: 'm³' },
  { re: new RegExp(String.raw`\b${NUM}\s*m(?:etres?|eters?)?\b(?:\s+(?:length|long|roll))?`, 'i'), unit: 'm' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:l|lt|litres?|liters?)\b`, 'i'), unit: 'L' },
  { re: new RegExp(String.raw`\b${NUM}\s*kg\b`, 'i'), unit: 'kg' },
];

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  return {
    limit: Math.max(1, Math.min(parseInt(get('limit') || '10', 10), 25)),
    project: get('project') || process.env.GCLOUD_PROJECT || 'hansendev',
    model: get('model') || process.env.GEMINI_AUDIT_MODEL || 'gemini-3.1-pro',
    out: get('out') || path.resolve(__dirname, '..', '..', 'quote-replay-priced-audit.json'),
    uid: get('uid'),
  };
}
function tsToMs(t: any): number { return typeof t?.toMillis === 'function' ? t.toMillis() : typeof t?._seconds === 'number' ? t._seconds * 1000 : typeof t === 'number' ? t : 0; }
function parsePackInfo(title?: string | null): { packSize: number; packUnit: string } | null {
  if (!title) return null;
  const mm = title.match(/\b(\d{4})\s*mm\s+(?:length|long)\b/i);
  if (mm) return { packSize: parseInt(mm[1], 10) / 1000, packUnit: 'm' };
  for (const p of PACK_PATTERNS) {
    const m = title.match(p.re); if (!m) continue;
    const size = parseFloat(m[1]); if (!(size > 0)) continue;
    if (p.unit === 'each' && size < 2) continue;
    return { packSize: size, packUnit: p.unit };
  }
  return null;
}
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

async function geminiJson(apiKey: string, model: string, prompt: string, maxOutputTokens = 16000): Promise<any> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 800)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no JSON text');
  return parseLooseJson(text);
}

function generationPrompt(d: DocLike): string {
  return `You are an expert Australian tradie estimator. Regenerate a clean materials list for this quote scope. Return ONLY JSON:
{ "estimatedHours": number, "materials": [ { "name": string, "searchTerm": string, "quantity": number, "unit": "each|m|m²|m³|kg|L", "reasoning": string } ] }

Rules:
- Use smallest physical requirement units, not guessed packs: screws/nails as each, gravel/sand as kg, oil as L, weed mat as m², timber length as m except decking boards as each.
- Include named primary materials and all major consumables.
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
      all.push(d);
    }
  }
  return all.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt)).slice(0, args.limit);
}

async function scraperBatch(terms: string[]): Promise<Map<string, ScraperProduct[]>> {
  const url = process.env.BUNNINGS_SCRAPER_URL;
  const key = process.env.BUNNINGS_SCRAPER_API_KEY;
  if (!url || !key) throw new Error('Missing BUNNINGS_SCRAPER_URL / BUNNINGS_SCRAPER_API_KEY');
  const out = new Map<string, ScraperProduct[]>();
  for (let i = 0; i < terms.length; i += 10) {
    const searches = terms.slice(i, i + 10).map(searchTerm => ({ searchTerm, limit: 5, sortBy: 'relevance' }));
    const res = await fetch(`${url.replace(/\/$/, '')}/api/batch-search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify({ searches }) });
    if (!res.ok) throw new Error(`Scraper batch ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json();
    for (const item of data.results || []) out.set(item.searchTerm, item.success ? item.results || [] : []);
    for (const s of searches) if (!out.has(s.searchTerm)) out.set(s.searchTerm, []);
  }
  return out;
}

function deterministicFallbackUnitPrice(m: ReplayMaterial): number | null {
  const name = `${m.searchTerm} ${m.name}`.toLowerCase();
  if (/decking.*board|deck.*board|hardwood.*decking|merbau|spotted\s+gum/.test(name)) return 75;
  if (/treated\s+pine|structural\s+pine/.test(name)) return m.unit === 'm' ? 12 : 55;
  if (/fascia.*board/.test(name)) return 65;
  if (/roof\s+tile|concrete\s+tile/.test(name)) return 7;
  if (/paint/.test(name)) return m.unit === 'L' ? 18 : 55;
  if (/oil|sealer|stain/.test(name)) return m.unit === 'L' ? 25 : 80;
  if (/weed\s+mat|geotextile|landscape\s+fabric/.test(name)) return m.unit === 'm²' ? 1.5 : 45;
  if (/gravel|aggregate|road\s+base|crusher\s+dust|sand/.test(name)) return m.unit === 'kg' ? 0.25 : 12;
  if (/screws?|nails?/.test(name)) return m.unit === 'each' ? 0.08 : 18;
  if (/joist\s+hanger/.test(name)) return 8;
  if (/bracket|multigrip|connector|clip/.test(name)) return 3;
  if (/silicone|sealant|caulk/.test(name)) return 14;
  if (/pointing\s+compound/.test(name)) return 55;
  if (/diesel|petrol|fuel/.test(name)) return m.unit === 'L' ? 2.5 : null;
  if (/hire|dump|tipping|disposal|skip/.test(name)) return 150;
  return null;
}

function priceReplay(materials: ReplayMaterial[], candidates: Map<string, ScraperProduct[]>): any[] {
  return materials.map(m => {
    const ranked = (candidates.get(m.searchTerm) || []).filter(p => p.price > 0).sort((a, b) => {
      const score = (x: ScraperProduct) => x.confidence === 'high' ? 0 : x.confidence === 'medium' ? 1 : 2;
      return score(a) - score(b) || a.price - b.price;
    });
    const chosen = pickBestCandidate(ranked as RankableCandidate[], { name: m.name, searchTerm: m.searchTerm }) as ScraperProduct | null;
    if (!chosen) {
      const fallback = deterministicFallbackUnitPrice(m);
      if (fallback && fallback > 0) return { ...m, price: fallback, totalPrice: Math.round(fallback * m.quantity * 100) / 100, priceStatus: 'estimated', candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
      return { ...m, price: 0, totalPrice: 0, priceStatus: 'unpriced', candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
    }
    const pack = chosen.packSize && chosen.packUnit ? { packSize: chosen.packSize, packUnit: chosen.packUnit } : parsePackInfo(`${chosen.productName} ${chosen.description || ''}`);
    let purchaseCount = m.quantity;
    let purchaseUnit = m.unit;
    if (pack && pack.packSize > 1 && normUnit(m.unit) && normUnit(m.unit) === normUnit(pack.packUnit)) {
      purchaseCount = Math.max(1, Math.ceil(m.quantity / pack.packSize));
      purchaseUnit = ['m', 'm²', 'm³'].includes(pack.packUnit) ? 'each' : 'pack';
    }
    const unitPrice = chosen.priceIncGst || chosen.price;
    return { ...m, requiredQty: m.quantity, quantity: purchaseCount, unit: purchaseUnit, price: unitPrice, totalPrice: Math.round(unitPrice * purchaseCount * 100) / 100, priceStatus: 'priced', chosen: { name: chosen.productName, price: unitPrice, confidence: chosen.confidence, itemNumber: chosen.itemNumber, pack }, candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
  });
}

function comparePrompt(stored: any, replay: any): string {
  return `You are Gemini Pro reviewing a QuoteMate regression replay. Compare the stored quote against a freshly regenerated-and-live-priced replay. Identify gaps in our pipeline/tests. Return ONLY JSON:
{ "verdict": "pass"|"review"|"fail", "summary": string, "gaps": [ { "kind": string, "severity": "low"|"medium"|"high", "item": string, "stored": string, "replay": string, "recommendation": string } ], "testAssertions": string[] }

Stored quote:
${JSON.stringify(stored, null, 2)}

Fresh replay with fetched prices:
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
      const gen = await geminiJson(geminiKey, args.model, generationPrompt(d));
      const mats: ReplayMaterial[] = (gen.materials || []).filter((m: any) => m.name && m.searchTerm && m.quantity > 0).slice(0, 30);
      process.stdout.write(`${mats.length} mats, fetch prices... `);
      const cand = await scraperBatch([...new Set(mats.map(m => m.searchTerm))]);
      const priced = priceReplay(mats, cand);
      const replay = { estimatedHours: gen.estimatedHours, materialsSubtotal: Math.round(priced.reduce((s, m) => s + (m.totalPrice || 0), 0) * 100) / 100, materials: priced };
      process.stdout.write('compare... ');
      const stored = { id: d.id, number: d.number, stage: d.stage, job: { name: d.job?.name, description: d.job?.description, template: d.job?.template, estimatedHours: d.job?.estimatedHours }, pricing: { total: d.total, materialsSubtotal: d.materialsSubtotal, laborHours: d.laborHours, laborTotal: d.laborTotal }, sections: (d.sections || []).map((s: any) => ({ name: s.name, hours: s.laborHoursTotal || s.laborHours, total: s.laborTotal })), materials: (d.materials || []).map((m: any) => ({ name: m.name, quantity: m.quantity, unit: m.unit, price: m.price, totalPrice: m.totalPrice, requiredQty: m.requiredQty, packSize: m.packSize, packUnit: m.packUnit, pricingSource: m.pricingSource, priceConfidence: m.priceConfidence })) };
      const oracle = await geminiJson(geminiKey, args.model, comparePrompt(stored, replay));
      console.log(oracle.verdict);
      results.push({ id: d.id, number: d.number, stage: d.stage, deterministicIssues: checkDocumentIntegrity(d as any), oracle, storedRedacted: { ...stored, job: { ...stored.job, description: undefined, descriptionLength: d.job?.description?.length || 0 } }, replay: { ...replay, materials: replay.materials.map((m: any) => ({ ...m, candidates: undefined })) } });
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
