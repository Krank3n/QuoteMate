/**
 * Recompute line scores on a corrected results file.
 *
 * Needed after fixing a harness bug that left a stale productName on rows the
 * reconcile pass had actually estimated or rejected. Coverage is scored
 * against the row's OWN product facts, so a stale name scored a row against a
 * candidate the pipeline had already discarded. Price realism is unaffected
 * (it reads the term's candidates, not the row's chosen product).
 *
 * Uses the on-disk scrape + product-facts caches, so it re-derives scores
 * without re-running a single arm.
 */
import './preload';
import * as fs from 'fs';
import { batchSearch } from './scraper';
import { productFactsFor } from './productFacts';
import { scoreLine, scoreArm } from './score';
import { ProductFacts, ScraperProduct } from './types';

async function main() {
  const raw = process.argv.slice(2);
  const inPath = raw.find((a) => a.startsWith('--in='))!.slice(5);
  const outPath = raw.find((a) => a.startsWith('--out='))!.slice(6);
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));

  for (const r of data.results) {
    if (!r.arms) continue;
    const terms = new Set<string>();
    for (const a of r.arms) for (const l of a.lines || []) terms.add(l.searchTerm || l.name);
    const byTerm = await batchSearch([...terms]);
    const all: ScraperProduct[] = [];
    for (const list of byTerm.values()) all.push(...list);
    // Cache-only: every fact needed was resolved during the original run.
    const facts: Map<string, ProductFacts> = await productFactsFor(all.filter((p) => p.productName));

    r.lineScores = {};
    r.scores = [];
    for (const a of r.arms) {
      const ls = (a.lines || []).map((l: any) => scoreLine(l, facts, byTerm.get(l.searchTerm || l.name) || []));
      r.lineScores[a.arm] = ls;
      r.scores.push(scoreArm(a.arm, ls, a.subtotal));
    }
    process.stdout.write('.');
  }
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nWrote ${outPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
