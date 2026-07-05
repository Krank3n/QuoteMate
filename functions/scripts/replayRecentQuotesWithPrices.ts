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

interface Args { limit: number; project: string; model: string; out: string; uid?: string; diverse: boolean; perUser: number }
interface DocLike { id: string; uid: string; number?: string; type?: string; stage?: string; createdAt?: any; job?: any; materials?: any[]; sections?: any[]; total?: number; materialsSubtotal?: number; laborHours?: number; laborTotal?: number; [k: string]: any }
interface ReplayMaterial { name: string; searchTerm: string; quantity: number; unit: string; reasoning?: string }
interface ScraperProduct { productName: string; description?: string; price: number; priceIncGst?: number; unit?: string; itemNumber?: string; productUrl?: string; confidence?: string; packSize?: number; packUnit?: string }

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const PACK_PATTERNS: Array<{ re: RegExp; unit: string }> = [
  { re: new RegExp(String.raw`\b(?:box|pack|packet|bag|tub|carton|case)\s+of\s+${NUM}\b`, 'i'), unit: 'each' },
  { re: new RegExp(String.raw`\b${NUM}\s*[- ]?(?:pack|pk|box|carton)\b`, 'i'), unit: 'each' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:pieces|piece|pcs|pc)\b`, 'i'), unit: 'each' },
  { re: new RegExp(String.raw`${NUM}\s*(?:m²|m2|sqm|sq\s*m|square\s+(?:metres?|meters?))\b`, 'i'), unit: 'm²' },
  { re: new RegExp(String.raw`${NUM}\s*(?:m³|m3|cubic\s+(?:metres?|meters?))\b`, 'i'), unit: 'm³' },
  { re: new RegExp(String.raw`(?<![\d.])${NUM}\s*m(?![lm²2a-z])(?:\s+(?:length|long|roll))?`, 'i'), unit: 'm' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:kg|g|grams?)\b`, 'i'), unit: 'kg' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:ml|millilitres?|milliliters?)\b`, 'i'), unit: 'L' },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:l|lt|litres?|liters?)\b`, 'i'), unit: 'L' },
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
    diverse: (get('diverse') || 'false') === 'true',
    perUser: Math.max(1, Math.min(parseInt(get('per-user') || '2', 10), 10)),
  };
}
function tsToMs(t: any): number { return typeof t?.toMillis === 'function' ? t.toMillis() : typeof t?._seconds === 'number' ? t._seconds * 1000 : typeof t === 'number' ? t : 0; }
function parsePackInfo(title?: string | null): { packSize: number; packUnit: string } | null {
  if (!title) return null;
  const areaDims = title.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|m)\b/i);
  if (areaDims && /\b(?:roll|fabric|mat|geotextile|membrane|sheet|sheeting|film|wrap|sarking|barrier|insulation|plastic|polyethylene|poly)\b/i.test(title)) {
    const a = parseFloat(areaDims[1]) / (areaDims[2].toLowerCase() === 'mm' ? 1000 : 1);
    const b = parseFloat(areaDims[3]) / (areaDims[4].toLowerCase() === 'mm' ? 1000 : 1);
    if (a > 0 && b > 0) return { packSize: Math.round(a * b * 100) / 100, packUnit: 'm²' };
  }
  const mm = title.match(/\b(\d{4})\s*mm\s+(?:length|long)\b/i);
  if (mm) return { packSize: parseInt(mm[1], 10) / 1000, packUnit: 'm' };
  for (const p of PACK_PATTERNS) {
    const m = title.match(p.re); if (!m) continue;
    let size = parseFloat(m[1]); if (!(size > 0)) continue;
    if (p.unit === 'L' && /(?:ml|millilitres?|milliliters?)/i.test(m[0])) size = size / 1000;
    if (p.unit === 'kg' && /\d\s*(?:g|grams?)\b/i.test(m[0]) && !/kg/i.test(m[0])) size = size / 1000;
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

async function geminiJsonWithFallback(apiKey: string, model: string, prompt: string, maxOutputTokens = 16000): Promise<any> {
  try {
    return await geminiJson(apiKey, model, prompt, maxOutputTokens);
  } catch (err) {
    if (model === 'gemini-2.5-pro') throw err;
    return await geminiJson(apiKey, 'gemini-2.5-pro', prompt, maxOutputTokens);
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

function deterministicFallbackUnitPrice(m: ReplayMaterial): number | null {
  const name = `${m.searchTerm} ${m.name}`.toLowerCase();
  if (/screws?|nails?/.test(name)) return m.unit === 'each' ? 0.08 : 18;
  if (/(?:wire|lever)\s+connectors?|wago\s+connectors?/.test(name)) return m.unit === 'each' ? 0.5 : 25;
  if (/exposed\s+aggregate\s+concrete|ready[-\s]?mix\s+concrete|concrete\s+for\s+slab|slab\s+concrete/.test(name)) return m.unit === 'm³' ? 300 : 12;
  if (/rinnai\s*b26|continuous\s+flow\s+gas\s+hot\s+water|gas\s+hot\s+water\s+heater/.test(name)) return 1350;
  if (/gas\s+compliance\s+certificate|compliance\s+certificate/.test(name)) return 150;
  if (/stump\s+grinder\s+(?:replacement\s+)?teeth|grinder\s+teeth/.test(name)) return 35;
  if (/material\s+delivery|delivery\s+fee/.test(name)) return 150;
  if (/colorbond\s+fence\s+(?:sheet|panel)|fence\s+(?:sheet|panel).*colorbond/.test(name)) return 38;
  if (/colorbond\s+fence\s+rail|fence\s+rail.*colorbond/.test(name)) return 18;
  if (/\b(?:rhs|shs)\b|rectangular\s+hollow|square\s+hollow/.test(name)) return m.unit === 'm' ? 45 : 180;
  if (/steel\s+base\s+plate|base\s+plate/.test(name)) return 28;
  if (/steel\s+post|galvanised\s+post|galvanized\s+post/.test(name)) return m.unit === 'm' ? 38 : 90;
  if (/plasterboard|villaboard|fibre\s+cement\s+sheet|fiber\s+cement\s+sheet|cement\s+sheet|cladding\s+sheets?|external\s+cladding/.test(name)) return m.unit === 'm²' ? 12 : 35;
  if (/floor\s+tiles?|wall\s+tiles?|ceramic\s+tiles?|porcelain\s+tiles?/.test(name) && !/roof/.test(name)) return m.unit === 'm²' ? 45 : 30;
  if (/\bgrout\b/.test(name)) return m.unit === 'kg' ? 4 : 55;
  if (/\b(?:pvc|pex)\b.*\bpipe\b|\bpipe\b.*\b(?:pvc|pex)\b|waste\s+pipe|dwv\s+pipe/.test(name)) return m.unit === 'm' ? 8 : 24;
  if (/basin\s+mixer|mixer\s+tap/.test(name)) return 140;
  if (/plumber'?s?\s+putty|plumbing\s+putty/.test(name)) return 12;
  if (/disposable\s+coveralls?|painters?\s+coveralls?|coveralls?/.test(name)) return 12;
  if (/debris\s+netting|safety\s+debris|shade\s+cloth|safety\s+mesh/.test(name)) return m.unit === 'm²' ? 2 : 80;
  if (/decking.*board|deck.*board|hardwood.*decking|merbau|spotted\s+gum/.test(name)) return 75;
  if (/palings?|paling/.test(name)) return 3.5;
  if (/fence\s+rail|75\s*x\s*38.*rail/.test(name)) return m.unit === 'm' ? 4 : 15;
  if (/90\s*x\s*45|70\s*x\s*35|framing\s+timber|mgp10|mgp12|structural\s+pine|treated\s+pine/.test(name)) return m.unit === 'm' ? 8 : 15;
  if (/fascia.*board/.test(name)) return 65;
  if (/roof\s+tile|concrete\s+tile/.test(name)) return 7;
  if (/paint/.test(name)) return m.unit === 'L' ? 18 : 55;
  if (/oil|sealer|stain/.test(name)) return m.unit === 'L' ? 25 : 80;
  if (/weed\s+mat|geotextile|landscape\s+fabric/.test(name)) return m.unit === 'm²' ? 1.5 : 45;
  if (/road\s+base|crusher\s+dust|aggregate\s+base/.test(name)) return m.unit === 'm³' ? 110 : m.unit === 'kg' ? 0.08 : 95;
  if (/gravel|aggregate|sand/.test(name)) return m.unit === 'm³' ? 120 : m.unit === 'kg' ? 0.12 : 12;
  if (/sliding\s+gate\s+(?:catcher|receiver|stop)|gate\s+(?:catcher|receiver|stop)/.test(name)) return 30;
  if (/sliding\s+gate\s+wheels?|gate\s+wheels?/.test(name)) return 35;
  if (/electrical\s+tape|insulation\s+tape/.test(name)) return 5;
  if (/joist\s+hanger/.test(name)) return 8;
  if (/bracket|multigrip|connector|clip/.test(name)) return 3;
  if (/silicone|sealant|caulk/.test(name)) return 14;
  if (/pointing\s+compound/.test(name)) return m.unit === 'L' ? 5.5 : 55;
  if (/airless\s+sprayer\s+cleanup|sprayer\s+cleanup|pump\s+armor|pump\s+protector/.test(name)) return m.unit === 'L' ? 18 : 35;
  if (/2[-\s]?stroke.*(?:fuel|mix)|chainsaw\s+fuel|fuel\s+mix/.test(name)) return m.unit === 'L' ? 5 : null;
  if (/2[-\s]?stroke\s+(?:engine\s+)?oil/.test(name)) return m.unit === 'L' ? 18 : 22;
  if (/vehicle\s+(?:running\s+)?(?:costs?|fuel)|travel\s+fuel/.test(name)) return 35;
  if (/diesel|petrol|fuel|unleaded/.test(name)) return m.unit === 'L' ? 2.5 : m.unit === 'each' ? 35 : null;
  if (/concrete\s+pump|pump\s+hire/.test(name)) return 850;
  if (/hook\s*bin|soil\s+disposal|spoil\s+disposal|dirt\s+disposal|heavy\s+waste/.test(name)) return m.unit === 'm³' ? 110 : m.unit === 'kg' ? 0.18 : 1200;
  if (/skip/.test(name)) return m.unit === 'm³' ? 110 : 650;
  if (/green\s+waste.*(?:disposal|dump|tip)|(?:disposal|dump|tip).*green\s+waste/.test(name)) return m.unit === 'kg' ? 0.1 : m.unit === 'm³' ? 60 : 120;
  if (/dump|tipping|disposal/.test(name)) return m.unit === 'kg' ? 0.25 : 250;
  if (/hire/.test(name)) return 250;
  return null;
}

function shouldUseTradeFallbackInsteadOfRetail(m: ReplayMaterial): boolean {
  const name = `${m.searchTerm} ${m.name}`.toLowerCase();
  if (/rinnai\s*b26|continuous\s+flow\s+gas\s+hot\s+water|gas\s+hot\s+water\s+heater|gas\s+compliance\s+certificate|compliance\s+certificate|stump\s+grinder\s+(?:replacement\s+)?teeth|grinder\s+teeth|material\s+delivery|delivery\s+fee/.test(name)) return true;
  if (/colorbond\s+fence\s+(?:sheet|panel|rail)|fence\s+(?:sheet|panel|rail).*colorbond/.test(name)) return true;
  if (/\b(?:rhs|shs)\b|rectangular\s+hollow|square\s+hollow|steel\s+base\s+plate|base\s+plate/.test(name)) return true;
  if (/plasterboard|villaboard|fibre\s+cement\s+sheet|fiber\s+cement\s+sheet|cement\s+sheet|cladding\s+sheets?|external\s+cladding|floor\s+tiles?|wall\s+tiles?|\bgrout\b|basin\s+mixer|mixer\s+tap|plumber'?s?\s+putty|plumbing\s+putty|debris\s+netting|safety\s+debris/.test(name)) return true;
  if (/road\s+base|crusher\s+dust|aggregate\s+base/.test(name)) return true;
  if (/green\s+waste|tip\s*fee|tipping|dumping|disposal|hook\s*bin|soil\s+disposal|spoil\s+disposal|dirt\s+disposal|heavy\s+waste/.test(name)) return true;
  if (/vehicle\s+(?:running\s+)?(?:costs?|fuel)|travel\s+fuel/.test(name)) return true;
  if (/\b(?:diesel|petrol|unleaded|machine\s+fuel)\b/.test(name)) return true;
  if (/2[-\s]?stroke.*(?:fuel|mix)|chainsaw\s+fuel|fuel\s+mix|2[-\s]?stroke\s+(?:engine\s+)?oil/.test(name)) return true;
  if (/airless\s+sprayer\s+cleanup|sprayer\s+cleanup|pump\s+armor|pump\s+protector/.test(name)) return true;
  if (/concrete\s+pump|pump\s+hire|skip|\bhire\b/.test(name)) return true;
  if ((/exposed\s+aggregate\s+concrete|ready[-\s]?mix\s+concrete|concrete\s+for\s+slab|slab\s+concrete|\b\d{2}\s*mpa\b.*concrete|concrete.*\b\d{2}\s*mpa\b/.test(name)) && (m.unit === 'm³' || m.quantity >= 0.5)) return true;
  return false;
}

function firstMetreLengthText(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*m\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && n <= 20 ? n : null;
}

function priceReplay(materials: ReplayMaterial[], candidates: Map<string, ScraperProduct[]>): any[] {
  return materials.map(m => {
    if (shouldUseTradeFallbackInsteadOfRetail(m)) {
      const fallback = deterministicFallbackUnitPrice(m);
      if (fallback && fallback > 0) return { ...m, price: fallback, totalPrice: Math.round(fallback * m.quantity * 100) / 100, priceStatus: 'estimated-trade', candidates: [] };
    }
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
    const titlePack = parsePackInfo(chosen.productName);
    const rawSuppliedPack = chosen.packSize && chosen.packUnit ? { packSize: chosen.packSize, packUnit: chosen.packUnit } : null;
    const suspiciousSuppliedEachPack = rawSuppliedPack?.packUnit === 'each' && rawSuppliedPack.packSize > 100 && !/\b(?:pack|box|pcs?|pieces?|jar|tub|carton|case)\b/i.test(chosen.productName || '');
    const suppliedPack = suspiciousSuppliedEachPack ? null : rawSuppliedPack;
    const compatible = (a?: string, b?: string) => normUnit(a) === normUnit(b) || (/pointing|compound|mortar|adhesive/i.test(`${m.name} ${chosen.productName}`) && ((normUnit(a) === 'L' && normUnit(b) === 'kg') || (normUnit(a) === 'kg' && normUnit(b) === 'L')));
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
    return { ...m, requiredQty: m.quantity, quantity: purchaseCount, unit: purchaseUnit, price: unitPrice, totalPrice: Math.round(unitPrice * purchaseCount * 100) / 100, priceStatus: 'priced', chosen: { name: chosen.productName, price: unitPrice, confidence: chosen.confidence, itemNumber: chosen.itemNumber, pack }, candidates: ranked.slice(0, 3).map(p => ({ name: p.productName, price: p.priceIncGst || p.price, confidence: p.confidence })) };
  });
}

function comparePrompt(stored: any, replay: any): string {
  return `You are Gemini Pro reviewing a QuoteMate MATERIAL/PRICING regression replay.

Important scope: the replay JSON is intentionally a PARTIAL replay containing regenerated materials, live/estimated material prices, material subtotal, and estimatedHours. It is NOT expected to include full QuoteMate document schema, customer metadata, nested pricing totals, sections, markup, GST, or final quote total. Do NOT flag missing quote schema/metadata/pricing object as a failure.

Compare the stored quote's materials/labour to the freshly regenerated-and-live-priced material replay. Identify actionable gaps in material generation, supplier product matching, pack/unit conversion, fallback estimates, and labour realism. Return ONLY JSON:
{ "verdict": "pass"|"review"|"fail", "summary": string, "gaps": [ { "kind": string, "severity": "low"|"medium"|"high", "item": string, "stored": string, "replay": string, "recommendation": string } ], "testAssertions": string[] }

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
      const priced = priceReplay(mats, cand);
      const replay = { estimatedHours: gen.estimatedHours, materialsSubtotal: Math.round(priced.reduce((s, m) => s + (m.totalPrice || 0), 0) * 100) / 100, materials: priced };
      process.stdout.write('compare... ');
      const stored = { id: d.id, number: d.number, stage: d.stage, job: { name: d.job?.name, description: d.job?.description, template: d.job?.template, estimatedHours: d.job?.estimatedHours }, pricing: { total: d.total, materialsSubtotal: d.materialsSubtotal, laborHours: d.laborHours, laborTotal: d.laborTotal }, sections: (d.sections || []).map((s: any) => ({ name: s.name, hours: s.laborHoursTotal || s.laborHours, total: s.laborTotal })), materials: (d.materials || []).map((m: any) => ({ name: m.name, quantity: m.quantity, unit: m.unit, price: m.price, totalPrice: m.totalPrice, requiredQty: m.requiredQty, packSize: m.packSize, packUnit: m.packUnit, pricingSource: m.pricingSource, priceConfidence: m.priceConfidence })) };
      const oracle = await geminiJsonWithFallback(geminiKey, args.model, comparePrompt(stored, replay));
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
