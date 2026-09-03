// Materials-pipeline feature telemetry.
//
// Two things get recorded here:
//   1. `recordMaterialsRecommend` — called by analyzeJobDescription (the "Get
//      Recommended Gear" analyse step) after each run with success/latency.
//   2. `reportPriceFetchUsage` (callable) — the RN client posts per-run
//      price-fetch outcome counts (fetched/failed/skipped, per supplier
//      source) once the fetch completes. The server can't see the fetch
//      itself — it fans out to the scraper/Reece/web from the device — so
//      this callable is the only way to know what a run actually produced.
//
// Both write onto `users/{uid}/featureUsage/{yyyymmdd}` and the global
// `featureUsageDaily/{yyyymmdd}` roll-up (with an activeUsers probe), mirroring
// assistantCosts' two-doc pattern.
//
// The patch-builders (`buildMaterialsRecommendPatch`, `buildPriceFetchPatch`)
// are pure: they return plain field → numeric-delta maps so the clamp/mapping
// math is unit-testable without firebase. The recorders wrap each delta in
// FieldValue.increment at write time.

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { todayKey } from './assistantCosts';

const db = () => admin.firestore();

/** Apply a plain delta map as FieldValue.increment onto the per-user + global
 * daily featureUsage docs. Swallowing failures is the caller's job (telemetry
 * is best-effort) — this just awaits the two writes. */
export async function applyFeatureUsagePatch(
  uid: string,
  deltas: Record<string, number>,
): Promise<void> {
  const inc = admin.firestore.FieldValue.increment;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(deltas)) patch[key] = inc(value);
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  const date = todayKey();
  await Promise.all([
    db().doc(`users/${uid}/featureUsage/${date}`).set(patch, { merge: true }),
    db().doc(`featureUsageDaily/${date}`).set(
      { ...patch, [`activeUsers.${uid}`]: true, date },
      { merge: true },
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Materials recommend (analyzeJobDescription) — success + latency counters.
// ---------------------------------------------------------------------------

/** Pure: field → delta map for one recommend run. */
export function buildMaterialsRecommendPatch(
  success: boolean,
  latencyMs: number,
): Record<string, number> {
  const latency = Math.max(0, Math.floor(Number(latencyMs) || 0));
  return {
    materialsRecommendCalls: 1,
    materialsRecommendFailures: success ? 0 : 1,
    materialsRecommendLatencyMsSum: latency,
  };
}

/**
 * Record one materials-recommend run. Best-effort — callers fire this with a
 * `.catch(() => {})`; telemetry must never fail the request it instruments.
 */
export async function recordMaterialsRecommend(opts: {
  uid: string;
  success: boolean;
  latencyMs: number;
}): Promise<void> {
  await applyFeatureUsagePatch(
    opts.uid,
    buildMaterialsRecommendPatch(opts.success, opts.latencyMs),
  );
}

// ---------------------------------------------------------------------------
// Price fetch (fetchPricesForQuote outcome) — reported by the RN client.
// ---------------------------------------------------------------------------

interface PriceFetchPayload {
  fetched?: number;
  failed?: number;
  skipped?: number;
  cancelled?: boolean;
  bySource?: {
    bunnings?: number;
    reece?: number;
    websearch?: number;
    local?: number;
  };
}

// A single price run tops out around 30 items; 10000 is comfortably above any
// legitimate value, so a misbehaving client can't poison the dashboard.
const COUNT_CAP = 10000;

/** Pure: clamp an untrusted count to 0..10000 (NaN/negative → 0). */
export function clampCount(n: unknown): number {
  return Math.max(0, Math.min(COUNT_CAP, Math.floor(Number(n) || 0)));
}

/** Pure: field → delta map for one price-fetch run. */
export function buildPriceFetchPatch(payload: PriceFetchPayload): Record<string, number> {
  const bySource = payload.bySource || {};
  return {
    priceFetchRuns: 1,
    priceFetchItemsFetched: clampCount(payload.fetched),
    priceFetchItemsFailed: clampCount(payload.failed),
    priceFetchItemsSkipped: clampCount(payload.skipped),
    priceFetchRunsCancelled: payload.cancelled ? 1 : 0,
    'priceFetchBySource.bunnings': clampCount(bySource.bunnings),
    'priceFetchBySource.reece': clampCount(bySource.reece),
    'priceFetchBySource.websearch': clampCount(bySource.websearch),
    'priceFetchBySource.local': clampCount(bySource.local),
  };
}

export const reportPriceFetchUsage = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

  await applyFeatureUsagePatch(uid, buildPriceFetchPatch((data || {}) as PriceFetchPayload));
  return { ok: true };
});
