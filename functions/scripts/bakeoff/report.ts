/**
 * Aggregate a bake-off run into the numbers that answer the question:
 * is QuoteMate's pipeline actually better than asking Claude?
 *
 * Usage: npx ts-node scripts/bakeoff/report.ts --in=/path/results.json
 */

import * as fs from 'fs';

const ARMS = ['app', 'app-fixed', 'claude-direct', 'claude-candidates'] as const;
type Arm = (typeof ARMS)[number];

function pct(n: number, d: number): string {
  if (d === 0) return '  —  ';
  return `${((n / d) * 100).toFixed(0)}%`.padStart(5);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const raw = process.argv.slice(2);
  const inPath = raw.find((a) => a.startsWith('--in='))?.slice(5) || '/tmp/bakeoff-results.json';
  const corpusPath = raw.find((a) => a.startsWith('--corpus='))?.slice(9);
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const results: any[] = data.results.filter((r: any) => r.scores);

  console.log(`\nBAKE-OFF — ${results.length} real customer job scopes\n${'='.repeat(78)}`);

  // ── Reconcile health (arm A only) ──
  const appArms = results.map((r) => r.arms.find((a: any) => a.arm === 'app')).filter(Boolean);
  const withReconcile = appArms.filter((a: any) => a.reconcile && a.reconcile.requested > 0);
  const died = withReconcile.filter((a: any) => a.reconcile.error);
  // The binary "did it crash" flag understates this. The loop aborts at the
  // FIRST applied row, so a quote that dies early loses the safety pass for
  // every row after it — on one job all 17. Rows-protected is the honest
  // measure of how much cover the coverage floor / over-buy clamp / category
  // gate actually provide in production.
  const requested = withReconcile.reduce((n: number, a: any) => n + a.reconcile.requested, 0);
  const applied = withReconcile.reduce((n: number, a: any) => n + a.reconcile.applied, 0);
  console.log(`\nRECONCILE SAFETY PASS (production as shipped)`);
  console.log(`  quotes where reconcile had rows to check : ${withReconcile.length}/${appArms.length}`);
  console.log(`  quotes where it crashed and was abandoned: ${died.length}/${withReconcile.length}  ${pct(died.length, withReconcile.length)}`);
  console.log(`  ROWS actually protected by it            : ${applied}/${requested}  ${pct(applied, requested)}`);
  if (died.length) {
    const msgs = new Map<string, number>();
    for (const a of died) msgs.set(a.reconcile.error, (msgs.get(a.reconcile.error) || 0) + 1);
    for (const [m, n] of msgs) console.log(`     ${n}x  ${m.slice(0, 90)}`);
    const lost = died.map((a: any) => a.reconcile.requested - a.reconcile.applied);
    console.log(`     rows lost per crashed quote: ${lost.join(', ')}`);
  }

  // ── What the crash actually costs, per job ──
  // One job showed $89,298 vs $8,809 on an early run and $6,848 vs $6,288 on a
  // later one, from the same scope — analyzeJobDescription is non-deterministic,
  // so the crash's impact is a DISTRIBUTION, not a constant multiple. Leading
  // with the worst case would overstate it; leading with the median would hide
  // the tail. Report both.
  const impacts: Array<{ job: string; ratio: number; app: number; fixed: number }> = [];
  for (const r of results) {
    const a = r.scores.find((s: any) => s.arm === 'app');
    const f = r.scores.find((s: any) => s.arm === 'app-fixed');
    if (!a || !f || !(f.subtotal > 0)) continue;
    impacts.push({ job: r.job.number, ratio: a.subtotal / f.subtotal, app: a.subtotal, fixed: f.subtotal });
  }
  if (impacts.length) {
    const ratios = impacts.map((x) => x.ratio);
    const med = median(ratios)!;
    const worst = impacts.slice().sort((x, y) => y.ratio - x.ratio)[0];
    const materiallyOff = impacts.filter((x) => x.ratio > 1.2 || x.ratio < 0.8).length;
    console.log(`\nWHAT THE CRASH COSTS (app as shipped vs same materials with the fix)`);
    console.log(`  jobs compared                  : ${impacts.length}`);
    console.log(`  median subtotal ratio           : ${med.toFixed(2)}×`);
    console.log(`  jobs differing by more than 20% : ${materiallyOff}/${impacts.length}  ${pct(materiallyOff, impacts.length)}`);
    console.log(`  worst single job                : ${worst.job}  $${worst.app.toFixed(0)} vs $${worst.fixed.toFixed(0)}  (${worst.ratio.toFixed(1)}×)`);
  }

  // ── Per-arm aggregates ──
  console.log(`\nPER-ARM RESULTS`);
  console.log(
    `  ${'arm'.padEnd(19)}${'lines'.padStart(6)}${'under'.padStart(7)}${'over'.padStart(6)}${'cov ok'.padStart(8)}${'no SKU'.padStart(8)}${'$0'.padStart(5)}${'measurd'.padStart(9)}${'cost off'.padStart(10)}${'med cost'.padStart(10)}`,
  );
  const summary: Record<string, any> = {};
  for (const arm of ARMS) {
    const rows = results.map((r) => r.scores.find((s: any) => s.arm === arm)).filter(Boolean);
    const sum = (k: string) => rows.reduce((a: number, s: any) => a + (s[k] || 0), 0);
    const lines = sum('lineCount');
    const checkable = sum('coverageOk') + sum('underBuy') + sum('overBuy');
    const allRatios: number[] = [];
    for (const r of results) for (const s of r.lineScores?.[arm] || []) if (s.costRatio !== null) allRatios.push(s.costRatio);
    const med = median(allRatios);
    summary[arm] = {
      lines,
      under: sum('underBuy'),
      over: sum('overBuy'),
      ok: sum('coverageOk'),
      noSku: sum('noSkuLines'),
      unpriced: sum('unpricedLines'),
      costWayOff: sum('costWayOff'),
      costComparable: sum('costComparable'),
      medianCostRatio: med,
      checkable,
      subtotal: sum('subtotal'),
    };
    console.log(
      `  ${arm.padEnd(19)}${String(lines).padStart(6)}${String(sum('underBuy')).padStart(7)}${String(sum('overBuy')).padStart(6)}` +
        `${pct(sum('coverageOk'), checkable).padStart(8)}${pct(sum('noSkuLines'), lines).padStart(8)}${String(sum('unpricedLines')).padStart(5)}` +
        `${pct(sum('costComparable'), lines).padStart(9)}` +
        `${pct(sum('costWayOff'), sum('costComparable')).padStart(10)}${(med === null ? '—' : med.toFixed(2) + '×').padStart(10)}`,
    );
  }
  console.log(
    `\n  under/over = purchase does not cover the requirement / buys >2x it (only countable where a real SKU was picked)` +
      `\n  cov ok     = share of SKU-backed lines whose purchase genuinely covers the job` +
      `\n  no SKU     = lines whose money has no product behind it (fallback table, or the model's own price)` +
      `\n  measurd    = share of lines a real cost could be established for — the rest are not in "cost off"` +
      `\n  cost off   = share of measurable lines charging <0.5x or >2x the real cost to cover that line` +
      `\n  med cost   = median (line total / real cost). 1.00x is perfect.`,
  );

  // ── Blind judge ──
  const judged = results.filter((r) => r.judge);
  const wins: Record<string, number> = {};
  const worst: Record<string, number> = {};
  const sendable: Record<string, { yes: number; total: number }> = {};
  const scoreSums: Record<string, { c: number; q: number; p: number; n: number }> = {};
  for (const r of judged) {
    const best = r.judge.mapping[r.judge.bestLabel];
    const wst = r.judge.mapping[r.judge.worstLabel];
    wins[best] = (wins[best] || 0) + 1;
    worst[wst] = (worst[wst] || 0) + 1;
    for (const [label, q] of Object.entries<any>(r.judge.perLabel)) {
      const arm = r.judge.mapping[label];
      if (!arm) continue;
      sendable[arm] = sendable[arm] || { yes: 0, total: 0 };
      sendable[arm].total += 1;
      if (q.sendable) sendable[arm].yes += 1;
      scoreSums[arm] = scoreSums[arm] || { c: 0, q: 0, p: 0, n: 0 };
      scoreSums[arm].c += q.completeness || 0;
      scoreSums[arm].q += q.quantitySanity || 0;
      scoreSums[arm].p += q.priceSanity || 0;
      scoreSums[arm].n += 1;
    }
  }
  // Scope coverage, measured two ways that do not depend on each other: the
  // judge's count of materials the scope needs but the quote omits, and the raw
  // line count. On multi-trade scopes the app was omitting whole sections the
  // customer asked for (demolition, disposal, a room fit-out), which is a
  // GENERATION gap, not a pricing one — worth separating from pack maths.
  const missing: Record<string, number> = {};
  const lineCounts: Record<string, number> = {};
  for (const r of judged) {
    for (const [label, q] of Object.entries<any>(r.judge.perLabel)) {
      const arm = r.judge.mapping[label];
      if (!arm) continue;
      missing[arm] = (missing[arm] || 0) + (Array.isArray(q.missingItems) ? q.missingItems.length : 0);
    }
    for (const a of r.arms) lineCounts[a.arm] = (lineCounts[a.arm] || 0) + (a.lineCount || 0);
  }

  console.log(`\nBLIND HEAD-TO-HEAD (${judged.length} jobs, arms shuffled and unlabelled)`);
  console.log(
    `  ${'arm'.padEnd(19)}${'best'.padStart(6)}${'worst'.padStart(7)}${'sendable'.padStart(10)}${'complete'.padStart(10)}${'qty'.padStart(7)}${'price'.padStart(7)}${'missing'.padStart(9)}${'lines'.padStart(7)}`,
  );
  for (const arm of ARMS) {
    const s = scoreSums[arm];
    const sd = sendable[arm];
    const miss = missing[arm] || 0;
    console.log(
      `  ${arm.padEnd(19)}${String(wins[arm] || 0).padStart(6)}${String(worst[arm] || 0).padStart(7)}` +
        `${(sd ? pct(sd.yes, sd.total) : '  —  ').padStart(10)}` +
        `${(s && s.n ? (s.c / s.n).toFixed(1) : '—').padStart(10)}${(s && s.n ? (s.q / s.n).toFixed(1) : '—').padStart(7)}${(s && s.n ? (s.p / s.n).toFixed(1) : '—').padStart(7)}` +
        `${(judged.length ? (miss / judged.length).toFixed(1) : '—').padStart(9)}${String(lineCounts[arm] || 0).padStart(7)}`,
    );
  }
  console.log(
    `\n  missing = materials the scope needs that the quote omits, per job (blind judge)` +
      `\n  lines   = total quote lines produced across all jobs`,
  );

  // ── Cost realism: the decisive question for "just ask Claude" ──
  console.log(`\nPRICE REALISM — arm total vs what those lines really cost`);
  for (const arm of ARMS) {
    const s = summary[arm];
    let armTotal = 0;
    let realTotal = 0;
    for (const r of results) {
      const sc = r.scores.find((x: any) => x.arm === arm);
      if (!sc) continue;
      armTotal += sc.armSubtotalOnComparable || 0;
      realTotal += sc.realSubtotalOnComparable || 0;
    }
    const delta = realTotal > 0 ? armTotal / realTotal : null;
    console.log(
      `  ${arm.padEnd(19)} quoted $${armTotal.toFixed(0).padStart(8)}  vs real $${realTotal.toFixed(0).padStart(8)}  = ${delta === null ? '—' : delta.toFixed(2) + '×'}  (${s.costComparable} comparable lines)`,
    );
  }

  // ── Labour ──
  // Materials are only part of a tradie's quote; labour is often the bigger
  // half. The stored quote's own hours are the closest thing to a real answer
  // — the tradie kept or edited them before sending — with the caveat that a
  // draft never sent was never checked by anyone.
  if (corpusPath) {
    const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
    const storedHoursByDoc = new Map<string, number>();
    for (const c of corpus.rows) if (c.storedLabourHours > 0) storedHoursByDoc.set(c.docId, c.storedLabourHours);

    const ratios: Record<string, number[]> = {};
    let jobsWithHours = 0;
    for (const r of results) {
      const stored = storedHoursByDoc.get(r.job.docId);
      if (!stored) continue;
      jobsWithHours += 1;
      for (const a of r.arms) {
        if (!(a.estimatedHours > 0)) continue;
        (ratios[a.arm] = ratios[a.arm] || []).push(a.estimatedHours / stored);
      }
    }
    if (jobsWithHours > 0) {
      console.log(`\nLABOUR HOURS vs the tradie's own stored hours (n=${jobsWithHours} jobs with stored hours)`);
      for (const arm of ARMS) {
        const rs = ratios[arm] || [];
        if (rs.length === 0) continue;
        const m = median(rs);
        const within = rs.filter((x) => x >= 0.67 && x <= 1.5).length;
        console.log(
          `  ${arm.padEnd(19)} median ${(m === null ? '—' : m.toFixed(2) + '×').padStart(7)}   within 1.5x of stored: ${pct(within, rs.length)}`,
        );
      }
      console.log(`  (app and app-fixed share one estimate — labour comes from generation, which the pricing fix does not touch)`);
      console.log(
        `  CAVEAT: stored hours are probably the app's OWN estimate that the tradie accepted, so\n` +
          `  "app matches stored" is partly circular and must not be read as the app being accurate.\n` +
          `  What is NOT circular: claude-direct lands ~2x the app's hours, which would materially\n` +
          `  change every quote total — and nothing in this harness checks whether a total is winnable.`,
      );
    }
  }

  // ── Per-trade, so a single trade cannot carry the verdict ──
  console.log(`\nBY TRADE (blind-judge wins)`);
  const trades = [...new Set(results.map((r) => r.job.trade))];
  for (const t of trades) {
    const rs = judged.filter((r) => r.job.trade === t);
    if (rs.length === 0) continue;
    const w: Record<string, number> = {};
    for (const r of rs) {
      const b = r.judge.mapping[r.judge.bestLabel];
      w[b] = (w[b] || 0) + 1;
    }
    console.log(`  ${t.padEnd(14)} n=${String(rs.length).padStart(2)}  ${ARMS.map((a) => `${a}:${w[a] || 0}`).join('  ')}`);
  }

  console.log();
}

main();
