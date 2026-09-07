/**
 * Parking an analyse result where the phone can still find it.
 *
 * analyzeJobDescription answers over HTTP, and that response is the only copy
 * of a run that costs 40–150 s of Opus time. If it doesn't arrive — a locked
 * phone, a dropped socket, an app iOS suspended mid-wait — the work is gone
 * and the tradie is told "Network request failed" for something that
 * succeeded. So the handler also writes the result to
 * users/{uid}/analyseRuns/{requestId}, and the phone reads it back.
 *
 * Every write here is best-effort: telemetry-grade, never allowed to fail the
 * request it is instrumenting. A phone that can't find a parked result is
 * exactly as badly off as it was before this module existed.
 *
 * TTL: `expiresAt` is reaped by a Firestore TTL policy on the analyseRuns
 * collection group (the same arrangement websiteFormRateLimits uses):
 *   gcloud firestore fields ttls update expiresAt \
 *     --collection-group=analyseRuns --enable-ttl --project hansendev
 * The phone deletes the doc as soon as it is finished with it, so the policy
 * only cleans up after an app that died mid-run.
 */

import * as admin from 'firebase-admin';
import {
  ANALYSE_HANDOFF_TTL_MS,
  isValidAnalyseRequestId,
  type AnalyseRunRecord,
} from './shared/pricing/analyseRunDoc';

/** Long enough for any healthy Firestore write, short enough to be free. */
export const HANDOFF_WRITE_TIMEOUT_MS = 5_000;

export interface AnalyseHandoffWriter {
  /** Marks the run as started, so a phone that finds nothing knows nothing landed. */
  started(): Promise<void>;
  done(result: Record<string, unknown>): Promise<void>;
  failed(message: string): Promise<void>;
}

/** A writer that does nothing — for callers that passed no request id. */
const NO_HANDOFF: AnalyseHandoffWriter = {
  started: async () => {},
  done: async () => {},
  failed: async () => {},
};

/**
 * Firestore rejects `undefined` anywhere in a document (this project does not
 * set ignoreUndefinedProperties), and a swallowed write would leave the phone
 * with nothing to recover. Round-tripping through JSON is the exact transform
 * the payload survives anyway — it IS the HTTP response body — so it drops
 * undefined values without changing what the phone would have received.
 */
function asStorable(result: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(result));
}

/**
 * A writer for this uid + request id, or a no-op when the caller didn't ask
 * for one. The server-side pricing run passes no request id: it already owns
 * a durable run document, so parking a second copy would be dead weight.
 */
export function analyseHandoffWriter(
  uid: string,
  requestId: unknown,
  db: () => admin.firestore.Firestore = () => admin.firestore(),
): AnalyseHandoffWriter {
  if (!isValidAnalyseRequestId(requestId)) return NO_HANDOFF;

  const startedAt = new Date().toISOString();
  const ref = () => db().doc(`users/${uid}/analyseRuns/${requestId}`);
  const expiresAt = () =>
    admin.firestore.Timestamp.fromMillis(Date.now() + ANALYSE_HANDOFF_TTL_MS);
  // Swallow-and-log: a handoff write must never turn a good analyse into a
  // 500, and must never mask the real error on the failure path. Bounded too
  // — `done` is awaited before the response goes out, so a write that hung
  // would spend the analyse's remaining budget and lose the very run this
  // module exists to save.
  const attempt = async (what: string, build: () => AnalyseRunRecord) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ref().set(build()),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('handoff write timed out')), HANDOFF_WRITE_TIMEOUT_MS);
        }),
      ]);
    } catch (err: any) {
      console.warn('[analyse handoff] write failed', { uid, requestId, what, message: err?.message });
    } finally {
      // Or a fast write leaves a 5 s timer holding the event loop open.
      if (timer) clearTimeout(timer);
    }
  };

  return {
    started: () => attempt('started', () => ({ status: 'running', startedAt, expiresAt: expiresAt() })),
    done: (result) =>
      attempt('done', () => ({
        status: 'done',
        result: asStorable(result),
        startedAt,
        finishedAt: new Date().toISOString(),
        expiresAt: expiresAt(),
      })),
    failed: (message) =>
      attempt('failed', () => ({
        status: 'failed',
        error: message,
        startedAt,
        finishedAt: new Date().toISOString(),
        expiresAt: expiresAt(),
      })),
  };
}
