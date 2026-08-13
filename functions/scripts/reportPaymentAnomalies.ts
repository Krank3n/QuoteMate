/**
 * Report documents whose payment ledger doesn't add up.
 *
 *   cd functions
 *   npx ts-node scripts/reportPaymentAnomalies.ts                 # every user
 *   npx ts-node scripts/reportPaymentAnomalies.ts --uid=<uid>     # one user
 *   npx ts-node scripts/reportPaymentAnomalies.ts --json          # machine-readable
 *
 * READ ONLY. There is deliberately no --commit.
 *
 * The bug this exists for: recordDocumentPayment used to write a payment down
 * two paths — saveDocument's absolute mirror onto invoices/{id}, and the
 * ADDITIVE legacy recordPayment on top of it. onInvoiceWritten then projected
 * the doubled legacy paidAmount back over the unified ledger as a single
 * inflated entry. A $960 payment on a $960 invoice became $1,920.
 *
 * That inflated number is now the stored record: summing payments[] reproduces
 * it, so the true amount is NOT recoverable from the document. Halving it, or
 * capping at total, would be a guess written over a tradie's payment history —
 * and a wrong guess is worse than a flagged one. So this only reports; the fix
 * is the tradie correcting the entry in the app (PaymentSheet → tap a payment).
 *
 * Two shapes are flagged:
 *   OVERPAID   paidTotal exceeds total — what a tradie actually sees.
 *   LEDGER_SUM stored paidTotal disagrees with the sum of payments[], which
 *              means something wrote the total without the ledger agreeing.
 */

import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Amounts within half a cent are equal — matches derivePaymentState. */
const EPSILON = 0.005;

interface Anomaly {
  uid: string;
  docId: string;
  number?: string;
  customerName?: string;
  type?: string;
  stage?: string;
  total: number;
  paidTotal: number;
  ledgerSum: number;
  reasons: string[];
  payments: Array<{ id: string; amount: number; kind?: string; method?: string; squarePaymentId?: string }>;
}

function inspect(uid: string, docId: string, data: Record<string, any>): Anomaly | null {
  if (data.type !== 'invoice') return null;
  const total = Number(data.total) || 0;
  const paidTotal = Number(data.paidTotal) || 0;
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const ledgerSum = payments.reduce((acc: number, p: any) => acc + (Number(p?.amount) || 0), 0);

  const reasons: string[] = [];
  if (total > 0 && paidTotal > total + EPSILON) reasons.push('OVERPAID');
  if (Math.abs(ledgerSum - paidTotal) > EPSILON) reasons.push('LEDGER_SUM');
  if (reasons.length === 0) return null;

  return {
    uid,
    docId,
    number: data.number,
    customerName: data.customerName,
    type: data.type,
    stage: data.stage,
    total,
    paidTotal,
    ledgerSum,
    reasons,
    payments: payments.map((p: any) => ({
      id: String(p?.id ?? ''),
      amount: Number(p?.amount) || 0,
      kind: p?.kind,
      method: p?.method,
      squarePaymentId: p?.squarePaymentId,
    })),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const uidArg = args.find((a) => a.startsWith('--uid='))?.split('=')[1];
  const asJson = args.includes('--json');

  const uids: string[] = uidArg
    ? [uidArg]
    : (await db.collection('users').select().get()).docs.map((d) => d.id);

  const found: Anomaly[] = [];
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).collection('documents').get();
    for (const doc of snap.docs) {
      const anomaly = inspect(uid, doc.id, doc.data() || {});
      if (anomaly) found.push(anomaly);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  console.log(`Scanned ${uids.length} user(s).`);
  if (found.length === 0) {
    console.log('No payment anomalies found.');
    return;
  }
  console.log(`\n${found.length} document(s) need a look:\n`);
  for (const a of found) {
    console.log(`  ${a.reasons.join(' + ')}  ${a.number ?? a.docId}  (${a.customerName ?? 'no customer'})`);
    console.log(`    user ${a.uid}  doc ${a.docId}  stage ${a.stage}`);
    console.log(`    total ${a.total.toFixed(2)}  paidTotal ${a.paidTotal.toFixed(2)}  ledgerSum ${a.ledgerSum.toFixed(2)}`);
    for (const p of a.payments) {
      const src = p.squarePaymentId ? ` square:${p.squarePaymentId}` : '';
      console.log(`      - ${p.amount.toFixed(2)}  ${p.kind ?? '?'}/${p.method ?? '?'}${src}`);
    }
    console.log('');
  }
  console.log('Correct these in the app: open the invoice → payment chip → tap the payment.');
  console.log('Square-sourced payments are read-only; those belong in Square.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
