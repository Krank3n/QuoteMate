/**
 * Paired eval for the AI price estimator.
 *
 * The estimator prices what the scraper cannot (trade equipment, services,
 * off-catalogue goods) and its misses are the largest single-line errors left:
 * the same Fujitsu 14kW SKU came back $25, $3,200 and $7,500 in three runs
 * against a ~$8,000 street price.
 *
 * Design — everything the sendable-verdict fiasco taught:
 *  - PAIRED per item: every variant prices the SAME item list, so the
 *    comparison is a per-item delta, not a cross-run judge vibe.
 *  - Deterministic metric: |log(estimate / reference)| against a WEB-SEARCHED
 *    reference price, built once. No blind judge anywhere.
 *  - The reference is built by a model with live search results in front of
 *    it; a reference the model cannot ground is dropped, not guessed.
 *
 * Usage:
 *   cd functions && set -a; source ../.env; source .env; set +a
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node scripts/bakeoff/estimatorAB.ts \
 *     --items=~/.quotemate-bakeoff/estimated-items.json --sample=100 \
 *     --refs=~/.quotemate-bakeoff/estimator-refs.json          # build refs
 *   ... --run-variants                                          # then compare
 */
import './preload';
import * as fs from 'fs';
import * as os from 'os';
import fetch from 'node-fetch';
import { buildEstimatorPrompt } from '../../src/estimatorPrompt';

const KEY = process.env.ANTHROPIC_API_KEY!;
const expand = (p: string) => p.replace(/^~/, os.homedir());

async function anthropic(body: any, timeoutMs = 180_000): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        signal: ctl.signal as any,
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 3) throw new Error(`anthropic ${res.status}`);
        await new Promise((r) => setTimeout(r, 15_000 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err: any) {
      if (attempt === 3 || !/abort|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(String(err?.message))) throw err;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    } finally {
      clearTimeout(t);
    }
  }
}

const text = (data: any): string =>
  (data.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');

function looseJson(t: string): any {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return JSON.parse(m[0]);
}

async function buildReference(name: string): Promise<any | null> {
  // Sonnet, not Opus: the grounding comes from the SEARCH RESULTS, not model
  // depth, and Opus-with-thinking took minutes per item — 8 hours for the set.
  const data = await anthropic({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content: `What does this cost to BUY in Australia right now (AUD, inc GST)? Search for real current prices from Australian retailers or trade suppliers.

Item: "${name}"

Rules:
- I want the purchase price of the item itself (supply only, no installation labour).
- For a service line (bin hire, disposal allowance), the typical charge for that service.
- Ground the number in search results. If you cannot find anything usable for this specific item or a directly comparable one, say so honestly rather than guessing.

Reply with ONLY JSON: {"referencePrice": <number|null>, "low": <number>, "high": <number>, "basis": "<one line: what you found>", "grounded": <true|false>}`,
    }],
  });
  try {
    const j = looseJson(text(data));
    if (!j.grounded || !(j.referencePrice > 0)) return null;
    return j;
  } catch { return null; }
}

async function runVariant(model: string, name: string): Promise<number | null> {
  const prompt = buildEstimatorPrompt(name, 'https://www.bunnings.com.au');
  const body: any = { model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] };
  if (/sonnet-5|opus-5|fable/.test(model)) { body.thinking = { type: 'adaptive' }; }
  else { body.temperature = 0.1; }
  const data = await anthropic(body);
  try {
    const j = looseJson(text(data));
    return j.price > 0 ? j.price : null;
  } catch { return null; }
}

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const items: any[] = JSON.parse(fs.readFileSync(expand(get('items')!), 'utf8'));
  const refPath = expand(get('refs')!);
  const sample = parseInt(get('sample') || '100', 10);

  // Cost-weighted sample: every big-ticket item (where a miss is worth the
  // most), then evens across the rest.
  const sorted = [...items].sort((a, b) => Math.max(...b.prices) - Math.max(...a.prices));
  const big = sorted.filter((e) => Math.max(...e.prices) >= 150);
  const rest = sorted.filter((e) => Math.max(...e.prices) < 150);
  const step = Math.max(1, Math.floor(rest.length / Math.max(1, sample - big.length)));
  const picked = [...big, ...rest.filter((_, i) => i % step === 0)].slice(0, sample);

  const refs: Record<string, any> = fs.existsSync(refPath) ? JSON.parse(fs.readFileSync(refPath, 'utf8')) : {};

  if (!raw.includes('--run-variants')) {
    console.log(`building web-grounded references for ${picked.length} items (${Object.keys(refs).length} cached)`);
    // Pool of 5 — each item is an independent search; serial was the bottleneck.
    const todo = picked.filter((e) => !refs[e.name]);
    let done = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      for (;;) {
        const e = todo.shift();
        if (!e) return;
        try {
          const r = await buildReference(e.name);
          refs[e.name] = r || { ungrounded: true };
          console.log(`[${++done}/${todo.length + done}] ${e.name.slice(0, 56)} ${r ? '$' + r.referencePrice : '(ungrounded)'}`);
        } catch (err: any) {
          console.log(`[${++done}] ERR ${String(err?.message).slice(0, 50)} — ${e.name.slice(0, 40)}`);
        }
        fs.writeFileSync(refPath, JSON.stringify(refs, null, 1));
      }
    }));
    const ok = Object.values(refs).filter((r: any) => r.referencePrice > 0).length;
    console.log(`\n${ok} grounded references written to ${refPath}`);
    return;
  }

  // ── paired variant comparison ──
  const VARIANTS = [
    { key: 'A prod (sonnet-4-5)', model: 'claude-sonnet-4-5-20250929' },
    { key: 'B sonnet-5', model: 'claude-sonnet-5' },
    { key: 'C opus-5', model: 'claude-opus-5' },
  ];
  const eligible = picked.filter((e) => refs[e.name]?.referencePrice > 0);
  console.log(`paired comparison over ${eligible.length} grounded items\n`);
  const out: any[] = [];
  for (const [i, e] of eligible.entries()) {
    const row: any = { name: e.name, ref: refs[e.name].referencePrice };
    await Promise.all(VARIANTS.map(async (v) => {
      try { row[v.key] = await runVariant(v.model, e.name); } catch { row[v.key] = null; }
    }));
    out.push(row);
    process.stdout.write(`[${i + 1}/${eligible.length}]\r`);
    fs.writeFileSync(expand(get('out') || '~/.quotemate-bakeoff/estimator-ab.json'), JSON.stringify(out, null, 1));
  }
  console.log('\n');
  console.log(`${'variant'.padEnd(24)}${'n'.padStart(5)}${'medianRatio'.padStart(13)}${'|logErr|'.padStart(10)}${'>2x off'.padStart(9)}${'null'.padStart(6)}`);
  for (const v of VARIANTS) {
    const pairs = out.filter((r) => r[v.key] > 0);
    const ratios = pairs.map((r) => r[v.key] / r.ref).sort((a, b) => a - b);
    const logerr = pairs.map((r) => Math.abs(Math.log(r[v.key] / r.ref)));
    const med = ratios[Math.floor(ratios.length / 2)] || NaN;
    const mlog = logerr.sort((a, b) => a - b)[Math.floor(logerr.length / 2)] || NaN;
    const off = pairs.filter((r) => r[v.key] / r.ref > 2 || r.ref / r[v.key] > 2).length;
    console.log(`${v.key.padEnd(24)}${String(pairs.length).padStart(5)}${med.toFixed(2).padStart(13)}${mlog.toFixed(2).padStart(10)}${String(off).padStart(7)}/${pairs.length}${String(out.length - pairs.length).padStart(6)}`);
  }
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
