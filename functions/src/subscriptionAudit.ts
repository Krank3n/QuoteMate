/**
 * Nightly subscription reconciler.
 *
 * Scans every subscription doc and flags Pro access that isn't backed by a
 * billing record, so miscounts surface in the admin dashboard instead of
 * silently skewing the funnel:
 *   - restored_awaiting_receipt: incident-2026-07 restore on a store platform,
 *     still waiting for the user's device to re-sync billing identifiers.
 *     Counted as paying in the funnel; should self-heal on next app open.
 *   - restored_unknown_platform: incident restore whose original platform was
 *     unknown — may or may not be a real payer; needs a human look.
 *   - restored_expired: incident grant has lapsed but isPro is still true and
 *     no billing record ever arrived — access should probably be revoked.
 *   - bare_ispro: isPro with no platform, no billing ids, and no incident
 *     marker — a potential free-Pro leak.
 * Admin comps (platform 'admin_grant') are counted but not listed as issues.
 *
 * Results land in adminStats/subscriptionAudit; adminSubscriptionAudit serves
 * them to the dashboard (computing live when the doc is missing/stale).
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { isBilledSub, isRestoredStorePro } from './subscription.helpers';

const AUDIT_DOC = () => admin.firestore().collection('adminStats').doc('subscriptionAudit');
const STALE_MS = 26 * 60 * 60 * 1000; // recompute in the callable if older than ~a day

export interface AuditIssue {
  uid: string;
  email: string | null;
  reason: 'restored_awaiting_receipt' | 'restored_unknown_platform' | 'restored_expired' | 'bare_ispro';
  platform: string | null;
  incidentProUntil: string | null;
}

interface AuditPayload {
  issues: AuditIssue[];
  counts: Record<string, number>;
  adminGrants: number;
  billed: number;
  scanned: number;
  generatedAt: number;
}

function classify(sub: any, nowMs: number): AuditIssue['reason'] | null {
  if (!sub?.isPro) return null;
  if (isBilledSub(sub)) return null;
  if (sub.platform === 'admin_grant') return null;

  if (sub.restoredFromIncident) {
    if (isRestoredStorePro(sub, nowMs)) return 'restored_awaiting_receipt';
    const until = typeof sub.incidentProUntil === 'string' ? Date.parse(sub.incidentProUntil) : NaN;
    if (Number.isFinite(until) && until <= nowMs) return 'restored_expired';
    return 'restored_unknown_platform';
  }
  return 'bare_ispro';
}

async function runAudit(): Promise<AuditPayload> {
  const now = Date.now();
  const snap = await admin.firestore().collectionGroup('profile').get();

  const issues: AuditIssue[] = [];
  let adminGrants = 0;
  let billed = 0;
  let scanned = 0;

  for (const doc of snap.docs) {
    if (doc.id !== 'subscription') continue;
    const uid = doc.ref.parent.parent?.id;
    if (!uid) continue;
    scanned++;
    const sub = doc.data();
    if (isBilledSub(sub)) billed++;
    if (sub?.isPro && sub.platform === 'admin_grant') adminGrants++;

    const reason = classify(sub, now);
    if (!reason) continue;
    let email: string | null = null;
    try {
      email = (await admin.auth().getUser(uid)).email || null;
    } catch {
      /* deleted auth user — keep the uid row */
    }
    issues.push({
      uid,
      email,
      reason,
      platform: sub.platform || null,
      incidentProUntil: typeof sub.incidentProUntil === 'string' ? sub.incidentProUntil : null,
    });
  }

  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.reason] = (counts[i.reason] || 0) + 1;

  const payload: AuditPayload = { issues, counts, adminGrants, billed, scanned, generatedAt: now };
  try {
    await AUDIT_DOC().set(payload);
  } catch (err: any) {
    console.error('subscriptionAudit: cache write failed', err?.message);
  }
  return payload;
}

export const subscriptionAuditDaily = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub.schedule('every day 06:00')
  .timeZone('Australia/Brisbane')
  .onRun(async () => {
    const payload = await runAudit();
    console.info(
      `subscriptionAudit: scanned=${payload.scanned} billed=${payload.billed} issues=${payload.issues.length} ` +
        JSON.stringify(payload.counts)
    );
    return null;
  });

export const adminSubscriptionAudit = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .https.onCall(async (_data, context) => {
    const isAdmin = context.auth?.token?.admin === true;
    if (!context.auth?.uid || !isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }
    try {
      const doc = await AUDIT_DOC().get();
      if (doc.exists) {
        const d = doc.data() as AuditPayload;
        if (d?.generatedAt && Date.now() - d.generatedAt < STALE_MS) return { ...d, cached: true };
      }
    } catch (err: any) {
      console.error('adminSubscriptionAudit: cache read failed, computing live', err?.message);
    }
    return { ...(await runAudit()), cached: false };
  });
