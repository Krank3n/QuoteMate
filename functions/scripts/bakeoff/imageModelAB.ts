/**
 * Gemini vs Claude on the IMAGE path.
 *
 * The text-only 2x2 showed Claude misses 2.15 materials/job against Gemini's
 * 7.54 on the identical production prompt. But image understanding is the
 * stated reason Gemini 3 Pro is primary here — analyzeJobDescription takes
 * site photos and plan drawings — so a text result cannot justify a switch.
 * This measures the path that actually holds Gemini's mandate.
 *
 * Fidelity: real customer photos pulled from Storage, run through the SAME
 * `normalizeLlmAttachments` production uses (it byte-sniffs media type — a
 * PDF stored as .jpg once 400'd both providers and killed analyze), the SAME
 * prompt via buildMaterialsPrompt, and the SAME attachment suffix. The only
 * variable is the model.
 *
 * Customer photos are read for measurement only: never written anywhere,
 * never included in output. Only counts and material names leave this script.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/bakeoff/imageModelAB.ts --corpus=/path/photo-corpus.json --limit=8
 */

import './preload';
import * as fs from 'fs';
import fetch from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';
import { askJson } from './claude';
import { buildMaterialsPrompt } from '../../src/materialsPrompt';
import { normalizeLlmAttachments, LlmAttachment } from '../../src/llmAttachments';

const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const CLAUDE_MODEL = 'claude-opus-5';
/** Anthropic's most capable widely released model — 2x Opus 5's token price. */
const FABLE_MODEL = 'claude-fable-5';
/** 40% of Opus 5's price. The question is how much of Opus's gain it keeps. */
const SONNET_MODEL = 'claude-sonnet-5';

/**
 * Generation arms. Judge stays fixed so only the generator varies.
 *
 * Fable was measured and dropped: 7.92 missing/job against Opus 5's 2.77 at
 * twice the token price. Sonnet 5 replaces it because the open question is
 * cost, not capability — Opus already wins, and what matters now is the
 * cheapest model that keeps the win on every quote.
 */
const GEN_ARMS = ['gemini', 'claude', 'sonnet'] as const;
type GenArm = (typeof GEN_ARMS)[number] | 'fable';

/** Verbatim from index.ts — the suffix production appends when files ride along. */
const attachmentSuffix = (n: number) =>
  `\n\nI've attached ${n} file(s) — site photos and/or plan documents (a plan may arrive as a PDF). Examine each carefully. If a file is an ordinary site photo, use it to understand the scope and identify visible materials. If a file is an architectural plan, floorplan, or scaled drawing — including a PDF plan — ALSO follow the FLOORPLAN ANALYSIS instructions above — read the scale and extract areas/perimeter, and use them to ground your material quantities.`;

async function fetchAsBase64(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal as any });
    if (!res.ok) return null;
    const buf = await res.buffer();
    return buf.toString('base64');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function promptFor(scope: string, n: number): string {
  const base = buildMaterialsPrompt({
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
  return n > 0 ? `${base}${attachmentSuffix(n)}` : base;
}

const toLines = (mats: any[]): string[] =>
  (Array.isArray(mats) ? mats : []).filter((m: any) => m?.name).map((m: any) => `${m.name} — ${m.quantity} ${m.unit}`);

function parseLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const i = t.indexOf('{');
    let d = 0, inStr = false, esc = false;
    for (let k = i; k < t.length; k++) {
      const c = t[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') d++; else if (c === '}' && --d === 0) return JSON.parse(t.slice(i, k + 1));
    }
    throw new Error('unparseable');
  }
}

async function viaGemini(scope: string, atts: LlmAttachment[]): Promise<string[]> {
  const parts: any[] = atts.map((a) => ({ inline_data: { mime_type: a.mediaType, data: a.data } }));
  parts.push({ text: promptFor(scope, atts.length) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 16000, responseMimeType: 'application/json' } }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data: any = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('gemini: no text');
    return toLines(parseLoose(txt).materials);
  } finally {
    clearTimeout(timer);
  }
}

async function viaAnthropic(scope: string, atts: LlmAttachment[], model: string): Promise<string[]> {
  const client = new Anthropic({ maxRetries: 3 });
  const content: any[] = atts.map((a) =>
    a.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
      : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } },
  );
  content.push({ type: 'text', text: promptFor(scope, atts.length) });
  // Deliberately NO server-side `fallbacks` here. In production that is the
  // right call, but in a measurement harness a silent substitution would let
  // another model's output be scored as this arm's — the comparison has to
  // fail loudly instead. Fable 5 runs thinking always-on; adaptive is the
  // accepted form and budget_tokens would be rejected outright.
  // Explicit per-request deadline. The SDK's default is generous and Fable can
  // legitimately run for minutes on a hard prompt, but "legitimately slow" and
  // "hung" look identical from outside — this loop sat 41 minutes on one job
  // before that was noticed. A bounded wait turns a hang into a recorded
  // failure for that arm instead of a dead run.
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content }],
    },
    { timeout: 420_000 },
  );
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`${model} refused: ${msg.stop_details?.explanation || ''}`.slice(0, 80));
  const txt = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  if (!txt.trim()) throw new Error(`${model}: no text`);
  return toLines(parseLoose(txt).materials);
}

const generateWith = (scope: string, atts: LlmAttachment[], arm: GenArm): Promise<string[]> =>
  arm === 'gemini'
    ? viaGemini(scope, atts)
    : viaAnthropic(scope, atts, arm === 'sonnet' ? SONNET_MODEL : arm === 'fable' ? FABLE_MODEL : CLAUDE_MODEL);

const JUDGE = {
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
          label: { type: 'string', enum: ['A', 'B', 'C'] },
          missing: { type: 'array', items: { type: 'string' } },
          padded: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

/**
 * Gemini judging the same comparison, with the same photos.
 *
 * The Claude judge is scoring Claude's own output against a competitor, which
 * is the textbook self-preference setup. Every judged result in this session
 * has been cross-checked by a second vendor for exactly that reason, and twice
 * the cross-check changed what could honestly be claimed.
 */
async function judgeWithGemini<T>(atts: LlmAttachment[], prompt: string): Promise<{ value: T }> {
  const parts: any[] = atts.map((a) => ({ inline_data: { mime_type: a.mediaType, data: a.data } }));
  parts.push({ text: `${prompt}\n\nReturn ONLY JSON: {"lists":[{"label":"A","missing":["..."],"padded":["..."]}]}` });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: 'application/json' } }),
    });
    if (!res.ok) throw new Error(`gemini judge ${res.status}`);
    const data: any = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('gemini judge: no text');
    return { value: parseLoose(txt) as T };
  } finally {
    clearTimeout(timer);
  }
}

/** Judge with the photos attached, so image-derived lines are not read as padding. */
async function askJsonWithImages<T>(atts: LlmAttachment[], prompt: string, schema: any): Promise<{ value: T }> {
  const client = new Anthropic({ maxRetries: 3 });
  const content: any[] = atts.map((a) =>
    a.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
      : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } },
  );
  content.push({ type: 'text', text: prompt });
  const stream = client.messages.stream(
    {
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      system: 'You are a senior Australian estimator checking whether a materials list covers the job, judging against the scope AND the attached photos.',
      messages: [{ role: 'user', content }],
    },
    { timeout: 300_000 },
  );
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('judge refused');
  if (msg.stop_reason === 'max_tokens') throw new Error('judge truncated');
  const txt = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  return { value: JSON.parse(txt) as T };
}

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const corpus = JSON.parse(fs.readFileSync(get('corpus')!, 'utf8'));
  const limit = parseInt(get('limit') || '8', 10);
  const outPath = get('out');

  const seen = new Set<string>();
  const jobs = corpus.rows.filter((r: any) => {
    if (seen.has(r.uid) || !r.photoUrls?.length) return false;
    seen.add(r.uid);
    return true;
  }).slice(0, limit);

  const tally: Record<string, { missing: number; padded: number; lines: number }> = {};
  for (const g of GEN_ARMS) tally[g] = { missing: 0, padded: 0, lines: 0 };
  let judged = 0;
  console.log(`image-path comparison over ${jobs.length} real customer quotes with photos`);
  console.log(`arms: ${GEN_ARMS.join(', ')} | judge: ${get('judge') === 'gemini' ? 'gemini' : 'claude'}\n`);

  for (const [i, job] of jobs.entries()) {
    process.stdout.write(`[${i + 1}/${jobs.length}] ${job.number || job.docId} `);
    const b64: string[] = [];
    for (const u of job.photoUrls.slice(0, 2)) {
      const d = await fetchAsBase64(u);
      if (d) b64.push(d);
    }
    if (b64.length === 0) { console.log('no readable photos'); continue; }
    const { attachments, dropped } = normalizeLlmAttachments(b64);
    if (attachments.length === 0) { console.log(`all ${dropped.length} attachment(s) dropped`); continue; }

    // Settle, not all: one slow arm should not discard the other two.
    const settled = await Promise.allSettled(GEN_ARMS.map((g) => generateWith(job.jobDescription, attachments, g)));
    const failed = settled.map((r, k) => (r.status === 'rejected' ? GEN_ARMS[k] : null)).filter(Boolean);
    if (failed.length) console.log(`\n   (arm failed: ${failed.join(', ')} — job skipped to keep arms comparable)`);
    if (settled.some((r) => r.status === 'rejected')) continue;
    const lists = settled.map((r) => (r as PromiseFulfilledResult<string[]>).value);

    const order = GEN_ARMS.map((_, k) => k).sort(() => Math.random() - 0.5);
    const labels = ['A', 'B', 'C'];
    const labelToArm: Record<string, string> = {};
    order.forEach((armIdx, pos) => (labelToArm[labels[pos]] = GEN_ARMS[armIdx]));
    const block = order
      .map((armIdx, pos) => `LIST ${labels[pos]}:\n${lists[armIdx].map((l) => '  - ' + l).join('\n')}`)
      .join('\n\n');

    const prompt = `An Australian tradie wrote the scope below and attached ${attachments.length} site photo(s), shown above. Judge against BOTH the scope and what is visible in the photos — a material justified by the photo is NOT padding, even if the scope text never mentions it.\n\nFor each list, name the materials the job needs that it OMITS, and lines it includes that neither the scope nor the photos justify.\n\nSCOPE:\n${job.jobDescription}\n\n${block}`;

    try {
      const judgeFn = get('judge') === 'gemini'
        ? (at: LlmAttachment[], p: string) => judgeWithGemini<any>(at, p)
        : (at: LlmAttachment[], p: string) => askJsonWithImages<any>(at, p, JUDGE);
      const { value } = await judgeFn(attachments, prompt);
      for (const l of value.lists || []) {
        const key = labelToArm[String(l.label).trim().slice(-1).toUpperCase()];
        if (!key || !tally[key]) continue;
        tally[key].missing += (l.missing || []).length;
        tally[key].padded += (l.padded || []).length;
      }
      GEN_ARMS.forEach((g, k) => (tally[g].lines += lists[k].length));
      judged++;
      console.log(`${attachments.length} img  ` + GEN_ARMS.map((g, k) => `${g}:${lists[k].length}`).join('  '));
      if (outPath) fs.writeFileSync(outPath, JSON.stringify({ judged, tally }, null, 2));
    } catch (err: any) {
      console.log(`judge ERR ${String(err?.message || err).slice(0, 70)}`);
    }
  }

  console.log(`\nIMAGE PATH — ${judged} judged quotes`);
  console.log(`  model      lines/job   missing/job   padded/job`);
  for (const k of GEN_ARMS) {
    const t = tally[k];
    console.log(`  ${k.padEnd(11)}${(t.lines / judged).toFixed(1).padStart(9)}${(t.missing / judged).toFixed(2).padStart(14)}${(t.padded / judged).toFixed(2).padStart(13)}`);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
