/**
 * Is the pipeline quoting the RIGHT ITEM?
 *
 * The cost oracle answers "is this the right price for what you looked up".
 * It cannot see that `Wall Tile Grout` was priced against a Tile & Grout
 * SEALER — a perfect price for the wrong product. That blind spot is why the
 * app measures 22 points ahead of Claude on price accuracy while the blind
 * judge marks it down on price sanity. This closes it.
 *
 * Design, following what has already proven necessary in this harness:
 *  - Judged blind: no arm labels, no prices. Price would leak "the system
 *    thought this was fine" and is not what is being asked.
 *  - CALIBRATION CONTROLS are mixed in — pairs whose answer is known from
 *    earlier findings. If the judge misses those, its verdicts on the real
 *    pairs are discounted rather than reported.
 *  - Three verdicts, because "wrong" has two very different costs: a wrong
 *    CATEGORY is a bad quote, a wrong SPEC is a defensible one a tradie can
 *    correct.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/bakeoff/matchAudit.ts --in=/path/results.json
 */

import './preload';
import * as fs from 'fs';
import { askJson } from './claude';

interface Pair {
  requirement: string;
  product: string;
  arm: string;
  /** Set on calibration controls only. */
  expected?: 'right' | 'wrong_category';
  control?: string;
}

/**
 * Known answers drawn from findings earlier in this session, so the judge's
 * own reliability is measured rather than assumed.
 */
const CONTROLS: Pair[] = [
  { requirement: 'Concrete Mix — 440 kg', product: 'Dingo 20kg MaxPRO Concrete Mix', arm: 'control', expected: 'right', control: 'obvious match' },
  { requirement: 'Turf Underlay Soil — 3000 kg', product: 'Tuff Turf 155mm Synthetic Grass Joining Roller', arm: 'control', expected: 'wrong_category', control: 'soil vs a roller' },
  { requirement: 'Merbau Decking Boards — 195 each', product: '90 x 19mm 2.25m Merbau Pre-Oiled Decking - 5 Pack', arm: 'control', expected: 'right', control: 'obvious match' },
  { requirement: 'N12 Starter Bars 600mm — 30 each', product: 'Chrome Towel Bar 600mm', arm: 'control', expected: 'wrong_category', control: 'rebar vs a towel bar' },
  { requirement: 'Wall Tile Grout — 1.5 kg', product: 'Betta TileCare 1L Tile & Grout Sealer', arm: 'control', expected: 'wrong_category', control: 'grout vs sealer' },
  { requirement: 'Rubber Grout Float — 1 each', product: 'QEP 270 x 100mm Gum Rubber Grout Float', arm: 'control', expected: 'right', control: 'obvious match' },
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'why'],
        properties: {
          index: { type: 'integer' },
          verdict: {
            type: 'string',
            enum: ['right', 'wrong_spec', 'wrong_category'],
            description:
              "right = a tradie would accept this product for this line. wrong_spec = right kind of thing, wrong size/grade/brand. wrong_category = a different kind of product entirely.",
          },
          why: { type: 'string', description: 'One short clause.' },
        },
      },
    },
  },
} as const;

async function main() {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const data = JSON.parse(fs.readFileSync(get('in')!, 'utf8'));
  const outPath = get('out') || get('in')!.replace(/\.json$/, '-matchaudit.json');

  const pairs: Pair[] = [];
  for (const r of data.results || []) {
    for (const a of r.arms || []) {
      for (const l of a.lines || []) {
        if (l.priceSource !== 'scraped' || !l.productName) continue;
        pairs.push({
          requirement: `${l.name} — ${l.requiredQty} ${l.requiredUnit}`,
          product: l.productName,
          arm: a.arm,
        });
      }
    }
  }
  // Controls repeated so they land in several batches, not just the first.
  const all = [...pairs];
  for (let i = 0; i < 3; i++) all.push(...CONTROLS);
  all.sort(() => Math.random() - 0.5);

  console.log(`judging ${pairs.length} real pairs + ${CONTROLS.length * 3} calibration controls\n`);

  const verdicts = new Map<number, { verdict: string; why: string }>();
  const BATCH = 40;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const block = batch
      .map((p, j) => `[${j}] TRADIE ASKED FOR: ${p.requirement}\n     PRODUCT QUOTED: ${p.product}`)
      .join('\n\n');
    try {
      const { value } = await askJson<any>(
        `For each line, say whether the product quoted is the right item for what the tradie asked for. Judge the PRODUCT ONLY — you are not being asked about price or quantity.\n\n${block}`,
        SCHEMA as any,
        { system: 'You are an Australian trade estimator checking that each quoted product is the right item for the line it was priced against.', effort: 'medium', maxTokens: 32000 },
      );
      for (const v of value.verdicts || []) {
        const idx = i + Number(v.index);
        if (batch[Number(v.index)]) verdicts.set(idx, { verdict: v.verdict, why: v.why });
      }
    } catch (err: any) {
      console.warn(`  batch failed: ${String(err?.message || err).slice(0, 120)}`);
    }
    process.stdout.write('.');
  }
  console.log();

  // ── Calibration first: an unreliable judge invalidates everything below ──
  let ctlOk = 0, ctlTotal = 0;
  const ctlMisses: string[] = [];
  all.forEach((p, i) => {
    if (!p.expected) return;
    const v = verdicts.get(i);
    if (!v) return;
    ctlTotal++;
    // wrong_spec is an acceptable read of a "right" control (brand/size nuance).
    const ok = p.expected === 'right' ? v.verdict !== 'wrong_category' : v.verdict === 'wrong_category';
    if (ok) ctlOk++; else ctlMisses.push(`${p.control}: said ${v.verdict}`);
  });
  console.log(`CALIBRATION: ${ctlOk}/${ctlTotal} controls correct`);
  for (const m of ctlMisses) console.log(`   miss — ${m}`);
  if (ctlTotal && ctlOk / ctlTotal < 0.8) {
    console.log('\n  Judge failed calibration; verdicts below are NOT reliable.\n');
  }

  const byArm: Record<string, Record<string, number>> = {};
  const examples: string[] = [];
  all.forEach((p, i) => {
    if (p.expected) return;
    const v = verdicts.get(i);
    if (!v) return;
    byArm[p.arm] = byArm[p.arm] || {};
    byArm[p.arm][v.verdict] = (byArm[p.arm][v.verdict] || 0) + 1;
    if (v.verdict === 'wrong_category' && examples.length < 12) {
      examples.push(`  ${p.arm.padEnd(18)} ${p.requirement.slice(0, 34).padEnd(34)} -> ${p.product.slice(0, 40)}  (${v.why.slice(0, 46)})`);
    }
  });

  console.log(`\nIS THE QUOTED PRODUCT THE RIGHT ITEM?`);
  console.log(`  arm                     n    right   wrong spec   WRONG CATEGORY`);
  for (const [arm, c] of Object.entries(byArm)) {
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    const pc = (k: string) => (n ? `${Math.round(((c[k] || 0) / n) * 100)}%` : '—');
    console.log(`  ${arm.padEnd(20)}${String(n).padStart(5)}${pc('right').padStart(9)}${pc('wrong_spec').padStart(13)}${pc('wrong_category').padStart(17)}`);
  }
  if (examples.length) {
    console.log(`\nwrong-category examples:`);
    for (const e of examples) console.log(e);
  }
  fs.writeFileSync(outPath, JSON.stringify({ calibration: { ok: ctlOk, total: ctlTotal, misses: ctlMisses }, byArm }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
