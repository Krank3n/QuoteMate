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
import { applyBrevoEventToLead } from './leadOutreach';
import {
  stageToQuoteStatus,
  stageToInvoiceStatus,
} from './shared/document/adapter';
import type { DocumentStage, DocumentType } from './shared/document/types';
// Subscription tier/status/billing derivation lives in a dependency-free module
// so the admin CRM callables and the funnel analytics helpers share one source
// of truth (and the latter stays unit-testable without firebase). See
// subscription.helpers.ts.
import { ts, deriveSubFields, isBilledSub } from './subscription.helpers';
import { listAllAuthUsers as drainAuthUsers } from './authUsers.helpers';
import {
  computeFunnelStats,
  isActivatingDoc,
  isRecoveredDocId,
  isTestAccount,
  type FunnelUserInput,
  type FunnelPayload,
} from './adminFunnel.helpers';
import {
  rollupEventFunnel,
  foldEvent,
  docHasSquarePayment,
  isMonetized,
  type EventFunnelUserInput,
  type EventFunnelPayload,
  type UserEventFlags,
} from './eventFunnel.helpers';
import { rollupAttribution, type AttributionRollup } from './attributionRollup.helpers';
import { foundingOfferStatus } from './foundingOffer';

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

// First-touch ad attribution lives at users/{uid}/profile/attribution (written
// once by the web app — attributionService in the app repo). Same
// collectionGroup('profile') scan shape as fetchAllSubscriptions; kept separate
// because that function's Map<uid, sub> signature has ~14 call sites.
async function fetchAllAttribution(): Promise<Map<string, any>> {
  const snap = await db().collectionGroup('profile').get();
  const map = new Map<string, any>();
  for (const d of snap.docs) {
    if (d.id !== 'attribution') continue;
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    map.set(uid, d.data());
  }
  return map;
}

// Square connection lives at users/{uid}/settings/squareConnection. Doc is written
// on successful OAuth connect and deleted on user-initiated disconnect, so doc
// presence = currently connected. `disconnectedReason` is set (e.g. 'token_refresh_failed')
// when the backend notices the connection is broken but keeps the doc for debugging.
type SquareSummary = {
  connected: boolean;
  merchantId: string | null;
  merchantName: string | null;
  locationName: string | null;
  env: string | null;
  connectedAt: string | null;
  disconnectedReason: string | null;
};

function summariseSquare(data: any | undefined): SquareSummary | null {
  if (!data) return null;
  return {
    connected: !data.disconnectedReason,
    merchantId: data.merchantId || null,
    merchantName: data.merchantName || null,
    locationName: data.locationName || null,
    env: data.env || null,
    connectedAt: data.connectedAt || null,
    disconnectedReason: data.disconnectedReason || null,
  };
}

async function fetchAllSquareConnections(): Promise<Map<string, any>> {
  const snap = await db().collectionGroup('settings').get();
  const map = new Map<string, any>();
  for (const d of snap.docs) {
    if (d.id !== 'squareConnection') continue;
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    map.set(uid, d.data());
  }
  return map;
}

// Single collection-group pass over `settings` that buckets the relevant
// per-user settings docs (emailState / business / emailPreferences /
// squareConnection) into per-type maps keyed by uid. Replaces the N+1 of
// reading each user's settings docs individually inside adminListUsers.
async function fetchAllUserSettings(): Promise<{
  emailState: Map<string, any>;
  business: Map<string, any>;
  emailPreferences: Map<string, any>;
  squareConnection: Map<string, any>;
}> {
  const snap = await db().collectionGroup('settings').get();
  const emailState = new Map<string, any>();
  const business = new Map<string, any>();
  const emailPreferences = new Map<string, any>();
  const squareConnection = new Map<string, any>();
  for (const d of snap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (d.id === 'emailState') emailState.set(uid, d.data());
    else if (d.id === 'business') business.set(uid, d.data());
    else if (d.id === 'emailPreferences') emailPreferences.set(uid, d.data());
    else if (d.id === 'squareConnection') squareConnection.set(uid, d.data());
  }
  return { emailState, business, emailPreferences, squareConnection };
}

// Per-user admin-note summary used by the user list to power "Contacted /
// Not contacted / Recently contacted" filters. One collection-group pass
// instead of N per-user reads.
async function fetchAllAdminNoteSummaries(): Promise<Map<string, { count: number; lastAt: number | null }>> {
  const snap = await db().collectionGroup('adminNotes').get();
  const map = new Map<string, { count: number; lastAt: number | null }>();
  for (const d of snap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const at = (d.data() as any)?.createdAt?.toMillis?.() ?? null;
    const cur = map.get(uid);
    if (!cur) {
      map.set(uid, { count: 1, lastAt: at });
    } else {
      cur.count += 1;
      if (at && (!cur.lastAt || at > cur.lastAt)) cur.lastAt = at;
    }
  }
  return map;
}

async function listAllAuthUsers(): Promise<admin.auth.UserRecord[]> {
  return drainAuthUsers(admin.auth());
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

// Cache the expensive dashboard computation in adminStats/current and lazily
// refresh it at most once every 15 minutes (see adminDashboardStats below).
const DASHBOARD_CACHE_TTL_MS = 15 * 60 * 1000;

// The full, uncached dashboard computation. Extracted verbatim from the
// original adminDashboardStats body so the returned shape is unchanged.
async function computeDashboardStats() {
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
}

// Lazy-refresh cache wrapper: serve adminStats/current if it was generated
// within the last 15 minutes (one doc read), otherwise recompute and refresh
// the cache. Caching problems never break the endpoint — any read/write error
// falls back to (or returns) the live computation.
export const adminDashboardStats = functions.runWith({ minInstances: 1 }).https.onCall(async (_data, context) => {
  requireAdmin(context);
  const cacheRef = db().collection('adminStats').doc('current');

  // Fast path — return cached payload if fresh. Never fail on a read error.
  try {
    const cached = await cacheRef.get();
    if (cached.exists) {
      const data = cached.data() as any;
      const generatedAt = typeof data?.generatedAt === 'number' ? data.generatedAt : 0;
      if (data?.payload && Date.now() - generatedAt < DASHBOARD_CACHE_TTL_MS) {
        return data.payload;
      }
    }
  } catch (err) {
    console.error('adminDashboardStats cache read failed, computing live', err);
  }

  // Stale or missing cache — recompute and refresh. A cache write failure must
  // still return the freshly computed result.
  const result = await computeDashboardStats();
  try {
    await cacheRef.set({ payload: result, generatedAt: Date.now() });
  } catch (err) {
    console.error('adminDashboardStats cache write failed', err);
  }
  return result;
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
  // 'connected'  = squareConnection doc present, no disconnectedReason
  // 'broken'     = doc present but token refresh failed (still signed up, currently unusable)
  // 'none'       = never connected, or user disconnected
  squareStatus: 'connected' | 'broken' | 'none';
  squareMerchantName: string | null;
  squareEnv: string | null;
  appVersion: string | null;
  appPlatform: string | null;
  appVersionSeenAt: number | null;
  noteCount: number;
  lastNoteAt: number | null;
}

export const adminListUsers = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60, minInstances: 1 })
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

    // Prefetch subscriptions + admin-note summaries + all per-user settings in
    // single collection-group passes. fetchAllUserSettings() replaces both the
    // per-user emailState/business/emailPreferences reads (the N+1) and the
    // separate fetchAllSquareConnections() pass — all four come from one
    // collectionGroup('settings') scan.
    const [subsMap, notesSummaryMap, userSettings] = await Promise.all([
      fetchAllSubscriptions(),
      fetchAllAdminNoteSummaries(),
      fetchAllUserSettings(),
    ]);

    const rows: UserListRow[] = authUsers.map((auth) => {
      const uid = auth.uid;
      const userData = userDocMap.get(uid) || {};
      const emailState = userSettings.emailState.get(uid) || {};
      const business = userSettings.business.get(uid) || {};
      const subFields = deriveSubFields(subsMap.get(uid));
      const emailPrefs = userSettings.emailPreferences.get(uid) || {};
      const squareSummary = summariseSquare(userSettings.squareConnection.get(uid));

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
          squareStatus: !squareSummary ? 'none' : squareSummary.connected ? 'connected' : 'broken',
          squareMerchantName: squareSummary?.merchantName || null,
          squareEnv: squareSummary?.env || null,
          appVersion: emailState.appVersion || null,
          appPlatform: emailState.appPlatform || null,
          appVersionSeenAt: emailState.appVersionSeenAt?.toMillis?.() || null,
          noteCount: notesSummaryMap.get(uid)?.count || 0,
          lastNoteAt: notesSummaryMap.get(uid)?.lastAt || null,
        };
    });

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
    squareSnap,
    documentsSnap,
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
    firestore.doc(`users/${uid}/settings/squareConnection`).get(),
    firestore.collection(`users/${uid}/documents`).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
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
    // Square summary — tokens are intentionally stripped, admin only needs
    // connection state + merchant identity for support.
    square: summariseSquare(squareSnap.data()),
    documents: (documentsSnap as any).docs.map(docToJson),
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
  const htmlContent = adminEmailTemplate({ subject, bodyHtml: body });
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
    payload: { subject, to, sent },
  });
  return { ok: sent };
});

// Outbound emails now track via Brevo's built-in open/click tracking + our
// webhook (see brevoEmailWebhook below). sendEmail() in email.ts creates the
// emailLog doc and tags the Brevo send with its id.
function adminEmailTemplate(params: { subject: string; bodyHtml: string; emailLogId?: string }) {
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
</div></body></html>`;
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

  const htmlContent = adminEmailTemplate({ subject, bodyHtml: body });
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
    payload: { to, subject, sent, ownerUid },
  });
  return { ok: sent };
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
  | 'supplier_subscribers'
  | 'custom_uids';

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
  if (segment === 'custom_uids') {
    const uids = Array.isArray(params.uids) ? (params.uids as string[]).map(String) : [];
    return uids;
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
      const html = adminEmailTemplate({ subject, bodyHtml: body });
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
// FEEDBACK — list + reply
// ============================================================

interface FeedbackRow {
  id: string;
  userId: string | null;
  email: string | null;
  category: string | null;
  feedback: string | null;
  rating: string | null;
  details: string | null;
  source: string | null;
  replied: boolean;
  repliedAt: number | null;
  repliedBy: string | null;
  replyBody: string | null;
  detailsAddedAt: number | null;
  createdAt: number | null;
}

export const adminListFeedback = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const limit = Math.min(Math.max(Number(data?.limit) || 100, 1), 500);
    const category = (data?.category || '').toString().trim();
    const rating = (data?.rating || '').toString().trim();
    const replied = data?.replied as boolean | undefined;

    let q: admin.firestore.Query = db().collection('feedback').orderBy('createdAt', 'desc');
    if (category) q = q.where('category', '==', category);
    if (rating) q = q.where('rating', '==', rating);

    const snap = await q.limit(limit).get();
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));

    // Resolve missing emails from userId in one pass (de-duped)
    const uidsToLookup = Array.from(
      new Set(
        docs
          .filter((d) => !d.data.userEmail && !d.data.email && d.data.userId)
          .map((d) => d.data.userId as string)
      )
    );
    const emailByUid = new Map<string, string | null>();
    await Promise.all(
      uidsToLookup.map(async (uid) => {
        try {
          emailByUid.set(uid, await getUserEmail(uid));
        } catch {
          emailByUid.set(uid, null);
        }
      })
    );

    let rows: FeedbackRow[] = docs.map(({ id, data: v }) => {
      const uid = v.userId || null;
      const email = v.userEmail || v.email || (uid ? emailByUid.get(uid) || null : null);
      return {
        id,
        userId: uid,
        email,
        category: v.category || null,
        feedback: v.feedback || v.message || null,
        rating: v.rating || null,
        details: v.details || null,
        source: v.source || null,
        replied: !!v.replied,
        repliedAt: ts(v.repliedAt),
        repliedBy: v.repliedBy || null,
        replyBody: v.replyBody || null,
        detailsAddedAt: ts(v.detailsAddedAt),
        createdAt: ts(v.createdAt),
      };
    });

    if (typeof replied === 'boolean') {
      rows = rows.filter((r) => r.replied === replied);
    }

    // Aggregate counts across the unfiltered slice (pre-replied filter so chips show real totals)
    const all = docs.map(({ id, data: v }) => ({
      id,
      replied: !!v.replied,
      rating: (v.rating || null) as string | null,
      category: (v.category || null) as string | null,
      createdAt: ts(v.createdAt),
    }));
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const totals = {
      all: all.length,
      unreplied: all.filter((r) => !r.replied).length,
      replied: all.filter((r) => r.replied).length,
      last7d: all.filter((r) => (r.createdAt || 0) >= sevenDaysAgo).length,
      ratings: {
        great: all.filter((r) => r.rating === 'great').length,
        okay: all.filter((r) => r.rating === 'okay').length,
        bad: all.filter((r) => r.rating === 'bad').length,
      },
    };
    const categoryCounts: Record<string, number> = {};
    for (const r of all) {
      const c = r.category || 'Uncategorised';
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    }

    return { items: rows, totals, categoryCounts };
  });

interface LeadInterestRow {
  id: string;
  userId: string | null;
  email: string | null;
  businessName: string | null;
  contactPhone: string | null;
  missedCalls: string | null;
  typicalJobValue: number | null;
  estLostPerYear: number | null;
  notes: string | null;
  product: string | null;
  status: string | null;
  handledAt: number | null;
  handledBy: string | null;
  createdAt: number | null;
}

/**
 * List in-app "Katie" call-answering interest sign-ups (the `leadInterests`
 * collection written by submitLeadInterest). Distinct from the outreach
 * `leads` collection. Mirrors adminListFeedback.
 */
export const adminListLeadInterests = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const limit = Math.min(Math.max(Number(data?.limit) || 200, 1), 500);
    const status = (data?.status || '').toString().trim();

    let q: admin.firestore.Query = db()
      .collection('leadInterests')
      .orderBy('createdAt', 'desc');
    if (status && status !== 'all') q = q.where('status', '==', status);

    const snap = await q.limit(limit).get();
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));

    // Resolve missing emails from userId in one de-duped pass
    const uidsToLookup = Array.from(
      new Set(
        docs
          .filter((d) => !d.data.userEmail && d.data.userId)
          .map((d) => d.data.userId as string),
      ),
    );
    const emailByUid = new Map<string, string | null>();
    await Promise.all(
      uidsToLookup.map(async (uid) => {
        try {
          emailByUid.set(uid, await getUserEmail(uid));
        } catch {
          emailByUid.set(uid, null);
        }
      }),
    );

    const rows: LeadInterestRow[] = docs.map(({ id, data: v }) => {
      const uid = v.userId || null;
      const email = v.userEmail || (uid ? emailByUid.get(uid) || null : null);
      return {
        id,
        userId: uid,
        email,
        businessName: v.businessName || null,
        contactPhone: v.contactPhone || null,
        missedCalls: v.missedCalls || null,
        typicalJobValue: typeof v.typicalJobValue === 'number' ? v.typicalJobValue : null,
        estLostPerYear: typeof v.estLostPerYear === 'number' ? v.estLostPerYear : null,
        notes: v.notes || null,
        product: v.product || null,
        status: v.status || 'new',
        handledAt: ts(v.handledAt),
        handledBy: v.handledBy || null,
        createdAt: ts(v.createdAt),
      };
    });

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const totals = {
      all: rows.length,
      new: rows.filter((r) => r.status !== 'handled').length,
      handled: rows.filter((r) => r.status === 'handled').length,
      last7d: rows.filter((r) => (r.createdAt || 0) >= sevenDaysAgo).length,
    };

    return { items: rows, totals };
  });

/** Toggle a lead interest between 'new' and 'handled'. */
export const adminMarkLeadInterestHandled = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  const handled = data?.handled !== false; // default true
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');

  await db().doc(`leadInterests/${id}`).set(
    {
      status: handled ? 'handled' : 'new',
      handledAt: handled ? admin.firestore.FieldValue.serverTimestamp() : null,
      handledBy: handled ? adminUid : null,
    },
    { merge: true },
  );

  return { ok: true };
});

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

  const html = adminEmailTemplate({ subject, bodyHtml: body });
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

export const adminMetricsSeries = functions.runWith({ minInstances: 1 }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const days = Math.min(Math.max(Number(data?.days) || 30, 7), 180);
  // Doc ids are YYYY-MM-DD so they sort lexicographically by date. Default
  // ascending order avoids the composite-index requirement of a DESC query.
  const snap = await db().collection('adminMetricsSnapshots').get();
  const all = snap.docs
    .map((d) => ({ date: d.id, ...(d.data() as any) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { series: all.slice(-days) };
});

// ============================================================
// DOCUMENTS — global log across all tradies (unified quote+invoice model)
// ============================================================
//
// Source of truth post-unification: users/{uid}/documents/{id}. The legacy
// quotes/{id} and invoices/{id} collections are kept as mirrors for older
// clients but the stage field on the document is canonical.

const STUCK_VIEWED_NO_RESPONSE_DAYS = 3;
const STUCK_INVOICE_UNPAID_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function tsMs(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  if (typeof v === 'object') {
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis(); } catch { return null; }
    }
  }
  return null;
}

function jobToString(job: any): string | null {
  if (typeof job === 'string') return job.slice(0, 200);
  if (job && typeof job === 'object') {
    const parts = [job.name, job.description].filter((x) => typeof x === 'string' && x.trim());
    const joined = parts.join(' — ').slice(0, 200);
    return joined || null;
  }
  return null;
}

export const adminListDocuments = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const limit = Math.min(Math.max(Number(data?.limit) || 500, 1), 2000);
    const stageFilter = (data?.stage || '').toString() as DocumentStage | '';
    const typeFilter = (data?.type || '').toString() as DocumentType | '';
    const userIdFilter = (data?.userId || '').toString();

    const firestore = db();
    const snap = await firestore.collectionGroup('documents').get();

    // Resolve auth + business per uid in batch so each row can show the tradie.
    const uidSet = new Set<string>();
    for (const d of snap.docs) {
      const uid = d.ref.parent.parent?.id;
      if (uid) uidSet.add(uid);
    }
    const uidList = Array.from(uidSet);
    const authMap = new Map<string, admin.auth.UserRecord>();
    for (let i = 0; i < uidList.length; i += 100) {
      const chunk = uidList.slice(i, i + 100);
      if (!chunk.length) continue;
      const res = await admin.auth().getUsers(chunk.map((uid) => ({ uid })));
      for (const u of res.users) authMap.set(u.uid, u);
    }
    const businessMap = new Map<string, any>();
    await Promise.all(
      uidList.map(async (uid) => {
        const b = await firestore.doc(`users/${uid}/settings/business`).get().catch(() => null);
        businessMap.set(uid, b?.data() || {});
      })
    );

    const now = Date.now();

    const rows = snap.docs
      .map((d) => {
        const uid = d.ref.parent.parent?.id || '';
        const doc = d.data() as any;
        if (userIdFilter && uid !== userIdFilter) return null;
        const stage = (doc.stage || 'draft') as DocumentStage;
        const type = (doc.type || (stage.startsWith('invoice') || stage === 'paid' || stage === 'partially_paid' ? 'invoice' : 'quote')) as DocumentType;
        if (stageFilter && stage !== stageFilter) return null;
        if (typeFilter && type !== typeFilter) return null;

        const auth = authMap.get(uid);
        const biz = businessMap.get(uid) || {};

        const createdAt = tsMs(doc.createdAt);
        const updatedAt = tsMs(doc.updatedAt);
        const sentAt = tsMs(doc.sentAt);
        const respondedAt = tsMs(doc.respondedAt);
        const firstViewedAt = tsMs(doc.firstViewedAt);
        const lastViewedAt = tsMs(doc.lastViewedAt);
        const acceptedAt = tsMs(doc.acceptedAt);
        const invoicedAt = tsMs(doc.invoicedAt);
        const paidInFullAt = tsMs(doc.paidInFullAt);
        const dueDate = tsMs(doc.dueDate);
        const issueDate = tsMs(doc.issueDate);
        const depositPaidAt = tsMs(doc.depositPaidAt);

        const total = Number(doc.total) || 0;
        const paidTotal = Number(doc.paidTotal) || 0;
        const depositPaid = Number(doc.depositPaid) || 0;
        const balanceDue = Number(doc.balanceDue) || Math.max(total - paidTotal - depositPaid, 0);

        // "Stuck" heuristic — quote viewed but no response for >3 days, OR
        // invoice sent and overdue/unpaid for >14 days. Helps the admin spot
        // pipelines that need a nudge without scanning every row.
        const stuck = (() => {
          if (type === 'quote' && firstViewedAt && !respondedAt) {
            return now - firstViewedAt > STUCK_VIEWED_NO_RESPONSE_DAYS * DAY_MS;
          }
          if (type === 'invoice' && (stage === 'invoice_sent' || stage === 'partially_paid')) {
            const ref = sentAt || invoicedAt || createdAt;
            return !!ref && now - ref > STUCK_INVOICE_UNPAID_DAYS * DAY_MS;
          }
          return false;
        })();

        return {
          id: d.id,
          uid,
          userEmail: auth?.email || biz.email || null,
          userBusinessName: biz.businessName || auth?.displayName || null,
          type,
          stage,
          // Legacy status alias for callers that still want one — derived, never stored.
          legacyStatus: type === 'invoice' ? stageToInvoiceStatus(stage) : stageToQuoteStatus(stage),
          number: doc.number || null,
          customerName: doc.customerName || null,
          customerEmail: doc.customerEmail || null,
          customerPhone: doc.customerPhone || null,
          jobAddress: doc.jobAddress || null,
          job: jobToString(doc.job),
          total,
          subtotal: Number(doc.subtotal) || 0,
          gst: Number(doc.gst) || 0,
          materialsSubtotal: Number(doc.materialsSubtotal) || 0,
          laborTotal: Number(doc.laborTotal) || 0,
          markup: Number(doc.markup) || 0,
          materialCount: Array.isArray(doc.materials) ? doc.materials.length : 0,
          photoCount: Array.isArray(doc.photos) ? doc.photos.length : 0,
          createdAt,
          updatedAt,
          sentAt,
          respondedAt,
          respondedBy: doc.respondedBy || null,
          firstViewedAt,
          lastViewedAt,
          viewCount: Number(doc.viewCount) || 0,
          acceptedAt,
          invoicedAt,
          paidInFullAt,
          issueDate,
          dueDate,
          hasAcceptanceToken: !!doc.acceptanceToken,
          depositPaid,
          paidTotal,
          balanceDue,
          depositPaidAt,
          squarePaymentId: doc.depositSquarePaymentId || doc.squarePaymentId || null,
          paymentLinkUrl: doc.activePaymentLink?.url || doc.depositPaymentLinkUrl || doc.squarePaymentLinkUrl || null,
          jobId: doc.jobId || null,
          stuck,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, limit);

    const countByStage = (s: DocumentStage) => rows.filter((r) => r.stage === s).length;
    const sumByStage = (s: DocumentStage) => rows.filter((r) => r.stage === s).reduce((a, r) => a + r.total, 0);

    const totals = {
      all: rows.length,
      // Per-stage counts
      draft: countByStage('draft'),
      quote_sent: countByStage('quote_sent'),
      quote_accepted: countByStage('quote_accepted'),
      quote_rejected: countByStage('quote_rejected'),
      invoice_sent: countByStage('invoice_sent'),
      partially_paid: countByStage('partially_paid'),
      paid: countByStage('paid'),
      cancelled: countByStage('cancelled'),
      // Per-type counts
      quotes: rows.filter((r) => r.type === 'quote').length,
      invoices: rows.filter((r) => r.type === 'invoice').length,
      // Action-oriented buckets
      stuck: rows.filter((r) => r.stuck).length,
      viewedNoResponse: rows.filter((r) => r.type === 'quote' && r.firstViewedAt && !r.respondedAt).length,
      // Money rolls
      valueAll: rows.reduce((a, r) => a + r.total, 0),
      valueDraft: sumByStage('draft'),
      valueQuoteSent: sumByStage('quote_sent') + sumByStage('quote_accepted') + sumByStage('quote_rejected'),
      valueAccepted: sumByStage('quote_accepted'),
      valueInvoiced: sumByStage('invoice_sent') + sumByStage('partially_paid') + sumByStage('paid'),
      valuePaid: rows.reduce((a, r) => a + Math.max(r.paidTotal, r.depositPaid), 0),
      paidCount: rows.filter((r) => r.paidTotal > 0 || r.depositPaid > 0).length,
    };

    return { documents: rows, totals };
  });

export const adminGetDocument = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const id = (data?.id || '').toString();
  if (!uid || !id) throw new functions.https.HttpsError('invalid-argument', 'uid and id required');

  const firestore = db();
  const [docSnap, biz, authRec] = await Promise.all([
    firestore.doc(`users/${uid}/documents/${id}`).get(),
    firestore.doc(`users/${uid}/settings/business`).get(),
    admin.auth().getUser(uid).catch(() => null),
  ]);
  if (!docSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'document not found');
  }

  const doc = docSnap.data() as any;
  // Convert known date fields to ms epochs so the client doesn't have to.
  const dateFields = [
    'createdAt', 'updatedAt', 'sentAt', 'respondedAt',
    'acceptanceTokenCreatedAt', 'syncedAt', 'firstViewedAt', 'lastViewedAt',
    'acceptedAt', 'invoicedAt', 'paidInFullAt', 'issueDate', 'dueDate',
    'depositPaidAt', 'squarePaidAt', 'xeroSyncedAt',
  ];
  const cleaned: any = { ...doc, id };
  for (const f of dateFields) {
    if (doc[f] !== undefined) cleaned[f] = tsMs(doc[f]);
  }
  if (Array.isArray(doc.payments)) {
    cleaned.payments = doc.payments.map((p: any) => ({
      ...p,
      paidAt: tsMs(p.paidAt),
    }));
  }

  return {
    id,
    uid,
    userEmail: authRec?.email || null,
    userBusinessName: biz.data()?.businessName || null,
    document: cleaned,
  };
});

// ============================================================
// BUSINESS HEALTH FUNNEL — signup → trial → sent quote → paying
// ============================================================
//
// The founder's #1 metric is trial→paid conversion. adminFunnelStats joins
// auth users + subscriptions + emailState + a single documents scan, then hands
// the plain arrays to the pure helpers in adminFunnel.helpers.ts (unit tested).
// Cached in adminStats/funnel with the same 15-min lazy-refresh pattern as
// adminDashboardStats so the expensive scans run at most once every 15 minutes.

// The full, uncached funnel computation. Thin wrapper: fetch, join, compute.
// Exported for reuse by the weekly analytics digest (analyticsDigest.ts).
export async function computeFunnelPayload(): Promise<FunnelPayload> {
  const firestore = db();
  const now = Date.now();

  const [authUsers, subs, emailStates, docsSnap] = await Promise.all([
    listAllAuthUsers(),
    fetchAllSubscriptions(),
    fetchAllEmailStates(),
    firestore.collectionGroup('documents').get(),
  ]);

  // One pass over every document: mark which uids have an activating (sent)
  // doc — never a second documents scan.
  const activatedUids = new Set<string>();
  for (const d of docsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (isActivatingDoc(d.data() as any)) activatedUids.add(uid);
  }

  const inputs: FunnelUserInput[] = authUsers.map((u) => {
    const es = emailStates.get(u.uid) || {};
    const signupAt = ts(es.signupAt) || new Date(u.metadata.creationTime).getTime();
    return {
      uid: u.uid,
      email: u.email || null,
      businessName: u.displayName || null,
      sub: subs.get(u.uid) || null,
      signupAt,
      lastActivityAt: ts(es.lastActivityAt),
      hasSentDoc: activatedUids.has(u.uid),
    };
  });

  return computeFunnelStats(inputs, now);
}

const FUNNEL_CACHE_TTL_MS = 15 * 60 * 1000;

// Lazy-refresh cache wrapper, mirroring adminDashboardStats: serve
// adminStats/funnel if generated within the last 15 minutes, else recompute and
// refresh. Cache read/write failures never break the endpoint.
export const adminFunnelStats = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (_data, context) => {
    requireAdmin(context);
    const cacheRef = db().collection('adminStats').doc('funnel');

    try {
      const cached = await cacheRef.get();
      if (cached.exists) {
        const data = cached.data() as any;
        const generatedAt = typeof data?.generatedAt === 'number' ? data.generatedAt : 0;
        if (data?.payload && Date.now() - generatedAt < FUNNEL_CACHE_TTL_MS) {
          return { ...data.payload, cached: true };
        }
      }
    } catch (err) {
      console.error('adminFunnelStats cache read failed, computing live', err);
    }

    const result = await computeFunnelPayload();
    try {
      await cacheRef.set({ payload: result, generatedAt: Date.now() });
    } catch (err) {
      console.error('adminFunnelStats cache write failed', err);
    }
    return result;
  });

// ============================================================
// EVENT FUNNEL — trial→monetised across BOTH revenue paths (Pro subs +
// Square-collecting free tradies). Step 1 of the conversion engine: the cron
// owns the expensive computation; the callable serves cache only, so an admin
// page load can never trigger the full collection-group scans.
// ============================================================

// Client events are lossy fire-and-forget writes; 30 days of history is
// plenty to see where current users stall, and the where('ts','>=') bound
// keeps the collectionGroup('events') scan from growing without limit.
// Needs the events.ts COLLECTION_GROUP field override in firestore.indexes.json.
const EVENT_WINDOW_DAYS = 30;

// The full, uncached computation. Same join style as computeFunnelPayload,
// plus the two Path-B signals (squareConnection doc, real square payments) and
// the event-derived paywall/checkout/send-flow flags.
//
// Two exclusions keep the numbers honest, and both report their own count in
// `excluded` so this stays auditable rather than a silent filter:
//   - our own test accounts (isTestAccount) never enter the population;
//   - `recovered-` documents — the 2026-07 email-derived reconstructions — are
//     skipped, because they carry a sent-looking stage for a send that never
//     happened and would read as activation the tradie never performed.
export async function computeEventFunnelPayload(): Promise<
  EventFunnelPayload & {
    foundingTaken: number;
    attribution: AttributionRollup;
    excluded: { testAccounts: number; recoveredDocs: number };
  }
> {
  const firestore = db();
  const now = Date.now();
  const cutoff = admin.firestore.Timestamp.fromMillis(now - EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [authUsers, subs, userSettings, docsSnap, eventsSnap, attributionMap] = await Promise.all([
    listAllAuthUsers(),
    fetchAllSubscriptions(),
    fetchAllUserSettings(),
    firestore.collectionGroup('documents').get(),
    firestore.collectionGroup('events').where('ts', '>=', cutoff).get(),
    fetchAllAttribution(),
  ]);

  // One pass over every document: draft / activated / square-paid per uid.
  // Reconstructed `recovered-` docs are skipped outright — see the header.
  const draftUids = new Set<string>();
  const activatedUids = new Set<string>();
  const squarePaidUids = new Set<string>();
  let recoveredDocs = 0;
  for (const d of docsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (isRecoveredDocId(d.id)) {
      recoveredDocs++;
      continue;
    }
    const data = d.data() as any;
    draftUids.add(uid);
    if (isActivatingDoc(data)) activatedUids.add(uid);
    if (docHasSquarePayment(data)) squarePaidUids.add(uid);
  }

  // Bucket events by parent uid into de-duped per-user flags. `props` carries
  // the send-flow detail (method, to_self, wait_ms) the breakdown reports on.
  const eventFlags = new Map<string, UserEventFlags>();
  for (const d of eventsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const data = d.data() as any;
    eventFlags.set(uid, foldEvent(eventFlags.get(uid), data?.event, data?.props));
  }

  const realUsers = authUsers.filter((u) => !isTestAccount(u.email, u.displayName));
  const testAccounts = authUsers.length - realUsers.length;

  const inputs: EventFunnelUserInput[] = realUsers.map((u) => {
    const flags = eventFlags.get(u.uid);
    return {
      uid: u.uid,
      sub: subs.get(u.uid) || null,
      hasQuoteDraft: draftUids.has(u.uid),
      hasSentDoc: activatedUids.has(u.uid),
      hasSquareConnection: userSettings.squareConnection.has(u.uid),
      hasSquarePayment: squarePaidUids.has(u.uid),
      viewedPaywall: flags?.viewedPaywall ?? false,
      startedCheckout: flags?.startedCheckout ?? false,
      // UserEventFlags is a superset of SendFlowFlags, so this passes through.
      send: flags,
    };
  });

  // Founding-member count over the FULL subs map, not just users with auth
  // records — a billed sub whose auth account was deleted still holds a spot.
  let foundingTaken = 0;
  for (const sub of subs.values()) {
    if (isBilledSub(sub)) foundingTaken++;
  }

  // Per-ad acquisition scoreboard (users/{uid}/profile/attribution is written
  // once, first-touch, by the web app). Organic users are the baseline count.
  const attribution = rollupAttribution(
    inputs.map((input) => ({
      uid: input.uid,
      attribution: attributionMap.get(input.uid) ?? null,
      hasQuoteDraft: input.hasQuoteDraft,
      hasSentDoc: input.hasSentDoc,
      monetized: isMonetized(input),
    })),
  );

  return {
    ...rollupEventFunnel(inputs, now, EVENT_WINDOW_DAYS),
    foundingTaken,
    attribution,
    excluded: { testAccounts, recoveredDocs },
  };
}

// Every 6h (offset from the 15-min lazy funnel cache — this one is heavier
// and its consumers are dashboards, not alerts).
export const aggregateEventFunnel = functions
  .runWith({ memory: '512MB', timeoutSeconds: 120 })
  .pubsub.schedule('every 6 hours')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const { foundingTaken, ...payload } = await computeEventFunnelPayload();
    await db().collection('adminStats').doc('eventFunnel').set({ payload, generatedAt: Date.now() });

    // Founding-member cap status → config/ (public read, server-only write)
    // so the paywall renders a REAL "X of 100 spots left". Same cadence as
    // the funnel; the count only moves when someone subscribes.
    const founding = foundingOfferStatus(foundingTaken);
    await db().collection('config').doc('foundingOffer').set({ ...founding, generatedAt: Date.now() });

    const send = payload.sendFlow;
    console.log(
      `aggregateEventFunnel: users=${payload.shared.signups}, monetized=${payload.monetized.count} ` +
        `(pro=${payload.monetized.viaPro}, square=${payload.monetized.viaSquare}), ` +
        `trialToMonetized=${(payload.conversion.trialToMonetized * 100).toFixed(1)}%, ` +
        `foundingSpotsLeft=${founding.spotsLeft}/${founding.cap}; ` +
        `sendFlow: sheet=${send.sheetOpened} method=${send.methodChosen} sent=${send.sent} ` +
        `(durableOnly=${send.durableOnlySends}), preview=${send.email.previewOpened} ` +
        `abandoned=${send.email.previewAbandoned}, waitMedian=${send.email.waitMs.median}ms ` +
        `over ${send.email.waitMs.samples} samples; ` +
        `excluded: ${payload.excluded.testAccounts} test accounts, ` +
        `${payload.excluded.recoveredDocs} recovered docs`
    );
  });

// Serve-cache-only: the cron owns computation. Before the first cron run the
// admin UI gets { pending: true } and shows an empty state.
export const adminEventFunnelStats = functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .https.onCall(async (_data, context) => {
    requireAdmin(context);
    const cached = await db().collection('adminStats').doc('eventFunnel').get();
    const data = cached.exists ? (cached.data() as any) : null;
    if (!data?.payload) return { pending: true };
    return { ...data.payload, cached: true, generatedAt: data.generatedAt ?? null };
  });

// ============================================================
// MATE ASSISTANT CONVERSATIONS — transcripts for QA / accuracy tuning
// ============================================================
//
// The app mirrors every Mate chat to users/{uid}/assistantConversations/{id}
// (see the app's firestoreService.saveConversation). These two callables let
// the admin panel sweep them across every tradie (list) and read one in full
// (get) so we can review what Mate proposed, what got applied, and where it
// errored — the signal for improving accuracy over time.

interface ConversationSummary {
  userMessages: number;
  assistantMessages: number;
  proposalCount: number;
  appliedCount: number;
  dismissedCount: number;
  failedCount: number;
  errorCount: number;
  proposalTypes: string[];
  firstUserText: string | null;
  lastText: string | null;
}

// Roll a conversation's message array up into scan-friendly counts + previews.
// Tolerant of partial/legacy shapes — every field defaults rather than throws.
function summariseConversation(messages: any[]): ConversationSummary {
  const out: ConversationSummary = {
    userMessages: 0,
    assistantMessages: 0,
    proposalCount: 0,
    appliedCount: 0,
    dismissedCount: 0,
    failedCount: 0,
    errorCount: 0,
    proposalTypes: [],
    firstUserText: null,
    lastText: null,
  };
  const types = new Set<string>();
  const arr = Array.isArray(messages) ? messages : [];
  for (const m of arr) {
    const text = typeof m?.text === 'string' ? m.text.trim() : '';
    if (m?.role === 'user') {
      out.userMessages++;
      if (!out.firstUserText && text) out.firstUserText = text.slice(0, 160);
    } else if (m?.role === 'assistant') {
      out.assistantMessages++;
    }
    if (text) out.lastText = text.slice(0, 160);
    if (m?.errorMessage) out.errorCount++;
    const proposals = Array.isArray(m?.proposals) ? m.proposals : [];
    out.proposalCount += proposals.length;
    for (const p of proposals) if (p?.type) types.add(String(p.type));
    const status = m?.proposalStatus && typeof m.proposalStatus === 'object' ? m.proposalStatus : {};
    for (const s of Object.values(status)) {
      if (s === 'applied') out.appliedCount++;
      else if (s === 'dismissed') out.dismissedCount++;
      else if (s === 'failed') out.failedCount++;
    }
  }
  out.proposalTypes = Array.from(types);
  return out;
}

export const adminListAssistantConversations = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const limit = Math.min(Math.max(Number(data?.limit) || 500, 1), 2000);
    const userIdFilter = (data?.userId || '').toString();

    const firestore = db();
    const snap = await firestore.collectionGroup('assistantConversations').get();

    // Resolve auth + business per uid in batch so each row can name the tradie.
    const uidSet = new Set<string>();
    for (const d of snap.docs) {
      const uid = d.ref.parent.parent?.id;
      if (uid && (!userIdFilter || uid === userIdFilter)) uidSet.add(uid);
    }
    const uidList = Array.from(uidSet);
    const authMap = new Map<string, admin.auth.UserRecord>();
    for (let i = 0; i < uidList.length; i += 100) {
      const chunk = uidList.slice(i, i + 100);
      if (!chunk.length) continue;
      const res = await admin.auth().getUsers(chunk.map((uid) => ({ uid })));
      for (const u of res.users) authMap.set(u.uid, u);
    }
    const businessMap = new Map<string, any>();
    await Promise.all(
      uidList.map(async (uid) => {
        const b = await firestore.doc(`users/${uid}/settings/business`).get().catch(() => null);
        businessMap.set(uid, b?.data() || {});
      })
    );

    const rows = snap.docs
      .map((d) => {
        const uid = d.ref.parent.parent?.id || '';
        if (userIdFilter && uid !== userIdFilter) return null;
        const c = d.data() as any;
        const summary = summariseConversation(c.messages);
        const authRec = authMap.get(uid);
        const biz = businessMap.get(uid) || {};
        return {
          id: d.id,
          uid,
          userEmail: authRec?.email || biz.email || null,
          userBusinessName: biz.businessName || authRec?.displayName || null,
          platform: c.platform || null,
          createdAt: tsMs(c.createdAt),
          updatedAt: tsMs(c.updatedAt),
          syncedAt: tsMs(c.syncedAt),
          messageCount: typeof c.messageCount === 'number'
            ? c.messageCount
            : (Array.isArray(c.messages) ? c.messages.length : 0),
          userMessages: summary.userMessages,
          assistantMessages: summary.assistantMessages,
          proposalCount: summary.proposalCount,
          appliedCount: summary.appliedCount,
          dismissedCount: summary.dismissedCount,
          failedCount: summary.failedCount,
          errorCount: summary.errorCount,
          proposalTypes: summary.proposalTypes,
          preview: summary.firstUserText,
          lastText: summary.lastText,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, limit);

    const totals = {
      all: rows.length,
      messages: rows.reduce((a, r) => a + r.messageCount, 0),
      proposals: rows.reduce((a, r) => a + r.proposalCount, 0),
      applied: rows.reduce((a, r) => a + r.appliedCount, 0),
      failed: rows.reduce((a, r) => a + r.failedCount, 0),
      withProposals: rows.filter((r) => r.proposalCount > 0).length,
      withErrors: rows.filter((r) => r.errorCount > 0 || r.failedCount > 0).length,
    };

    return { conversations: rows, totals };
  });

export const adminGetAssistantConversation = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const id = (data?.id || '').toString();
  if (!uid || !id) throw new functions.https.HttpsError('invalid-argument', 'uid and id required');

  const firestore = db();
  const [snap, biz, authRec] = await Promise.all([
    firestore.doc(`users/${uid}/assistantConversations/${id}`).get(),
    firestore.doc(`users/${uid}/settings/business`).get(),
    admin.auth().getUser(uid).catch(() => null),
  ]);
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'conversation not found');
  }

  const c = snap.data() as any;
  // Pass messages through verbatim (proposals/status/working/error all intact)
  // so the panel can render the exact transcript — only normalise timestamps.
  const messages = (Array.isArray(c.messages) ? c.messages : []).map((m: any) => ({
    id: m?.id || null,
    role: m?.role || 'assistant',
    text: typeof m?.text === 'string' ? m.text : '',
    createdAt: tsMs(m?.createdAt),
    proposals: Array.isArray(m?.proposals) ? m.proposals : undefined,
    proposalStatus: m?.proposalStatus && typeof m.proposalStatus === 'object' ? m.proposalStatus : undefined,
    errorMessage: m?.errorMessage || undefined,
    working: m?.working || undefined,
    inlineQuoteId: m?.inlineQuoteId || undefined,
  }));

  return {
    id,
    uid,
    userEmail: authRec?.email || null,
    userBusinessName: biz.data()?.businessName || null,
    conversation: {
      id,
      platform: c.platform || null,
      createdAt: tsMs(c.createdAt),
      updatedAt: tsMs(c.updatedAt),
      syncedAt: tsMs(c.syncedAt),
      messageCount: typeof c.messageCount === 'number' ? c.messageCount : messages.length,
      messages,
      summary: summariseConversation(c.messages),
    },
  };
});

// ============================================================
// REVENUE — Square payment aggregation
// ============================================================
//
// Each completed Square payment is written to `squarePayments/{paymentId}` by the
// Square webhook. New writes include amountCents + appFeeCents + channel so we
// can aggregate QuoteMate's cut. Older payments (before this instrumentation)
// only have {userId, quoteId|invoiceId, orderId} — for those we fall back to
// summing depositPaid/paidTotal on the quote/invoice and estimating the fee.

const CENTS_PER_DOLLAR = 100;
const ONLINE_FEE_PCT = 1.0;  // must match QM_APP_FEE_PCT_ONLINE in shared/pdf/squareFees.ts

interface PaymentRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userBusinessName: string | null;
  kind: 'invoice' | 'quote_deposit' | 'quote_full' | 'unknown';
  quoteId: string | null;
  invoiceId: string | null;
  amountDollars: number;
  appFeeDollars: number;
  channel: string;
  paidAt: number | null;
  orderId: string | null;
  currency: string;
  enriched: boolean; // false → legacy payment, fields inferred
}

export const adminListPayments = functions
  .runWith({ memory: '512MB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const firestore = db();
    const limit = Math.min(Math.max(Number(data?.limit) || 500, 1), 2000);

    const snap = await firestore.collection('squarePayments').get();

    // Batch-resolve user info for display.
    const uidSet = new Set<string>();
    for (const d of snap.docs) {
      const u = (d.data() as any)?.userId;
      if (u) uidSet.add(u);
    }
    const uidList = Array.from(uidSet);
    const authMap = new Map<string, admin.auth.UserRecord>();
    for (let i = 0; i < uidList.length; i += 100) {
      const chunk = uidList.slice(i, i + 100);
      if (!chunk.length) continue;
      const res = await admin.auth().getUsers(chunk.map((uid) => ({ uid })));
      for (const u of res.users) authMap.set(u.uid, u);
    }
    const businessMap = new Map<string, any>();
    await Promise.all(
      uidList.map(async (uid) => {
        const b = await firestore.doc(`users/${uid}/settings/business`).get().catch(() => null);
        businessMap.set(uid, b?.data() || {});
      })
    );

    const rows: PaymentRow[] = [];
    for (const d of snap.docs) {
      const p = d.data() as any;
      const uid: string | null = p.userId || null;
      const auth = uid ? authMap.get(uid) : null;
      const biz = uid ? businessMap.get(uid) || {} : {};
      const enriched = typeof p.amountCents === 'number';
      let amountDollars = enriched ? (p.amountCents || 0) / CENTS_PER_DOLLAR : 0;
      let appFeeDollars = enriched ? (p.appFeeCents || 0) / CENTS_PER_DOLLAR : 0;

      // Legacy fallback: look up the referenced quote/invoice to get the paid amount.
      if (!enriched && uid) {
        try {
          if (p.invoiceId) {
            const inv = await firestore.doc(`users/${uid}/invoices/${p.invoiceId}`).get();
            amountDollars = Number(inv.data()?.paidTotal || inv.data()?.paidAmount) || 0;
          } else if (p.quoteId) {
            const q = await firestore.doc(`users/${uid}/quotes/${p.quoteId}`).get();
            amountDollars = Math.max(
              Number(q.data()?.paidTotal) || 0,
              Number(q.data()?.depositPaid) || 0
            );
          }
          appFeeDollars = (amountDollars * ONLINE_FEE_PCT) / 100;
        } catch {}
      }

      rows.push({
        id: d.id,
        userId: uid,
        userEmail: auth?.email || biz.email || null,
        userBusinessName: biz.businessName || auth?.displayName || null,
        kind: p.kind || (p.invoiceId ? 'invoice' : p.quoteId ? 'quote_deposit' : 'unknown'),
        quoteId: p.quoteId || null,
        invoiceId: p.invoiceId || null,
        amountDollars,
        appFeeDollars,
        channel: p.channel || 'online',
        paidAt: ts(p.paidAt) || ts(p.createdAt),
        orderId: p.orderId || null,
        currency: p.currency || 'AUD',
        enriched,
      });
    }

    rows.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0));
    const trimmed = rows.slice(0, limit);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const sumFee = (cutoff: number | null) =>
      rows.filter((r) => cutoff === null || (r.paidAt && r.paidAt >= cutoff)).reduce((a, r) => a + r.appFeeDollars, 0);
    const sumGross = (cutoff: number | null) =>
      rows.filter((r) => cutoff === null || (r.paidAt && r.paidAt >= cutoff)).reduce((a, r) => a + r.amountDollars, 0);
    const count = (cutoff: number | null) =>
      rows.filter((r) => cutoff === null || (r.paidAt && r.paidAt >= cutoff)).length;

    const totals = {
      allTime: { grossDollars: sumGross(null), feeDollars: sumFee(null), count: count(null) },
      last24h: { grossDollars: sumGross(now - DAY), feeDollars: sumFee(now - DAY), count: count(now - DAY) },
      last7d: { grossDollars: sumGross(now - 7 * DAY), feeDollars: sumFee(now - 7 * DAY), count: count(now - 7 * DAY) },
      last30d: { grossDollars: sumGross(now - 30 * DAY), feeDollars: sumFee(now - 30 * DAY), count: count(now - 30 * DAY) },
      enrichedCount: rows.filter((r) => r.enriched).length,
      legacyCount: rows.filter((r) => !r.enriched).length,
    };

    // Top earners — users ranked by QuoteMate app-fee contribution.
    const perUser = new Map<string, { userId: string; userEmail: string | null; userBusinessName: string | null; grossDollars: number; feeDollars: number; count: number }>();
    for (const r of rows) {
      if (!r.userId) continue;
      const cur = perUser.get(r.userId) || { userId: r.userId, userEmail: r.userEmail, userBusinessName: r.userBusinessName, grossDollars: 0, feeDollars: 0, count: 0 };
      cur.grossDollars += r.amountDollars;
      cur.feeDollars += r.appFeeDollars;
      cur.count += 1;
      perUser.set(r.userId, cur);
    }
    const topUsers = Array.from(perUser.values()).sort((a, b) => b.feeDollars - a.feeDollars).slice(0, 10);

    return { payments: trimmed, totals, topUsers };
  });

// ============================================================
// USER STATUS — grant/revoke Pro, disable, enable, delete
// ============================================================

export const adminGrantPro = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const months = Math.max(1, Math.min(Number(data?.months) || 1, 24));
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  const now = new Date();
  const expiry = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);
  await db().doc(`users/${uid}/profile/subscription`).set(
    {
      isPro: true,
      platform: 'admin_grant',
      grantedBy: adminUid,
      grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      currentPeriodStart: now,
      currentPeriodEnd: expiry,
      cancelAtPeriodEnd: false,
      validatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await logAdminAction({
    adminUid,
    action: 'grant_pro',
    targetType: 'user',
    targetId: uid,
    payload: { months, expiresAt: expiry.toISOString() },
  });
  return { ok: true, expiresAt: expiry.toISOString() };
});

export const adminRevokePro = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  await db().doc(`users/${uid}/profile/subscription`).set(
    {
      isPro: false,
      revokedBy: adminUid,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiredReason: 'admin_revoke',
    },
    { merge: true }
  );
  await logAdminAction({
    adminUid,
    action: 'revoke_pro',
    targetType: 'user',
    targetId: uid,
  });
  return { ok: true };
});

export const adminSetUserDisabled = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const uid = (data?.uid || '').toString();
  const disabled = data?.disabled === true;
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  await admin.auth().updateUser(uid, { disabled });
  await logAdminAction({
    adminUid,
    action: disabled ? 'disable_user' : 'enable_user',
    targetType: 'user',
    targetId: uid,
  });
  return { ok: true, disabled };
});

export const adminDeleteUser = functions
  .runWith({ timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const uid = (data?.uid || '').toString();
    const wipeData = data?.wipeData === true;
    const confirm = (data?.confirmEmail || '').toString().trim().toLowerCase();
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

    const user = await admin.auth().getUser(uid).catch(() => null);
    if (!user) throw new functions.https.HttpsError('not-found', 'user not found');

    // Defence in depth: require the admin to re-type the target email to confirm.
    if (user.email && confirm !== user.email.toLowerCase()) {
      throw new functions.https.HttpsError('failed-precondition', 'Email confirmation mismatch');
    }

    // Optionally delete the user's Firestore subtree (quotes, invoices, settings, etc).
    let wipedDocs = 0;
    if (wipeData) {
      const firestore = db();
      const collectionsToWipe = [
        `users/${uid}/quotes`,
        `users/${uid}/invoices`,
        `users/${uid}/settings`,
        `users/${uid}/profile`,
        `users/${uid}/adminNotes`,
        `users/${uid}/crmEvents`,
        `users/${uid}/affiliateEarnings`,
      ];
      for (const path of collectionsToWipe) {
        const snap = await firestore.collection(path).get().catch(() => ({ docs: [] as any[] }));
        for (const d of (snap as any).docs) {
          await d.ref.delete();
          wipedDocs++;
        }
      }
      await firestore.doc(`users/${uid}`).delete().catch(() => null);
    }

    await admin.auth().deleteUser(uid);
    await logAdminAction({
      adminUid,
      action: 'delete_user',
      targetType: 'user',
      targetId: uid,
      payload: { email: user.email || null, wipeData, wipedDocs },
    });
    return { ok: true, wipedDocs };
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
      const [authUsers, subsMap, squareMap] = await Promise.all([
        listAllAuthUsers(),
        fetchAllSubscriptions(),
        fetchAllSquareConnections(),
      ]);
      const rows: Record<string, any>[] = [];
      for (const auth of authUsers) {
        const [biz, es] = await Promise.all([
          firestore.doc(`users/${auth.uid}/settings/business`).get(),
          firestore.doc(`users/${auth.uid}/settings/emailState`).get(),
        ]);
        const b = biz.data() || {};
        const e = es.data() || {};
        const f = deriveSubFields(subsMap.get(auth.uid));
        const sq = summariseSquare(squareMap.get(auth.uid));
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
          squareStatus: !sq ? 'none' : sq.connected ? 'connected' : 'broken',
          squareMerchant: sq?.merchantName || '',
          squareEnv: sq?.env || '',
          squareConnectedAt: sq?.connectedAt || '',
          appVersion: e.appVersion || '',
          appPlatform: e.appPlatform || '',
        });
      }
      return {
        filename: `quotemate-users-${Date.now()}.csv`,
        csv: rowsToCsv(['uid', 'email', 'displayName', 'businessName', 'phone', 'abn', 'plan', 'platform', 'currentPeriodEnd', 'lastActivityAt', 'signupAt', 'marketingOptIn', 'squareStatus', 'squareMerchant', 'squareEnv', 'squareConnectedAt', 'appVersion', 'appPlatform'], rows),
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
// BREVO WEBHOOK — delivery / bounce / spam / open / click / unsubscribe
// ============================================================
//
// Configure in Brevo dashboard → Transactional → Settings → Webhook:
//   https://us-central1-hansendev.cloudfunctions.net/brevoEmailWebhook?key=<BREVO_WEBHOOK_SECRET>
// Tick every event type you want surfaced. Our sendEmail() tags every send
// with `emailLogId:<id>` and sets X-Mailin-custom: {emailLogId, userId, category}
// — the webhook parses either to find the matching emailLog doc.
//
// Brevo event payloads: https://developers.brevo.com/docs/transactional-webhooks
// Events we handle:
//   request, delivered, deferred, soft_bounce, hard_bounce, spam,
//   invalid_email, blocked, error, opened, click, unsubscribe

function parseEmailLogId(body: any): string | null {
  // Prefer X-Mailin-custom header (JSON string) if present.
  const custom = body['X-Mailin-custom'] || body.mailinCustom;
  if (typeof custom === 'string') {
    try {
      const parsed = JSON.parse(custom);
      if (parsed?.emailLogId) return String(parsed.emailLogId);
    } catch {}
  }
  // Fall back to parsing the tags array for `emailLogId:<id>`.
  const tagField = body.tag || body.tags;
  let tags: string[] = [];
  if (Array.isArray(tagField)) tags = tagField;
  else if (typeof tagField === 'string') {
    try { tags = JSON.parse(tagField); } catch { tags = [tagField]; }
  }
  for (const t of tags) {
    if (typeof t === 'string' && t.startsWith('emailLogId:')) return t.slice('emailLogId:'.length);
  }
  return null;
}

function timestampFromBrevo(body: any): admin.firestore.FieldValue | admin.firestore.Timestamp {
  const raw = body.date || body.ts_event || body.ts;
  if (typeof raw === 'number') return admin.firestore.Timestamp.fromMillis(raw * 1000);
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (!isNaN(t)) return admin.firestore.Timestamp.fromMillis(t);
  }
  return admin.firestore.FieldValue.serverTimestamp();
}

export const brevoEmailWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const key = (req.query.key as string | undefined) || req.get('x-brevo-key');
    const expected = process.env.BREVO_WEBHOOK_SECRET;
    if (!expected || !key || key !== expected) {
      console.warn('brevoEmailWebhook: unauthorized attempt');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Brevo sends a single event per POST, or (rarely) a batch array.
    const events: any[] = Array.isArray(req.body) ? req.body : [req.body];
    let matched = 0;
    let unmatched = 0;

    for (const body of events) {
      const event = String(body.event || '').toLowerCase();
      const logId = parseEmailLogId(body);

      // Fan out lead-tagged events to leads/{id} regardless of emailLog match.
      try {
        const tagField = body.tag || body.tags;
        let parsedTags: string[] = [];
        if (Array.isArray(tagField)) parsedTags = tagField;
        else if (typeof tagField === 'string') {
          try { parsedTags = JSON.parse(tagField); } catch { parsedTags = [tagField]; }
        }
        const eventAt = timestampFromBrevo(body);
        await applyBrevoEventToLead({
          tags: parsedTags,
          event,
          email: body.email || null,
          at: eventAt,
          reason: body.reason || null,
        });
      } catch (e) {
        console.warn('brevoEmailWebhook: lead fan-out failed', e);
      }

      if (!logId) {
        unmatched++;
        console.info(`brevoEmailWebhook: ${event} event with no emailLogId`, body.email, body['message-id']);
        continue;
      }
      const logRef = db().doc(`emailLog/${logId}`);
      const at = timestampFromBrevo(body);
      const update: any = {
        [`events.${event}.at`]: at,
        [`events.${event}.count`]: admin.firestore.FieldValue.increment(1),
        lastEvent: event,
        lastEventAt: at,
      };

      switch (event) {
        case 'request':
        case 'delivered':
          update.status = 'delivered';
          update.deliveredAt = at;
          break;
        case 'deferred':
          if (!update.status) update.status = 'deferred';
          update.deferredAt = at;
          break;
        case 'soft_bounce':
        case 'hard_bounce':
          update.status = 'bounced';
          update.bouncedAt = at;
          update.bounceType = event === 'hard_bounce' ? 'hard' : 'soft';
          update.bounceReason = body.reason || body['reason'] || null;
          break;
        case 'spam':
          update.status = 'spam';
          update.spamReportedAt = at;
          break;
        case 'unsubscribe':
          update.unsubscribedAt = at;
          break;
        case 'blocked':
          update.status = 'blocked';
          update.blockedAt = at;
          update.blockedReason = body.reason || null;
          break;
        case 'invalid_email':
        case 'error':
          update.status = 'error';
          update.deliveryError = body.reason || event;
          break;
        case 'opened':
        case 'unique_opened':
          update.openedAt = update.openedAt || at;
          update.openCount = admin.firestore.FieldValue.increment(1);
          break;
        case 'click':
          update.firstClickedAt = update.firstClickedAt || at;
          update.clickCount = admin.firestore.FieldValue.increment(1);
          if (body.link || body.url) {
            update.clickedUrls = admin.firestore.FieldValue.arrayUnion(body.link || body.url);
          }
          break;
        default:
          // Unknown event type — still record under events.{event}
          break;
      }

      // Mirror brevoMessageId for cross-referencing.
      if (body['message-id'] && !update.brevoMessageId) update.brevoMessageId = body['message-id'];

      await logRef.set(update, { merge: true });
      matched++;
    }

    res.json({ ok: true, matched, unmatched });
  } catch (err: any) {
    console.error('brevoEmailWebhook: handler error', err);
    res.status(500).json({ error: err?.message || 'webhook error' });
  }
});

// ============================================================
// EMAIL EVENTS — admin callables to browse delivery telemetry
// ============================================================

export const adminListEmailEvents = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const limit = Math.min(Math.max(Number(data?.limit) || 100, 1), 500);
    const category = data?.category as string | undefined;
    const status = data?.status as string | undefined;
    const userId = data?.userId as string | undefined;

    let q: admin.firestore.Query = db().collection('emailLog').orderBy('queuedAt', 'desc');
    if (category) q = q.where('category', '==', category);
    if (status) q = q.where('status', '==', status);
    if (userId) q = q.where('userId', '==', userId);

    const snap = await q.limit(limit).get().catch(async () => {
      // Fall back to sentAt if older docs don't have queuedAt
      let q2: admin.firestore.Query = db().collection('emailLog').orderBy('sentAt', 'desc');
      if (category) q2 = q2.where('category', '==', category);
      if (status) q2 = q2.where('status', '==', status);
      if (userId) q2 = q2.where('userId', '==', userId);
      return q2.limit(limit).get();
    });

    const rows = snap.docs.map((d) => {
      const v = d.data() as any;
      return {
        id: d.id,
        userId: v.userId || null,
        to: v.to || null,
        subject: v.subject || null,
        category: v.category || null,
        status: v.status || (v.sentAt ? 'sent' : 'pending'),
        tags: v.tags || [],
        queuedAt: ts(v.queuedAt),
        sentAt: ts(v.sentAt),
        deliveredAt: ts(v.deliveredAt),
        bouncedAt: ts(v.bouncedAt),
        bounceType: v.bounceType || null,
        bounceReason: v.bounceReason || null,
        openedAt: ts(v.openedAt),
        openCount: v.openCount || 0,
        firstClickedAt: ts(v.firstClickedAt),
        clickCount: v.clickCount || 0,
        clickedUrls: v.clickedUrls || [],
        spamReportedAt: ts(v.spamReportedAt),
        unsubscribedAt: ts(v.unsubscribedAt),
        blockedAt: ts(v.blockedAt),
        blockedReason: v.blockedReason || null,
        deliveryError: v.deliveryError || null,
        lastEvent: v.lastEvent || null,
        lastEventAt: ts(v.lastEventAt),
      };
    });

    // Totals for the filtered slice (aggregate in memory — cheap at limit 500)
    const totals = {
      all: rows.length,
      delivered: rows.filter((r) => r.status === 'delivered' || !!r.deliveredAt).length,
      bounced: rows.filter((r) => !!r.bouncedAt).length,
      opened: rows.filter((r) => !!r.openedAt).length,
      clicked: rows.filter((r) => !!r.firstClickedAt).length,
      spam: rows.filter((r) => !!r.spamReportedAt).length,
      unsubscribed: rows.filter((r) => !!r.unsubscribedAt).length,
      failed: rows.filter((r) => r.status === 'send_failed' || r.status === 'error' || r.status === 'blocked').length,
    };

    return { events: rows, totals };
  });

export const adminEmailHealth = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const twentyFourHoursAgo = admin.firestore.Timestamp.fromMillis(now - day);
  const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(now - 7 * day);

  // Only look at recent docs to keep this cheap
  const snap = await db()
    .collection('emailLog')
    .where('queuedAt', '>=', sevenDaysAgo)
    .get()
    .catch(() => ({ docs: [] as any[] }));

  let sent24 = 0, sent7d = 0;
  let delivered24 = 0, delivered7d = 0;
  let bounced24 = 0, bounced7d = 0;
  let opened24 = 0, opened7d = 0;
  let clicked24 = 0, clicked7d = 0;
  let spam7d = 0, failed7d = 0;
  for (const d of (snap as any).docs) {
    const v = d.data() as any;
    const queuedAt = ts(v.queuedAt) || ts(v.sentAt) || 0;
    if (queuedAt < now - 7 * day) continue;
    sent7d++;
    if (queuedAt >= now - day) sent24++;
    if (v.deliveredAt) {
      delivered7d++;
      if (ts(v.deliveredAt)! >= now - day) delivered24++;
    }
    if (v.bouncedAt) {
      bounced7d++;
      if (ts(v.bouncedAt)! >= now - day) bounced24++;
    }
    if (v.openedAt) {
      opened7d++;
      if (ts(v.openedAt)! >= now - day) opened24++;
    }
    if (v.firstClickedAt) {
      clicked7d++;
      if (ts(v.firstClickedAt)! >= now - day) clicked24++;
    }
    if (v.spamReportedAt) spam7d++;
    if (v.status === 'send_failed' || v.status === 'error' || v.status === 'blocked') failed7d++;
  }

  // Ignore the unused 24h-ago timestamp (declared for parity with existing conventions).
  void twentyFourHoursAgo;

  return {
    last24h: { sent: sent24, delivered: delivered24, bounced: bounced24, opened: opened24, clicked: clicked24 },
    last7d: { sent: sent7d, delivered: delivered7d, bounced: bounced7d, opened: opened7d, clicked: clicked7d, spam: spam7d, failed: failed7d },
  };
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
          billed: f.billed,
          interval: f.interval,
          monthlyAud: f.monthlyAud,
        };
      })
    );

    const active = rows.filter((r) => r.status === 'active').length;
    const canceling = rows.filter((r) => r.status === 'canceling').length;
    const canceled = rows.filter((r) => r.status === 'canceled').length;
    const trialing = rows.filter((r) => r.status === 'trialing').length;
    const trial_expired = rows.filter((r) => r.status === 'trial_expired').length;
    const free = rows.filter((r) => r.status === 'free').length;

    // MRR = sum of monthly-equivalent revenue across billed subs (comps + bare
    // isPro flags contribute $0). "paying" is the count of real revenue subs.
    const mrr = Math.round(rows.reduce((a, r) => a + (r.monthlyAud || 0), 0));
    const paying = rows.filter((r) => r.billed && (r.status === 'active' || r.status === 'canceling')).length;
    const comped = rows.filter((r) => r.isPro && !r.billed).length;

    return {
      subscriptions: rows,
      totals: { active, canceling, canceled, trialing, trial_expired, free, all: rows.length, mrr, paying, comped },
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
