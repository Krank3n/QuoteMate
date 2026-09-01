/**
 * Offline audit of isNonRetailTradeRow's false-positive surface.
 *
 * A row routed here NEVER hits supplier search — it gets a flat trade-table
 * estimate or stays unpriced. That is correct for services, hire, disposal and
 * bulk supply. It is wrong for anything Bunnings actually stocks, because the
 * tradie then gets a made-up number for an item with a real shelf price.
 *
 * These are ordinary hardware items, most of which appeared in real customer
 * quotes during the bake-off.
 */
import './preload';
import { isNonRetailTradeRow, tradeFallbackUnitPriceWithUnit } from '../../../src/utils/tradeFallback';

const STOCKED: Array<[string, string]> = [
  ['rubber grout float', 'each'],
  ['tiling grout sponge', 'each'],
  ['manual grout saw', 'each'],
  ['grout removal blade oscillating multi tool', 'each'],
  ['tile and grout cleaner', 'L'],
  ['flexible floor grout light grey', 'kg'],
  ['wall tiles 300x600 white gloss', 'each'],
  ['floor tiles 600x600 matt', 'each'],
  ['plasterboard 10mm 2400x1200', 'each'],
  ['villaboard 6mm sheet', 'each'],
  ['basin mixer tap chrome', 'each'],
  ['road base 20mm', 'kg'],
  ['crusher dust', 'kg'],
];

const GENUINELY_NON_RETAIL: Array<[string, string]> = [
  ['concrete pump hire', 'each'],
  ['skip bin 6m3', 'each'],
  ['tip fees green waste disposal', 'each'],
  ['ready mix concrete 25mpa delivered', 'm³'],
  ['N16 starter bars', 'each'],
  ['diesel fuel', 'L'],
];

let fp = 0;
console.log('ITEMS BUNNINGS STOCKS — routed away from retail search?\n');
for (const [name, unit] of STOCKED) {
  const routed = isNonRetailTradeRow(name, unit, 10);
  const hit = tradeFallbackUnitPriceWithUnit(name, unit as any);
  const safe = hit && (hit.per === unit || ['each', 'pack', 'box'].includes(unit));
  if (routed) fp += 1;
  console.log(
    `  ${routed ? 'ROUTED AWAY' : 'searched   '}  ${name.padEnd(46)} unit=${unit.padEnd(4)}` +
      (routed ? `  -> ${hit ? (safe ? `flat $${hit.price}/${hit.per}` : `table says $${hit.price}/${hit.per} — unit-unsafe, stays UNPRICED`) : 'no table entry — stays UNPRICED'}` : ''),
  );
}
console.log(`\n  false positives: ${fp}/${STOCKED.length}\n`);

console.log('GENUINELY NON-RETAIL — correctly routed?\n');
let tp = 0;
for (const [name, unit] of GENUINELY_NON_RETAIL) {
  const routed = isNonRetailTradeRow(name, unit, 10);
  if (routed) tp += 1;
  console.log(`  ${routed ? 'ROUTED AWAY' : 'searched   '}  ${name}`);
}
console.log(`\n  correctly routed: ${tp}/${GENUINELY_NON_RETAIL.length}\n`);

// ── Measured rate over REAL generated lines ──
// The hand-picked list above demonstrates the failure mode but is selected, so
// it is not a rate. This measures the actual share of lines the pipeline routed
// away from supplier search across every app-arm line in a bake-off run, and
// how many of those had real candidates available had it looked.
import * as fs from 'fs';
import { batchSearch } from './scraper';

async function measuredRate(resultsPath: string) {
  const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const lines: Array<{ name: string; searchTerm?: string; unit: string; qty: number }> = [];
  for (const r of data.results || []) {
    const app = (r.arms || []).find((a: any) => a.arm === 'app-fixed');
    if (!app) continue;
    for (const l of app.lines || []) lines.push({ name: l.name, searchTerm: l.searchTerm, unit: l.requiredUnit, qty: l.requiredQty });
  }
  const routed = lines.filter((l) => isNonRetailTradeRow(`${l.searchTerm || ''} ${l.name}`, l.unit as any, l.qty));
  console.log(`\nMEASURED OVER ${lines.length} REAL GENERATED LINES (${data.results.length} jobs)`);
  console.log(`  routed away from supplier search: ${routed.length}  (${((routed.length / lines.length) * 100).toFixed(0)}%)`);

  // Of the routed rows, how many would the scraper actually have found?
  const terms = [...new Set(routed.map((l) => l.searchTerm || l.name))];
  const found = await batchSearch(terms);
  let withCandidates = 0;
  for (const t of terms) if ((found.get(t) || []).filter((c) => c.price > 0).length > 0) withCandidates += 1;
  console.log(`  of those, terms Bunnings DOES stock : ${withCandidates}/${terms.length}  (${((withCandidates / terms.length) * 100).toFixed(0)}%)`);
  console.log(`  -> lines given a flat estimate despite a real shelf price being available\n`);
}

const resultsArg = process.argv.find((a) => a.startsWith('--results='))?.slice(10);
if (resultsArg) {
  measuredRate(resultsArg).catch((e) => console.error(e));
}
