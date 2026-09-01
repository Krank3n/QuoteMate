/**
 * Independent measure of SCOPE COVERAGE — the bake-off's headline finding.
 *
 * The blind judge already reports "materials the scope needs that this quote
 * omits", but that is one model's free-form list and it sees all four quotes
 * side by side, so a shared blind spot would go unnoticed and a long list is
 * flattered by having more chances to match.
 *
 * This measures it the other way round and in two independent steps:
 *   1. Read ONLY the customer's scope (no quotes visible) and enumerate the
 *      discrete work items the tradie is being asked to do.
 *   2. For each arm, ask which of those work items the bill of materials
 *      actually provisions — one work item at a time, quotes unlabelled.
 *
 * Step 1 cannot be biased by any arm because it never sees one. That makes
 * this the number to lead with when claiming the app under-scopes.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/bakeoff/scopeCoverage.ts --in=/path/results.json --corpus=/path/corpus.json
 */

import * as fs from 'fs';
import fetch from 'node-fetch';
import { askJson } from './claude';

const ARMS = ['app', 'app-fixed', 'claude-direct', 'claude-candidates'];

const SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['workItems'],
  properties: {
    workItems: {
      type: 'array',
      description: 'Fine-grained work activities, each needing its OWN distinct materials. Decompose composite work: "build a room" is framing, wall lining, cornice, painting, floor covering, power rough-in, lighting — separate entries. Still not a materials list.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'needsMaterials'],
        properties: {
          item: { type: 'string', description: 'e.g. "demolish carport and garage", "pour 66m2 driveway slab", "frame and line a 2x3.6m office room"' },
          needsMaterials: { type: 'boolean', description: 'false for pure-labour items that legitimately need no materials.' },
        },
      },
    },
  },
} as const;

const COVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['covered'],
  properties: {
    covered: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'quotes'],
        properties: {
          item: { type: 'string' },
          quotes: {
            type: 'array',
            description: 'One entry per quote, in the order given.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'provisioned'],
              properties: {
                label: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                provisioned: { type: 'boolean', description: 'Does this bill of materials contain the materials this work item needs?' },
              },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Enumerate the scope's work items with Gemini instead of Claude.
 *
 * Step 1 and the claude-direct arm are otherwise both Claude, so a shared way
 * of decomposing a job would flatter that arm — it would be scored against a
 * work list drawn up the same way it wrote its quote. Running the enumeration
 * on a different vendor tests exactly that. If the ranking survives, the
 * finding is a property of the quotes, not of one model's taxonomy.
 */
async function geminiWorkItems(scope: string): Promise<Array<{ item: string; needsMaterials: boolean }>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  const model = process.env.GEMINI_AUDIT_MODEL || 'gemini-3.1-pro-preview';
  const prompt = `List the work activities this Australian trade job asks for, at the granularity where each one needs its OWN distinct materials. Decompose composite work: "build a room" becomes framing, lining, cornice, painting, floor covering, power and lighting rough-in. Do NOT write a materials list and do NOT invent work the scope does not ask for.

Return ONLY JSON: {"workItems":[{"item":"...","needsMaterials":true}]}

SCOPE:
${scope}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`.slice(0, 60));
  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  return parsed.workItems || [];
}

/**
 * Normalise a judge/coverage label to a bare letter.
 *
 * Models return "Quote A" as readily as "A" even with an enum on the field, and
 * a missed lookup counted the work item for nobody — which reads as "every arm
 * failed this work" rather than "the harness dropped it". Exported for tests.
 */
export function normaliseLabel(raw: unknown): string {
  return String(raw ?? '').trim().slice(-1).toUpperCase();
}

function renderLines(a: any): string {
  if (!a.lines || a.lines.length === 0) return '  (no materials)';
  return a.lines.map((l: any) => `  - ${l.name} (${l.quantity} ${l.unit})`).join('\n');
}

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const inPath = get('in')!;
  const corpusPath = get('corpus')!;
  const outPath = get('out') || inPath.replace(/\.json$/, '-scopecoverage.json');
  const enumerator = (get('enumerator') || 'claude') as 'claude' | 'gemini';
  if (!inPath || !corpusPath) throw new Error('--in= and --corpus= required');

  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const scopeByDoc = new Map<string, string>();
  for (const r of corpus.rows) scopeByDoc.set(`${r.uid}:${r.docId}`, r.jobDescription);
  // Results carry docId but not uid; docId is unique enough in practice, so
  // index by docId too and prefer an exact single match.
  const byDocId = new Map<string, string[]>();
  for (const r of corpus.rows) {
    const list = byDocId.get(r.docId) || [];
    list.push(r.jobDescription);
    byDocId.set(r.docId, list);
  }

  const totals: Record<string, { covered: number; total: number }> = {};
  for (const a of ARMS) totals[a] = { covered: 0, total: 0 };
  const perJob: any[] = [];

  const results = data.results.filter((r: any) => r.arms);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const candidates = byDocId.get(r.job.docId) || [];
    if (candidates.length !== 1) {
      console.log(`[${i + 1}/${results.length}] ${r.job.number} — scope not uniquely resolvable, skipped`);
      continue;
    }
    const scope = candidates[0];

    process.stdout.write(`[${i + 1}/${results.length}] ${r.job.number} (${r.job.trade}) `);
    let workItems: Array<{ item: string; needsMaterials: boolean }>;
    try {
      // Step 1 — scope only. No quote is visible here, by construction.
      workItems = enumerator === 'gemini' ? await geminiWorkItems(scope) : (
        await askJson<any>(
          `List the work activities this Australian trade job asks for, at the granularity where each one needs its OWN distinct materials.

Decompose composite work rather than naming it once: "build a 2x3.6m office room inside the garage" becomes wall framing, wall/ceiling lining, cornice, painting, floor covering, power outlets and lighting rough-in — each a separate entry. A slab becomes sub-base, vapour barrier, reinforcement, and the pour. Demolition becomes the breaking-out and the cartage/disposal.

Do NOT write a materials list, and do NOT invent work the scope does not ask for. If the scope is small, a short list is correct.

SCOPE:
${scope}`,
          SCOPE_SCHEMA as any,
          { system: 'You read trade job scopes and enumerate the work they contain.', effort: 'medium', maxTokens: 8000 },
        )
      ).value.workItems;
    } catch (err: any) {
      console.log(`scope-parse ERR ${String(err?.message || err).slice(0, 80)}`);
      continue;
    }
    const needing = workItems.filter((w) => w.needsMaterials);
    if (needing.length === 0) {
      console.log('no material-bearing work items');
      continue;
    }

    // Step 2 — quotes shuffled and unlabelled.
    const shuffled = [...r.arms].sort(() => Math.random() - 0.5);
    const labels = ['A', 'B', 'C', 'D'];
    const mapping: Record<string, string> = {};
    shuffled.forEach((a: any, j: number) => (mapping[labels[j]] = a.arm));
    const block = shuffled.map((a: any, j: number) => `QUOTE ${labels[j]}:\n${renderLines(a)}`).join('\n\n');

    try {
      const cov = (
        await askJson<any>(
          `For each work item, say whether each quote's bill of materials actually provisions it — i.e. contains the materials that work needs. Judge only provisioning, not price or quantity.\n\nWORK ITEMS:\n${needing.map((w) => `- ${w.item}`).join('\n')}\n\n${block}`,
          COVER_SCHEMA as any,
          // Four quotes x up to 50 lines x many work items is a large output,
          // and adaptive thinking spends the same budget. 16k silently
          // truncated the biggest jobs — which are exactly the ones where the
          // arms diverge — so the scored subsample skewed small.
          { system: 'You check whether a bill of materials covers a piece of work.', effort: 'medium', maxTokens: 48000 },
        )
      ).value.covered;

      const jobTotals: Record<string, number> = {};
      let unmapped = 0;
      for (const c of cov) {
        for (const q of c.quotes || []) {
          // The model returns "Quote A" as often as "A" even with an enum on
          // the field, and a silent lookup miss counted the item for nobody —
          // which read as "every arm missed this work" rather than "the
          // harness dropped it". Normalise to the trailing letter.
          const label = normaliseLabel(q.label);
          const arm = mapping[label];
          if (!arm || !totals[arm]) {
            unmapped += 1;
            continue;
          }
          totals[arm].total += 1;
          if (q.provisioned) {
            totals[arm].covered += 1;
            jobTotals[arm] = (jobTotals[arm] || 0) + 1;
          }
        }
      }
      if (unmapped > 0) console.log(`  (warning: ${unmapped} unmapped label(s) dropped)`);
      perJob.push({ job: r.job.number, trade: r.job.trade, workItems: needing.length, covered: jobTotals, mapping, unmapped });
      console.log(
        `${needing.length} work items -> ` + ARMS.map((a) => `${a.replace('claude-', 'c-')}:${jobTotals[a] || 0}`).join(' '),
      );
    } catch (err: any) {
      console.log(`coverage ERR ${String(err?.message || err).slice(0, 80)}`);
    }
  }

  console.log(`\nSCOPE COVERAGE (work items enumerated by ${enumerator}) — share the quote actually provisions`);
  for (const a of ARMS) {
    const t = totals[a];
    const p = t.total ? ((t.covered / t.total) * 100).toFixed(0) + '%' : '—';
    console.log(`  ${a.padEnd(19)} ${String(t.covered).padStart(4)}/${String(t.total).padEnd(5)} ${p.padStart(5)}`);
  }
  fs.writeFileSync(outPath, JSON.stringify({ totals, perJob }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
