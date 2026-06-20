/**
 * [1] Quote driver — produces a REAL-priced quote for a scenario, plus the
 * playback payload the app demo harness replays.
 *
 *   local   (default) — derive materials from the repo's nicheTemplates
 *                        formulas, price each via the live Bunnings scraper
 *                        proxy (no auth), reconcile pack math locally, and
 *                        total with the app's own calculateDocumentTotals.
 *   backend (--mode backend, needs FIREBASE_ID_TOKEN) — drive the real LLM
 *                        pipeline: analyzeJobDescription -> scraper ->
 *                        reconcilePricedMaterials.
 *
 * Both modes emit out/<slug>.quote.json and out/<slug>.demo.json.
 *
 *   tsx driver/generateQuote.ts <slug> [--mode local|backend]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NicheJobTemplate } from '../../src/data/nicheTemplates';
import type { ScraperProduct } from '../../src/services/bunningsScraperClient';
import type { Material, Quote } from '../../src/types';
import type { DemoEvent, DemoPayload } from '../../src/demo/demoTypes';

// The app's source is resolved as CommonJS (the RN/Expo package isn't ESM),
// so named ESM imports across that boundary fail at link time. Load the
// runtime modules dynamically with a default-export interop fallback instead.
let NICHE_TEMPLATES: NicheJobTemplate[];
let calculateDocumentTotals: typeof import('../../src/utils/documentCalculator').calculateDocumentTotals;
let findCandidatesForMaterial: typeof import('../../src/services/bunningsScraperClient').findCandidatesForMaterial;

async function loadAppModules(): Promise<void> {
  const pick = (m: any, k: string) => m[k] ?? m.default?.[k];
  const [tmpl, calc, scraper] = await Promise.all([
    import('../../src/data/nicheTemplates'),
    import('../../src/utils/documentCalculator'),
    import('../../src/services/bunningsScraperClient'),
  ]);
  NICHE_TEMPLATES = pick(tmpl, 'NICHE_TEMPLATES');
  calculateDocumentTotals = pick(calc, 'calculateDocumentTotals');
  findCandidatesForMaterial = pick(scraper, 'findCandidatesForMaterial');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FUNCTIONS_URL =
  process.env.USE_FIREBASE_EMULATOR === 'true'
    ? 'http://127.0.0.1:5001/hansendev/us-central1'
    : 'https://us-central1-hansendev.cloudfunctions.net';

interface Scenario {
  slug: string;
  title: string;
  trade: { categoryId: string; nicheId: string; categoryName: string; nicheName: string };
  templateId: string;
  params: Record<string, number>;
  jobDescription: string;
  labour: {
    rate: number;
    unit: 'hours' | 'days';
    hoursOverride: number | null;
    materialMarkupPercent: number;
    laborMarkupPercent: number;
  };
  customer: { name: string; address?: string };
  conversation: {
    request: string;
    mateAck: string;
    clarifyingQuestion: string;
    clarifyingAnswer: string;
    matePricing: string;
    reveal: string;
  };
}

// ---- helpers ---------------------------------------------------------------

/** Evaluate a template quantity/hours formula against the scenario params. */
function evalFormula(formula: string, params: Record<string, number>): number {
  const keys = Object.keys(params);
  const fn = new Function(...keys, 'Math', `return (${formula});`);
  const out = fn(...keys.map((k) => params[k]), Math);
  return Number.isFinite(out) ? out : 0;
}

/** Pull a pack/length size out of a product name when the scraper didn't set it. */
function parsePackSize(p: ScraperProduct): number | undefined {
  if (p.packSize && p.packSize > 0) return p.packSize;
  const m = p.productName.match(/(\d+)\s*(?:pack|pk|pieces|pcs)\b/i);
  return m ? Number(m[1]) : undefined;
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'per', 'piece', 'colour', 'matched', 'steel']);
const tokenize = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t));

/**
 * Local (no-LLM) candidate pick: among the scraper's ranked, priced results,
 * prefer the one whose product name shares the most tokens with the material
 * name + search term. A poor man's category gate — backend mode uses the real
 * LLM reconciliation (reconcilePricedMaterials) for higher fidelity.
 */
function pickBestLocal(
  name: string,
  searchTerm: string,
  candidates: ScraperProduct[],
): { product: ScraperProduct; overlap: number } | null {
  if (candidates.length === 0) return null;
  const want = new Set([...tokenize(name), ...tokenize(searchTerm)]);
  const scored = candidates.map((c) => {
    const overlap = new Set(tokenize(c.productName)).size
      ? tokenize(c.productName).filter((t) => want.has(t)).length
      : 0;
    return { product: c, overlap, priced: (c.priceIncGst || c.price) > 0 };
  });
  scored.sort((a, b) => Number(b.priced) - Number(a.priced) || b.overlap - a.overlap);
  return scored[0];
}

function emptyMaterial(id: string, name: string, qty: number, unit: Material['unit'], searchTerm: string): Material {
  return {
    id,
    name,
    quantity: qty,
    unit,
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    searchTerm,
    pricingSource: 'ai',
    priceConfidence: 'low',
  };
}

// ---- local pricing ---------------------------------------------------------

async function buildMaterialsLocal(
  template: NicheJobTemplate,
  params: Record<string, number>,
  slug: string,
): Promise<Material[]> {
  const out: Material[] = [];
  let i = 0;
  for (const def of template.defaultMaterials ?? []) {
    const qty = Math.max(0, Math.ceil(evalFormula(def.quantityFormula, params)));
    if (qty <= 0) continue;
    const id = `${slug}-mat-${i++}`;
    const unit = (def.unit as Material['unit']) ?? 'each';
    const searchTerm = def.searchTerm ?? def.name;

    const candidates = await findCandidatesForMaterial(searchTerm, 5);
    const pick = pickBestLocal(def.name, searchTerm, candidates);
    if (!pick) {
      console.warn(`  ! no candidate for "${searchTerm}" — left unpriced`);
      out.push(emptyMaterial(id, def.name, qty, unit, searchTerm));
      continue;
    }
    const best = pick.product;

    // For pack-sold products, the template formula already yields the count of
    // purchasable units (sheets, posts, bags, packs), so purchaseCount == qty.
    const price = best.priceIncGst || best.price;
    // No token overlap → likely a category miss; flag it low-confidence.
    const confidence = pick.overlap === 0 ? 'low' : best.confidence;
    out.push({
      id,
      name: def.name,
      quantity: qty,
      requiredQty: qty,
      packSize: parsePackSize(best),
      unit,
      price,
      totalPrice: Math.round(price * qty * 100) / 100,
      manualPriceOverride: false,
      searchTerm,
      productUrl: best.productUrl,
      pricingSource: 'scraper',
      priceConfidence: confidence,
      bunningsItemNumber: best.itemNumber,
      imageUrl: best.imageUrl,
      description: Array.isArray((best as any).description)
        ? (best as any).description.join(' · ')
        : best.description,
      brand: best.brand,
      stockCheckedAt: best.stockCheckedAt,
    });
    console.log(`  ✓ ${def.name}: ${qty} × $${price} = $${(price * qty).toFixed(2)}  (${best.productName})`);
  }
  return out;
}

// ---- backend pricing (full LLM pipeline) -----------------------------------

async function postJson(path: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function buildMaterialsBackend(scenario: Scenario, slug: string): Promise<Material[]> {
  const token = process.env.FIREBASE_ID_TOKEN;
  if (!token) throw new Error('backend mode needs FIREBASE_ID_TOKEN (marketing-bot account id token)');

  const analysis = await postJson(
    'analyzeJobDescription',
    {
      jobDescription: scenario.jobDescription,
      tradeContext: {
        categoryName: scenario.trade.categoryName,
        nicheName: scenario.trade.nicheName,
      },
    },
    token,
  );
  const rawMaterials: any[] = analysis.materials ?? [];

  // Price each material's searchTerm, then let reconciliation pick + pack.
  const items = [];
  for (let i = 0; i < rawMaterials.length; i++) {
    const m = rawMaterials[i];
    const candidates = await findCandidatesForMaterial(m.searchTerm ?? m.name, 5);
    items.push({
      id: `${slug}-mat-${i}`,
      name: m.name,
      requirement: m.quantity,
      requirementUnit: m.unit,
      _raw: m,
      _candidates: candidates,
      candidates: candidates.map((c) => ({
        name: c.productName,
        price: c.priceIncGst || c.price,
        url: c.productUrl,
        description: Array.isArray((c as any).description) ? (c as any).description.join(' · ') : c.description,
      })),
    });
  }

  const reconciled = await postJson(
    'reconcilePricedMaterials',
    {
      jobName: analysis.jobSummary,
      jobDescription: scenario.jobDescription,
      items: items.map(({ id, name, requirement, requirementUnit, candidates }) => ({
        id,
        name,
        requirement,
        requirementUnit,
        candidates,
      })),
    },
    token,
  );
  const byId = new Map<string, any>((reconciled.results ?? []).map((r: any) => [r.id, r]));

  const out: Material[] = [];
  for (const item of items) {
    const r = byId.get(item.id);
    const unit = (item._raw.unit as Material['unit']) ?? 'each';
    if (!r || r.decision === 'reject') {
      out.push(emptyMaterial(item.id, item.name, item.requirement, unit, item._raw.searchTerm ?? item.name));
      continue;
    }
    const chosen = r.decision === 'apply' ? item._candidates[r.chosenIndex] : undefined;
    const price = chosen ? chosen.priceIncGst || chosen.price : r.estimatedUnitPrice ?? 0;
    const qty = r.purchaseCount ?? item.requirement;
    out.push({
      id: item.id,
      name: item.name,
      quantity: qty,
      requiredQty: item.requirement,
      unit,
      price,
      totalPrice: r.totalPrice ?? Math.round(price * qty * 100) / 100,
      manualPriceOverride: false,
      searchTerm: item._raw.searchTerm ?? item.name,
      productUrl: chosen?.productUrl,
      pricingSource: chosen ? 'scraper' : 'ai',
      priceConfidence: r.confidence ?? 'medium',
      bunningsItemNumber: chosen?.itemNumber,
      imageUrl: chosen?.imageUrl,
      brand: chosen?.brand,
      section: item._raw.section,
    });
  }
  return out;
}

// ---- assembly --------------------------------------------------------------

function assembleQuote(scenario: Scenario, template: NicheJobTemplate, materials: Material[]): Quote {
  const laborHours =
    scenario.labour.hoursOverride ??
    Math.round(evalFormula(template.estimatedHoursFormula ?? '8', scenario.params) * 10) / 10;
  const rate = scenario.labour.rate;
  const totals = calculateDocumentTotals(
    materials,
    rate,
    laborHours,
    scenario.labour.materialMarkupPercent,
    0,
    undefined,
    scenario.labour.laborMarkupPercent,
    0,
    true, // scraper prices are GST-inclusive
  );
  const now = new Date();
  return {
    id: `demo-${scenario.slug}`,
    quoteNumber: 'Q-DEMO',
    createdAt: now,
    updatedAt: now,
    customerName: scenario.customer.name,
    jobAddress: scenario.customer.address,
    job: { id: `demo-${scenario.slug}-job`, name: template.name, description: scenario.jobDescription, template: 'fence' },
    materials,
    laborRate: rate,
    laborHours,
    laborUnit: scenario.labour.unit,
    laborTotal: totals.laborTotal,
    materialsSubtotal: totals.materialsSubtotal,
    markup: scenario.labour.materialMarkupPercent,
    laborMarkup: scenario.labour.laborMarkupPercent,
    markupAmount: totals.markupAmount,
    subtotal: totals.subtotal,
    gst: totals.gst,
    total: totals.total,
    status: 'draft',
    pricesIncludeGst: true,
    showMarkup: false,
    showMaterialCosts: true,
    showLaborCosts: true,
  };
}

function buildDemoPayload(scenario: Scenario, quote: Quote): DemoPayload {
  const c = scenario.conversation;
  const events: DemoEvent[] = [
    { kind: 'user', text: c.request },
    { kind: 'assistant', text: `${c.mateAck}\n\n${c.clarifyingQuestion}` },
    { kind: 'user', text: c.clarifyingAnswer, delayMs: 900 },
    {
      kind: 'working',
      phases: [
        { phase: 'analyzing', status: 'Reading the job…', ms: 1100 },
        { phase: 'building', status: 'Building the materials list…', detail: 'Posts, rails, infill, gate kit', ms: 1300 },
        { phase: 'pricing', status: 'Pricing with live supplier rates…', detail: `${quote.materials.length} items`, ms: 1700 },
        { phase: 'done', status: 'Quote ready', ms: 500 },
      ],
    },
    { kind: 'reveal', quoteId: quote.id, text: c.reveal },
  ];
  return { quote, events, options: { typingMsPerChar: 22, betweenMs: 650, startDelayMs: 700 } };
}

// ---- main ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  const mode = (args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'local') as 'local' | 'backend';
  if (!slug) throw new Error('usage: generateQuote.ts <slug> [--mode local|backend]');

  await loadAppModules();
  const scenario: Scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios', `${slug}.json`), 'utf8'));
  const template = NICHE_TEMPLATES.find((t) => t.id === scenario.templateId);
  if (!template) throw new Error(`template not found: ${scenario.templateId}`);

  console.log(`\n[${slug}] ${scenario.title}  (mode: ${mode})\n`);
  const materials =
    mode === 'backend'
      ? await buildMaterialsBackend(scenario, slug)
      : await buildMaterialsLocal(template, scenario.params, slug);

  const quote = assembleQuote(scenario, template, materials);
  const priced = materials.filter((m) => m.totalPrice > 0).length;
  console.log(
    `\n  materials $${quote.materialsSubtotal}  labour $${quote.laborTotal}  ` +
      `markup $${quote.markupAmount}  gst $${quote.gst}  TOTAL $${quote.total}`,
  );
  console.log(`  ${priced}/${materials.length} line items priced from live supplier data\n`);

  const outDir = join(ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${slug}.quote.json`), JSON.stringify(quote, null, 2));
  writeFileSync(join(outDir, `${slug}.demo.json`), JSON.stringify(buildDemoPayload(scenario, quote), null, 2));
  console.log(`  → out/${slug}.quote.json`);
  console.log(`  → out/${slug}.demo.json\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
