/**
 * revenueTruth.js — ground-truth cross-platform revenue read.
 *
 * Reads every subscription doc (users/{uid}/profile/subscription) from Firestore
 * and computes real recurring revenue using the SAME billing logic as
 * functions/src/adminCrm.ts (isBilledSub / monthlyRevenueAud). Counts a sub as
 * revenue only when backed by a real billing record: an app-store productId
 * (Apple/Google Play) or a Stripe subscriptionId/priceId. admin_grant comps and
 * bare isPro flags bill $0.
 *
 * Run (uses Application Default Credentials; you must be gcloud-authed on hansendev):
 *   cd functions && NODE_PATH=./node_modules GOOGLE_CLOUD_PROJECT=hansendev \
 *     node scripts/revenueTruth.js
 *
 * Output: JSON aggregate + a one-line summary. Recurring only — for lifetime
 * Stripe charges use the Stripe dashboard/MCP; Google Play one-off history is in
 * Play Console.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });
const db = admin.firestore();

const SUB_PRICE_AUD = { monthly: 49, yearly: 328 }; // live Stripe "Starter"; store SKUs match
// App's real trial is 14 days (src/utils/trialConfig.ts). NB: functions/src/adminCrm.ts
// hardcodes 7 — that's a bug that misclassifies trials; this tool uses the true 14.
const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;

function isBilledSub(sub) {
  if (!sub || !sub.isPro) return false;
  if (sub.platform === 'admin_grant') return false;
  return !!(sub.productId || sub.subscriptionId || sub.priceId);
}
function subInterval(sub) {
  const i = String((sub && (sub.interval || sub.planInterval)) || '').toLowerCase();
  if (i.startsWith('year') || i.startsWith('annual')) return 'yearly';
  if (i.startsWith('month')) return 'monthly';
  const sku = String((sub && (sub.productId || sub.priceId)) || '').toLowerCase();
  if (sku.includes('year') || sku.includes('annual')) return 'yearly';
  return 'monthly';
}
function monthlyRevenueAud(sub) {
  if (!isBilledSub(sub)) return 0;
  return subInterval(sub) === 'yearly'
    ? Math.round((SUB_PRICE_AUD.yearly / 12) * 100) / 100
    : SUB_PRICE_AUD.monthly;
}
function tsm(v) {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (v._seconds) return v._seconds * 1000;
  if (v.toMillis) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}
function statusOf(sub) {
  const isPro = !!(sub && sub.isPro);
  const canceling = isPro && !!sub.cancelAtPeriodEnd;
  const platform = (sub && sub.platform) || null;
  const trialStartedAt = tsm(sub && sub.trialStartedAt);
  const now = Date.now();
  const inTrial = trialStartedAt !== null && (now - trialStartedAt) < TRIAL_MS;
  if (isPro) return canceling ? 'canceling' : 'active';
  if (inTrial) return 'trialing';
  if (trialStartedAt !== null && !inTrial) return 'trial_expired';
  if (platform === 'web' && sub.subscriptionId) return 'canceled';
  return 'free';
}
const PLAT = (p) => p === 'web' ? 'web(Stripe)' : p === 'ios' ? 'ios(Apple)' : p === 'android' ? 'android(GooglePlay)' : (p || 'none');

(async () => {
  const snap = await db.collectionGroup('profile').get();
  const subs = [];
  for (const d of snap.docs) {
    if (d.id !== 'subscription') continue;
    subs.push({ uid: d.ref.parent.parent && d.ref.parent.parent.id, ...d.data() });
  }
  const agg = {
    totalSubDocs: subs.length,
    byStatus: {},
    billed: { count: 0, mrr: 0, byPlatform: {}, byInterval: { monthly: 0, yearly: 0 } },
    proNotBilled: { count: 0, byPlatform: {} },
  };
  for (const s of subs) {
    const st = statusOf(s);
    agg.byStatus[st] = (agg.byStatus[st] || 0) + 1;
    if (isBilledSub(s)) {
      const plat = PLAT(s.platform);
      const intv = subInterval(s);
      const m = monthlyRevenueAud(s);
      agg.billed.count++; agg.billed.mrr += m; agg.billed.byInterval[intv]++;
      agg.billed.byPlatform[plat] = agg.billed.byPlatform[plat] || { count: 0, mrr: 0, monthly: 0, yearly: 0 };
      agg.billed.byPlatform[plat].count++; agg.billed.byPlatform[plat].mrr += m; agg.billed.byPlatform[plat][intv]++;
    } else if (s.isPro) {
      const plat = PLAT(s.platform);
      agg.proNotBilled.count++;
      agg.proNotBilled.byPlatform[plat] = (agg.proNotBilled.byPlatform[plat] || 0) + 1;
    }
  }
  agg.billed.mrr = Math.round(agg.billed.mrr * 100) / 100;
  for (const p in agg.billed.byPlatform) agg.billed.byPlatform[p].mrr = Math.round(agg.billed.byPlatform[p].mrr * 100) / 100;
  agg.arrAud = Math.round(agg.billed.mrr * 12 * 100) / 100;

  const trials = (agg.byStatus.trialing || 0) + (agg.byStatus.trial_expired || 0);
  const conv = trials ? ((agg.billed.count / (trials + agg.billed.count)) * 100).toFixed(1) : 'n/a';
  console.log(JSON.stringify(agg, null, 2));
  console.log(`\nSUMMARY: ${agg.billed.count} paying · MRR A$${agg.billed.mrr} · ARR A$${agg.arrAud} · trial→paid ~${conv}% · ${agg.totalSubDocs} sub docs`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.message ? e.message : e); process.exit(1); });
