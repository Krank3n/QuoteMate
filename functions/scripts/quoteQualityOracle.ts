/**
 * Read-only quote quality oracle.
 *
 * Pulls recent real quotes from Firestore, runs deterministic integrity checks,
 * then asks Gemini Pro for an independent trade/pricing review. The output is a
 * PII-redacted JSON report that can be turned into regression fixtures.
 *
 * Usage:
 *   cd functions
 *   GEMINI_API_KEY=... npx ts-node scripts/quoteQualityOracle.ts --limit=25
 *
 * Optional:
 *   --project=hansendev
 *   --model=gemini-3.1-pro
 *   --out=../quote-quality-oracle.json
 *   --uid=<only one user>
 *   --include-drafts=false
 *
 * Notes:
 * - This does NOT write to Firestore.
 * - This intentionally reviews the stored quote as generated/saved by the app.
 *   Use the JSON report's `regressionSeed` to build deterministic tests for new
 *   pipeline fixes.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { checkDocumentIntegrity, IntegrityIssue } from '../src/shared/document/integrityCheck';

interface Args {
  limit: number;
  project: string;
  model: string;
  out: string;
  uid?: string;
  includeDrafts: boolean;
}

interface DocLike {
  id: string;
  uid: string;
  number?: string;
  type?: string;
  stage?: string;
  createdAt?: any;
  updatedAt?: any;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job?: { name?: string; description?: string; template?: string; estimatedHours?: number };
  materials?: any[];
  sections?: any[];
  laborHours?: number;
  laborRate?: number;
  laborTotal?: number;
  materialsSubtotal?: number;
  subtotal?: number;
  markup?: number;
  markupAmount?: number;
  gst?: number;
  total?: number;
  pricesIncludeGst?: boolean;
  [k: string]: any;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const pref = `--${name}=`;
    const hit = raw.find((a) => a.startsWith(pref));
    return hit ? hit.slice(pref.length) : undefined;
  };
  return {
    limit: Math.max(1, Math.min(parseInt(get('limit') || '25', 10), 100)),
    project: get('project') || process.env.GCLOUD_PROJECT || 'hansendev',
    model: get('model') || process.env.GEMINI_AUDIT_MODEL || 'gemini-3.1-pro',
    out: get('out') || path.resolve(__dirname, '..', '..', 'quote-quality-oracle.json'),
    uid: get('uid'),
    includeDrafts: (get('include-drafts') || 'true') !== 'false',
  };
}

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

function compactQuoteForOracle(d: DocLike): any {
  return {
    documentId: d.id,
    number: d.number,
    type: d.type,
    stage: d.stage,
    job: {
      name: d.job?.name,
      description: d.job?.description,
      template: d.job?.template,
      estimatedHours: d.job?.estimatedHours,
    },
    pricing: {
      materialsSubtotal: d.materialsSubtotal,
      laborHours: d.laborHours,
      laborRate: d.laborRate,
      laborTotal: d.laborTotal,
      subtotal: d.subtotal,
      markup: d.markup,
      markupAmount: d.markupAmount,
      gst: d.gst,
      total: d.total,
      pricesIncludeGst: d.pricesIncludeGst,
    },
    sections: (d.sections || []).map((s: any) => ({
      name: s.name,
      multiplier: s.multiplier,
      laborHours: s.laborHours,
      laborHoursTotal: s.laborHoursTotal,
      laborUnit: s.laborUnit,
      laborRate: s.laborRate,
      laborTotal: s.laborTotal,
    })),
    materials: (d.materials || []).map((m: any) => ({
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      price: m.price,
      totalPrice: m.totalPrice,
      requiredQty: m.requiredQty,
      packSize: m.packSize,
      packUnit: m.packUnit,
      pricingSource: m.pricingSource,
      priceConfidence: m.priceConfidence,
      description: m.description,
      searchTerm: m.searchTerm,
      manualPriceOverride: m.manualPriceOverride,
    })),
  };
}

function redactForReport(d: DocLike, oracleInput: any): any {
  return {
    id: d.id,
    uidHash: d.uid.slice(0, 6),
    number: d.number,
    type: d.type,
    stage: d.stage,
    createdAtMs: tsToMs(d.createdAt),
    updatedAtMs: tsToMs(d.updatedAt),
    job: {
      name: d.job?.name,
      template: d.job?.template,
      estimatedHours: d.job?.estimatedHours,
      // Keep description in report only if explicitly allowed; it can contain
      // addresses/customer details. The oracle sees it, the saved report does not.
      descriptionLength: d.job?.description?.length || 0,
    },
    pricing: oracleInput.pricing,
    sections: oracleInput.sections,
    materials: oracleInput.materials,
  };
}

function buildPrompt(quote: any, deterministicIssues: IntegrityIssue[]): string {
  return `You are Gemini Pro acting as an independent Australian trade quote QA oracle.

Review the stored quote below for material quantities, pack/box/unit mistakes, missing prices, labour realism, and total reliability. Compare it to what a competent Australian tradie should allow for based on the job description. Do not need exact supplier prices; use realistic ranges and call out likely distortions.

Return ONLY valid JSON in this exact shape:
{
  "overallVerdict": "pass" | "review" | "fail",
  "confidence": "low" | "medium" | "high",
  "summary": "one short paragraph",
  "majorIssues": [
    {
      "kind": "missing_price" | "quantity_under" | "quantity_over" | "pack_unit_error" | "bad_product_match" | "labour_low" | "labour_high" | "total_unreliable" | "other",
      "severity": "low" | "medium" | "high",
      "item": "material or section name, if applicable",
      "current": "what the quote has",
      "recommended": "what a tradie would likely use instead",
      "reasoning": "short explanation"
    }
  ],
  "recommendedMaterials": [
    { "name": "line item", "quantityRange": "e.g. 70-85", "unit": "each|m|m²|m³|kg|L|pack|box", "notes": "short" }
  ],
  "recommendedLabourHoursRange": { "min": 0, "max": 0, "reasoning": "short" },
  "regressionAssertions": [
    "plain English assertion suitable for a future automated test"
  ]
}

Be conservative: only mark fail/high severity when the quote total is materially unreliable or the customer would be misled. If a row is merely worth checking, use review/medium.

Deterministic integrity issues already detected by app validators:
${JSON.stringify(deterministicIssues, null, 2)}

Quote JSON:
${JSON.stringify(quote, null, 2)}`;
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 12000,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini returned ${res.status}: ${text.slice(0, 1000)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  return JSON.parse(text);
}

async function fetchRecentDocs(args: Args): Promise<DocLike[]> {
  if (!admin.apps.length) admin.initializeApp({ projectId: args.project });
  const db = admin.firestore();

  const all: DocLike[] = [];
  const userDocs = args.uid
    ? [await db.collection('users').doc(args.uid).get()]
    : (await db.collection('users').get()).docs;

  for (const u of userDocs) {
    if (!u.exists) continue;
    const snap = await db.collection('users').doc(u.id).collection('documents')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(args.limit, 20))
      .get();
    for (const ds of snap.docs) {
      const d = { id: ds.id, uid: u.id, ...(ds.data() as any) } as DocLike;
      if (d.type && d.type !== 'quote') continue;
      if (!args.includeDrafts && d.stage === 'draft') continue;
      if (!d.job?.description) continue;
      all.push(d);
    }
  }

  all.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return all.slice(0, args.limit);
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY');

  console.log(`Quote quality oracle: project=${args.project}, limit=${args.limit}, model=${args.model}`);
  const docs = await fetchRecentDocs(args);
  console.log(`Reviewing ${docs.length} recent quote(s)...`);

  const results: any[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const quote = compactQuoteForOracle(d);
    const deterministicIssues = checkDocumentIntegrity(d as any);
    process.stdout.write(`  [${i + 1}/${docs.length}] ${d.number || d.id} ... `);
    try {
      const oracle = await callGemini(apiKey, args.model, buildPrompt(quote, deterministicIssues));
      console.log(`${oracle.overallVerdict || 'unknown'}`);
      results.push({
        id: d.id,
        number: d.number,
        stage: d.stage,
        deterministicIssues,
        oracle,
        quote: redactForReport(d, quote),
        regressionSeed: {
          jobName: d.job?.name,
          jobDescription: d.job?.description,
          template: d.job?.template,
          assertions: oracle.regressionAssertions || [],
        },
      });
    } catch (err: any) {
      console.log(`error: ${err.message}`);
      results.push({ id: d.id, number: d.number, stage: d.stage, error: err.message, deterministicIssues });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    project: args.project,
    model: args.model,
    reviewedCount: results.length,
    verdictCounts: results.reduce((acc: Record<string, number>, r: any) => {
      const v = r.oracle?.overallVerdict || (r.error ? 'error' : 'unknown');
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {}),
    highSeverityCount: results.reduce((n: number, r: any) => n + (r.oracle?.majorIssues || []).filter((x: any) => x.severity === 'high').length, 0),
  };

  const out = { summary, results };
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${args.out}`);
  console.log(summary);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
