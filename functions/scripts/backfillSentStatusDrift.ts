/**
 * backfillSentStatusDrift.ts — put `status: 'sent'` back on legacy quote rows
 * that the app rewound to 'draft' after a real send.
 *
 * After an email send the server stamps status 'sent' on users/{uid}/quotes/{id}
 * and stage quote_sent on users/{uid}/documents/{id}. The app can then re-save
 * the legacy quote from a stale in-memory copy still marked 'draft'; the mirror
 * refuses to downgrade the unified row, so documents/ says sent while quotes/
 * says draft. On 16 Sep 2026 that was 60 of 208 sent quotes across 18 accounts.
 * The follow-up schedulers now select off documents/ and no longer need this,
 * but the legacy row is still what the acceptance page and older clients read.
 *
 * Only a quote at stage quote_sent whose legacy row exists, is not 'sent', and
 * carries a real send stamp (sentAt on either row) is touched, and only its
 * `status` field is written. Nothing is minted; nothing else is changed.
 * Invoice drift (invoice_sent / partially_paid vs invoices/ status) is
 * REPORTED, not fixed — the legacy invoice status also encodes payment state,
 * which this script does not adjudicate.
 *
 * Dry-run by default; prints ids and counts only (no customer details).
 *
 *   cd functions && npx ts-node scripts/backfillSentStatusDrift.ts [--uid <uid>] [--apply]
 *
 * Needs Application Default Credentials.
 */

import * as admin from 'firebase-admin';
import { legacyIdForDocument } from '../src/customerFollowUp';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const INVOICE_STATUS_FOR_STAGE: Record<string, string> = {
  invoice_sent: 'sent',
  partially_paid: 'partial',
};

async function main() {
  const onlyUid = argValue('--uid');
  const apply = process.argv.includes('--apply');

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  const users = onlyUid
    ? [await db.collection('users').doc(onlyUid).get()]
    : (await db.collection('users').get()).docs;

  let sentQuotes = 0;
  let quotesFixed = 0;
  let quotesSkippedNoLegacy = 0;
  let quotesSkippedNoSendStamp = 0;
  let invoiceDrift = 0;
  const touchedAccounts = new Set<string>();

  for (const u of users) {
    if (!u.exists) continue;
    const uid = u.id;

    const quoteDocs = await u.ref.collection('documents').where('stage', '==', 'quote_sent').get();
    for (const d of quoteDocs.docs) {
      const x = d.data();
      if (x.type && x.type !== 'quote') continue;
      sentQuotes++;
      const legacyRef = u.ref.collection('quotes').doc(legacyIdForDocument(d.id, x, 'quote'));
      const legacySnap = await legacyRef.get();
      const legacy = legacySnap.data();
      if (!legacy) { quotesSkippedNoLegacy++; continue; }
      if (legacy.status === 'sent') continue;
      if (!legacy.sentAt && !x.sentAt) { quotesSkippedNoSendStamp++; continue; }

      quotesFixed++;
      touchedAccounts.add(uid);
      console.log(`${apply ? 'FIX ' : 'would fix'} ${uid}/quotes/${legacyRef.id} status ${String(legacy.status)} -> sent`);
      if (apply) await legacyRef.set({ status: 'sent' }, { merge: true });
    }

    const owingDocs = await u.ref
      .collection('documents')
      .where('stage', 'in', Object.keys(INVOICE_STATUS_FOR_STAGE))
      .get();
    for (const d of owingDocs.docs) {
      const x = d.data();
      if (x.type !== 'invoice') continue;
      const legacyRef = u.ref.collection('invoices').doc(legacyIdForDocument(d.id, x, 'invoice'));
      const legacy = (await legacyRef.get()).data();
      const expected = INVOICE_STATUS_FOR_STAGE[String(x.stage)];
      if (legacy && legacy.status !== expected && legacy.status !== 'overdue') {
        invoiceDrift++;
        console.log(`invoice drift (not fixed) ${uid}/invoices/${legacyRef.id} stage ${String(x.stage)} vs status ${String(legacy.status)}`);
      }
    }
  }

  console.log({
    documentsAtQuoteSent: sentQuotes,
    legacyQuoteRows: apply ? 'fixed' : 'wouldFix',
    count: quotesFixed,
    accounts: touchedAccounts.size,
    skippedNoLegacyRow: quotesSkippedNoLegacy,
    skippedNoSendStamp: quotesSkippedNoSendStamp,
    invoiceDriftReported: invoiceDrift,
  });
  if (!apply) console.log('\nDry run — re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
