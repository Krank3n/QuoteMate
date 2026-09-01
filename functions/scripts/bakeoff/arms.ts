/**
 * The three arms of the bake-off. All see the identical customer scope text.
 *
 *  A. app               — production today: deployed analyzeJobDescription,
 *                         real scraper, real candidateRanker / packAwarePricing /
 *                         applyReconcileResult, deployed reconcile endpoint.
 *  B. claude-direct     — one Claude call, scope in, priced quote out, no
 *                         supplier data at all. "What Tom gets by asking Claude."
 *  C. claude-candidates — one Claude call given the scope AND the same real
 *                         candidate products arm A saw, doing selection,
 *                         quantity and pack maths together in one pass. This is
 *                         the inverted architecture under test.
 */

import './preload';

import { callFunction } from './auth';
import { askJson } from './claude';
import { batchSearch, describe, normalisedPrice, normaliseDescriptions } from './scraper';
import { ArmResult, CorpusJob, QuoteLine, ScraperProduct, Unit } from './types';

// Real production logic — not reimplementations.
import { convertLLMMaterialsToMaterials } from '../../../src/services/llmService';
import { applyPackAwarePricing } from '../../../src/utils/packAwarePricing';
import { pickBestCandidate, isSemanticallyCompatible, type RankableCandidate } from '../../../src/services/candidateRanker';
import { matchEvidence, stampMatchConfidence } from '../../../src/utils/matchEvidence';
import { isNonRetailTradeRow, tradeFallbackUnitPriceWithUnit } from '../../../src/utils/tradeFallback';
import { applyReconcileResult, applyLastResortGuess } from '../../../src/services/materialsPipeline';
import { simplifySearchTerm } from '../../../src/utils/simplifySearchTerm';
import { coverageSanePurchaseCount } from '../../../src/utils/purchaseCoverage';
import {
  parseJobAreaM2,
  geometricSanePieceCount,
  geometricMinimumPieceCount,
} from '../../../src/utils/geometricCoverage';
import type { ReconcileItem } from '../../src/reconcile.helpers';

const UNITS: Unit[] = ['each', 'pack', 'box', 'm', 'm²', 'm³', 'kg', 'L'];
function asUnit(u: any): Unit {
  const s = String(u || 'each');
  const map: Record<string, Unit> = { m2: 'm²', m3: 'm³', l: 'L', litre: 'L', litres: 'L' };
  const norm = map[s.toLowerCase()] || (s as Unit);
  return UNITS.includes(norm) ? norm : 'each';
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price every arm inc-GST for the bake-off.
 *
 * 295 of 338 real quotes run GST-EXCLUSIVE, so that is what production does —
 * but the scraper quotes inc-GST and the ground-truth oracle costs a line from
 * those same inc-GST figures. Scoring an ex-GST arm against an inc-GST
 * baseline silently marked the app ~10% cheaper than it is, and the blind
 * judge read the same lines as "below achievable retail on every line".
 *
 * GST mode is a uniform divide, not pipeline logic, so putting every arm and
 * the oracle on one basis removes the bias without changing what is measured.
 */
const GST_INCLUSIVE = true;
/** Mirrors materialsPipeline's PURCHASE_UNITS — units you can count purchases in. */
const PURCHASE_UNITS: ReadonlySet<string> = new Set(['each', 'pack', 'box']);

// ───────────────────────── Arm A: the app as it ships ─────────────────────────

export interface AppArmOptions {
  /**
   * Fix the description-array defect at the scraper boundary before the
   * pipeline sees it. false = the app exactly as it ships today (where the
   * array kills the whole reconcile pass through a bare catch).
   */
  normaliseDescription?: boolean;
  /** Distinguishes the two variants in results. */
  label?: 'app' | 'app-fixed';
}

/**
 * Production's materials generation, over the wire. Split out so the two app
 * variants price the IDENTICAL generated list — analyzeJobDescription is a
 * non-deterministic LLM call, and running it twice would confound the
 * description-fix comparison with generation variance.
 */
export async function generateAppMaterials(
  job: CorpusJob,
  seed?: { materials: any[]; estimatedHours?: number },
): Promise<{ materials: any[]; estimatedHours?: number }> {
  // Generation is non-deterministic, so comparing a fix against a previous run
  // by regenerating would confound the fix with generation variance. Seeding
  // from the earlier run's rows makes it a true A/B on identical input.
  if (seed) return seed;
  const gen: any = await callFunction('analyzeJobDescription', { jobDescription: job.jobDescription });
  const llmMaterials = Array.isArray(gen?.materials) ? gen.materials : [];
  if (llmMaterials.length === 0) throw new Error('analyzeJobDescription returned no materials');

  // Production's converter — this is what sets requiredQty/unit semantics.
  const converted = convertLLMMaterialsToMaterials(llmMaterials);
  const materials = converted.map((m, i) => ({
    id: `m${i}`,
    name: m.name || '',
    searchTerm: m.searchTerm || m.name || '',
    quantity: m.quantity ?? 0,
    unit: asUnit(m.unit),
    price: 0,
    totalPrice: 0,
    ...m,
  }));
  return { materials, estimatedHours: gen?.estimatedHours };
}

export async function runAppArm(
  job: CorpusJob,
  generated: { materials: any[]; estimatedHours?: number },
  opts: AppArmOptions = {},
): Promise<ArmResult> {
  const armName = (opts.label || 'app') as any;
  const t0 = Date.now();
  try {
    // Deep copy — the pipeline mutates rows in place, and both variants must
    // start from the same untouched generation.
    const materials: any[] = JSON.parse(JSON.stringify(generated.materials));

    // Non-retail rows are routed away from retail search entirely.
    const nonRetailIds = new Set<string>();
    for (const m of materials) {
      if (isNonRetailTradeRow(`${m.searchTerm || ''} ${m.name || ''}`, m.unit, m.requiredQty ?? m.quantity)) {
        nonRetailIds.add(m.id);
        const hit = tradeFallbackUnitPriceWithUnit(`${m.searchTerm || ''} ${m.name || ''}`, m.unit);
        // Production's unitSafeFallbackUnitPrice guard: only apply the table's
        // price when it is quoted in a unit the row can multiply by. A $30/each
        // grout price against a 15 kg requirement is REFUSED, leaving the row
        // honestly unpriced. Omitting this invented a $450 line prod never has.
        const unitSafe = !!hit && (hit.per === m.unit || PURCHASE_UNITS.has(m.unit));
        if (hit && hit.price > 0 && unitSafe) {
          m.price = round2(hit.price);
          m.totalPrice = round2(m.price * m.quantity);
          m.pricingSource = 'ai';
          m.priceConfidence = 'low';
          m.description = 'Fallback trade estimate — verify before sending';
        }
      }
    }

    // One shared scrape for every retail row.
    const retail = materials.filter((m) => !nonRetailIds.has(m.id));
    const terms = [...new Set(retail.map((m) => m.searchTerm || m.name))];
    const candidatesByTerm = await batchSearch(terms);

    const candidatesById = new Map<string, ScraperProduct[]>();
    for (const m of retail) {
      let cands = (candidatesByTerm.get(m.searchTerm || m.name) || []).filter((c) => c.price > 0);
      if (opts.normaliseDescription) cands = normaliseDescriptions(cands);
      candidatesById.set(m.id, cands);
      const chosen = pickBestCandidate(cands as RankableCandidate[], {
        name: m.name,
        searchTerm: m.searchTerm,
        qualityTier: m.qualityTier,
      }) as ScraperProduct | null;
      if (!chosen) continue;
      m.price = normalisedPrice(chosen);
      m.pricingSource = 'scraper';
      if (chosen.confidence) m.priceConfidence = chosen.confidence;
      if (chosen.itemNumber) m.bunningsItemNumber = chosen.itemNumber;
      m.productName = chosen.productName;
      // Mirrors production's applyProduct, INCLUDING stamping the raw
      // description onto the row — that is the step that plants the array.
      if (chosen.description) m.description = chosen.description as any;
      applyPackAwarePricing(m, {
        productName: chosen.productName,
        packSize: (chosen as any).packSize,
        packUnit: (chosen as any).packUnit,
      });
      stampMatchConfidence(m, chosen.productName);
    }

    // Individual-pass rescue, as production runs it: any row the batch left
    // unpriced falls through to the deployed searchMaterialPrice endpoint (a
    // general-knowledge AI estimate), then back through pack-aware pricing.
    // Skipping this would under-represent the app — it is the path that keeps
    // rows off $0 — so the bake-off pays the extra calls.
    for (const m of materials) {
      if (m.price > 0) continue;
      if (nonRetailIds.has(m.id)) continue;
      try {
        const ai: any = await callFunction('searchMaterialPrice', {
          materialName: m.searchTerm || m.name,
          hardwareStoreUrls: ['https://www.bunnings.com.au'],
        });
        if (ai && typeof ai.price === 'number' && ai.price > 0) {
          m.price = round2(ai.price);
          m.pricingSource = 'ai';
          m.priceConfidence = 'low';
          m.description = 'Estimated price — verify with supplier before sending';
          // Mirrors production: the estimator now states what one purchase
          // contains, so pack-aware pricing has evidence instead of falling
          // through to multiplying the purchase price by the requirement.
          applyPackAwarePricing(m, {
            productName: ai.productName,
            packSize: ai.packSize,
            packUnit: ai.packUnit,
          });
        }
      } catch {
        // Best-effort, exactly as production treats it: the row stays $0.
      }
    }

    // Reconcile — same semantic gate prod applies before handing candidates over.
    const gated = new Map<string, ScraperProduct[]>();
    for (const m of retail) {
      const raw = candidatesById.get(m.id) || [];
      const g = raw.filter(
        (c) =>
          isSemanticallyCompatible(m.searchTerm || m.name, c.productName || '') &&
          matchEvidence(m.searchTerm || m.name, c.productName || '') === 'strong',
      );
      if (g.length > 0) gated.set(m.id, g);
    }
    const items: ReconcileItem[] = retail
      .filter((m) => (gated.get(m.id) || []).length > 0)
      .map((m) => ({
        id: m.id,
        name: m.searchTerm || m.name,
        requirement: m.requiredQty ?? m.quantity,
        requirementUnit: String(m.requiredUnit ?? m.unit),
        candidates: (gated.get(m.id) || []).map((c) => ({
          name: c.productName,
          price: normalisedPrice(c),
          url: c.productUrl,
          description: describe(c),
          packSize: (c as any).packSize,
          packUnit: (c as any).packUnit,
        })),
      }));

    let reconcileError: string | undefined;
    let reconcileApplied = 0;
    if (items.length > 0) {
      try {
        // Mirrors production's batching (llmService.RECONCILE_MAX_ITEMS_PER_REQUEST).
        // The endpoint 400s above 50 items, and the pipeline's catch swallows
        // it, so an unbatched harness silently scores big quotes with the
        // whole reconcile pass missing — which is exactly how the bug was
        // found on QU-178377 (0 of 81 items reconciled, still reporting a
        // confident $28,654).
        const decisions: any[] = [];
        for (let i = 0; i < items.length; i += 50) {
          const res: any = await callFunction('reconcilePricedMaterials', {
            items: items.slice(i, i + 50),
            jobName: job.jobName,
            jobDescription: job.jobDescription,
          });
          if (Array.isArray(res?.results)) decisions.push(...res.results);
        }
        const byId = new Map(materials.map((m) => [m.id, m]));
        for (const d of decisions) {
          const m = byId.get(d.id);
          if (!m) continue;
          applyReconcileResult(m, d, (gated.get(m.id) || []) as any, GST_INCLUSIVE);
          reconcileApplied += 1;
        }
      } catch (err: any) {
        // Production's call site is a BARE catch — the loop aborts here and
        // every row after the throwing one keeps its pre-reconcile state.
        reconcileError = String(err?.message || err);
      }
    }

    // ── Last-resort estimate sweep (mirrors fetchPricesForQuoteInner) ──
    // Same order production now runs: a simplified-term retry, the
    // deterministic trade table, then a bounded one-purchase placeholder. The
    // harness composes the pipeline rather than calling it, so this has to be
    // mirrored here or the arm would not exercise the fix at all.
    for (const m of materials) {
      if (m.price > 0) continue;
      if (m.manualPriceOverride) continue;
      const term = m.searchTerm || m.name;
      const simplified = simplifySearchTerm(term);
      if (simplified && simplified !== term) {
        try {
          const retry: any = await callFunction('searchMaterialPrice', {
            materialName: simplified,
            hardwareStoreUrls: ['https://www.bunnings.com.au'],
          });
          if (retry && typeof retry.price === 'number' && retry.price > 0) {
            m.price = round2(retry.price);
            m.pricingSource = 'ai';
            m.priceConfidence = 'low';
            // Mirrors production: the estimate prices ONE purchasable item, so
            // it goes through pack-aware pricing rather than being multiplied
            // by the requirement.
            applyPackAwarePricing(m, {
              productName: retry.productName,
              packSize: retry.packSize,
              packUnit: retry.packUnit,
            });
            if (!m.description || String(m.description).startsWith('No price')) {
              m.description = 'Estimated price — verify with supplier before sending';
            }
            continue;
          }
        } catch {
          /* fall through to the table */
        }
      }
      const hit = tradeFallbackUnitPriceWithUnit(`${m.searchTerm || ''} ${m.name || ''}`, m.unit);
      if (hit && hit.price > 0 && (hit.per === m.unit || PURCHASE_UNITS.has(m.unit))) {
        m.price = round2(hit.price);
        m.totalPrice = round2(m.price * m.quantity);
        m.pricingSource = 'ai';
        m.priceConfidence = 'low';
        m.description = 'Fallback trade estimate — verify before sending';
        continue;
      }
      applyLastResortGuess(m, GST_INCLUSIVE);
    }

    // ── Final deterministic coverage sweep (mirrors fetchPricesForQuoteInner) ──
    // Bulk fastener/oil over-buy clamp plus the geometric bounds for board
    // piece-goods. The harness composes the pipeline rather than calling it, and
    // omitting this made arm A worse than production on exactly the rows where
    // an estimate gets multiplied by a piece count — a $3,948 line of coil
    // nails that production already clamps to $66.
    const jobAreaM2 = parseJobAreaM2(job.jobDescription)?.areaM2 ?? null;
    for (const m of materials) {
      if (m.manualPriceOverride) continue;
      if (m.requiredQty === undefined || !(m.price > 0)) continue;
      const sane = coverageSanePurchaseCount({
        requirement: m.requiredQty,
        name: m.name,
        perPurchasePrice: GST_INCLUSIVE ? m.price : round2(m.price * 1.1),
        packSize: m.packSize,
        packUnit: m.packUnit,
        requirementUnit: String(m.requiredUnit ?? m.unit),
        // Mirrors production: lets the guard see "72 packs for 72 nails".
        purchaseUnit: String(m.unit),
        proposedCount: m.quantity,
      });
      if (sane !== null && sane < m.quantity) {
        m.quantity = sane;
        m.totalPrice = round2(m.price * sane);
      }
      if (jobAreaM2 !== null) {
        const geoMax = geometricSanePieceCount({ name: m.name, requirement: m.requiredQty, areaM2: jobAreaM2 });
        if (geoMax !== null && geoMax < m.quantity) {
          m.quantity = geoMax;
          m.totalPrice = round2(m.price * geoMax);
        }
        if (m.unit === 'each') {
          const geoMin = geometricMinimumPieceCount({ name: m.name, requirement: m.requiredQty, areaM2: jobAreaM2 });
          if (geoMin !== null && geoMin > m.quantity) {
            m.requiredQty = geoMin;
            m.quantity = geoMin;
            m.totalPrice = round2(m.price * geoMin);
          }
        }
      }
    }

    // itemNumber -> productName across every candidate this quote saw, so a
    // reconcile-switched row resolves to the product it actually landed on.
    // The scraper returns the literal string "unknown" when it cannot identify
    // a SKU, so it is NOT a key — every unidentified product collides on it and
    // the last one wins. That put "Bostik Seal N Flex Silicone" on 20 unrelated
    // rows (pine framing, ceiling battens, sarking, insulation batts) and the
    // blind judge, which reads these names, called the arm a "spreadsheet
    // accident" on the strength of it. Same collision as the productFacts
    // `factsKey` fix; a row with no identifiable SKU must show no product name.
    const isRealItem = (item?: string): boolean => !!item && item !== 'unknown';
    const nameByItem = new Map<string, string>();
    for (const list of candidatesById.values()) {
      for (const c of list) if (isRealItem(c.itemNumber) && c.productName) nameByItem.set(c.itemNumber!, c.productName);
    }
    const productNameFor = (item?: string): string | undefined =>
      isRealItem(item) ? nameByItem.get(item!) : undefined;

    const lines: QuoteLine[] = materials.map((m) => ({
      name: m.name,
      searchTerm: m.searchTerm,
      requiredQty: m.requiredQty ?? m.quantity,
      requiredUnit: asUnit(m.requiredUnit ?? m.unit),
      quantity: m.quantity,
      unit: asUnit(m.unit),
      unitPrice: round2(m.price || 0),
      totalPrice: round2(m.totalPrice || 0),
      // Derive the product from the item number the pipeline ACTUALLY ended
      // up with, never from the harness's own round-1 note.
      //
      // Two ways m.productName went stale, both of which made the app look
      // worse than it is. applyReconcileResult clears bunningsItemNumber when
      // it estimates or rejects — leaving a name behind made an honest
      // estimate look like a confident match. And when reconcile picks a
      // DIFFERENT candidate than round-1 ranking did, it updates the item
      // number but knows nothing about this harness field, so 11% of scraped
      // lines displayed the wrong product: a 1L oil where the pipeline had
      // correctly chosen the 4L, a 40-pack where it had chosen the 100-pack.
      // The deterministic scorers key on itemNumber and were unaffected, but
      // the blind judge reads these names and was misled by them.
      productName: m.pricingSource === 'scraper' ? productNameFor(m.bunningsItemNumber) : undefined,
      itemNumber: m.pricingSource === 'scraper' && isRealItem(m.bunningsItemNumber) ? m.bunningsItemNumber : undefined,
      priceSource: !(m.price > 0) ? 'unpriced' : m.pricingSource === 'scraper' ? 'scraped' : 'estimated',
      note: typeof m.description === 'string' ? m.description.slice(0, 160) : undefined,
    }));

    return {
      arm: armName,
      lines,
      estimatedHours: generated.estimatedHours,
      materialsSubtotal: round2(lines.reduce((s, l) => s + l.totalPrice, 0)),
      ms: Date.now() - t0,
      reconcile: { requested: items.length, applied: reconcileApplied, error: reconcileError },
    } as ArmResult;
  } catch (err: any) {
    return { arm: armName, lines: [], materialsSubtotal: 0, ms: Date.now() - t0, error: String(err?.message || err) };
  }
}

// ───────────────────── Arm B: ask Claude directly ─────────────────────

const DIRECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['estimatedHours', 'materials'],
  properties: {
    estimatedHours: { type: 'number' },
    materials: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'searchTerm', 'requiredQty', 'requiredUnit', 'purchaseQty', 'purchaseUnit', 'unitPrice'],
        properties: {
          name: { type: 'string' },
          searchTerm: { type: 'string', description: 'What you would type into a supplier search to find this.' },
          requiredQty: { type: 'number', description: 'How much the job physically needs.' },
          requiredUnit: { type: 'string', enum: ['each', 'm', 'm²', 'm³', 'kg', 'L'] },
          purchaseQty: { type: 'number', description: 'How many units/packs to actually buy.' },
          purchaseUnit: { type: 'string', enum: ['each', 'pack', 'box', 'm', 'm²', 'm³', 'kg', 'L'] },
          unitPrice: { type: 'number', description: 'Australian retail price of ONE purchased unit, in AUD inc GST.' },
        },
      },
    },
  },
} as const;

export async function runClaudeDirectArm(job: CorpusJob): Promise<ArmResult> {
  const t0 = Date.now();
  try {
    const { value } = await askJson<any>(
      `Quote the materials for this Australian trade job. Give the full bill of materials with realistic current Australian retail prices, and an estimate of labour hours.

For each line: what the job physically needs (requiredQty/requiredUnit), what to actually buy (purchaseQty/purchaseUnit), and the price of ONE purchased unit inc GST.

JOB:
${job.jobDescription}`,
      DIRECT_SCHEMA as any,
      {
        system: 'You are an experienced Australian tradie estimator producing a materials list for a customer quote.',
        effort: 'high',
        maxTokens: 64000,
      },
    );
    const lines: QuoteLine[] = (value.materials || []).map((m: any) => {
      const qty = Number(m.purchaseQty) || 0;
      const price = Number(m.unitPrice) || 0;
      return {
        name: String(m.name || ''),
        searchTerm: String(m.searchTerm || m.name || ''),
        requiredQty: Number(m.requiredQty) || qty,
        requiredUnit: asUnit(m.requiredUnit),
        quantity: qty,
        unit: asUnit(m.purchaseUnit),
        unitPrice: round2(price),
        totalPrice: round2(price * qty),
        priceSource: 'model-knowledge',
      };
    });
    return {
      arm: 'claude-direct',
      lines,
      estimatedHours: value.estimatedHours,
      materialsSubtotal: round2(lines.reduce((s, l) => s + l.totalPrice, 0)),
      ms: Date.now() - t0,
    };
  } catch (err: any) {
    return { arm: 'claude-direct', lines: [], materialsSubtotal: 0, ms: Date.now() - t0, error: String(err?.message || err) };
  }
}

// ────────────── Arm C: Claude with the real candidate products ──────────────

const CAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['estimatedHours', 'materials'],
  properties: {
    estimatedHours: { type: 'number' },
    materials: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lineIndex', 'name', 'requiredQty', 'requiredUnit', 'chosenProductIndex', 'purchaseQty', 'purchaseUnit', 'reasoning'],
        properties: {
          lineIndex: { type: 'integer', description: 'The "Line N" number this entry answers. Required — entries are matched by it, not by position.' },
          name: { type: 'string' },
          requiredQty: { type: 'number' },
          requiredUnit: { type: 'string', enum: ['each', 'm', 'm²', 'm³', 'kg', 'L'] },
          chosenProductIndex: {
            type: ['integer', 'null'],
            description: 'Index into this line\'s candidate list, or null if no candidate is the right product.',
          },
          purchaseQty: { type: 'number', description: 'How many of the chosen product to buy so the requirement is covered.' },
          purchaseUnit: { type: 'string', enum: ['each', 'pack', 'box', 'm', 'm²', 'm³', 'kg', 'L'] },
          estimatedUnitPrice: {
            type: ['number', 'null'],
            description: 'Only when chosenProductIndex is null: your best estimate of the AUD price of one unit.',
          },
          reasoning: { type: 'string', description: 'One line: the coverage maths, e.g. "440kg / 20kg bag = 22 bags".' },
        },
      },
    },
  },
} as const;

export async function runClaudeCandidatesArm(job: CorpusJob, appLines: QuoteLine[]): Promise<ArmResult> {
  const t0 = Date.now();
  try {
    // Same requirement rows and the same real candidates arm A worked from, so
    // the only variable is WHO does selection + pack maths.
    const terms = [...new Set(appLines.map((l) => l.searchTerm || l.name).filter(Boolean))] as string[];
    const byTerm = await batchSearch(terms);

    const rows = appLines.map((l) => ({
      line: l,
      candidates: (byTerm.get(l.searchTerm || l.name) || []).filter((c) => c.price > 0).slice(0, 5),
    }));

    const block = rows
      .map((r, i) => {
        const cands = r.candidates.length
          ? r.candidates
              .map((c, j) => `      [${j}] ${c.productName} — $${normalisedPrice(c)} — ${describe(c) || 'no description'}`)
              .join('\n')
          : '      (no candidates found)';
        return `  Line ${i}: ${r.line.name}\n    needs: ${r.line.requiredQty} ${r.line.requiredUnit}\n    candidates:\n${cands}`;
      })
      .join('\n\n');

    const { value } = await askJson<any>(
      `Price this Australian trade job. For each line you are given what the job needs and the REAL products currently available at Bunnings with their real prices and descriptions.

For each line: pick the right product, then work out how many to buy so the requirement is actually covered. The product title and description are where pack size lives ("20kg", "5 Pack", "2.25m", "20m² roll") — read them and do the coverage maths yourself. If none of the candidates is the right product category, set chosenProductIndex to null.

Return one entry per line, each carrying its own lineIndex. chosenProductIndex indexes THAT line's own candidate list.

JOB:
${job.jobDescription}

LINES AND CANDIDATES:
${block}`,
      CAND_SCHEMA as any,
      {
        system: 'You are an experienced Australian tradie estimator selecting real supplier products and computing purchase quantities.',
        effort: 'high',
        maxTokens: 64000,
      },
    );

    // Match on the model's own lineIndex, never on array position. Position
    // mapping silently mis-assigned candidates when the model reordered or
    // dropped an entry — one job had a single "Turf Cutter Blade Hire Add-on"
    // assigned to 31 unrelated rows, which then read as a catastrophic
    // match-quality result rather than the harness bug it was.
    const lines: QuoteLine[] = (value.materials || []).map((m: any, i: number) => {
      const lineIdx = typeof m.lineIndex === 'number' && rows[m.lineIndex] ? m.lineIndex : i;
      const row = rows[lineIdx];
      const candIdx = m.chosenProductIndex;
      const chosen = row && typeof candIdx === 'number' && candIdx >= 0 ? row.candidates[candIdx] : undefined;
      const qty = Number(m.purchaseQty) || 0;
      const price = chosen ? normalisedPrice(chosen) : Number(m.estimatedUnitPrice) || 0;
      return {
        name: String(m.name || row?.line.name || ''),
        searchTerm: row?.line.searchTerm,
        requiredQty: Number(m.requiredQty) || row?.line.requiredQty || 0,
        requiredUnit: asUnit(m.requiredUnit || row?.line.requiredUnit),
        quantity: qty,
        unit: asUnit(m.purchaseUnit),
        unitPrice: round2(price),
        totalPrice: round2(price * qty),
        productName: chosen?.productName,
        itemNumber: chosen?.itemNumber,
        priceSource: chosen ? 'scraped' : price > 0 ? 'estimated' : 'unpriced',
        note: m.reasoning ? String(m.reasoning).slice(0, 160) : undefined,
      };
    });

    return {
      arm: 'claude-candidates',
      lines,
      estimatedHours: value.estimatedHours,
      materialsSubtotal: round2(lines.reduce((s, l) => s + l.totalPrice, 0)),
      ms: Date.now() - t0,
    };
  } catch (err: any) {
    return { arm: 'claude-candidates', lines: [], materialsSubtotal: 0, ms: Date.now() - t0, error: String(err?.message || err) };
  }
}
