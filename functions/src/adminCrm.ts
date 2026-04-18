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

  // These queries all read small slices — they won't scale past ~100k users without
  // aggregation, but for now direct Firestore counts are fine.
  const [
    allUsers,
    suppliers,
    subs,
    feedback,
    recentActivity,
  ] = await Promise.all([
    firestore.collection('users').select().get(),
    firestore.collection('suppliers').select('ownerUid', 'subscriberCount', 'name').get(),
    firestore.collection('subscriptions').get(),
    firestore.collection('feedback').orderBy('createdAt', 'desc').limit(10).get(),
    firestore
      .collectionGroup('emailState')
      .where('lastActivityAt', '>=', sevenDaysAgo)
      .get()
      .catch(() => ({ size: 0, docs: [] as any[] })),
  ]);

  let activeSubs = 0;
  let canceledSubs = 0;
  let pastDueSubs = 0;
  let trialSubs = 0;
  for (const d of subs.docs) {
    const s = d.data() as any;
    if (s.status === 'active') activeSubs++;
    else if (s.status === 'canceled' || s.status === 'cancelled') canceledSubs++;
    else if (s.status === 'past_due' || s.status === 'unpaid') pastDueSubs++;
    else if (s.status === 'trialing') trialSubs++;
  }

  // Signups this week — fall back to Auth user metadata since users doc may not carry createdAt.
  // Cheap trick: read emailState.signupAt where available.
  let signupsThisWeek = 0;
  let signupsToday = 0;
  try {
    const recentSignups = await firestore
      .collectionGroup('emailState')
      .where('signupAt', '>=', sevenDaysAgo)
      .get();
    signupsThisWeek = recentSignups.size;
    signupsToday = recentSignups.docs.filter((d) => {
      const at = (d.data() as any).signupAt;
      return at?.toMillis && at.toMillis() >= now - dayMs;
    }).length;
  } catch {
    // collection-group may not be indexed yet; harmless
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
      activeSevenDay: (recentActivity as any).size || 0,
    },
    subscriptions: {
      active: activeSubs,
      trialing: trialSubs,
      canceled: canceledSubs,
      pastDue: pastDueSubs,
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
}

export const adminListUsers = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const firestore = db();
    const search = (data?.search || '').toString().toLowerCase().trim();
    const limit = Math.min(Math.max(Number(data?.limit) || 100, 1), 500);

    // Pull all users — cheap at small scale. When this grows we'll paginate.
    const usersSnap = await firestore.collection('users').get();

    // Pull auth records in parallel for email/displayName (Firebase Admin supports batch getUsers up to 100).
    const uids = usersSnap.docs.map((d) => d.id);
    const authRecords = new Map<string, admin.auth.UserRecord>();
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100);
      if (!chunk.length) continue;
      const result = await admin.auth().getUsers(chunk.map((uid) => ({ uid })));
      for (const u of result.users) authRecords.set(u.uid, u);
    }

    // Pull settings + subscriptions in parallel — one doc read per user for
    // emailState, business, and subscription. Cheap for the current scale.
    const rows: UserListRow[] = await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const uid = userDoc.id;
        const userData = userDoc.data() as any;
        const auth = authRecords.get(uid);
        const [emailStateSnap, businessSnap, subSnap, emailPrefsSnap] = await Promise.all([
          firestore.doc(`users/${uid}/settings/emailState`).get(),
          firestore.doc(`users/${uid}/settings/business`).get(),
          firestore.doc(`subscriptions/${uid}`).get(),
          firestore.doc(`users/${uid}/settings/emailPreferences`).get(),
        ]);
        const emailState = emailStateSnap.data() || {};
        const business = businessSnap.data() || {};
        const sub = subSnap.data() || {};
        const emailPrefs = emailPrefsSnap.data() || {};

        const planTier = (() => {
          if (sub.status === 'active' || sub.status === 'trialing') return sub.tier || 'pro';
          if (sub.status === 'canceled' || sub.status === 'cancelled') return 'canceled';
          return 'free';
        })();

        return {
          uid,
          email: auth?.email || business.email || null,
          displayName: auth?.displayName || business.businessName || null,
          businessName: business.businessName || null,
          phone: business.phone || auth?.phoneNumber || null,
          lastActivityAt: emailState.lastActivityAt?.toMillis?.() || null,
          signupAt: emailState.signupAt?.toMillis?.() || auth?.metadata?.creationTime
            ? new Date(auth!.metadata.creationTime).getTime()
            : null,
          planTier,
          quoteCount: userData.quoteCount || 0,
          invoiceCount: userData.invoiceCount || 0,
          supplierBookCount: userData.supplierBookCount || 0,
          tags: userData.crmTags || [],
          marketingOptIn: emailPrefs.marketing !== false,
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
    firestore.doc(`subscriptions/${uid}`).get(),
    firestore.collection(`users/${uid}/quotes`).orderBy('createdAt', 'desc').limit(25).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`users/${uid}/invoices`).orderBy('createdAt', 'desc').limit(25).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`users/${uid}/adminNotes`).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection(`users/${uid}/crmEvents`).orderBy('at', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
    firestore.collection('emailLog').where('userId', '==', uid).orderBy('sentAt', 'desc').limit(50).get().catch(() => ({ docs: [] as any[] })),
    firestore.collectionGroup('subscribers').where(admin.firestore.FieldPath.documentId(), '>=', '').get().catch(() => ({ docs: [] as any[] })),
    firestore.collection('feedback').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ docs: [] as any[] })),
  ]);

  // Supplier book: filter subscribers where doc id = uid
  const supplierBook: Array<{ supplierId: string; name?: string; subscribedAt?: number }> = [];
  for (const d of (supplierBookSnap as any).docs) {
    if (d.id !== uid) continue;
    const supplierId = d.ref.parent.parent?.id;
    if (!supplierId) continue;
    supplierBook.push({
      supplierId,
      subscribedAt: (d.data() as any).subscribedAt?.toMillis?.() || null,
    });
  }
  // Resolve supplier names in one pass
  if (supplierBook.length) {
    const names = await Promise.all(
      supplierBook.map((b) =>
        firestore.doc(`suppliers/${b.supplierId}`).get().then((s) => (s.data() as any)?.name || b.supplierId)
      )
    );
    supplierBook.forEach((b, i) => (b.name = names[i]));
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
    subscription: subSnap.data() || {},
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

  // Wrap body in our standard email template for consistency
  const htmlContent = adminEmailTemplate({ subject, bodyHtml: body });
  const sent = await sendEmail({
    to,
    subject,
    htmlContent,
    category: bypassPrefs ? 'transactional' : 'marketing',
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

function adminEmailTemplate(params: { subject: string; bodyHtml: string }) {
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
  | 'supplier_subscribers';

async function resolveSegment(
  segment: Segment,
  params: Record<string, unknown>
): Promise<string[]> {
  const firestore = db();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (segment === 'all') {
    const snap = await firestore.collection('users').select().get();
    return snap.docs.map((d) => d.id);
  }
  if (segment === 'pro') {
    const snap = await firestore.collection('subscriptions').where('status', 'in', ['active', 'trialing']).get();
    return snap.docs.map((d) => d.id);
  }
  if (segment === 'free') {
    const [usersSnap, subsSnap] = await Promise.all([
      firestore.collection('users').select().get(),
      firestore.collection('subscriptions').where('status', 'in', ['active', 'trialing']).get(),
    ]);
    const paid = new Set(subsSnap.docs.map((d) => d.id));
    return usersSnap.docs.map((d) => d.id).filter((u) => !paid.has(u));
  }
  if (segment === 'inactive_7d' || segment === 'inactive_30d') {
    const days = segment === 'inactive_7d' ? 7 : 30;
    const cutoff = admin.firestore.Timestamp.fromMillis(now - days * dayMs);
    const snap = await firestore.collectionGroup('emailState').where('lastActivityAt', '<=', cutoff).get();
    return snap.docs.map((d) => d.ref.parent.parent!.id);
  }
  if (segment === 'signed_up_this_week') {
    const cutoff = admin.firestore.Timestamp.fromMillis(now - 7 * dayMs);
    const snap = await firestore.collectionGroup('emailState').where('signupAt', '>=', cutoff).get();
    return snap.docs.map((d) => d.ref.parent.parent!.id);
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
// DENORMALIZATION — maintain stats on user and supplier docs
// ============================================================

async function recomputeUserStats(uid: string): Promise<void> {
  const firestore = db();
  const [quotesSnap, invoicesSnap, supplierBookSnap] = await Promise.all([
    firestore.collection(`users/${uid}/quotes`).select().get().catch(() => ({ size: 0, docs: [] as any[] })),
    firestore.collection(`users/${uid}/invoices`).select().get().catch(() => ({ size: 0, docs: [] as any[] })),
    firestore
      .collectionGroup('subscribers')
      .where(admin.firestore.FieldPath.documentId(), '>=', '')
      .get()
      .catch(() => ({ docs: [] as any[] })),
  ]);
  const supplierIds: string[] = [];
  for (const d of (supplierBookSnap as any).docs) {
    if (d.id === uid && d.ref.parent.parent?.id) supplierIds.push(d.ref.parent.parent.id);
  }
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

export const recomputeUserStatsOnQuoteWrite = functions.firestore
  .document('users/{uid}/quotes/{quoteId}')
  .onWrite(async (_change, ctx) => {
    await recomputeUserStats(ctx.params.uid);
  });

export const recomputeUserStatsOnInvoiceWrite = functions.firestore
  .document('users/{uid}/invoices/{invoiceId}')
  .onWrite(async (_change, ctx) => {
    await recomputeUserStats(ctx.params.uid);
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
    const usersSnap = await firestore.collection('users').select().get();
    let processed = 0;
    for (const doc of usersSnap.docs) {
      await recomputeUserStats(doc.id);
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
