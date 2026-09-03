/**
 * Server-side pricing run.
 *
 * Mate's "Price it up" used to run the whole materials + pricing pipeline in
 * the phone's JavaScript, held awake by a wake lock. Lock the phone or switch
 * apps and iOS froze the run within seconds; on resume the in-flight scraper
 * call had died and the tradie got an unpriced draft with a "tap Fetch Prices"
 * note. The run also could not tell the tradie it had finished, because the
 * thing that would have sent the notification was the thing that had stopped.
 *
 * Now the phone writes a run document (users/{uid}/pricingRuns/{runId}) and
 * this module executes the SAME pipeline (shared/pricing/pipeline.ts) inside a
 * Cloud Function, streaming the working-card status into that document and
 * writing the priced quote back where the app's realtime listener picks it
 * up. If the phone has gone to the background by the time the run finishes, a
 * push tells the tradie the quote is ready.
 *
 * Everything that touches Firestore or sends a push arrives through
 * PricingRunStore so the orchestration is unit-testable; the Firestore
 * binding lives at the bottom of this file.
 */

import type * as admin from 'firebase-admin';
import {
  fetchPricesForQuote,
  generateMaterialsForQuote,
  PipelineCancelled,
  type PipelineDeps,
} from './shared/pricing/pipeline';
import { pricingEventToProgress, type WorkingStatus } from './shared/pricing/progress';
import {
  recalculateQuoteTotals,
  stripLabourFromQuote,
  type RecalculableQuote,
} from './shared/pricing/documentTotals';
import type { PricingBusinessSettings, PricingQuote } from './shared/pricing/types';
import type { PricingRunRecord, PricingRunResult } from './shared/pricing/pricingRunDoc';
import { summarisePriceCounts } from './shared/pricing/progress';
import { stripUndefined } from './documentMirror';

export type { PricingRunRecord, PricingRunResult } from './shared/pricing/pricingRunDoc';

/** Gen1 Firestore triggers cap at nine minutes; a normal run is 15–60 s. */
export const PRICING_RUN_TIMEOUT_SECONDS = 540;
/** Runs one user may start inside RATE_WINDOW_MS before the server refuses. */
export const MAX_RUNS_PER_WINDOW = 8;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
/** Progress writes are coalesced to at most one per this many milliseconds. */
export const PROGRESS_WRITE_INTERVAL_MS = 600;
/**
 * The phone re-stamps foregroundAt every 20 s while it is in front. A stamp
 * older than this means the phone went away (or its "I'm away" write never
 * left it), and either way the tradie isn't watching the card.
 */
export const FOREGROUND_STALE_MS = 45_000;

export type PricingRunNotifyEvent = 'quote_priced' | 'quote_pricing_snag';

/** A quote as stored under users/{uid}/quotes — the pipeline's slice plus whatever else is on it. */
export type StoredQuote = PricingQuote &
  RecalculableQuote & {
    draftStep?: string;
    jobId?: string;
    [key: string]: unknown;
  };

export interface PricingRunStore {
  /** Atomically move the run from queued to running. Null when it isn't ours to run. */
  claim(): Promise<PricingRunRecord | null>;
  /** Merge fields onto the run document. */
  update(patch: Record<string, unknown>): Promise<void>;
  /** A fresh read of the run document. */
  read(): Promise<PricingRunRecord | null>;
  /** How many of this user's runs the server claimed at or after the given time. */
  runsStartedSince(sinceMs: number): Promise<number>;
  loadQuote(quoteId: string): Promise<StoredQuote | null>;
  /** Merge fields onto the quote document. */
  saveQuote(quoteId: string, patch: Record<string, unknown>): Promise<void>;
  loadBusinessSettings(): Promise<PricingBusinessSettings | null>;
  notify(
    event: PricingRunNotifyEvent,
    vars: Record<string, string>,
    data: Record<string, string>,
  ): Promise<void>;
  now(): number;
}

export interface PricingRunLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NaN/Infinity become 0 so they never reach the document — the same walk the
 * app's saveDraft does (sanitizeNonFiniteNumbers in src/store/useStore.ts),
 * after a single non-finite section value once poisoned a whole quote's totals.
 */
export function scrubNonFinite<T>(value: T): T {
  if (typeof value === 'number') return (Number.isFinite(value) ? value : 0) as unknown as T;
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrubNonFinite) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = scrubNonFinite(entry);
  return out as T;
}

/**
 * The fields a run writes back to the quote: the rows and hours the pipeline
 * produced, the wizard step marker, and totals recomputed exactly as the app
 * would (see recalculateQuoteTotals). Everything else on the quote is left to
 * the merge.
 */
export function quotePatch(quote: StoredQuote, nowMs: number): Record<string, unknown> {
  const recalculated = recalculateQuoteTotals(quote);
  const iso = new Date(nowMs).toISOString();
  return stripUndefined(
    scrubNonFinite({
      materials: recalculated.materials,
      sections: recalculated.sections ?? [],
      laborHours: recalculated.laborHours,
      job: recalculated.job,
      ...(recalculated.draftStep ? { draftStep: recalculated.draftStep } : {}),
      materialsSubtotal: recalculated.materialsSubtotal,
      laborTotal: recalculated.laborTotal,
      subtotal: recalculated.subtotal,
      markupAmount: recalculated.markupAmount,
      gst: recalculated.gst,
      total: recalculated.total,
      updatedAt: iso,
      syncedAt: iso,
    }),
  );
}

/**
 * A push is only worth sending to a tradie who isn't looking at the card.
 * "Away" is the phone saying so, OR the phone having gone quiet: its
 * "I'm away" write is fired as iOS suspends it and can be lost, and the safe
 * failure is a redundant banner, never silence for the one push the tradie
 * explicitly asked for.
 */
export function shouldNotify(record: PricingRunRecord | null, nowMs: number): boolean {
  if (!record) return false;
  if (record.foreground === false) return true;
  const stampedAt = record.foregroundAt ? Date.parse(record.foregroundAt) : Number.NaN;
  if (!Number.isFinite(stampedAt)) return true;
  return nowMs - stampedAt > FOREGROUND_STALE_MS;
}

/** AUD, whole dollars for a push body. */
export function formatAud(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * Coalesces the pipeline's rapid per-item events into at most one Firestore
 * write per PROGRESS_WRITE_INTERVAL_MS, always carrying the merged state so a
 * dropped intermediate never loses the phase headline. Writes are serialised
 * and never awaited by the pipeline; finish() drains them.
 */
export class ProgressWriter {
  private current: WorkingStatus;
  private lastWriteAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: Pick<PricingRunStore, 'update' | 'now'>,
    initial: WorkingStatus,
    private readonly intervalMs: number = PROGRESS_WRITE_INTERVAL_MS,
  ) {
    this.current = initial;
  }

  get status(): WorkingStatus {
    return this.current;
  }

  report(next: Partial<WorkingStatus>): void {
    this.current = { ...this.current, ...next };
    const now = this.store.now();
    if (now - this.lastWriteAt < this.intervalMs) return;
    this.lastWriteAt = now;
    this.enqueue(this.current, {});
  }

  /** Write the final state plus the run-level patch, after everything queued. */
  async finish(final: Partial<WorkingStatus>, patch: Record<string, unknown>): Promise<void> {
    this.current = { ...this.current, ...final };
    this.enqueue(this.current, patch);
    await this.chain;
  }

  private enqueue(status: WorkingStatus, patch: Record<string, unknown>): void {
    const write = {
      progress: stripUndefined({ ...status }),
      updatedAt: new Date(this.store.now()).toISOString(),
      ...patch,
    };
    this.chain = this.chain.then(() => this.store.update(write)).catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

export type PricingRunOutcome = 'done' | 'failed' | 'cancelled' | 'skipped';

export async function runPricingRun(args: {
  store: PricingRunStore;
  deps: PipelineDeps;
  log?: PricingRunLogger;
}): Promise<PricingRunOutcome> {
  const { store, deps } = args;
  const log = args.log ?? console;

  // At-least-once delivery: a redelivered event must not price the quote twice.
  const run = await store.claim();
  if (!run) return 'skipped';

  const progress = new ProgressWriter(
    store,
    run.progress ?? { phase: 'preflight', status: 'Getting ready…', done: false, runsOnServer: true },
  );
  const iso = () => new Date(store.now()).toISOString();
  let jobName = 'that quote';
  let jobId: string | undefined;

  const notifyIfAway = async (
    event: PricingRunNotifyEvent,
    vars: Record<string, string>,
  ): Promise<void> => {
    try {
      const latest = await store.read();
      if (!shouldNotify(latest, store.now())) return;
      await store.notify(event, vars, {
        quoteId: run.quoteId,
        ...(jobId ? { jobId } : {}),
      });
    } catch (err) {
      log.warn('[pricingRun] push failed', { quoteId: run.quoteId, message: String((err as Error)?.message || err) });
    }
  };

  try {
    // A phone can create run documents as fast as it likes; each one costs
    // LLM and scraper calls. The HTTP handlers rate-limit per user, so this
    // path needs a ceiling too. Only claimed runs count — one the phone
    // cancelled at the queue timeout cost nothing.
    const recent = await store.runsStartedSince(store.now() - RATE_WINDOW_MS);
    if (recent > MAX_RUNS_PER_WINDOW) {
      throw new Error('Too many pricing runs in a short time — give it a few minutes and try again.');
    }

    const quote = await store.loadQuote(run.quoteId);
    if (!quote) throw new Error('Quote not found — it may have been deleted before pricing started.');
    if (!quote.job?.description) throw new Error('Quote has no job description — add a scope first.');
    jobName = quote.job.name || jobName;
    jobId = typeof quote.jobId === 'string' ? quote.jobId : undefined;

    const businessSettings = await store.loadBusinessSettings();
    const templates = await deps.loadTemplates();
    progress.report({ phase: 'preflight', status: 'Getting ready…', runsOnServer: true });

    // ── Phase 1: analyse ──
    const analysed = await generateMaterialsForQuote(
      deps,
      { quote, businessSettings, isPro: run.options.isPro, templates },
      { onEvent: (event) => progress.report({ phase: event.phase, status: event.status, detail: event.detail }) },
    );
    let next: StoredQuote = analysed.updatedQuote;
    if (run.options.stripLabour) next = stripLabourFromQuote(next);
    if (run.options.labourOnly) {
      next = { ...next, materials: next.materials.filter((m) => m.kind === 'work') };
    }
    const generatedMaterialCount = run.options.labourOnly ? 0 : analysed.generatedMaterialCount;

    if (run.options.labourOnly) {
      await store.saveQuote(run.quoteId, quotePatch({ ...next, draftStep: 'JobPreview' }, store.now()));
      const result: PricingRunResult = {
        generatedMaterialCount: 0,
        fetchedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        missedSupplierTerms: [],
        reeceReauthNeeded: false,
      };
      await progress.finish(
        {
          phase: 'done',
          status: 'Labour only — nothing to price.',
          detail: undefined,
          items: undefined,
          done: true,
          summary: 'Labour only — hours and sections, no materials list.',
        },
        { status: 'done', result, finishedAt: iso() },
      );
      await notifyIfAway('quote_priced', { job: jobName, amount: formatAud(Number(next.total) || 0) });
      return 'done';
    }

    // The analysed rows are persisted before pricing, as the app does, so a
    // snag mid-pricing still leaves the gear list on the quote.
    await store.saveQuote(run.quoteId, quotePatch(next, store.now()));
    progress.report({
      phase: 'pricing',
      status: `Pricing ${generatedMaterialCount} item${generatedMaterialCount === 1 ? '' : 's'}…`,
      detail: undefined,
    });

    // ── Phase 2: pricing ──
    const missedSupplierTerms: string[] = [];
    const priced = await fetchPricesForQuote(
      deps,
      { quote: next, businessSettings, reeceConnected: null },
      {
        onEvent: (event) => {
          if (event.kind === 'supplier-priority-fallback') {
            missedSupplierTerms.push(...event.missedTerms);
          }
          const mapped = pricingEventToProgress(event);
          if (mapped) progress.report(mapped);
        },
      },
    );

    // Finished but unsent — the wizard step the dashboard banner and the
    // unsent-quote nudge both key on.
    const final: StoredQuote = { ...priced.updatedQuote, draftStep: 'JobPreview' };
    await store.saveQuote(run.quoteId, quotePatch(final, store.now()));

    const result: PricingRunResult = {
      generatedMaterialCount,
      fetchedCount: priced.fetchedCount,
      failedCount: priced.failedCount,
      skippedCount: priced.skippedCount,
      missedSupplierTerms,
      reeceReauthNeeded: priced.reeceReauthNeeded,
    };
    await progress.finish(
      {
        phase: 'done',
        status: `Drafted ${generatedMaterialCount} item${generatedMaterialCount === 1 ? '' : 's'}.`,
        detail: undefined,
        items: undefined,
        done: true,
        summary: summarisePriceCounts(result),
      },
      { status: 'done', result, finishedAt: iso() },
    );
    log.info('[pricingRun] done', { quoteId: run.quoteId, ...result, missedSupplierTerms: missedSupplierTerms.length });
    await notifyIfAway('quote_priced', {
      job: jobName,
      amount: formatAud(Number(recalculateQuoteTotals(final).total) || 0),
      count: `${generatedMaterialCount} item${generatedMaterialCount === 1 ? '' : 's'}`,
    });
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PipelineCancelled) {
      await progress.finish(
        { phase: 'failed', status: 'Pricing was cancelled.', done: true },
        { status: 'cancelled', finishedAt: iso() },
      );
      return 'cancelled';
    }
    log.error('[pricingRun] failed', { quoteId: run.quoteId, message });
    // The draft exists but its prices don't. Park it on the wizard step that
    // carries Fetch Prices so the dashboard banner can resume it.
    try {
      await store.saveQuote(run.quoteId, { draftStep: 'MaterialsList', updatedAt: iso() });
    } catch {
      // Best-effort — the run record carries the failure regardless.
    }
    await progress.finish(
      { phase: 'failed', status: "Couldn't finish pricing that one.", detail: message, done: true },
      { status: 'failed', error: message, finishedAt: iso() },
    );
    await notifyIfAway('quote_pricing_snag', { job: jobName });
    return 'failed';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore binding
// ─────────────────────────────────────────────────────────────────────────────

export function firestorePricingRunStore(args: {
  db: admin.firestore.Firestore;
  uid: string;
  runId: string;
  notify: PricingRunStore['notify'];
}): PricingRunStore {
  const { db, uid, runId } = args;
  const runRef = db.doc(`users/${uid}/pricingRuns/${runId}`);
  const quoteRef = (quoteId: string) => db.doc(`users/${uid}/quotes/${quoteId}`);
  return {
    now: () => Date.now(),
    claim: () =>
      db.runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (!snap.exists) return null;
        const data = snap.data() as PricingRunRecord;
        if (data.status !== 'queued') return null;
        const startedAt = new Date().toISOString();
        tx.update(runRef, { status: 'running', startedAt, updatedAt: startedAt });
        return { ...data, status: 'running', startedAt };
      }),
    update: async (patch) => {
      await runRef.set(patch, { merge: true });
    },
    read: async () => {
      const snap = await runRef.get();
      return snap.exists ? (snap.data() as PricingRunRecord) : null;
    },
    runsStartedSince: async (sinceMs) => {
      // startedAt is only ever written by claim(), so this counts runs the
      // server actually took, not ones the phone cancelled unclaimed.
      const snap = await db
        .collection(`users/${uid}/pricingRuns`)
        .where('startedAt', '>=', new Date(sinceMs).toISOString())
        .count()
        .get();
      return snap.data().count;
    },
    loadQuote: async (quoteId) => {
      const snap = await quoteRef(quoteId).get();
      return snap.exists ? (snap.data() as StoredQuote) : null;
    },
    saveQuote: async (quoteId, patch) => {
      await quoteRef(quoteId).set(patch, { merge: true });
    },
    loadBusinessSettings: async () => {
      const snap = await db.doc(`users/${uid}/settings/business`).get();
      return snap.exists ? (snap.data() as PricingBusinessSettings) : null;
    },
    notify: args.notify,
  };
}
