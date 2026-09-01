/**
 * Independent cross-judge for the bake-off.
 *
 * The in-run blind judge is Claude, and two of the four arms are Claude's own
 * output. That is a self-preference risk, and "trust me, it was blind" is not
 * good enough for a result that would justify re-architecting the pipeline.
 * This re-judges the SAME saved quotes with Gemini — a different vendor, the
 * one production already uses for materials generation — under its own random
 * label shuffle, then reports how often the two judges agree.
 *
 * If both judges independently pick the same winner, the ranking is a property
 * of the quotes. If they disagree, the deterministic coverage and price-realism
 * scorers are the ones to believe, and the report should say so.
 *
 * Runs offline against a results file — it never re-runs an arm.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/bakeoff/crossJudge.ts --in=/path/results.json
 */

import * as fs from 'fs';
import fetch from 'node-fetch';

const MODEL = process.env.GEMINI_AUDIT_MODEL || 'gemini-3.1-pro-preview';

interface ArmLike {
  arm: string;
  error?: string;
  lines: any[];
  subtotal: number;
  estimatedHours?: number;
}

function render(a: ArmLike): string {
  if (a.error) return `  (this quote failed to generate)`;
  if (!a.lines || a.lines.length === 0) return '  (no materials)';
  return (
    a.lines
      .map(
        (l) =>
          `  - ${l.name} | needs ${l.requiredQty} ${l.requiredUnit} | buy ${l.quantity} ${l.unit} @ $${l.unitPrice} = $${l.totalPrice}${l.productName ? ` | product: ${l.productName}` : ''}`,
      )
      .join('\n') + `\n  MATERIALS SUBTOTAL: $${a.subtotal}`
  );
}

function parseLooseJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to brace balancing */
  }
  const start = t.indexOf('{');
  if (start < 0) throw new Error(`no JSON in: ${t.slice(0, 120)}`);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('unbalanced JSON');
}

async function gemini(prompt: string): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200).replace(/key=[^&\s]+/g, 'key=REDACTED')}`);
  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  return parseLooseJson(text);
}

async function main() {
  const raw = process.argv.slice(2);
  const inPath = raw.find((a) => a.startsWith('--in='))?.slice(5);
  const outPath = raw.find((a) => a.startsWith('--out='))?.slice(6) || inPath?.replace(/\.json$/, '-crossjudge.json');
  if (!inPath) throw new Error('--in=<results.json> required');

  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const results: any[] = data.results.filter((r: any) => r.arms && r.judge);

  const agree: string[] = [];
  const disagree: Array<{ job: string; claude: string; gemini: string }> = [];
  const wins: Record<string, number> = {};
  const out: any[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // The scope text is not stored in the results file (it is customer content),
    // so the cross-judge works from the bills of materials alone. That is a
    // harder comparison, not an easier one — it removes any scope-matching cue
    // and leaves only internal coherence and price plausibility.
    const shuffled = [...r.arms].sort(() => Math.random() - 0.5);
    const labels = ['A', 'B', 'C', 'D'];
    const mapping: Record<string, string> = {};
    shuffled.forEach((a: ArmLike, j: number) => (mapping[labels[j]] = a.arm));
    const body = shuffled.map((a: ArmLike, j: number) => `QUOTE ${labels[j]}:\n${render(a)}`).join('\n\n');

    const prompt = `You are a senior Australian estimator. Several systems produced these bills of materials for the SAME ${r.job.trade} job. You are not told which system produced which; the order is random.

Judge each on whether the quantities are internally coherent and the prices are plausible for Australian retail today. Be strict about a line that buys far more or far less than its stated requirement.

Return ONLY JSON:
{"quotes":[{"label":"A","quantitySanity":1-5,"priceSanity":1-5,"sendable":true|false,"worstProblem":"..."}],"bestLabel":"A","worstLabel":"A"}

${body}`;

    process.stdout.write(`[${i + 1}/${results.length}] ${r.job.number} ...`);
    try {
      const v = await gemini(prompt);
      const gBest = mapping[v.bestLabel];
      const cBest = r.judge.mapping[r.judge.bestLabel];
      wins[gBest] = (wins[gBest] || 0) + 1;
      if (gBest === cBest) agree.push(r.job.number);
      else disagree.push({ job: r.job.number, claude: cBest, gemini: gBest });
      out.push({ job: r.job.number, geminiBest: gBest, claudeBest: cBest, mapping, verdict: v });
      console.log(` gemini=${gBest} claude=${cBest}${gBest === cBest ? '  ✓' : '  ✗'}`);
    } catch (err: any) {
      console.log(` ERR ${String(err?.message || err).slice(0, 90)}`);
    }
  }

  const total = agree.length + disagree.length;
  console.log(`\nCROSS-JUDGE AGREEMENT: ${agree.length}/${total} (${total ? ((agree.length / total) * 100).toFixed(0) : 0}%)`);
  console.log(`Gemini's winner counts: ${JSON.stringify(wins)}`);
  if (disagree.length) {
    console.log('\nDisagreements (claude -> gemini):');
    for (const d of disagree) console.log(`  ${d.job}: ${d.claude} -> ${d.gemini}`);
  }
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ model: MODEL, agreement: { agree: agree.length, total }, wins, results: out }, null, 2));
    console.log(`\nWrote ${outPath}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
