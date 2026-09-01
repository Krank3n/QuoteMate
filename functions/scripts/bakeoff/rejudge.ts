/**
 * Re-run the blind judge over an existing results file.
 *
 * The judge reads product names, and a harness defect put ONE product name on
 * up to 20 unrelated rows (the scraper's literal "unknown" item number was used
 * as a Map key, so every unidentified product collided on it). The judge called
 * an arm a "spreadsheet accident" partly on the strength of names it was shown
 * wrongly, in 7 of 12 jobs.
 *
 * The prices and quantities in those results are untouched by that defect, so
 * the honest repair is to drop the fabricated names — which is exactly what the
 * fixed harness now emits — and judge the same quotes again, rather than pay
 * three hours to regenerate identical numbers.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node scripts/bakeoff/rejudge.ts \
 *     --in=/path/results.json --corpus=/path/corpus.json --out=/path/out.json
 */
import './preload';
import * as fs from 'fs';
import { judgeBlind } from './judge';

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const inPath = get('in')!;
  const outPath = get('out') || inPath.replace(/\.json$/, '-rejudged.json');
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  // Results store only the scope's LENGTH, so the text is rejoined from the
  // corpus by docId. Without the scope the judge has nothing to judge against.
  const corpus = JSON.parse(fs.readFileSync(get('corpus')!, 'utf8'));
  const scopeById = new Map<string, string>(
    (corpus.rows || []).map((r: any) => [r.docId, r.jobDescription]),
  );

  let stripped = 0;
  for (const r of data.results || []) {
    for (const a of r.arms || []) {
      for (const l of a.lines || []) {
        // "unknown" is not an identifier — a row whose SKU could not be
        // identified must show no product name at all.
        if (l.itemNumber === 'unknown' || (!l.itemNumber && l.productName && l.priceSource !== 'scraped')) {
          if (l.productName) stripped++;
          delete l.productName;
          delete l.itemNumber;
        }
      }
    }
  }
  console.log(`stripped ${stripped} fabricated product names\n`);

  for (const [i, r] of (data.results || []).entries()) {
    const job = { ...r.job, jobDescription: scopeById.get(r.job.docId) || '' };
    if (!job.jobDescription) {
      console.log(`[${i + 1}] ${r.job.number} — no scope stored, skipped`);
      continue;
    }
    const arms = (r.arms || []).map((a: any) => ({
      arm: a.arm,
      lines: a.lines || [],
      materialsSubtotal: a.subtotal,
      estimatedHours: a.estimatedHours,
      error: a.error,
      ms: a.ms,
    }));
    process.stdout.write(`[${i + 1}/${data.results.length}] ${r.job.number} `);
    try {
      const j = await judgeBlind(job as any, arms as any);
      r.judge = j;
      console.log(j ? `best=${j.mapping[j.bestLabel]}` : 'judge returned null');
    } catch (err: any) {
      console.log(`ERR ${String(err?.message || err).slice(0, 70)}`);
    }
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  }
  console.log(`\nWrote ${outPath}`);
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
