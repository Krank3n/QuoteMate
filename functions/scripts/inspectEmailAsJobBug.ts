/**
 * Read-only: find documents whose job description looks like a follow-up EMAIL
 * BODY rather than a job description, and dump their structure so we can tell
 * which write path produced them.
 *
 *   cd functions && npx ts-node scripts/inspectEmailAsJobBug.ts
 *
 * PII-redacted output.
 */

import * as admin from 'firebase-admin';

const EMAIL_BODY_RE = /bumping this up|check-in on the quote|got buried|happy to answer any questions|reply to this email/i;

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}
const iso = (t: any) => (tsToMs(t) ? new Date(tsToMs(t)).toISOString() : '—');

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  const db = admin.firestore();

  const usersSnap = await db.collection('users').get();
  const hits: any[] = [];

  for (const u of usersSnap.docs) {
    const snap = await db.collection('users').doc(u.id).collection('documents').get();
    for (const d of snap.docs) {
      const data: any = d.data();
      const desc = String(data?.job?.description || '');
      const name = String(data?.job?.name || '');
      if (EMAIL_BODY_RE.test(desc) || EMAIL_BODY_RE.test(name)) {
        hits.push({ id: d.id, uid: u.id, ...data });
      }
    }
  }

  console.log(`\n=== ${hits.length} document(s) with email-body text in the job fields ===\n`);

  for (const h of hits) {
    const mats: any[] = Array.isArray(h.materials) ? h.materials : [];
    const secs: any[] = Array.isArray(h.sections) ? h.sections : [];
    console.log('─'.repeat(78));
    console.log(`docId        ${h.id}`);
    console.log(`uid          ${String(h.uid).slice(0, 8)}…`);
    console.log(`number       ${h.number || '—'}`);
    console.log(`type/stage   ${h.type || '—'} / ${h.stage || '—'}`);
    console.log(`created      ${iso(h.createdAt)}`);
    console.log(`updated      ${iso(h.updatedAt)}`);
    console.log(`total        $${Number(h.total || 0).toFixed(2)}   matsSubtotal $${Number(h.materialsSubtotal || 0).toFixed(2)}  labor $${Number(h.laborTotal || 0).toFixed(2)}`);
    console.log(`job.name     ${JSON.stringify(String(h?.job?.name || '').slice(0, 90))}`);
    console.log(`job.desc     ${JSON.stringify(String(h?.job?.description || '').slice(0, 200))}`);
    console.log(`job.template ${h?.job?.template || '—'}   estHours ${h?.job?.estimatedHours ?? '—'}`);
    console.log(`jobId        ${h.jobId || h?.job?.id || '—'}`);
    console.log(`materials    ${mats.length}   sections ${secs.length}`);
    for (const m of mats.slice(0, 6)) {
      console.log(`   • ${JSON.stringify(String(m.name || '').slice(0, 46))} ${m.quantity} ${m.unit} @ $${Number(m.price || 0).toFixed(2)} = $${Number(m.totalPrice || 0).toFixed(2)}`);
      console.log(`     origin=${m.origin || '—'} pricingSource=${m.pricingSource || '—'} conf=${m.priceConfidence || '—'} manualOverride=${!!m.manualPriceOverride}`);
    }
    // Every remaining top-level key, so we can spot the write path.
    const skip = new Set(['materials', 'sections', 'job', 'customerName', 'customerEmail', 'customerPhone', 'jobAddress', 'notes', 'clientNotes', 'uid']);
    const rest = Object.keys(h).filter((k) => !skip.has(k)).sort();
    console.log(`other keys   ${rest.join(', ')}`);
    for (const k of ['draftStep', 'origin', 'source', 'createdVia', 'acceptedAt', 'sentAt', 'emailSentAt', 'lastFollowUpAt', 'followUpCount', 'linkedDocumentId', 'parentDocumentId']) {
      if (h[k] !== undefined) console.log(`   ${k} = ${JSON.stringify(h[k])}`);
    }
  }

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
