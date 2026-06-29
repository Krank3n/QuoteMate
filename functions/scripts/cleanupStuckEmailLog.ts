/**
 * One-off cleanup for the `quoteFollowUp` runaway loop.
 *
 *   cd functions && npx ts-node scripts/cleanupStuckEmailLog.ts [--apply] [--stale-hours=6]
 *
 * Needs Application Default Credentials (gcloud auth application-default login).
 *
 * Background
 * ----------
 * The pre-fix `quoteFollowUp` scheduler sent to EVERY user every 30 min and
 * only set `quoteFollowUpSentAt` when Brevo accepted the send. For unsendable
 * accounts (Apple private relay, example.com test users) the send never
 * resolved, the flag never got set, and the email re-sent on every tick —
 * flooding `emailLog` with orphaned `pending` rows.
 *
 * This script does two things (DRY-RUN by default — pass --apply to write):
 *
 *   1. emailLog hygiene — for every `status == 'pending'` row:
 *        • if the recipient is structurally unsendable -> mark `blocked`
 *          (with blockedReason), because it can never deliver.
 *        • else if it's been stuck `pending` longer than --stale-hours
 *          (default 6h) -> mark `send_failed` (reason: stuck-pending), since a
 *          genuine send flips to sent/send_failed within seconds.
 *
 *   2. Loop backfill — for every user whose Auth email is unsendable and who
 *      received a stuck quote-follow-up, set
 *      `users/{uid}/settings/emailState.quoteFollowUpSentAt` so the OLD code
 *      stops re-sending during the deploy window (the new code already skips
 *      them, but this closes the gap before/while the fix rolls out).
 *
 * Safe to re-run. Idempotent.
 */

import * as admin from 'firebase-admin';
import { classifyUnsendable } from '../src/email';

const APPLY = process.argv.includes('--apply');
const staleArg = process.argv.find((a) => a.startsWith('--stale-hours='));
const STALE_HOURS = staleArg ? Math.max(0, parseFloat(staleArg.split('=')[1])) : 6;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  const now = Date.now();

  console.log(`\n=== Stuck emailLog cleanup ===`);
  console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'} | stale threshold: ${STALE_HOURS}h\n`);

  // ---------------------------------------------------------------------------
  // Pass 1: scan every pending emailLog row.
  // ---------------------------------------------------------------------------
  const pendingSnap = await db.collection('emailLog').where('status', '==', 'pending').get();
  console.log(`Found ${pendingSnap.size} pending emailLog rows.\n`);

  type Action = { ref: FirebaseFirestore.DocumentReference; update: Record<string, any>; kind: string };
  const actions: Action[] = [];
  const reasonCounts = new Map<string, number>();
  // userIds whose stuck quote-follow-up went to an unsendable account.
  const followUpUserIds = new Set<string>();

  for (const doc of pendingSnap.docs) {
    const d = doc.data() as any;
    const to: string = d.to || '';
    const tags: string[] = Array.isArray(d.tags) ? d.tags : [];
    const isFollowUp = tags.includes('quote-follow-up');
    const unsendable = classifyUnsendable(to);

    if (unsendable) {
      actions.push({
        ref: doc.ref,
        kind: `blocked (${unsendable})`,
        update: {
          status: 'blocked',
          blockedReason: unsendable,
          blockedAt: admin.firestore.FieldValue.serverTimestamp(),
          cleanupNote: 'stuck-pending unsendable recipient (cleanupStuckEmailLog)',
        },
      });
      reasonCounts.set(`blocked:${unsendable}`, (reasonCounts.get(`blocked:${unsendable}`) || 0) + 1);
      if (isFollowUp && d.userId) followUpUserIds.add(d.userId);
      continue;
    }

    const ageMs = now - tsToMs(d.queuedAt);
    if (ageMs >= STALE_MS) {
      actions.push({
        ref: doc.ref,
        kind: 'send_failed (stuck-pending)',
        update: {
          status: 'send_failed',
          sendError: 'stuck-pending',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          cleanupNote: `pending > ${STALE_HOURS}h, never resolved (cleanupStuckEmailLog)`,
        },
      });
      reasonCounts.set('send_failed:stuck-pending', (reasonCounts.get('send_failed:stuck-pending') || 0) + 1);
    }
    // else: genuinely-recent pending row — leave it alone, it may still resolve.
  }

  console.log(`emailLog rows to update: ${actions.length}`);
  for (const [reason, n] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(40)} ${n}`);
  }
  console.log();

  // ---------------------------------------------------------------------------
  // Pass 2: backfill quoteFollowUpSentAt for unsendable follow-up recipients.
  // ---------------------------------------------------------------------------
  console.log(`Users to backfill quoteFollowUpSentAt: ${followUpUserIds.size}`);
  const userActions: Action[] = [];
  for (const uid of followUpUserIds) {
    userActions.push({
      ref: db.doc(`users/${uid}/settings/emailState`),
      kind: 'emailState backfill',
      update: {
        quoteFollowUpSentAt: admin.firestore.FieldValue.serverTimestamp(),
        quoteFollowUpSkippedReason: 'unsendable (cleanupStuckEmailLog backfill)',
      },
    });
  }
  console.log();

  if (!APPLY) {
    console.log('DRY-RUN complete. Re-run with --apply to commit the changes above.');
    return;
  }

  // ---------------------------------------------------------------------------
  // Commit — batched writes (Firestore cap: 500 ops/batch).
  // emailState backfill uses { merge: true } so we never clobber other fields.
  // ---------------------------------------------------------------------------
  const all = [...actions, ...userActions];
  let written = 0;
  for (let i = 0; i < all.length; i += 450) {
    const slice = all.slice(i, i + 450);
    const batch = db.batch();
    for (const a of slice) {
      batch.set(a.ref, a.update, { merge: true });
    }
    await batch.commit();
    written += slice.length;
    console.log(`  committed ${written}/${all.length}…`);
  }

  console.log(`\nDone. Updated ${actions.length} emailLog rows and ${userActions.length} users.`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
