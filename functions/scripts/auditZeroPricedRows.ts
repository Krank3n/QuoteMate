/**
 * How often does a $0 material row actually reach a customer?
 *
 * Read-only over stored production quotes. The bake-off replay could not
 * answer this: its harness skipped the AI-estimate fallback for non-retail
 * rows, which production does attempt, so the replay over-counted $0 lines.
 * Stored documents are the ground truth.
 */
import * as admin from 'firebase-admin';

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: 'hansendev' });
  const db = admin.firestore();
  const users = (await db.collection('users').get()).docs;

  let quotes = 0, quotesWithZero = 0, rows = 0, zeroRows = 0, sentWithZero = 0, sentQuotes = 0;
  let attemptedZero = 0, inPartlyPricedQuote = 0, pricedQuotes = 0;
  const stageCounts: Record<string, number> = {};
  const namesOut = new Set<string>();
  const examples: string[] = [];
  // Real stage vocabulary in Firestore — not 'sent'/'accepted'.
  const SENT = new Set(['quote_sent', 'quote_accepted', 'quote_rejected', 'invoiced', 'paid', 'scheduled', 'complete', 'completed']);

  for (const u of users) {
    const snap = await db.collection('users').doc(u.id).collection('documents')
      .orderBy('createdAt', 'desc').limit(40).get();
    for (const ds of snap.docs) {
      if (ds.id.startsWith('recovered-')) continue;
      const d: any = ds.data();
      if (d.type && d.type !== 'quote') continue;
      const mats: any[] = d.materials || [];
      if (mats.length === 0) continue;
      quotes += 1;
      const isSent = SENT.has(String(d.stage || '').toLowerCase());
      if (isSent) sentQuotes += 1;
      stageCounts[String(d.stage || 'undefined')] = (stageCounts[String(d.stage || 'undefined')] || 0) + 1;
      let zeroHere = 0;
      // A quote where NO row was ever priced is a draft the tradie never ran
      // pricing on — a different problem from a pricing pass that tried and
      // failed. Only the latter is the pipeline's fault.
      const anyPriced = mats.some((m: any) => Number(m.price) > 0);
      for (const m of mats) {
        if (m.kind === 'work') continue;
        rows += 1;
        if (!(Number(m.price) > 0) && Number(m.quantity) > 0) {
          zeroRows += 1;
          zeroHere += 1;
          if (m.pricingSource) attemptedZero += 1;
          if (m.name) namesOut.add(`${m.name}||${m.unit || 'each'}||${m.quantity}`);
          if (anyPriced) inPartlyPricedQuote += 1;
          if (anyPriced && examples.length < 12) examples.push(`${String(m.name || '').slice(0, 40)} — ${m.quantity} ${m.unit} — src=${m.pricingSource || 'none'} conf=${m.priceConfidence || '-'}`);
        }
      }
      if (anyPriced) pricedQuotes += 1;
      if (zeroHere > 0) {
        quotesWithZero += 1;
        if (isSent) sentWithZero += 1;
      }
    }
  }

  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
  console.log(`quotes with materials            : ${quotes}`);
  console.log(`quotes containing a $0 row       : ${quotesWithZero}  (${pct(quotesWithZero, quotes)})`);
  console.log(`material rows                    : ${rows}`);
  console.log(`rows at $0 with a positive qty   : ${zeroRows}  (${pct(zeroRows, rows)})`);
  console.log(`SENT quotes                      : ${sentQuotes}`);
  console.log(`SENT quotes containing a $0 row  : ${sentWithZero}  (${pct(sentWithZero, sentQuotes)})  <- reached a customer`);
  console.log(`\nquotes where at least one row got a price : ${pricedQuotes}`);
  console.log(`  $0 rows inside those quotes            : ${inPartlyPricedQuote}  <- pricing RAN and failed on these`);
  console.log(`  $0 rows carrying a pricingSource stamp : ${attemptedZero}`);
  console.log(`\nstages seen: ${JSON.stringify(stageCounts)}`);
  // Dump the distinct row names so the fallback table's coverage of them can
  // be measured directly, rather than guessed at.
  const fs = require('fs');
  fs.writeFileSync(process.env.ZERO_NAMES_OUT || '/tmp/zero-row-names.json', JSON.stringify([...namesOut], null, 2));
  console.log(`\ndistinct $0 row names written: ${namesOut.size}`);
  console.log('\nexamples (from quotes where pricing did run):');
  for (const e of examples) console.log('  -', e);
}
main().catch((e) => { console.error(e); process.exit(1); });
