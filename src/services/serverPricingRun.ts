/**
 * Mate's pricing run, executed on the server.
 *
 * "Price it up" used to run the whole materials + pricing pipeline in this
 * process, held awake by a wake lock. Lock the phone or switch apps and iOS
 * froze it within seconds; the tradie came back to an unpriced draft. The
 * pipeline (shared/pricing/pipeline.ts) now also runs inside a Cloud Function
 * (functions/src/pricingRun.ts). This module is the phone's side of that:
 *
 *   1. write a run document under users/{uid}/pricingRuns,
 *   2. stream its progress into the chat's working card,
 *   3. keep a `foreground` flag on it honest so the server knows whether a
 *      "quote's ready" push is worth sending,
 *   4. resolve with the priced quote once the server writes it.
 *
 * If the server doesn't pick the run up (flag off, function not deployed,
 * no network) the caller falls back to running the pipeline here, exactly as
 * before — so the phone path stays the safety net, never the other way round.
 *
 * Every side effect goes through ServerRunIo so the waiting logic is testable
 * without Firestore or a device.
 */

import { AppState, Platform } from 'react-native';
import {
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { Quote } from '../types';
import type { WorkingStatus } from '../../shared/pricing/progress';
import { generateId } from '../utils/generateId';
import { firestoreService } from './firestoreService';

export type PricingRunKind = 'draft' | 'scope';

export interface PricingRunOptions {
  isPro: boolean;
  stripLabour: boolean;
  labourOnly: boolean;
}

export interface PricingRunResult {
  generatedMaterialCount: number;
  fetchedCount: number;
  failedCount: number;
  skippedCount: number;
  missedSupplierTerms: string[];
  reeceReauthNeeded: boolean;
}

/** The run document, as this phone creates it and the server advances it. */
export interface PricingRunRecord {
  quoteId: string;
  kind: PricingRunKind;
  options: PricingRunOptions;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress?: WorkingStatus;
  foreground?: boolean;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: PricingRunResult;
  error?: string;
  clientPlatform?: string;
}

export interface ServerRunRequest {
  quoteId: string;
  kind: PricingRunKind;
  options: PricingRunOptions;
}

export type ServerRunOutcome =
  | { kind: 'done'; result: PricingRunResult; quote: Quote }
  | { kind: 'failed'; error: string }
  /** The server never took the run — price on the phone instead. */
  | { kind: 'unavailable'; reason: string };

export interface ServerRunIo {
  uid(): string | null;
  /** The remote kill switch (config/pipeline.serverRuns). */
  isEnabled(): Promise<boolean>;
  createRun(runId: string, record: PricingRunRecord): Promise<void>;
  deleteRun(runId: string): Promise<void>;
  watchRun(
    runId: string,
    onChange: (record: PricingRunRecord | null) => void,
    onError: (error: unknown) => void,
  ): () => void;
  /** Cancel the run if the server hasn't claimed it. True when cancelled. */
  cancelIfQueued(runId: string): Promise<boolean>;
  setForeground(runId: string, foreground: boolean): Promise<void>;
  fetchQuote(quoteId: string): Promise<Quote | null>;
  subscribeAppState(listener: (state: string) => void): () => void;
  now(): number;
  platform: string;
}

/** How long a Firestore write may take before the phone decides it's offline. */
export const CREATE_TIMEOUT_MS = 8_000;
/** How long the run may sit unclaimed before the phone prices it itself. */
export const QUEUE_TIMEOUT_MS = 25_000;
/** A running run with no progress write for this long is presumed dead. */
export const STALE_TIMEOUT_MS = 6 * 60 * 1000;
/** Nothing legitimately runs longer than the function's own timeout. */
export const HARD_TIMEOUT_MS = 10 * 60 * 1000;

const FLAG_CACHE_MS = 5 * 60 * 1000;
let flagCache: { value: boolean; readAt: number } | null = null;

/**
 * config/pipeline { serverRuns: boolean }. Missing document or a failed read
 * both mean ON — the queue timeout is the real safety net, and a flag that
 * fails closed would silently put every run back on the phone.
 */
export async function readServerRunsFlag(now: number = Date.now()): Promise<boolean> {
  if (flagCache && now - flagCache.readAt < FLAG_CACHE_MS) return flagCache.value;
  let value = true;
  try {
    const snap = await getDoc(doc(db, 'config', 'pipeline'));
    const raw = snap.exists() ? (snap.data() as { serverRuns?: unknown }).serverRuns : undefined;
    if (raw === false) value = false;
  } catch {
    value = true;
  }
  flagCache = { value, readAt: now };
  return value;
}

/** Test seam. */
export function __resetServerRunsFlagCache(): void {
  flagCache = null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export const defaultServerRunIo: ServerRunIo = {
  uid: () => auth.currentUser?.uid ?? null,
  isEnabled: () => readServerRunsFlag(),
  createRun: async (runId, record) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('signed out');
    await setDoc(doc(db, 'users', uid, 'pricingRuns', runId), record);
  },
  deleteRun: async (runId) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'pricingRuns', runId));
  },
  watchRun: (runId, onChange, onError) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      onError(new Error('signed out'));
      return () => {};
    }
    return onSnapshot(
      doc(db, 'users', uid, 'pricingRuns', runId),
      (snap) => onChange(snap.exists() ? (snap.data() as PricingRunRecord) : null),
      onError,
    );
  },
  cancelIfQueued: async (runId) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    const ref = doc(db, 'users', uid, 'pricingRuns', runId);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || (snap.data() as PricingRunRecord).status !== 'queued') return false;
      tx.update(ref, { status: 'cancelled', updatedAt: new Date().toISOString() });
      return true;
    });
  },
  setForeground: async (runId, foreground) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(
      doc(db, 'users', uid, 'pricingRuns', runId),
      { foreground, updatedAt: new Date().toISOString() },
      { merge: true },
    );
  },
  fetchQuote: (quoteId) => firestoreService.getQuote(quoteId),
  subscribeAppState: (listener) => {
    const sub = AppState.addEventListener('change', (state) => listener(String(state)));
    return () => sub.remove();
  },
  now: () => Date.now(),
  platform: Platform.OS,
};

/**
 * Run the pipeline on the server and wait for it, streaming progress. Never
 * throws: a failed run comes back as { kind: 'failed' }, and anything that
 * means the server never had it comes back as { kind: 'unavailable' }.
 */
export async function runPipelineOnServer(
  request: ServerRunRequest,
  callbacks: { onProgress?: (status: WorkingStatus) => void } = {},
  io: ServerRunIo = defaultServerRunIo,
): Promise<ServerRunOutcome> {
  const uid = io.uid();
  if (!uid) return { kind: 'unavailable', reason: 'signed out' };
  if (!(await io.isEnabled())) return { kind: 'unavailable', reason: 'disabled' };

  const runId = generateId();
  const createdAt = new Date(io.now()).toISOString();
  const record: PricingRunRecord = {
    quoteId: request.quoteId,
    kind: request.kind,
    options: request.options,
    status: 'queued',
    foreground: true,
    createdAt,
    updatedAt: createdAt,
    progress: { phase: 'preflight', status: 'Getting ready…', done: false, runsOnServer: true },
    clientPlatform: io.platform,
  };

  try {
    await withTimeout(io.createRun(runId, record), CREATE_TIMEOUT_MS, 'create timed out');
  } catch (err) {
    // The write is queued locally when offline; it would still create the run
    // once the network returns, so take it back. A delete queued behind a
    // create nets out to nothing on the server.
    io.deleteRun(runId).catch(() => {});
    return { kind: 'unavailable', reason: err instanceof Error ? err.message : 'create failed' };
  }

  return new Promise<ServerRunOutcome>((resolve) => {
    let settled = false;
    let claimed = false;
    let lastProgressAt = io.now();
    let unsubscribeWatch: (() => void) | null = null;
    let unsubscribeAppState: (() => void) | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (outcome: ServerRunOutcome) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      unsubscribeWatch?.();
      unsubscribeAppState?.();
      resolve(outcome);
    };

    const fallBack = async (reason: string) => {
      if (settled) return;
      let cancelled = false;
      try {
        cancelled = await withTimeout(io.cancelIfQueued(runId), CREATE_TIMEOUT_MS, 'cancel timed out');
      } catch {
        // Couldn't reach Firestore. Take the run back the same way a failed
        // create is taken back; if the server already has it, its later
        // writes simply recreate the document.
        io.deleteRun(runId).catch(() => {});
        cancelled = true;
      }
      if (cancelled) {
        finish({ kind: 'unavailable', reason });
      }
      // Not cancelled: the server claimed it in the meantime. Keep waiting.
    };

    // The queue watchdog: nothing has claimed the run.
    timers.push(
      setTimeout(() => {
        if (!claimed) void fallBack('no server pickup');
      }, QUEUE_TIMEOUT_MS),
    );
    // The stale watchdog: claimed, then silence.
    const staleCheck = () => {
      if (settled) return;
      if (claimed && io.now() - lastProgressAt >= STALE_TIMEOUT_MS) {
        finish({ kind: 'failed', error: 'The server stopped reporting progress.' });
        return;
      }
      timers.push(setTimeout(staleCheck, 15_000));
    };
    timers.push(setTimeout(staleCheck, 15_000));
    timers.push(
      setTimeout(() => finish({ kind: 'failed', error: 'Pricing timed out.' }), HARD_TIMEOUT_MS),
    );

    unsubscribeAppState = io.subscribeAppState((state) => {
      if (settled) return;
      // 'inactive' precedes 'background' on an iOS lock and gives the write
      // the most time to leave the phone before JavaScript is frozen.
      const foreground = state === 'active';
      io.setForeground(runId, foreground).catch(() => {});
    });

    unsubscribeWatch = io.watchRun(
      runId,
      (latest) => {
        if (settled) return;
        if (!latest) return; // Our own create hasn't echoed yet, or it was taken back.
        if (latest.status !== 'queued') {
          claimed = true;
          lastProgressAt = io.now();
        }
        if (latest.progress) {
          callbacks.onProgress?.({ ...latest.progress, runsOnServer: true });
        }
        if (latest.status === 'done') {
          const result = latest.result;
          if (!result) {
            finish({ kind: 'failed', error: 'The run finished without a result.' });
            return;
          }
          io.fetchQuote(request.quoteId).then(
            (quote) => {
              if (!quote) {
                finish({ kind: 'failed', error: 'The priced quote could not be read back.' });
                return;
              }
              finish({ kind: 'done', result, quote });
            },
            (err) => finish({ kind: 'failed', error: err instanceof Error ? err.message : 'read failed' }),
          );
          return;
        }
        if (latest.status === 'failed') {
          finish({ kind: 'failed', error: latest.error || 'Pricing failed on the server.' });
          return;
        }
        if (latest.status === 'cancelled') {
          finish({ kind: 'failed', error: 'Pricing was cancelled.' });
        }
      },
      (err) => {
        if (claimed) {
          finish({ kind: 'failed', error: err instanceof Error ? err.message : 'watch failed' });
        } else {
          void fallBack('watch failed');
        }
      },
    );
  });
}
