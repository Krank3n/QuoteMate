/**
 * Reclaiming an analyse the phone stopped listening for.
 *
 * analyzeJobDescription is one bare `fetch` that routinely runs 40–150 s. On
 * 7 Sep 2026 one ran 108.8 s and finished 200, but iOS had suspended the app
 * during the wait; the socket died, the phone raised "Network request failed"
 * four minutes later, and a finished gear list was thrown away. Nothing was
 * retryable — a second call is another two minutes of Opus, and the comment
 * on the original fetch is right that blind retries just duplicate the admin
 * failure emails.
 *
 * So the server now parks its result at users/{uid}/analyseRuns/{requestId}
 * (functions/src/analyseHandoff.ts) and this module goes and gets it. The
 * decision logic is pure and lives in shared/pricing/analyseRunDoc; what's
 * here is the Firestore plumbing and the waiting, behind an IO seam so both
 * are testable without a device — same arrangement as serverPricingRun.
 *
 * Scope: this recovers a response lost by the process that asked for it. An
 * app the OS KILLS mid-analyse still loses the request id with its memory —
 * that case belongs to the server-side pricing run and its ledger.
 */

import { doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import {
  HANDOFF_GRACE_MS,
  readAnalyseHandoff,
  type AnalyseRunRecord,
} from '../../shared/pricing/analyseRunDoc';

/** How often the wait re-checks the clock when no snapshot has arrived. */
export const HANDOFF_TICK_MS = 2_000;

export interface AnalyseHandoffIo {
  watch(
    requestId: string,
    onChange: (record: AnalyseRunRecord | null) => void,
    onError: (error: unknown) => void,
  ): () => void;
  forget(requestId: string): Promise<void>;
  now(): number;
}

export const defaultAnalyseHandoffIo: AnalyseHandoffIo = {
  watch: (requestId, onChange, onError) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      onError(new Error('signed out'));
      return () => {};
    }
    return onSnapshot(
      doc(db, 'users', uid, 'analyseRuns', requestId),
      (snap) => onChange(snap.exists() ? (snap.data() as AnalyseRunRecord) : null),
      onError,
    );
  },
  forget: async (requestId) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'analyseRuns', requestId));
  },
  now: () => Date.now(),
};

export type ParkedAnalyse =
  | { kind: 'done'; result: Record<string, unknown> }
  | { kind: 'failed'; error: string }
  /** Nothing to recover — the caller re-throws the network error it already has. */
  | { kind: 'gone'; reason: string };

/**
 * Wait for the server's parked copy of a run whose response never arrived.
 * Never throws: everything the caller can't use comes back as `gone`.
 *
 * `sentAt` is when the REQUEST left the phone, not when the wait started —
 * the server's own 420 s ceiling started then, so a phone that woke up four
 * minutes later has to give up that much sooner.
 */
export function waitForParkedAnalyse(
  requestId: string,
  sentAt: number,
  io: AnalyseHandoffIo = defaultAnalyseHandoffIo,
): Promise<ParkedAnalyse> {
  return new Promise<ParkedAnalyse>((resolve) => {
    let settled = false;
    let latest: AnalyseRunRecord | null = null;
    // Firestore hasn't answered yet. Until it has, an absent document proves
    // nothing — and getting this wrong is the whole bug: in the case this
    // exists for, the wait starts ~4 minutes after the request, long past the
    // grace period, with the finished result already sitting there unread.
    let heard = false;
    const waitStartedAt = io.now();
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: ParkedAnalyse) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve(outcome);
    };

    // One place decides, whether we got here from a snapshot or from the
    // clock — otherwise "no document yet" and "out of time" drift apart.
    const judge = () => {
      if (settled) return;
      if (!heard) {
        // A listener that hasn't said anything this long is an offline phone,
        // not an empty collection.
        if (io.now() - waitStartedAt >= HANDOFF_GRACE_MS) {
          finish({ kind: 'gone', reason: 'could not read the parked result' });
        }
        return;
      }
      const verdict = readAnalyseHandoff(latest, io.now() - sentAt);
      if (verdict.kind === 'done') finish({ kind: 'done', result: verdict.result });
      else if (verdict.kind === 'failed') finish({ kind: 'failed', error: verdict.error });
      else if (verdict.kind === 'give-up') finish({ kind: 'gone', reason: verdict.reason });
    };

    const tick = () => {
      judge();
      if (settled) return;
      timer = setTimeout(tick, HANDOFF_TICK_MS);
    };

    const subscription = io.watch(
      requestId,
      (record) => {
        heard = true;
        latest = record;
        judge();
      },
      // Can't read the document — no worse off than before it existed.
      () => finish({ kind: 'gone', reason: 'could not read the parked result' }),
    );
    // A watch that answered during subscribe (the signed-out path does) has
    // already settled us, and finish() ran before there was anything to
    // unsubscribe. Tidy up here instead of leaking the listener and a timer.
    if (settled) {
      subscription();
      return;
    }
    unsubscribe = subscription;
    timer = setTimeout(tick, HANDOFF_TICK_MS);
  });
}

/** Drop a parked result we're finished with. Best-effort — the TTL is the backstop. */
export function forgetParkedAnalyse(
  requestId: string,
  io: AnalyseHandoffIo = defaultAnalyseHandoffIo,
): void {
  io.forget(requestId).catch(() => {});
}
