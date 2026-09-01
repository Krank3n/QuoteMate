/**
 * Before/after comparison for a pipeline change, on IDENTICAL generated input.
 *
 * The "after" run is seeded from the "before" run's generated rows (see
 * run.ts --seed-from), so every difference below is the code change rather
 * than generation variance — which is large enough on its own to swamp a real
 * effect if you let it (the same scope produced $89,298 and $6,848 on two
 * runs of the unfixed pipeline).
 *
 * Usage:
 *   npx ts-node scripts/bakeoff/abCompare.ts --before=<results.json> --after=<results.json>
 */

import * as fs from 'fs';

interface Row {
  name: string;
  requiredQty: number;
  requiredUnit: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  priceSource: string;
  productName?: string;
}

function armOf(job: any, arm: string) {
  return (job.arms || []).find((a: any) => a.arm === arm);
}
function scoreOf(job: any, arm: string) {
  return (job.scores || []).find((s: any) => s.arm === arm);
}
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const before = JSON.parse(fs.readFileSync(get('before')!, 'utf8'));
  const after = JSON.parse(fs.readFileSync(get('after')!, 'utf8'));
  // The "before" baseline is production as it shipped: the `app` arm of the
  // earlier run, which carried the crash.
  const BEFORE_ARM = get('before-arm') || 'app';
  const AFTER_ARM = get('after-arm') || 'app';

  const beforeByDoc = new Map<string, any>();
  for (const r of before.results || []) beforeByDoc.set(r.job.docId, r);

  const pairs: Array<{ job: any; b: any; a: any; bs: any; as: any }> = [];
  for (const r of after.results || []) {
    const b = beforeByDoc.get(r.job.docId);
    if (!b) continue;
    const bArm = armOf(b, BEFORE_ARM);
    const aArm = armOf(r, AFTER_ARM);
    if (!bArm || !aArm) continue;
    pairs.push({ job: r.job, b: bArm, a: aArm, bs: scoreOf(b, BEFORE_ARM), as: scoreOf(r, AFTER_ARM) });
  }

  console.log(`\nBEFORE/AFTER — ${pairs.length} jobs, identical generated materials\n${'='.repeat(72)}`);

  // ── The thing the change was for ──
  const zeros = (arm: any) => (arm.lines || []).filter((l: Row) => !(l.unitPrice > 0)).length;
  const bZeroLines = pairs.reduce((n, p) => n + zeros(p.b), 0);
  const aZeroLines = pairs.reduce((n, p) => n + zeros(p.a), 0);
  const bZeroJobs = pairs.filter((p) => zeros(p.b) > 0).length;
  const aZeroJobs = pairs.filter((p) => zeros(p.a) > 0).length;
  console.log(`\n$0 LINES — the defect this change targets`);
  console.log(`  lines at $0 : ${bZeroLines}  ->  ${aZeroLines}`);
  console.log(`  jobs with one: ${bZeroJobs}/${pairs.length}  ->  ${aZeroJobs}/${pairs.length}`);

  // ── Deterministic quality ──
  const sum = (ps: typeof pairs, side: 'bs' | 'as', k: string) =>
    ps.reduce((n, p) => n + ((p[side] || {})[k] || 0), 0);
  const rows: Array<[string, string, string]> = [];
  const checkable = (side: 'bs' | 'as') => sum(pairs, side, 'coverageOk') + sum(pairs, side, 'underBuy') + sum(pairs, side, 'overBuy');
  rows.push(['coverage correct', pct(sum(pairs, 'bs', 'coverageOk'), checkable('bs')), pct(sum(pairs, 'as', 'coverageOk'), checkable('as'))]);
  rows.push(['under-buys', String(sum(pairs, 'bs', 'underBuy')), String(sum(pairs, 'as', 'underBuy'))]);
  rows.push(['over-buys', String(sum(pairs, 'bs', 'overBuy')), String(sum(pairs, 'as', 'overBuy'))]);
  rows.push(['lines with no SKU', String(sum(pairs, 'bs', 'noSkuLines')), String(sum(pairs, 'as', 'noSkuLines'))]);
  rows.push(['unpriced lines', String(sum(pairs, 'bs', 'unpricedLines')), String(sum(pairs, 'as', 'unpricedLines'))]);
  rows.push(['broken line arithmetic', String(sum(pairs, 'bs', 'arithmeticBreaks')), String(sum(pairs, 'as', 'arithmeticBreaks'))]);

  const bQ = sum(pairs, 'bs', 'armSubtotalOnComparable');
  const aQ = sum(pairs, 'as', 'armSubtotalOnComparable');
  const bR = sum(pairs, 'bs', 'realSubtotalOnComparable');
  const aR = sum(pairs, 'as', 'realSubtotalOnComparable');
  rows.push(['quoted vs real cost', bR > 0 ? `${(bQ / bR).toFixed(2)}×` : '—', aR > 0 ? `${(aQ / aR).toFixed(2)}×` : '—']);

  console.log(`\nDETERMINISTIC QUALITY`);
  console.log(`  ${'measure'.padEnd(26)}${'before'.padStart(10)}${'after'.padStart(10)}`);
  for (const [k, b, a] of rows) console.log(`  ${k.padEnd(26)}${b.padStart(10)}${a.padStart(10)}`);

  // ── Totals ──
  const ratios = pairs.map((p) => (p.b.subtotal > 0 ? p.a.subtotal / p.b.subtotal : null)).filter((x): x is number => x !== null);
  console.log(`\nQUOTE TOTALS`);
  console.log(`  median after/before subtotal : ${median(ratios)?.toFixed(2)}×`);
  const moved = pairs
    .map((p) => ({ job: p.job, b: p.b.subtotal, a: p.a.subtotal, r: p.b.subtotal > 0 ? p.a.subtotal / p.b.subtotal : 1 }))
    .sort((x, y) => Math.abs(Math.log(y.r || 1)) - Math.abs(Math.log(x.r || 1)))
    .slice(0, 6);
  console.log(`  biggest movers:`);
  for (const m of moved) {
    console.log(`    ${String(m.job.number).padEnd(11)} ${String(m.job.trade).padEnd(12)} $${m.b.toFixed(0).padStart(9)} -> $${m.a.toFixed(0).padStart(9)}  ${m.r.toFixed(2)}×`);
  }
  console.log();
}

main();
