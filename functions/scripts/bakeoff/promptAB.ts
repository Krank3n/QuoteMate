/**
 * Offline A/B for the materials-generation prompt.
 *
 * The pipeline's biggest remaining gap is completeness — 5.1 materials missing
 * per job against 1.3 for an unguided model call, measured on held-out
 * customer work. That is a prompt problem, and until the prompt was extracted
 * from index.ts the only way to try a change was to deploy it and watch real
 * quotes come out. This measures a variant first.
 *
 * Generation runs on the SAME model production uses (gemini-3.1-pro-preview)
 * through the same builder, so the only difference between arms is the rule
 * block under test. Judging is Claude — a different vendor from the generator,
 * blind, with the two lists shuffled per job.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/bakeoff/promptAB.ts --corpus=/path/corpus.json --limit=12
 */

import './preload';
import * as fs from 'fs';
import fetch from 'node-fetch';
import { askJson, QUOTING_MODEL } from './claude';
import { buildMaterialsPrompt } from '../../src/materialsPrompt';

/** Production's generator. */
const MODEL = 'gemini-3.1-pro-preview';

/**
 * The four arms. Model and prompt vary INDEPENDENTLY on purpose.
 *
 * Every comparison in this session so far confounded them: "claude-direct" was
 * Claude with a short ad-hoc prompt, while the app was Gemini with the
 * 155-line production prompt. The completeness gap could have been either. A
 * 2x2 separates them, which is the only way to answer "should the generator be
 * Claude?" with evidence rather than preference.
 */
const ARMS = [
  { key: 'gemini (production)', model: 'gemini' as const },
  { key: 'claude', model: 'claude' as const },
];

function parseLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const i = t.indexOf('{');
    let depth = 0, inStr = false, esc = false;
    for (let k = i; k < t.length; k++) {
      const c = t[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return JSON.parse(t.slice(i, k + 1));
    }
    throw new Error('unparseable');
  }
}

const MATS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['materials'],
  properties: {
    materials: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unit'],
        properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' } },
      },
    },
  },
} as const;

async function generate(scope: string, model: 'gemini' | 'claude'): Promise<string[]> {
  const prompt = buildMaterialsPrompt({
    jobDescription: scope,
    hasExisting: false,
    storeName: 'Bunnings',
    contextSection: '',
    existingMaterialsSection: '',
    templateReferenceSection: '',
    savedRatesSection: '',
    reeceCatalogueSection: '',
    tradeContext: null,
  });

  // Same prompt, different generator. Claude gets the production prompt
  // verbatim so the only variable is the model.
  if (model === 'claude') {
    const { value } = await askJson<any>(prompt, MATS_SCHEMA as any, {
      model: QUOTING_MODEL,
      effort: 'high',
      maxTokens: 32000,
    });
    return (value.materials || [])
      .filter((m: any) => m?.name)
      .map((m: any) => `${m.name} — ${m.quantity} ${m.unit}`);
  }

  // Every external call in a long loop needs its own deadline. Without one a
  // single stalled connection hangs the whole run silently — this loop sat for
  // 70 minutes on one job before anyone noticed, and the in-memory tally for
  // the nine jobs already judged went with it.
  let res: any;
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal as any,
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 16000, responseMimeType: 'application/json' } }),
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr) throw lastErr;
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data: any = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error('no text');
  const parsed = parseLoose(txt);
  const mats = parsed.materials || parsed.items || [];
  return (Array.isArray(mats) ? mats : [])
    .filter((m: any) => m?.name)
    .map((m: any) => `${m.name} — ${m.quantity} ${m.unit}`);
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lists'],
  properties: {
    lists: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'missing', 'padded'],
        properties: {
          label: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          missing: { type: 'array', items: { type: 'string' }, description: 'Materials the scope needs that this list omits.' },
          padded: { type: 'array', items: { type: 'string' }, description: 'Lines this list includes that the scope never asked for.' },
        },
      },
    },
  },
} as const;

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const corpus = JSON.parse(fs.readFileSync(get('corpus')!, 'utf8'));
  const limit = parseInt(get('limit') || '12', 10);

  // Spread across trades, cap per tradie — same discipline as the main run.
  const picked: any[] = [];
  const perTrade: Record<string, number> = {};
  const perUid: Record<string, number> = {};
  for (const r of corpus.rows) {
    if (picked.length >= limit) break;
    if ((perTrade[r.trade] || 0) >= 2 || (perUid[r.uid] || 0) >= 1) continue;
    picked.push(r); perTrade[r.trade] = (perTrade[r.trade] || 0) + 1; perUid[r.uid] = (perUid[r.uid] || 0) + 1;
  }

  const tally: Record<string, { missing: number; padded: number; lines: number }> = {};
  for (const a of ARMS) tally[a.key] = { missing: 0, padded: 0, lines: 0 };
  let judged = 0;
  console.log(`prompt/model 2x2 over ${picked.length} real scopes\n`);

  for (const [i, job] of picked.entries()) {
    process.stdout.write(`[${i + 1}/${picked.length}] ${job.number || job.docId} (${job.trade}) `);
    let lists: string[][];
    try {
      lists = await Promise.all(ARMS.map((a) => generate(job.jobDescription, a.model)));
    } catch (err: any) {
      console.log(`gen ERR ${String(err?.message || err).slice(0, 60)}`);
      continue;
    }

    // Shuffle so a label carries no information about which arm produced it.
    const order = ARMS.map((_, k) => k).sort(() => Math.random() - 0.5);
    const labels = ['A', 'B', 'C', 'D'];
    const labelToArm: Record<string, string> = {};
    order.forEach((armIdx, pos) => (labelToArm[labels[pos]] = ARMS[armIdx].key));
    const block = order
      .map((armIdx, pos) => `LIST ${labels[pos]}:\n${lists[armIdx].map((l) => '  - ' + l).join('\n')}`)
      .join('\n\n');

    try {
      const { value } = await askJson<any>(
        `An Australian tradie wrote the scope below. Several systems produced a materials list for it. For each list, name the materials the scope needs that the list OMITS, and any lines it includes that the scope never asked for.\n\nSCOPE:\n${job.jobDescription}\n\n${block}`,
        JUDGE_SCHEMA as any,
        { system: 'You are a senior Australian estimator checking whether a materials list covers the job.', effort: 'high', maxTokens: 32000 },
      );
      for (const l of value.lists || []) {
        const key = labelToArm[String(l.label).trim().slice(-1).toUpperCase()];
        if (!key || !tally[key]) continue;
        tally[key].missing += (l.missing || []).length;
        tally[key].padded += (l.padded || []).length;
      }
      ARMS.forEach((a, k) => (tally[a.key].lines += lists[k].length));
      judged++;
      console.log(ARMS.map((a, k) => `${a.model[0]}:${lists[k].length}`).join('  '));
      if (get('out')) fs.writeFileSync(get('out')!, JSON.stringify({ judged, tally }, null, 2));
    } catch (err: any) {
      console.log(`judge ERR ${String(err?.message || err).slice(0, 60)}`);
    }
  }

  console.log(`\nRESULT over ${judged} judged jobs`);
  console.log(`  arm                        lines/job   missing/job   padded/job`);
  for (const a of ARMS) {
    const t = tally[a.key];
    console.log(
      `  ${a.key.padEnd(25)}${(t.lines / judged).toFixed(1).padStart(9)}${(t.missing / judged).toFixed(2).padStart(14)}${(t.padded / judged).toFixed(2).padStart(13)}`,
    );
  }
  console.log(`\n  padded/job is the guard rail: the variant must not buy completeness with padding.`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
