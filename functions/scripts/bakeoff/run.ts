/**
 * Quoting bake-off: does QuoteMate's pipeline actually beat asking Claude?
 *
 * Runs three arms over REAL customer job scopes (see surveyCustomerJobs.ts —
 * founder, demo and `recovered-` documents are excluded) and scores them on
 * coverage, price realism, and a blind head-to-head judge.
 *
 * Read-only against Firestore. Writes nothing to any customer record.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   # TRANSPILE_ONLY is required: the harness imports CLIENT sources (which
 *   # reference `@env`, stubbed at runtime by preload.js) but compiles them
 *   # under the functions tsconfig, so type-checking them here fails on
 *   # modules that only resolve in the app's own build. Each package's real
 *   # type safety comes from its own `tsc`, which this does not weaken.
 *   TS_NODE_TRANSPILE_ONLY=true \
 *     npx ts-node scripts/bakeoff/run.ts --corpus=/path/corpus.json --limit=20 --out=/path/out.json
 */

import './preload';

import * as fs from 'fs';
import { generateAppMaterials, runAppArm, runClaudeDirectArm, runClaudeCandidatesArm } from './arms';
import { batchSearch, flushCache } from './scraper';
import { productFactsFor } from './productFacts';
import { scoreLine, scoreArm, LineScore, ArmScore } from './score';
import { judgeBlind } from './judge';
import { ArmResult, CorpusJob, ProductFacts, ScraperProduct } from './types';

interface Args {
  corpus: string;
  out: string;
  limit: number;
  perTradie: number;
  perTrade: number;
  skipJudge: boolean;
  only?: string;
  /** Previous results file to seed generation from, for a clean A/B. */
  seedFrom?: string;
  /** Reuse the Claude arms from the seed run instead of re-running them. */
  reuseClaude: boolean;
  /**
   * Skip the second app variant. Once the description-array defect is fixed at
   * source, `app` and `app-fixed` are the same code and running both is pure
   * cost — the before/after comparison comes from the seed run instead.
   */
  singleAppArm: boolean;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return {
    corpus: get('corpus') || '/tmp/customer-jobs-corpus.json',
    out: get('out') || '/tmp/bakeoff-results.json',
    limit: parseInt(get('limit') || '20', 10),
    perTradie: parseInt(get('per-tradie') || '2', 10),
    perTrade: parseInt(get('per-trade') || '4', 10),
    skipJudge: (get('skip-judge') || 'false') === 'true',
    only: get('only'),
    seedFrom: get('seed-from'),
    reuseClaude: (get('reuse-claude') || 'false') === 'true',
    singleAppArm: (get('single-app-arm') || 'false') === 'true',
  };
}

/**
 * Stratified sample: cap per tradie so the one user with 50 quotes cannot
 * define the result, and cap per trade so fencing (85 of 338 scopes) does not
 * drown the trades where the pipeline may behave completely differently.
 */
export function selectCorpus(rows: CorpusJob[], limit: number, perTradie: number, perTrade: number): CorpusJob[] {
  const picked: CorpusJob[] = [];
  const byTradie = new Map<string, number>();
  const byTrade = new Map<string, number>();
  // Round-robin across trades so a truncated run is still balanced.
  const trades = [...new Set(rows.map((r) => r.trade))];
  const queues = new Map(trades.map((t) => [t, rows.filter((r) => r.trade === t)]));
  let progress = true;
  while (picked.length < limit && progress) {
    progress = false;
    for (const t of trades) {
      if (picked.length >= limit) break;
      const q = queues.get(t)!;
      while (q.length > 0) {
        const cand = q.shift()!;
        if ((byTradie.get(cand.uid) || 0) >= perTradie) continue;
        if ((byTrade.get(t) || 0) >= perTrade) break;
        picked.push(cand);
        byTradie.set(cand.uid, (byTradie.get(cand.uid) || 0) + 1);
        byTrade.set(t, (byTrade.get(t) || 0) + 1);
        progress = true;
        break;
      }
    }
  }
  return picked;
}

async function main() {
  const args = parseArgs();
  const corpus = JSON.parse(fs.readFileSync(args.corpus, 'utf8'));
  const all: CorpusJob[] = corpus.rows;
  const jobs = args.only
    ? all.filter((j) => j.number === args.only || j.docId === args.only)
    : selectCorpus(all, args.limit, args.perTradie, args.perTrade);

  console.log(`Bake-off over ${jobs.length} real customer scopes`);
  const tradeCounts = jobs.reduce((a: any, j) => ((a[j.trade] = (a[j.trade] || 0) + 1), a), {});
  console.log(`Trades: ${JSON.stringify(tradeCounts)}\n`);

  // Seeded A/B: price the SAME generated materials as a previous run, so any
  // difference is the pipeline change and not generation variance. Keyed by
  // docId because job numbers repeat across tradies.
  const seedByDoc = new Map<string, any>();
  if (args.seedFrom) {
    const prev = JSON.parse(fs.readFileSync(args.seedFrom, 'utf8'));
    for (const r of prev.results || []) seedByDoc.set(r.job.docId, r);
    console.log(`Seeding generation from ${seedByDoc.size} previous jobs (identical inputs)\n`);
  }

  const results: any[] = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const tag = `[${i + 1}/${jobs.length}] ${job.number || job.docId} (${job.trade})`;
    process.stdout.write(`${tag} app...`);

    // Generate ONCE, price twice — the two app variants must differ only by
    // the description fix, not by LLM generation variance.
    const prevJob = seedByDoc.get(job.docId);
    // Rebuild the generated rows from the previous run's app lines: the
    // requirement is what generation produced, before any pricing touched it.
    const seed = prevJob
      ? {
          estimatedHours: (prevJob.arms.find((a: any) => a.arm === 'app') || {}).estimatedHours,
          materials: (prevJob.arms.find((a: any) => a.arm === 'app')?.lines || []).map((l: any, i: number) => ({
            id: `m${i}`,
            name: l.name,
            searchTerm: l.searchTerm,
            quantity: l.requiredQty,
            unit: l.requiredUnit,
            requiredQty: l.requiredQty,
            requiredUnit: l.requiredUnit,
            price: 0,
            totalPrice: 0,
          })),
        }
      : undefined;

    let generated: { materials: any[]; estimatedHours?: number };
    try {
      generated = await generateAppMaterials(job, seed && seed.materials.length ? seed : undefined);
    } catch (err: any) {
      console.log(` generation ERR: ${String(err?.message || err).slice(0, 120)}`);
      continue;
    }
    const app = await runAppArm(job, generated, { label: 'app' });
    process.stdout.write(app.error ? ` ERR` : ` ${app.lines.length} lines $${app.materialsSubtotal}${app.reconcile?.error ? ' [reconcile DIED]' : ''}`);

    // Same pipeline, with the scraper description-array defect fixed at the
    // boundary — isolates "the reconcile pass never runs" from "the
    // architecture is wrong".
    let appFixed = app;
    if (!args.singleAppArm) {
      process.stdout.write(' | app+fix...');
      appFixed = await runAppArm(job, generated, { label: 'app-fixed', normaliseDescription: true });
      process.stdout.write(appFixed.error ? ' ERR' : ` ${appFixed.lines.length} lines $${appFixed.materialsSubtotal}${appFixed.reconcile?.error ? ' [reconcile DIED]' : ''}`);
    }

    // The Claude arms are unchanged by a pipeline fix and their inputs (the
    // scope) are identical, so reuse them when A/B-ing to keep the comparison
    // contemporaneous without paying for them twice.
    const prevDirect = args.reuseClaude ? prevJob?.arms.find((a: any) => a.arm === 'claude-direct') : undefined;
    const prevCands = args.reuseClaude ? prevJob?.arms.find((a: any) => a.arm === 'claude-candidates') : undefined;

    process.stdout.write(' | direct...');
    const direct = prevDirect
      ? ({ ...prevDirect, lines: prevDirect.lines, materialsSubtotal: prevDirect.subtotal } as ArmResult)
      : await runClaudeDirectArm(job);
    process.stdout.write(direct.error ? ' ERR' : ` ${direct.lines.length} lines $${direct.materialsSubtotal}${prevDirect ? ' (reused)' : ''}`);

    process.stdout.write(' | cands...');
    const cands = prevCands
      ? ({ ...prevCands, lines: prevCands.lines, materialsSubtotal: prevCands.subtotal } as ArmResult)
      : appFixed.lines.length > 0 ? await runClaudeCandidatesArm(job, appFixed.lines) : { arm: 'claude-candidates' as const, lines: [], materialsSubtotal: 0, ms: 0, error: 'no app lines to price' };
    process.stdout.write(cands.error ? ' ERR' : ` ${cands.lines.length} lines $${cands.materialsSubtotal}`);

    const arms: ArmResult[] = args.singleAppArm ? [app, direct, cands] : [app, appFixed, direct, cands];

    // ── Ground truth ──
    // Every arm's line is scored against the real candidates for ITS OWN search
    // term, so an arm is never penalised for a term another arm chose.
    process.stdout.write(' | truth...');
    const termsNeeded = new Set<string>();
    for (const a of arms) for (const l of a.lines) termsNeeded.add(l.searchTerm || l.name);
    let candidatesByTerm = new Map<string, ScraperProduct[]>();
    try {
      candidatesByTerm = await batchSearch([...termsNeeded]);
    } catch (err: any) {
      console.warn(`\n  truth scrape failed: ${String(err?.message || err).slice(0, 120)}`);
    }

    const allProducts: ScraperProduct[] = [];
    for (const list of candidatesByTerm.values()) allProducts.push(...list);
    // Also fact-check the exact products the arms chose, even if a later
    // scrape no longer returns them.
    for (const a of arms) {
      for (const l of a.lines) {
        if (l.productName) allProducts.push({ productName: l.productName, itemNumber: l.itemNumber, price: l.unitPrice } as ScraperProduct);
      }
    }
    let facts = new Map<string, ProductFacts>();
    try {
      facts = await productFactsFor(allProducts.filter((p) => p.productName));
    } catch (err: any) {
      console.warn(`\n  productFacts failed: ${String(err?.message || err).slice(0, 120)}`);
    }

    const armScores: ArmScore[] = [];
    const lineScoresByArm: Record<string, LineScore[]> = {};
    for (const a of arms) {
      const ls = a.lines.map((l) => scoreLine(l, facts, candidatesByTerm.get(l.searchTerm || l.name) || []));
      lineScoresByArm[a.arm] = ls;
      armScores.push(scoreArm(a.arm, ls, a.materialsSubtotal));
    }

    let judge = null;
    if (!args.skipJudge) {
      process.stdout.write(' | judge...');
      judge = await judgeBlind(job, arms);
    }
    console.log(judge ? ` best=${judge.mapping[judge.bestLabel]}` : '');

    results.push({
      job: { number: job.number, docId: job.docId, trade: job.trade, scopeLength: job.jobDescription.length, storedMaterialCount: job.storedMaterialCount, storedMaterialsSubtotal: job.storedMaterialsSubtotal },
      arms: arms.map((a) => ({ arm: a.arm, error: a.error, reconcile: a.reconcile, ms: a.ms, lineCount: a.lines.length, subtotal: a.materialsSubtotal, estimatedHours: a.estimatedHours, lines: a.lines })),
      scores: armScores,
      lineScores: lineScoresByArm,
      judge,
    });

    flushCache();
    fs.writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), jobCount: jobs.length, results }, null, 2));
  }

  console.log(`\nWrote ${args.out}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
