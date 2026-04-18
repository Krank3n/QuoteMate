/**
 * Admin CRM backend — custom-claim-gated callables for the /admin panel on
 * quotemateapp.au. Every write is recorded in `adminAuditLog/` for traceability.
 *
 * Access model:
 *   - Bootstrap: `bootstrapAdminClaim` (onRequest) sets `admin: true` on a uid,
 *     protected by ADMIN_DASHBOARD_KEY.
 *   - All other endpoints are onCall and require `context.auth.token.admin === true`.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendEmail, getUserEmail } from './email';

const db = () => admin.firestore();

// ============================================================
// AUTH HELPERS
// ============================================================

function requireAdmin(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  const isAdmin = context.auth?.token?.admin === true;
  if (!uid || !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
  return uid;
}

// Subscription data lives at users/{uid}/profile/subscription — NOT at top-level
// subscriptions/{uid} (which is empty in this app). Field shape varies by source:
//   - Stripe webhook sets: isPro, platform:'web', cancelAtPeriodEnd, currentPeriod*, subscriptionId, customerId
//   - Apple/Google validate: isPro:true, platform:'ios'|'android', currentPeriodEnd (Date)
//   - Client trial code (firestoreService.ts): isPro:false, NO platform, currentPeriodEnd stored as ISO STRING,
//     plus trialStartedAt (ISO string). This accounts for 80 of the 82 docs.
// "Canceled Pro" ≠ "trial expired" ≠ "free quota" — distinguish for the admin CRM.
const TRIAL_DAYS = 7;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

interface SubFields {
  isPro: boolean;
  canceling: boolean;
  platform: string | null;
  tier: 'pro' | 'pro_canceling' | 'trialing' | 'trial_expired' | 'free';
  status: 'active' | 'canceling' | 'trialing' | 'trial_expired' | 'canceled' | 'free';
  productId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  validatedAt: number | null;
  cancelAt: number | null;
  trialStartedAt: number | null;
  trialDaysRemaining: number | null;
}

function ts(v: any): number | null {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  if (v._seconds) return v._seconds * 1000;
  if (v.toMillis) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

function deriveSubFields(sub: any | undefined | null): SubFields {
  const isPro = !!sub?.isPro;
  const canceling = isPro && !!sub?.cancelAtPeriodEnd;
  const platform = sub?.platform || null;
  const trialStartedAt = ts(sub?.trialStartedAt);
  const now = Date.now();
  const trialElapsed = trialStartedAt ? now - trialStartedAt : Infinity;
  const inTrial = trialStartedAt !== null && trialElapsed < TRIAL_MS;
  const trialDaysRemaining = inTrial ? Math.ceil((TRIAL_MS - trialElapsed) / (24 * 60 * 60 * 1000)) : null;

  let tier: SubFields['tier'];
  let status: SubFields['status'];
  if (isPro) {
    tier = canceling ? 'pro_canceling' : 'pro';
    status = canceling ? 'canceling' : 'active';
  } else if (inTrial) {
    tier = 'trialing';
    status = 'trialing';
  } else if (trialStartedAt !== null && !inTrial) {
    tier = 'trial_expired';
    status = 'trial_expired';
  } else if (platform === 'web' && sub?.subscriptionId) {
    // Had a Stripe subscription that's no longer active = genuinely canceled Pro
    tier = 'free';
    status = 'canceled';
  } else {
    tier = 'free';
    status = 'free';
  }

  return {
    isPro,
    canceling,
    platform,
    tier,
    status,
    productId: sub?.productId || null,
    currentPeriodStart: ts(sub?.currentPeriodStart),
    currentPeriodEnd: ts(sub?.currentPeriodEnd),
    validatedAt: ts(sub?.validatedAt),
    cancelAt: canceling ? ts(sub?.currentPeriodEnd) : null,
    trialStartedAt,
    trialDaysRemaining,
  };
}

// Returns a map of uid → raw sub data for every user with a subscription doc.
// Uses collectionGroup on 'profile' and filters in memory for doc.id === 'subscription'.
// emailState lives at users/{uid}/settings/emailState (a doc within `settings`),
// NOT at users/{uid}/emailState/{docId}. A `collectionGroup('emailState')` query
// returns ZERO matches, so we have to iterate or use collectionGroup('settings').
async function fetchAllEmailStates(): Promise<Map<string, any>> {
  const snap = await db().collectionGroup('settings').get();
  const map = new Map<string, any>();
  for (const d of snap.docs) {
    if (d.id !== 'emailState') continue;
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    map.set(uid, d.data());
  }
  return map;
}

async function fetchAllSubscriptions(): Promise<Map<string, any>> {
  const snap = await db().collectionGroup('profile').get();
  const map = new Map<string, any>();
  for (const d of snap.docs) {
    if (d.id !== 'subscription') continue;
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    map.set(uid, d.data());
  }
  return map;
}

async function listAllAuthUsers(): Promise<admin.auth.UserRecord[]> {
  const all: admin.auth.UserRecord[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, nextPageToken);
    all.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return all;
}

async function logAdminAction(params: {
  adminUid: string;
  action: string;
  targetType: 'user' | 'supplier' | 'feedback' | 'broadcast' | 'system';
  targetId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().collection('adminAuditLog').add({
      ...params,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('adminAuditLog write failed', err);
  }
}

// ============================================================
// BOOTSTRAP — set the admin custom claim on a uid
// ============================================================

export const bootstrapAdminClaim = functions.https.onRequest(async (req, res) => {
  try {
    const key = req.get('x-admin-key') || (req.query.key as string | undefined);
    const expected = process.env.ADMIN_DASHBOARD_KEY;
    if (!expected || !key || key !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const uid = (req.query.uid as string | undefined) || (req.body?.uid as string | undefined);
    const grant = (req.query.grant as string | undefined) !== 'false';
    if (!uid) {
      res.status(400).json({ error: 'uid required' });
      return;
    }
    const user = await admin.auth().getUser(uid);
    const claims = { ...(user.customClaims || {}), admin: grant };
    if (!grant) delete (claims as any).admin;
    await admin.auth().setCustomUserClaims(uid, claims);
    await logAdminAction({
      adminUid: 'bootstrap',
      action: grant ? 'grant_admin' : 'revoke_admin',
      targetType: 'user',
      targetId: uid,
    });
    res.json({ ok: true, uid, admin: grant });
  } catch (err: any) {
    console.error('bootstrapAdminClaim failed', err);
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// ============================================================
// SESSION CHECK — used by the web client to confirm admin status
// ============================================================

export const adminWhoami = functions.https.onCall(async (_data, context) => {
  const uid = requireAdmin(context);
  const user = await admin.auth().getUser(uid);
  return {
    uid,
    email: user.email || null,
    displayName: user.displayName || null,
    admin: true,
  };
});

// ============================================================
// DASHBOARD STATS
// ============================================================

export const adminDashboardStats = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const firestore = db();

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(now - 7 * dayMs);
  const thirtyDaysAgo = admin.firestore.Timestamp.fromMillis(now - 30 * dayMs);
  const oneDayAgo = admin.firestore.Timestamp.fromMillis(now - dayMs);

  // Users live as Auth accounts; there may or may not be a root users/{uid} doc.
  // Firebase Auth listUsers is the source of truth for user count.
  const [
    allAuthUsers,
    suppliers,
    subscriptions,
    feedback,
    emailStates,
  ] = await Promise.all([
    listAllAuthUsers(),
    firestore.collection('suppliers').select('ownerUid', 'subscriberCount', 'name').get(),
    fetchAllSubscriptions(),
    firestore.collection('feedback').orderBy('createdAt', 'desc').limit(10).get(),
    fetchAllEmailStates(),
  ]);
  const allUsers = { size: allAuthUsers.length };

  // Active in last 7d — count emailState docs whose lastActivityAt is recent.
  let activeSevenDay = 0;
  for (const [, es] of emailStates) {
    const t = ts(es.lastActivityAt);
    if (t && t >= now - 7 * dayMs) activeSevenDay++;
  }

  let activeSubs = 0;
  let cancelingSubs = 0;
  let canceledSubs = 0;
  let trialingSubs = 0;
  let trialExpiredSubs = 0;
  for (const [, raw] of subscriptions) {
    const f = deriveSubFields(raw);
    if (f.status === 'active') activeSubs++;
    else if (f.status === 'canceling') cancelingSubs++;
    else if (f.status === 'canceled') canceledSubs++;
    else if (f.status === 'trialing') trialingSubs++;
    else if (f.status === 'trial_expired') trialExpiredSubs++;
  }

  // Signups this week — fall back to Auth user metadata since users doc may not carry createdAt.
  // Signups this week — combine emailState.signupAt (canonical when present)
  // with Auth creationTime (fallback so new users show up even before emailState exists).
  let signupsThisWeek = 0;
  let signupsToday = 0;
  for (const u of allAuthUsers) {
    const es = emailStates.get(u.uid) || {};
    const signupAt = ts(es.signupAt) || new Date(u.metadata.creationTime).getTime();
    if (signupAt >= now - 7 * dayMs) signupsThisWeek++;
    if (signupAt >= now - dayMs) signupsToday++;
  }

  const topSuppliers = suppliers.docs
    .map((d) => ({
      id: d.id,
      name: (d.data() as any).name || d.id,
      subscriberCount: (d.data() as any).subscriberCount || 0,
    }))
    .sort((a, b) => b.subscriberCount - a.subscriberCount)
    .slice(0, 5);

  const feedbackItems = feedback.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

  return {
    users: {
      total: allUsers.size,
      signupsToday,
      signupsThisWeek,
      activeSevenDay,
    },
    subscriptions: {
      active: activeSubs,
      canceling: cancelingSubs,
      canceled: canceledSubs,
      trialing: trialingSubs,
      trialExpired: trialExpiredSubs,
    },
    suppliers: {
      total: suppliers.size,
      top: topSuppliers,
    },
    feedback: feedbackItems,
    generatedAt: new Date().toISOString(),
    ranges: {
      sevenDaysAgo: sevenDaysAgo.toMillis(),
      thirtyDaysAgo: thirtyDaysAgo.toMillis(),
      oneDayAgo: oneDayAgo.toMillis(),
    },
  };
});

// ============================================================
// USERS — list, search, detail
// ============================================================

interface UserListRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  businessName: string | null;
  phone: string | null;
  lastActivityAt: number | null;
  signupAt: number | null;
  planTier: string;
  quoteCount: number;
  invoiceCount: number;
  supplierBookCount: number;
  tags: string[];
  marketingOptIn: boolean;
  healthScore: number;
}

export const adminListUsers = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const firestore = db();
    const search = (data?.search || '').toString().toLowerCase().trim();
    const limit = Math.min(Math.max(Number(data?.limit) || 100, 1), 500);

    // Enumerate users from Firebase Auth (source of truth) — a root users/{uid}
    // doc may or may not exist.
    const authUsers = await listAllAuthUsers();
    const authRecords = new Map<string, admin.auth.UserRecord>();
    for (const u of authUsers) authRecords.set(u.uid, u);

    // Fetch any existing user docs for stats.
    const userDocsSnap = await firestore.collection('users').get();
    const userDocMap = new Map<string, any>();
    for (const d of userDocsSnap.docs) userDocMap.set(d.id, d.data());

    // Prefetch subscriptions in one collection-group pass instead of N reads
    const subsMap = await fetchAllSubscriptions();

    const rows: UserListRow[] = await Promise.all(
      authUsers.map(async (auth) => {
        const uid = auth.uid;
        const userData = userDocMap.get(uid) || {};
        const [emailStateSnap, businessSnap, emailPrefsSnap] = await Promise.all([
          firestore.doc(`users/${uid}/settings/emailState`).get(),
          firestore.doc(`users/${uid}/settings/business`).get(),
          firestore.doc(`users/${uid}/settings/emailPreferences`).get(),
        ]);
        const emailState = emailStateSnap.data() || {};
        const business = businessSnap.data() || {};
        const subFields = deriveSubFields(subsMap.get(uid));
        const emailPrefs = emailPrefsSnap.data() || {};

        const planTier = subFields.tier;

        return {
          uid,
          email: auth?.email || business.email || null,
          displayName: auth?.displayName || business.businessName || null,
          businessName: business.businessName || null,
          phone: business.phone || auth?.phoneNumber || null,
          lastActivityAt: emailState.lastActivityAt?.toMillis?.() || null,
          signupAt:
            emailState.signupAt?.toMillis?.() ||
            (auth?.metadata?.creationTime ? new Date(auth.metadata.creationTime).getTime() : null),
          planTier,
          quoteCount: userData.quoteCount || 0,
          invoiceCount: userData.invoiceCount || 0,
          supplierBookCount: userData.supplierBookCount || 0,
          tags: userData.crmTags || [],
          marketingOptIn: emailPrefs.marketing !== false,
          healthScore: typeof userData.healthScore === 'number'
            ? userData.healthScore
            : computeHealthScore({
                lastActivityAt: emailState.lastActivityAt?.toMillis?.() || null,
                quoteCount: userData.quoteCount || 0,
                invoiceCount: userData.invoiceCount || 0,
                supplierBookCount: userData.supplierBookCount || 0,
                tier: subFields.tier,
              }),
        };
      })
    );

    const filtered = search
      ? rows.filter((r) => {
          const haystack = [r.email, r.displayName, r.businessName, r.phone, r.uid]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
      : rows;

    filtered.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));

    return { users: filtered.slice(0, limit), total: filtered.length };
  });

export const adminGetUser = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = (data?.uid || '').toString();
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  const firestore = db();
  const [
    userDoc,
    authRecord,
    businessSnap,
    emailStateSnap,
    emailPrefsSnap,
    regSnap,
    referralSnap,
    subSnap,
    quotesSnap,
    invoicesSnap,
    notesSnap,
    callsSnap,
    emailLogSnap,
    supplierBookSnap,
    feedbackSnap,
  ] = await Promise.all([
    firestore.doc(`users/${uid}`).get(),
    admin.auth().getUser(uid).catch(() => null),
    firestore.doc(`users/${uid}/settings/business`).get(),
    firestore.doc(`users/${uid}/settings/emailState`).get(),
    firestore.doc(`users/${uid}/settings/emailPreferences`).get(),
    firestore.doc(`users/${uid}/settings/registrationInfo`).get(),
    firestore.doc(`users/${uid}/profile/referral`).get(),
    firestore.doc(`users/${uid}/profile/subscription`).get(),
    firestore.collection(`users/${uid}/quotes`).orderBy('createdAt', 'desc').limit(25).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`users/${uid}/invoices`).orderBy('createdAt', 'desc').limit(25).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`users/${uid}/adminNotes`).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`users/${uid}/crmEvents`).orderBy('at', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection('emailLog').where('userId', '==', uid).orderBy('sentAt', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection('suppliers').get().catch(() => ({ docs: [] as any[] })),
    firestore.collection('feedback').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ docs: [] as any[] })),
  ]);

  // Supplier book: check each supplier for a subscribers/{uid} doc
  const supplierBook: Array<{ supplierId: string; name?: string; subscribedAt?: number | null }> = [];
  const supplierChecks = await Promise.all(
    (supplierBookSnap as any).docs.map((sd: any) =>
      firestore.doc(`suppliers/${sd.id}/subscribers/${uid}`).get().then((snap) => ({
        supplierId: sd.id,
        name: (sd.data() as any)?.name || sd.id,
        subscribedAt: snap.exists ? (snap.data() as any)?.subscribedAt?.toMillis?.() || null : null,
        exists: snap.exists,
      })).catch(() => null)
    )
  );
  for (const c of supplierChecks) {
    if (c && c.exists) supplierBook.push({ supplierId: c.supplierId, name: c.name, subscribedAt: c.subscribedAt });
  }

  const docToJson = (d: any) => ({ id: d.id, ...d.data() });
  const cleanTs = (obj: any): any => {
    if (!obj) return obj;
    if (obj._seconds !== undefined) return obj._seconds * 1000;
    if (obj.toMillis) return obj.toMillis();
    if (Array.isArray(obj)) return obj.map(cleanTs);
    if (typeof obj === 'object') {
      const out: any = {};
      for (const k of Object.keys(obj)) out[k] = cleanTs(obj[k]);
      return out;
    }
    return obj;
  };

  return cleanTs({
    uid,
    profile: {
      email: authRecord?.email || null,
      displayName: authRecord?.displayName || null,
      phoneNumber: authRecord?.phoneNumber || null,
      emailVerified: authRecord?.emailVerified || false,
      creationTime: authRecord?.metadata?.creationTime || null,
      lastSignInTime: authRecord?.metadata?.lastSignInTime || null,
      disabled: authRecord?.disabled || false,
    },
    userDoc: userDoc.exists ? userDoc.data() : {},
    business: businessSnap.data() || {},
    emailState: emailStateSnap.data() || {},
    emailPreferences: emailPrefsSnap.data() || {},
    registration: regSnap.data() || {},
    referral: referralSnap.data() || {},
    subscription: { ...(subSnap.data() || {}), ...deriveSubFields(subSnap.data()) },
    quotes: (quotesSnap as any).docs.map(docToJson),
    invoices: (invoicesSnap as any).docs.map(docToJson),
    notes: (notesSnap as any).docs.map(docToJson),
    calls: (callsSnap as any).docs.map(docToJson),
    emailLog: (emailLogSnap as any).docs.map(docToJson),
    feedback: (feedbackSnap as any).docs.map(docToJson),
    supplierBook,
  });
});

// ============================================================
// USERS — write actions
// ============================================================

export const adminAddUserNote = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const note = (data?.note || '').toString().trim();
  if (!uid || !note) throw new functions.https.HttpsError('invalid-argument', 'uid and note required');

  const ref = await db().collection(`users/${uid}/adminNotes`).add({
    note,
    authorUid: adminUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await logAdminAction({
    adminUid,
    action: 'add_note',
    targetType: 'user',
    targetId: uid,
    payload: { noteId: ref.id, preview: note.slice(0, 80) },
  });
  return { ok: true, id: ref.id };
});

export const adminLogCall = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const outcome = (data?.outcome || 'completed').toString();
  const notes = (data?.notes || '').toString();
  const durationSec = Number(data?.durationSec) || 0;
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  const ref = await db().collection(`users/${uid}/crmEvents`).add({
    type: 'call',
    outcome,
    notes,
    durationSec,
    authorUid: adminUid,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  await logAdminAction({
    adminUid,
    action: 'log_call',
    targetType: 'user',
    targetId: uid,
    payload: { eventId: ref.id, outcome },
  });
  return { ok: true, id: ref.id };
});

export const adminSetUserTags = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const tags = Array.isArray(data?.tags) ? data.tags.map((t: any) => String(t)) : null;
  if (!uid || !tags) throw new functions.https.HttpsError('invalid-argument', 'uid and tags required');

  await db().doc(`users/${uid}`).set({ crmTags: tags }, { merge: true });
  await logAdminAction({
    adminUid,
    action: 'set_tags',
    targetType: 'user',
    targetId: uid,
    payload: { tags },
  });
  return { ok: true };
});

export const adminSendUserEmail = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const subject = (data?.subject || '').toString().trim();
  const body = (data?.body || '').toString();
  const bypassPrefs = data?.bypassPrefs === true;
  if (!uid || !subject || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'uid, subject, body required');
  }
  const to = await getUserEmail(uid);
  if (!to) throw new functions.https.HttpsError('not-found', 'No email address on file for this user');

  const category = bypassPrefs ? 'transactional' : 'marketing';
  const emailLogId = await createAdminEmailLog({
    userId: uid,
    to,
    subject,
    category,
    tags: ['admin_manual'],
    source: 'admin_manual',
  });
  const htmlContent = adminEmailTemplate({ subject, bodyHtml: body, emailLogId });
  const sent = await sendEmail({
    to,
    subject,
    htmlContent,
    category,
    userId: uid,
    tags: ['admin_manual'],
  });

  await logAdminAction({
    adminUid,
    action: 'send_email',
    targetType: 'user',
    targetId: uid,
    payload: { subject, to, sent, emailLogId },
  });
  return { ok: sent, emailLogId };
});

function pixelUrl(emailLogId: string): string {
  // Project-agnostic resolution from function region/project — matches the rest of the codebase.
  return `https://us-central1-hansendev.cloudfunctions.net/emailOpenPixel?id=${encodeURIComponent(emailLogId)}`;
}

function adminEmailTemplate(params: { subject: string; bodyHtml: string; emailLogId?: string }) {
  const pixel = params.emailLogId
    ? `<img src="${pixelUrl(params.emailLogId)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`
    : '';
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="padding:32px 32px 16px;border-bottom:3px solid #f97316;">
    <div style="font-size:20px;font-weight:700;color:#0F172A;">QuoteMate</div>
  </div>
  <div style="padding:32px;color:#0F172A;font-size:15px;line-height:1.7;">
    ${params.bodyHtml}
  </div>
  <div style="padding:24px 32px;background:#0F172A;color:#94A3B8;font-size:13px;">
    Tom at QuoteMate · <a href="mailto:tom@hansendev.com.au" style="color:#fb923c;">tom@hansendev.com.au</a>
  </div>
  ${pixel}
</div></body></html>`;
}

// Create a pre-send emailLog doc so the outgoing HTML can embed the tracking
// pixel that points back to this exact doc.
async function createAdminEmailLog(params: {
  userId?: string;
  to: string;
  subject: string;
  category: string;
  tags?: string[];
  source: 'admin_manual' | 'admin_broadcast' | 'supplier' | 'feedback_reply';
}): Promise<string> {
  const ref = await db().collection('emailLog').add({
    userId: params.userId || null,
    to: params.to,
    subject: params.subject,
    category: params.category,
    tags: params.tags || [],
    source: params.source,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    openedAt: null,
    openCount: 0,
  });
  return ref.id;
}

// ============================================================
// SUPPLIERS — list and detail
// ============================================================

export const adminListSuppliers = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const firestore = db();
  const snap = await firestore.collection('suppliers').get();

  const suppliers = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data() as any;
      const [subscribersSnap, priceItemsSnap] = await Promise.all([
        firestore.collection(`suppliers/${d.id}/subscribers`).select().get().catch(() => ({ size: 0 })),
        firestore.collection(`suppliers/${d.id}/priceItems`).select().get().catch(() => ({ size: 0 })),
      ]);
      let ownerEmail: string | null = null;
      if (data.ownerUid) {
        try {
          const auth = await admin.auth().getUser(data.ownerUid);
          ownerEmail = auth.email || null;
        } catch {}
      }
      return {
        id: d.id,
        name: data.name || d.id,
        kind: data.kind || 'custom',
        ownerUid: data.ownerUid || null,
        ownerEmail,
        subscriberCount: (subscribersSnap as any).size || 0,
        priceItemCount: (priceItemsSnap as any).size || 0,
        lastPriceUpdate: data.lastPriceUpdate?.toMillis?.() || null,
        tags: data.crmTags || [],
      };
    })
  );

  suppliers.sort((a, b) => b.subscriberCount - a.subscriberCount);
  return { suppliers };
});

export const adminGetSupplier = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const id = (data?.id || '').toString();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');

  const firestore = db();
  const [supplierDoc, subsSnap, itemsSnap, notesSnap] = await Promise.all([
    firestore.doc(`suppliers/${id}`).get(),
    firestore.collection(`suppliers/${id}/subscribers`).get(),
    firestore.collection(`suppliers/${id}/priceItems`).orderBy('updatedAt', 'desc').limit(25).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`suppliers/${id}/adminNotes`).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
  ]);

  if (!supplierDoc.exists) throw new functions.https.HttpsError('not-found', 'supplier not found');
  const supplier = supplierDoc.data() as any;

  let ownerEmail: string | null = null;
  let ownerDisplayName: string | null = null;
  if (supplier.ownerUid) {
    try {
      const auth = await admin.auth().getUser(supplier.ownerUid);
      ownerEmail = auth.email || null;
      ownerDisplayName = auth.displayName || null;
    } catch {}
  }

  // Resolve subscriber names
  const subscribers = await Promise.all(
    (subsSnap as any).docs.map(async (sd: any) => {
      const tradieUid = sd.id;
      const [businessSnap, authRec] = await Promise.all([
        firestore.doc(`users/${tradieUid}/settings/business`).get(),
        admin.auth().getUser(tradieUid).catch(() => null),
      ]);
      const business = businessSnap.data() || {};
      return {
        uid: tradieUid,
        businessName: business.businessName || null,
        email: authRec?.email || null,
        subscribedAt: sd.data()?.subscribedAt?.toMillis?.() || null,
      };
    })
  );

  const docToJson = (d: any) => ({ id: d.id, ...d.data() });

  return {
    id,
    supplier: {
      ...supplier,
      lastPriceUpdate: supplier.lastPriceUpdate?.toMillis?.() || null,
    },
    owner: {
      uid: supplier.ownerUid || null,
      email: ownerEmail,
      displayName: ownerDisplayName,
    },
    subscribers,
    priceItems: (itemsSnap as any).docs.map(docToJson),
    notes: (notesSnap as any).docs.map(docToJson),
  };
});

export const adminAddSupplierNote = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  const note = (data?.note || '').toString().trim();
  if (!id || !note) throw new functions.https.HttpsError('invalid-argument', 'id and note required');

  const ref = await db().collection(`suppliers/${id}/adminNotes`).add({
    note,
    authorUid: adminUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await logAdminAction({
    adminUid,
    action: 'add_note',
    targetType: 'supplier',
    targetId: id,
    payload: { noteId: ref.id },
  });
  return { ok: true, id: ref.id };
});

export const adminSetSupplierTags = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  const tags = Array.isArray(data?.tags) ? data.tags.map((t: any) => String(t)) : null;
  if (!id || !tags) throw new functions.https.HttpsError('invalid-argument', 'id and tags required');

  await db().doc(`suppliers/${id}`).set({ crmTags: tags }, { merge: true });
  await logAdminAction({
    adminUid,
    action: 'set_tags',
    targetType: 'supplier',
    targetId: id,
    payload: { tags },
  });
  return { ok: true };
});

export const adminSendSupplierEmail = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  const subject = (data?.subject || '').toString().trim();
  const body = (data?.body || '').toString();
  if (!id || !subject || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'id, subject, body required');
  }
  const supplierDoc = await db().doc(`suppliers/${id}`).get();
  if (!supplierDoc.exists) throw new functions.https.HttpsError('not-found', 'supplier not found');
  const ownerUid = (supplierDoc.data() as any).ownerUid;
  if (!ownerUid) throw new functions.https.HttpsError('failed-precondition', 'supplier has no owner');
  const to = await getUserEmail(ownerUid);
  if (!to) throw new functions.https.HttpsError('not-found', 'No email on file for supplier owner');

  const emailLogId = await createAdminEmailLog({
    userId: ownerUid,
    to,
    subject,
    category: 'transactional',
    tags: ['admin_manual', 'supplier'],
    source: 'supplier',
  });
  const htmlContent = adminEmailTemplate({ subject, bodyHtml: body, emailLogId });
  const sent = await sendEmail({
    to,
    subject,
    htmlContent,
    category: 'transactional',
    userId: ownerUid,
    tags: ['admin_manual', 'supplier'],
  });
  await logAdminAction({
    adminUid,
    action: 'send_email',
    targetType: 'supplier',
    targetId: id,
    payload: { to, subject, sent, ownerUid, emailLogId },
  });
  return { ok: sent, emailLogId };
});

// ============================================================
// BROADCAST — send to a segment
// ============================================================

type Segment =
  | 'all'
  | 'pro'
  | 'free'
  | 'inactive_7d'
  | 'inactive_30d'
  | 'signed_up_this_week'
  | 'supplier_subscribers';

async function resolveSegment(
  segment: Segment,
  params: Record<string, unknown>
): Promise<string[]> {
  const firestore = db();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (segment === 'all') {
    const authUsers = await listAllAuthUsers();
    return authUsers.map((u) => u.uid);
  }
  if (segment === 'pro') {
    const subs = await fetchAllSubscriptions();
    const out: string[] = [];
    for (const [uid, raw] of subs) if (deriveSubFields(raw).isPro) out.push(uid);
    return out;
  }
  if (segment === 'free') {
    const [authUsers, subs] = await Promise.all([listAllAuthUsers(), fetchAllSubscriptions()]);
    const paid = new Set<string>();
    for (const [uid, raw] of subs) if (deriveSubFields(raw).isPro) paid.add(uid);
    return authUsers.map((u) => u.uid).filter((u) => !paid.has(u));
  }
  if (segment === 'inactive_7d' || segment === 'inactive_30d') {
    const days = segment === 'inactive_7d' ? 7 : 30;
    const [authUsers, emailStates] = await Promise.all([listAllAuthUsers(), fetchAllEmailStates()]);
    const threshold = now - days * dayMs;
    return authUsers
      .map((u) => u.uid)
      .filter((uid) => {
        const es = emailStates.get(uid);
        const lastAt = ts(es?.lastActivityAt);
        return !lastAt || lastAt <= threshold;
      });
  }
  if (segment === 'signed_up_this_week') {
    const [authUsers, emailStates] = await Promise.all([listAllAuthUsers(), fetchAllEmailStates()]);
    const threshold = now - 7 * dayMs;
    return authUsers
      .map((u) => u.uid)
      .filter((uid) => {
        const signupAt = ts(emailStates.get(uid)?.signupAt) || new Date(
          authUsers.find((a) => a.uid === uid)!.metadata.creationTime
        ).getTime();
        return signupAt >= threshold;
      });
  }
  if (segment === 'supplier_subscribers') {
    const supplierId = String(params.supplierId || '');
    if (!supplierId) return [];
    const snap = await firestore.collection(`suppliers/${supplierId}/subscribers`).get();
    return snap.docs.map((d) => d.id);
  }
  return [];
}

export const adminBroadcast = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const segment = (data?.segment || 'all') as Segment;
    const segmentParams = (data?.segmentParams || {}) as Record<string, unknown>;
    const subject = (data?.subject || '').toString().trim();
    const body = (data?.body || '').toString();
    const dryRun = data?.dryRun === true;
    if (!subject || !body) throw new functions.https.HttpsError('invalid-argument', 'subject and body required');

    const uids = await resolveSegment(segment, segmentParams);
    if (dryRun) {
      await logAdminAction({
        adminUid,
        action: 'broadcast_dryrun',
        targetType: 'broadcast',
        payload: { segment, segmentParams, count: uids.length, subject },
      });
      return { dryRun: true, count: uids.length };
    }

    let sent = 0;
    let failed = 0;
    for (const uid of uids) {
      const to = await getUserEmail(uid);
      if (!to) {
        failed++;
        continue;
      }
      const emailLogId = await createAdminEmailLog({
        userId: uid,
        to,
        subject,
        category: 'marketing',
        tags: ['admin_broadcast', segment],
        source: 'admin_broadcast',
      });
      const html = adminEmailTemplate({ subject, bodyHtml: body, emailLogId });
      const ok = await sendEmail({
        to,
        subject,
        htmlContent: html,
        category: 'marketing',
        userId: uid,
        tags: ['admin_broadcast', segment],
      });
      ok ? sent++ : failed++;
    }
    await logAdminAction({
      adminUid,
      action: 'broadcast_send',
      targetType: 'broadcast',
      payload: { segment, segmentParams, count: uids.length, sent, failed, subject },
    });
    return { sent, failed, total: uids.length };
  });

// ============================================================
// FEEDBACK — reply
// ============================================================

export const adminReplyToFeedback = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const feedbackId = (data?.feedbackId || '').toString();
  const body = (data?.body || '').toString();
  const subject = (data?.subject || 'Re: your QuoteMate feedback').toString();
  if (!feedbackId || !body) throw new functions.https.HttpsError('invalid-argument', 'feedbackId and body required');

  const firestore = db();
  const fbDoc = await firestore.doc(`feedback/${feedbackId}`).get();
  if (!fbDoc.exists) throw new functions.https.HttpsError('not-found', 'feedback not found');
  const fb = fbDoc.data() as any;
  const uid = fb.userId;
  const to = uid ? await getUserEmail(uid) : fb.email;
  if (!to) throw new functions.https.HttpsError('failed-precondition', 'no email on record');

  const emailLogId = await createAdminEmailLog({
    userId: uid,
    to,
    subject,
    category: 'transactional',
    tags: ['feedback_reply'],
    source: 'feedback_reply',
  });
  const html = adminEmailTemplate({ subject, bodyHtml: body, emailLogId });
  const sent = await sendEmail({
    to,
    subject,
    htmlContent: html,
    category: 'transactional',
    userId: uid,
    tags: ['feedback_reply'],
  });

  await firestore.doc(`feedback/${feedbackId}`).set(
    {
      replied: true,
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      repliedBy: adminUid,
      replyBody: body,
    },
    { merge: true }
  );
  await logAdminAction({
    adminUid,
    action: 'reply_feedback',
    targetType: 'feedback',
    targetId: feedbackId,
    payload: { to, subject, sent },
  });
  return { ok: sent };
});

// ============================================================
// HEALTH SCORE — 0-100 engagement score per user
// ============================================================

/**
 * Health score components (all 0-1, weighted):
 *   - activity recency (30%): fresh activity in last 7d = 1.0, decaying to 0 at 60d+
 *   - quote volume (25%): 0 quotes = 0, 5+ = 1.0
 *   - supplier book (15%): 0 = 0, 3+ = 1.0
 *   - paid tier (20%): pro = 1.0, pro_canceling = 0.3, free = 0.3
 *   - invoice activity (10%): 0 = 0, 3+ = 1.0
 * Output: 0-100 integer
 */
interface HealthInputs {
  lastActivityAt: number | null;
  quoteCount: number;
  invoiceCount: number;
  supplierBookCount: number;
  tier: string;
}

function computeHealthScore(x: HealthInputs): number {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const daysSinceActivity = x.lastActivityAt ? (now - x.lastActivityAt) / day : 999;
  const recencyScore = daysSinceActivity <= 7 ? 1 : daysSinceActivity >= 60 ? 0 : 1 - (daysSinceActivity - 7) / 53;
  const quoteScore = Math.min(1, (x.quoteCount || 0) / 5);
  const supplierScore = Math.min(1, (x.supplierBookCount || 0) / 3);
  const tierScore = x.tier === 'pro' ? 1 : x.tier === 'pro_canceling' ? 0.3 : 0.3;
  const invoiceScore = Math.min(1, (x.invoiceCount || 0) / 3);
  const raw = recencyScore * 0.3 + quoteScore * 0.25 + supplierScore * 0.15 + tierScore * 0.2 + invoiceScore * 0.1;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

/**
 * Auto-apply the "pipeline:at-risk" tag when score drops below 30. Never
 * overwrites a manually-assigned pipeline stage (only toggles at-risk based
 * on score). Used by both listing and the stats backfill.
 */
function maybeAutoAtRisk(currentTags: string[], score: number): { tags: string[]; changed: boolean } {
  const hasManualPipeline = currentTags.some(
    (t) => t.startsWith('pipeline:') && t !== 'pipeline:at-risk' && t !== 'pipeline:auto-at-risk'
  );
  const isAutoAtRisk = currentTags.includes('pipeline:auto-at-risk');
  if (hasManualPipeline) return { tags: currentTags, changed: false };
  if (score < 30 && !isAutoAtRisk) {
    return {
      tags: [...currentTags.filter((t) => !t.startsWith('pipeline:')), 'pipeline:auto-at-risk'],
      changed: true,
    };
  }
  if (score >= 30 && isAutoAtRisk) {
    return { tags: currentTags.filter((t) => t !== 'pipeline:auto-at-risk'), changed: true };
  }
  return { tags: currentTags, changed: false };
}

// Scheduled daily refresh of health scores + auto at-risk flagging
export const recomputeAllHealthScores = functions.pubsub
  .schedule('0 2 * * *')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const firestore = db();
    const [authUsers, subsMap] = await Promise.all([listAllAuthUsers(), fetchAllSubscriptions()]);
    let updated = 0;
    for (const u of authUsers) {
      const uid = u.uid;
      const [userDocSnap, esSnap] = await Promise.all([
        firestore.doc(`users/${uid}`).get(),
        firestore.doc(`users/${uid}/settings/emailState`).get(),
      ]);
      const userData = (userDocSnap.data() || {}) as any;
      const emailState = (esSnap.data() || {}) as any;
      const subFields = deriveSubFields(subsMap.get(uid));
      const score = computeHealthScore({
        lastActivityAt: emailState.lastActivityAt?.toMillis?.() || null,
        quoteCount: userData.quoteCount || 0,
        invoiceCount: userData.invoiceCount || 0,
        supplierBookCount: userData.supplierBookCount || 0,
        tier: subFields.tier,
      });
      const currentTags: string[] = userData.crmTags || [];
      const { tags, changed } = maybeAutoAtRisk(currentTags, score);
      const update: any = { healthScore: score, healthScoreAt: admin.firestore.FieldValue.serverTimestamp() };
      if (changed) update.crmTags = tags;
      await firestore.doc(`users/${uid}`).set(update, { merge: true });
      updated++;
    }
    console.log(`recomputeAllHealthScores: updated ${updated} users`);
    return null;
  });

// Manual trigger for health score recompute — same body as the scheduled one.
export const recomputeAllHealthScoresNow = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    const key = req.get('x-admin-key') || (req.query.key as string | undefined);
    if (!key || key !== process.env.ADMIN_DASHBOARD_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const firestore = db();
    const [authUsers, subsMap] = await Promise.all([listAllAuthUsers(), fetchAllSubscriptions()]);
    let updated = 0;
    for (const u of authUsers) {
      const uid = u.uid;
      const [userDocSnap, esSnap] = await Promise.all([
        firestore.doc(`users/${uid}`).get(),
        firestore.doc(`users/${uid}/settings/emailState`).get(),
      ]);
      const userData = (userDocSnap.data() || {}) as any;
      const emailState = (esSnap.data() || {}) as any;
      const subFields = deriveSubFields(subsMap.get(uid));
      const score = computeHealthScore({
        lastActivityAt: emailState.lastActivityAt?.toMillis?.() || null,
        quoteCount: userData.quoteCount || 0,
        invoiceCount: userData.invoiceCount || 0,
        supplierBookCount: userData.supplierBookCount || 0,
        tier: subFields.tier,
      });
      const currentTags: string[] = userData.crmTags || [];
      const { tags, changed } = maybeAutoAtRisk(currentTags, score);
      const update: any = { healthScore: score, healthScoreAt: admin.firestore.FieldValue.serverTimestamp() };
      if (changed) update.crmTags = tags;
      await firestore.doc(`users/${uid}`).set(update, { merge: true });
      updated++;
    }
    res.json({ ok: true, updated });
  });

// ============================================================
// METRICS SNAPSHOTS — daily writes at 01:00 Australia/Sydney
// ============================================================

async function computeDailySnapshot(): Promise<Record<string, any>> {
  const firestore = db();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const [authUsers, subs, suppliersSnap] = await Promise.all([
    listAllAuthUsers(),
    fetchAllSubscriptions(),
    firestore.collection('suppliers').select('subscriberCount', 'priceItemCount').get(),
  ]);
  let active = 0;
  let canceling = 0;
  let canceled = 0;
  let trialingSubs = 0;
  let trialExpiredSubs = 0;
  for (const [, raw] of subs) {
    const f = deriveSubFields(raw);
    if (f.status === 'active') active++;
    else if (f.status === 'canceling') canceling++;
    else if (f.status === 'canceled') canceled++;
    else if (f.status === 'trialing') trialingSubs++;
    else if (f.status === 'trial_expired') trialExpiredSubs++;
  }
  // Signups in last 24h — use emailState.signupAt where present, fall back to Auth creationTime
  let signupsToday = 0;
  for (const u of authUsers) {
    const created = new Date(u.metadata.creationTime).getTime();
    if (created >= now - day) signupsToday++;
  }
  // Active 7d — iterate fetched emailState docs (collection-group on 'settings').
  const emailStates = await fetchAllEmailStates();
  let active7d = 0;
  for (const [, es] of emailStates) {
    const t = ts(es.lastActivityAt);
    if (t && t >= now - 7 * day) active7d++;
  }

  // Supplier totals
  let supplierSubscriberSum = 0;
  let supplierItemSum = 0;
  for (const d of suppliersSnap.docs) {
    const data = d.data() as any;
    supplierSubscriberSum += data.subscriberCount || 0;
    supplierItemSum += data.priceItemCount || 0;
  }

  return {
    usersTotal: authUsers.length,
    signupsToday,
    active7d,
    subscriptionsActive: active,
    subscriptionsCanceling: canceling,
    subscriptionsCanceled: canceled,
    subscriptionsTrialing: trialingSubs,
    subscriptionsTrialExpired: trialExpiredSubs,
    subscriptionsPro: active + canceling,
    suppliersTotal: suppliersSnap.size,
    supplierSubscriberSum,
    supplierItemSum,
    at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export const writeDailyMetricsSnapshot = functions.pubsub
  .schedule('0 1 * * *')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const snapshot = await computeDailySnapshot();
    const date = new Date().toISOString().slice(0, 10);
    await db().doc(`adminMetricsSnapshots/${date}`).set(snapshot, { merge: true });
    return null;
  });

// Manual trigger for the scheduled function — also used to seed historical days.
export const writeDailyMetricsSnapshotNow = functions.https.onRequest(async (req, res) => {
  const key = req.get('x-admin-key') || (req.query.key as string | undefined);
  if (!key || key !== process.env.ADMIN_DASHBOARD_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const snapshot = await computeDailySnapshot();
  const dateOverride = (req.query.date as string | undefined) || new Date().toISOString().slice(0, 10);
  await db().doc(`adminMetricsSnapshots/${dateOverride}`).set(snapshot, { merge: true });
  res.json({ ok: true, date: dateOverride, snapshot });
});

export const adminMetricsSeries = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const days = Math.min(Math.max(Number(data?.days) || 30, 7), 180);
  const snap = await db()
    .collection('adminMetricsSnapshots')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
    .limit(days)
    .get();
  const series = snap.docs
    .map((d) => ({ date: d.id, ...(d.data() as any) }))
    .reverse();
  return { series };
});

// ============================================================
// IMPERSONATION — mint a custom auth token for the target user
// ============================================================

export const adminImpersonate = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');
  const target = await admin.auth().getUser(uid).catch(() => null);
  if (!target) throw new functions.https.HttpsError('not-found', 'user not found');
  // Custom token includes a claim identifying this as an admin impersonation
  // session — the app can surface a banner if it wants to.
  const token = await admin.auth().createCustomToken(uid, {
    impersonatedBy: adminUid,
    impersonatedAt: Date.now(),
  });
  await logAdminAction({
    adminUid,
    action: 'impersonate',
    targetType: 'user',
    targetId: uid,
    payload: { targetEmail: target.email || null },
  });
  return { token, targetUid: uid, email: target.email || null };
});

// ============================================================
// CSV EXPORT
// ============================================================

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers: string[], rows: Array<Record<string, any>>): string {
  const out = [headers.join(',')];
  for (const r of rows) out.push(headers.map((h) => csvEscape(r[h])).join(','));
  return out.join('\n');
}

export const adminExportCsv = functions
  .runWith({ memory: '1GB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const entity = (data?.entity || 'users').toString();
    const firestore = db();

    if (entity === 'users') {
      const [authUsers, subsMap] = await Promise.all([listAllAuthUsers(), fetchAllSubscriptions()]);
      const rows: Record<string, any>[] = [];
      for (const auth of authUsers) {
        const [biz, es] = await Promise.all([
          firestore.doc(`users/${auth.uid}/settings/business`).get(),
          firestore.doc(`users/${auth.uid}/settings/emailState`).get(),
        ]);
        const b = biz.data() || {};
        const e = es.data() || {};
        const f = deriveSubFields(subsMap.get(auth.uid));
        rows.push({
          uid: auth.uid,
          email: auth.email || '',
          displayName: auth.displayName || '',
          businessName: b.businessName || '',
          phone: b.phone || auth.phoneNumber || '',
          abn: b.abn || '',
          plan: f.tier,
          platform: f.platform || '',
          currentPeriodEnd: f.currentPeriodEnd ? new Date(f.currentPeriodEnd).toISOString() : '',
          lastActivityAt: e.lastActivityAt?.toDate?.()?.toISOString?.() || '',
          signupAt: e.signupAt?.toDate?.()?.toISOString?.() || auth.metadata.creationTime || '',
          marketingOptIn: (await firestore.doc(`users/${auth.uid}/settings/emailPreferences`).get()).data()?.marketing !== false,
        });
      }
      return {
        filename: `quotemate-users-${Date.now()}.csv`,
        csv: rowsToCsv(['uid', 'email', 'displayName', 'businessName', 'phone', 'abn', 'plan', 'platform', 'currentPeriodEnd', 'lastActivityAt', 'signupAt', 'marketingOptIn'], rows),
      };
    }

    if (entity === 'suppliers') {
      const snap = await firestore.collection('suppliers').get();
      const rows = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as any;
          const [subs, items] = await Promise.all([
            firestore.collection(`suppliers/${d.id}/subscribers`).select().get(),
            firestore.collection(`suppliers/${d.id}/priceItems`).select().get(),
          ]);
          let ownerEmail = '';
          if (data.ownerUid) {
            try { ownerEmail = (await admin.auth().getUser(data.ownerUid)).email || ''; } catch {}
          }
          return {
            id: d.id,
            name: data.name || '',
            kind: data.kind || 'custom',
            ownerUid: data.ownerUid || '',
            ownerEmail,
            subscriberCount: subs.size,
            priceItemCount: items.size,
            lastPriceUpdate: data.lastPriceUpdate?.toDate?.()?.toISOString?.() || '',
          };
        })
      );
      return {
        filename: `quotemate-suppliers-${Date.now()}.csv`,
        csv: rowsToCsv(['id', 'name', 'kind', 'ownerUid', 'ownerEmail', 'subscriberCount', 'priceItemCount', 'lastPriceUpdate'], rows),
      };
    }

    if (entity === 'subscriptions') {
      const subsMap = await fetchAllSubscriptions();
      const rows = await Promise.all(
        Array.from(subsMap.entries()).map(async ([uid, sub]) => {
          const [biz, auth] = await Promise.all([
            firestore.doc(`users/${uid}/settings/business`).get(),
            admin.auth().getUser(uid).catch(() => null),
          ]);
          const b = biz.data() || {};
          const f = deriveSubFields(sub);
          return {
            uid,
            email: auth?.email || b.email || '',
            businessName: b.businessName || '',
            status: f.status,
            tier: f.tier,
            platform: f.platform || '',
            productId: f.productId || '',
            currentPeriodStart: f.currentPeriodStart ? new Date(f.currentPeriodStart).toISOString() : '',
            currentPeriodEnd: f.currentPeriodEnd ? new Date(f.currentPeriodEnd).toISOString() : '',
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
            validatedAt: f.validatedAt ? new Date(f.validatedAt).toISOString() : '',
          };
        })
      );
      return {
        filename: `quotemate-subscriptions-${Date.now()}.csv`,
        csv: rowsToCsv(['uid', 'email', 'businessName', 'status', 'tier', 'platform', 'productId', 'currentPeriodStart', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'validatedAt'], rows),
      };
    }

    if (entity === 'affiliates') {
      const snap = await firestore.collectionGroup('profile').get();
      const rows: Record<string, any>[] = [];
      for (const d of snap.docs) {
        if (d.id !== 'referral') continue;
        const data = d.data() as any;
        if (!data?.isAffiliate) continue;
        const uid = d.ref.parent.parent?.id;
        if (!uid) continue;
        const [biz, auth] = await Promise.all([
          firestore.doc(`users/${uid}/settings/business`).get(),
          admin.auth().getUser(uid).catch(() => null),
        ]);
        const b = biz.data() || {};
        rows.push({
          uid,
          email: auth?.email || '',
          businessName: b.businessName || '',
          referralCode: data.referralCode || '',
          commissionRate: data.commissionRate || 0,
          totalReferrals: data.totalReferrals || 0,
          convertedReferrals: data.convertedReferrals || 0,
          totalEarnings: data.totalEarnings || 0,
          pendingEarnings: data.pendingEarnings || 0,
          paidEarnings: data.paidEarnings || 0,
        });
      }
      return {
        filename: `quotemate-affiliates-${Date.now()}.csv`,
        csv: rowsToCsv(['uid', 'email', 'businessName', 'referralCode', 'commissionRate', 'totalReferrals', 'convertedReferrals', 'totalEarnings', 'pendingEarnings', 'paidEarnings'], rows),
      };
    }

    throw new functions.https.HttpsError('invalid-argument', `Unknown entity: ${entity}`);
  });

// ============================================================
// EMAIL OPEN TRACKING — 1px pixel
// ============================================================

// Transparent 1x1 GIF
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export const emailOpenPixel = functions.https.onRequest(async (req, res) => {
  const id = (req.query.id as string) || '';
  if (id) {
    try {
      await db().doc(`emailLog/${id}`).set(
        {
          openedAt: admin.firestore.FieldValue.serverTimestamp(),
          openCount: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
    } catch (err) {
      console.error('emailOpenPixel: write failed', err);
    }
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.status(200).send(PIXEL_GIF);
});

// ============================================================
// SAVED SEGMENTS — reusable broadcast combos
// ============================================================

export const adminListSegments = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db().collection('adminSegments').orderBy('updatedAt', 'desc').get();
  return {
    segments: snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.name,
        segment: data.segment,
        segmentParams: data.segmentParams || {},
        subject: data.subject || '',
        body: data.body || '',
        createdAt: data.createdAt?.toMillis?.() || null,
        updatedAt: data.updatedAt?.toMillis?.() || null,
      };
    }),
  };
});

export const adminSaveSegment = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const name = (data?.name || '').toString().trim();
  const segment = (data?.segment || 'all').toString();
  const segmentParams = data?.segmentParams || {};
  const subject = (data?.subject || '').toString();
  const body = (data?.body || '').toString();
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'name required');

  const id = data?.id || db().collection('adminSegments').doc().id;
  await db().doc(`adminSegments/${id}`).set(
    {
      name,
      segment,
      segmentParams,
      subject,
      body,
      savedBy: adminUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await logAdminAction({
    adminUid,
    action: 'save_segment',
    targetType: 'system',
    targetId: id,
    payload: { name, segment },
  });
  return { ok: true, id };
});

export const adminDeleteSegment = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  await db().doc(`adminSegments/${id}`).delete();
  await logAdminAction({
    adminUid,
    action: 'delete_segment',
    targetType: 'system',
    targetId: id,
  });
  return { ok: true };
});

// ============================================================
// SUBSCRIPTIONS — revenue view
// ============================================================

export const adminListSubscriptions = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (_data, context) => {
    requireAdmin(context);
    const firestore = db();
    const subsMap = await fetchAllSubscriptions();

    const rows = await Promise.all(
      Array.from(subsMap.entries()).map(async ([uid, sub]) => {
        const [businessSnap, authRec] = await Promise.all([
          firestore.doc(`users/${uid}/settings/business`).get(),
          admin.auth().getUser(uid).catch(() => null),
        ]);
        const business = businessSnap.data() || {};
        const f = deriveSubFields(sub);
        return {
          uid,
          email: authRec?.email || business.email || null,
          businessName: business.businessName || null,
          status: f.status,
          tier: f.tier,
          platform: f.platform,
          isPro: f.isPro,
          canceling: f.canceling,
          productId: f.productId,
          currentPeriodStart: f.currentPeriodStart,
          currentPeriodEnd: f.currentPeriodEnd,
          cancelAt: f.cancelAt,
          validatedAt: f.validatedAt,
          quotesThisMonth: sub.quotesThisMonth || 0,
        };
      })
    );

    const active = rows.filter((r) => r.status === 'active').length;
    const canceling = rows.filter((r) => r.status === 'canceling').length;
    const canceled = rows.filter((r) => r.status === 'canceled').length;
    const trialing = rows.filter((r) => r.status === 'trialing').length;
    const trial_expired = rows.filter((r) => r.status === 'trial_expired').length;
    const free = rows.filter((r) => r.status === 'free').length;

    return {
      subscriptions: rows,
      totals: { active, canceling, canceled, trialing, trial_expired, free, all: rows.length },
    };
  });

// ============================================================
// AFFILIATES — list + earnings
// ============================================================

export const adminListAffiliates = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (_data, context) => {
    requireAdmin(context);
    const firestore = db();

    // Affiliate data lives at users/{uid}/profile/referral
    const referralSnap = await firestore.collectionGroup('profile').get();
    const affiliates: any[] = [];

    for (const d of referralSnap.docs) {
      if (d.id !== 'referral') continue;
      const data = d.data() as any;
      if (!data?.isAffiliate) continue;
      const uid = d.ref.parent.parent?.id;
      if (!uid) continue;

      const [businessSnap, authRec] = await Promise.all([
        firestore.doc(`users/${uid}/settings/business`).get(),
        admin.auth().getUser(uid).catch(() => null),
      ]);
      const business = businessSnap.data() || {};
      affiliates.push({
        uid,
        email: authRec?.email || business.email || null,
        businessName: business.businessName || null,
        referralCode: data.referralCode || null,
        commissionRate: data.commissionRate || 0,
        totalReferrals: data.totalReferrals || 0,
        convertedReferrals: data.convertedReferrals || 0,
        totalEarnings: data.totalEarnings || 0,
        pendingEarnings: data.pendingEarnings || 0,
        paidEarnings: data.paidEarnings || 0,
        joinedAt: data.joinedAt?.toMillis?.() || data.joinedAt?._seconds * 1000 || null,
      });
    }

    affiliates.sort((a, b) => (b.totalEarnings || 0) - (a.totalEarnings || 0));

    const totals = affiliates.reduce(
      (acc, a) => ({
        affiliates: acc.affiliates + 1,
        referrals: acc.referrals + (a.totalReferrals || 0),
        converted: acc.converted + (a.convertedReferrals || 0),
        totalEarnings: acc.totalEarnings + (a.totalEarnings || 0),
        pending: acc.pending + (a.pendingEarnings || 0),
        paid: acc.paid + (a.paidEarnings || 0),
      }),
      { affiliates: 0, referrals: 0, converted: 0, totalEarnings: 0, pending: 0, paid: 0 }
    );

    return { affiliates, totals };
  });

// ============================================================
// DENORMALIZATION — maintain stats on user and supplier docs
// ============================================================

async function recomputeUserStats(uid: string): Promise<void> {
  const firestore = db();
  const [quotesSnap, invoicesSnap, suppliersSnap] = await Promise.all([
    firestore.collection(`users/${uid}/quotes`).select().get().catch(() => ({ size: 0, docs: [] as any[] })),
    firestore.collection(`users/${uid}/invoices`).select().get().catch(() => ({ size: 0, docs: [] as any[] })),
    firestore.collection('suppliers').select().get().catch(() => ({ docs: [] as any[] })),
  ]);
  // For supplier book, check each supplier for a subscribers/{uid} doc.
  const supplierChecks = await Promise.all(
    (suppliersSnap as any).docs.map((sd: any) =>
      firestore.doc(`suppliers/${sd.id}/subscribers/${uid}`).get().then(
        (snap) => (snap.exists ? sd.id : null)
      ).catch(() => null)
    )
  );
  const supplierIds: string[] = supplierChecks.filter((x: string | null): x is string => !!x);
  await firestore.doc(`users/${uid}`).set(
    {
      quoteCount: (quotesSnap as any).size,
      invoiceCount: (invoicesSnap as any).size,
      supplierBookCount: supplierIds.length,
      primarySupplierIds: supplierIds.slice(0, 3),
      statsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// Touch users/{uid}/settings/emailState.lastActivityAt without clobbering other fields.
// The app currently only writes this on signup / email-link click, so derived triggers
// (quote/invoice/supplier writes) are our best real-time signal of in-app activity.
async function touchUserActivity(uid: string): Promise<void> {
  await db()
    .doc(`users/${uid}/settings/emailState`)
    .set({ lastActivityAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

export const recomputeUserStatsOnQuoteWrite = functions.firestore
  .document('users/{uid}/quotes/{quoteId}')
  .onWrite(async (_change, ctx) => {
    await Promise.all([
      recomputeUserStats(ctx.params.uid),
      touchUserActivity(ctx.params.uid),
    ]);
  });

export const recomputeUserStatsOnInvoiceWrite = functions.firestore
  .document('users/{uid}/invoices/{invoiceId}')
  .onWrite(async (_change, ctx) => {
    await Promise.all([
      recomputeUserStats(ctx.params.uid),
      touchUserActivity(ctx.params.uid),
    ]);
  });

export const recomputeSupplierStatsOnSubscriberWrite = functions.firestore
  .document('suppliers/{supplierId}/subscribers/{tradieUid}')
  .onWrite(async (_change, ctx) => {
    const firestore = db();
    const { supplierId, tradieUid } = ctx.params;
    const countSnap = await firestore.collection(`suppliers/${supplierId}/subscribers`).select().get();
    await firestore.doc(`suppliers/${supplierId}`).set(
      { subscriberCount: countSnap.size },
      { merge: true }
    );
    // Also refresh the tradie's supplier book count
    await recomputeUserStats(tradieUid);
  });

export const recomputeSupplierStatsOnPriceItemWrite = functions.firestore
  .document('suppliers/{supplierId}/priceItems/{itemId}')
  .onWrite(async (_change, ctx) => {
    const firestore = db();
    const { supplierId } = ctx.params;
    const countSnap = await firestore.collection(`suppliers/${supplierId}/priceItems`).select().get();
    await firestore.doc(`suppliers/${supplierId}`).set(
      {
        priceItemCount: countSnap.size,
        lastPriceUpdate: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

// ============================================================
// ACTIVITY BACKFILL — derive lastActivityAt from existing quote/invoice writes
// ============================================================

async function deriveLastActivityForUser(uid: string): Promise<number | null> {
  // Fetch all (usually small) and pick the max timestamp in memory rather than
  // relying on orderBy, since some older quote/invoice docs were written without
  // an updatedAt field and would be excluded by orderBy.
  const firestore = db();
  const [quotesSnap, invoicesSnap] = await Promise.all([
    firestore.collection(`users/${uid}/quotes`).get().catch(() => null),
    firestore.collection(`users/${uid}/invoices`).get().catch(() => null),
  ]);
  let best: number | null = null;
  for (const s of [quotesSnap, invoicesSnap]) {
    if (!s) continue;
    for (const doc of s.docs) {
      const data = doc.data() as any;
      const t = ts(data.updatedAt) || ts(data.createdAt) || ts(data.respondedAt);
      if (t && (!best || t > best)) best = t;
    }
  }
  return best;
}

export const adminBackfillActivity = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    const key = req.get('x-admin-key') || (req.query.key as string | undefined);
    if (!key || key !== process.env.ADMIN_DASHBOARD_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const firestore = db();
    const authUsers = await listAllAuthUsers();
    let updated = 0;
    let skipped = 0;
    for (const u of authUsers) {
      const derived = await deriveLastActivityForUser(u.uid);
      if (!derived) { skipped++; continue; }
      // Only move it forward, never back. Merge-write so we don't touch other fields.
      const esSnap = await firestore.doc(`users/${u.uid}/settings/emailState`).get();
      const existing = (esSnap.data() || {}) as any;
      const existingTs = ts(existing.lastActivityAt);
      if (existingTs && existingTs >= derived) { skipped++; continue; }
      await firestore.doc(`users/${u.uid}/settings/emailState`).set(
        { lastActivityAt: admin.firestore.Timestamp.fromMillis(derived) },
        { merge: true }
      );
      updated++;
    }
    res.json({ ok: true, updated, skipped, total: authUsers.length });
  });

// ============================================================
// IAP EXPIRATION — flip isPro:false when currentPeriodEnd has passed
// ============================================================
//
// Background: validateAppleReceipt / validateGoogleReceipt write isPro:true but
// there's no server-side listener for App Store Server Notifications or Google
// RTDN, so expired IAP subscriptions stay marked active forever. The Stripe
// webhook already handles web-platform cancellations, so we only sweep iOS/Android.

async function expireStaleIapSubscriptions(): Promise<{ expired: number; checked: number }> {
  const firestore = db();
  const subsMap = await fetchAllSubscriptions();
  const now = Date.now();
  const gracePeriodMs = 3 * 24 * 60 * 60 * 1000; // 3-day grace to survive brief IAP renewal lag
  let expired = 0;
  let checked = 0;
  for (const [uid, raw] of subsMap) {
    checked++;
    if (!raw?.isPro) continue;
    const platform = raw?.platform;
    if (platform !== 'ios' && platform !== 'android') continue; // Stripe handled elsewhere
    const end = ts(raw?.currentPeriodEnd);
    if (!end || end + gracePeriodMs > now) continue;
    await firestore.doc(`users/${uid}/profile/subscription`).set(
      {
        isPro: false,
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        expiredReason: `iap-period-ended-${platform}`,
      },
      { merge: true }
    );
    expired++;
  }
  return { expired, checked };
}

export const expireStaleSubscriptions = functions.pubsub
  .schedule('30 0 * * *')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const result = await expireStaleIapSubscriptions();
    console.log(`expireStaleSubscriptions: ${JSON.stringify(result)}`);
    return null;
  });

export const expireStaleSubscriptionsNow = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (req, res) => {
    const key = req.get('x-admin-key') || (req.query.key as string | undefined);
    if (!key || key !== process.env.ADMIN_DASHBOARD_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const result = await expireStaleIapSubscriptions();
    res.json({ ok: true, ...result });
  });

// ============================================================
// BACKFILL — one-shot stats population for existing data
// ============================================================

export const adminBackfillStats = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    const key = req.get('x-admin-key') || (req.query.key as string | undefined);
    if (!key || key !== process.env.ADMIN_DASHBOARD_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const firestore = db();
    const authUsers = await listAllAuthUsers();
    let processed = 0;
    for (const u of authUsers) {
      await recomputeUserStats(u.uid);
      processed++;
    }
    // Supplier counts
    const suppliersSnap = await firestore.collection('suppliers').select().get();
    for (const sd of suppliersSnap.docs) {
      const [subs, items] = await Promise.all([
        firestore.collection(`suppliers/${sd.id}/subscribers`).select().get(),
        firestore.collection(`suppliers/${sd.id}/priceItems`).select().get(),
      ]);
      await firestore.doc(`suppliers/${sd.id}`).set(
        { subscriberCount: subs.size, priceItemCount: items.size },
        { merge: true }
      );
    }
    res.json({ ok: true, usersProcessed: processed, suppliersProcessed: suppliersSnap.size });
  });
