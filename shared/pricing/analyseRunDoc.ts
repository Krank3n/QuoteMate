/**
 * The analyse-handoff document — users/{uid}/analyseRuns/{requestId}.
 *
 * Written by the Cloud Function (functions/src/analyseHandoff.ts), read by the
 * phone (src/services/analyseHandoff.ts) when its HTTP response never arrives.
 * This is the wire contract between two processes, so it lives here and
 * nowhere else — same reason as pricingRunDoc.
 *
 * Why it exists: analyzeJobDescription routinely runs 40–150 s (featureUsage
 * says so). On 7 Sep 2026 one ran 108.8 s, finished 200, and the tradie got
 * nothing — iOS had suspended the app during the wait and dropped the socket,
 * so the phone raised "Network request failed" and binned a gear list the
 * server had already generated and billed for. The result is now parked here
 * before the response goes out, so a lost response costs a Firestore read
 * instead of the whole run.
 */

export type AnalyseRunStatus = 'running' | 'done' | 'failed';

export interface AnalyseRunRecord {
  status: AnalyseRunStatus;
  /** The raw analyse payload, exactly as the HTTP response body carries it. */
  result?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  /** Firestore TTL field — see the policy note in functions/src/analyseHandoff.ts. */
  expiresAt?: unknown;
}

/** How long a parked result is kept before the TTL policy reaps it. */
export const ANALYSE_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * No doc this long after the request was sent means it never reached the
 * server — the phone stops waiting and reports the network error it already
 * has. The server writes the `running` marker before it touches an
 * attachment or an LLM, so a request that landed shows up within a second.
 */
export const HANDOFF_GRACE_MS = 20_000;

/**
 * The function's own ceiling (timeoutSeconds: 420) plus slack for the write.
 * Nothing can legitimately still be coming after this.
 */
export const HANDOFF_DEADLINE_MS = 450_000;

/**
 * The phone stops holding the socket open at this point and reads the result
 * out of Firestore instead. Deliberately well past the slowest observed
 * analyse (146 s daily mean, 6 Sep 2026) so the ordinary run still answers
 * over HTTP — this is a backstop for a request that never settles, not a
 * timeout the happy path is meant to hit.
 */
export const HANDOFF_FETCH_BACKSTOP_MS = 300_000;

export type AnalyseHandoffVerdict =
  | { kind: 'wait' }
  | { kind: 'done'; result: Record<string, unknown> }
  | { kind: 'failed'; error: string }
  /** Nothing is coming — the caller re-throws the network error it started with. */
  | { kind: 'give-up'; reason: string };

/**
 * What to do with the handoff document as it stands. Pure so the waiting
 * logic can be tested without Firestore or a device.
 *
 * `elapsedMs` is measured from when the REQUEST was sent, not from when the
 * phone started waiting — the server's 420 s clock started then, and a phone
 * that woke up four minutes later has already spent most of it.
 */
export function readAnalyseHandoff(
  record: AnalyseRunRecord | null | undefined,
  elapsedMs: number,
): AnalyseHandoffVerdict {
  if (record?.status === 'done' && record.result) {
    return { kind: 'done', result: record.result };
  }
  if (record?.status === 'failed') {
    return { kind: 'failed', error: record.error || 'The analyse failed on the server.' };
  }
  // A done record with no result is a malformed write, not a result to wait
  // for — treat it as nothing rather than hanging until the deadline.
  if (!record || record.status === 'done') {
    return elapsedMs >= HANDOFF_GRACE_MS
      ? { kind: 'give-up', reason: 'the analyse never reached the server' }
      : { kind: 'wait' };
  }
  return elapsedMs >= HANDOFF_DEADLINE_MS
    ? { kind: 'give-up', reason: 'the analyse ran out of time' }
    : { kind: 'wait' };
}

/**
 * Firestore document ids can't contain a slash, can't be "." or "..", and
 * can't run past 1500 bytes. The id comes off the wire, so the server checks
 * it before it builds a path out of it.
 */
export function isValidAnalyseRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
