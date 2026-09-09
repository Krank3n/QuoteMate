/**
 * Collecting an analyse the last app process sent and never lived to see.
 *
 * The handoff (analyseHandoff) covers a response lost by the process that
 * asked for it. This covers the process itself being gone: the OS killed
 * the app mid-analyse, the request id died with its memory, and the server
 * finished anyway and parked the result. On the next launch, every request
 * in the analyse ledger is read back from the server and — if it finished —
 * applied to its draft through the very same generateMaterialsForQuote the
 * live run would have used, so rates, sections and hours land identically.
 *
 * The draft is then parked on the MaterialsList step: the dashboard's draft
 * banner keys on draftStep, so "Continue Quote" opens straight onto the gear
 * list with Fetch Prices waiting. No chat plumbing — the wizard's "Build my
 * list" is a caller too, and it has no chat.
 *
 * What a resume must never do, each of which the first cut got wrong:
 *   - land on a quote that is no longer an untouched draft — one that was
 *     sent, invoiced, or given rows by hand — because a gap-fill result
 *     generated against an EMPTY quote replaces whatever is there now;
 *   - decide from a snapshot taken BEFORE the wait: the wait can run for
 *     minutes on a still-running run, and the tradie may have opened the
 *     draft and built it themselves in the meantime;
 *   - touch the quote the tradie has open right now, or swap the wizard's
 *     currentQuote under them — the save is a background write;
 *   - delete the parked copy before the draft is safely persisted.
 *
 * Every side effect goes through AnalyseResumeDeps, so the decisions are
 * testable without a store, Firestore or a device.
 */

import type { Quote } from '../types';
import { HANDOFF_DEADLINE_MS } from '../../shared/pricing/analyseRunDoc';
import { waitForParkedAnalyse, type AnalyseHandoffIo, type ParkedAnalyse } from './analyseHandoff';
import type { AnalyseLedgerEntry } from './analyseLedger';

export interface AnalyseResumeDeps {
  now(): number;
  unsettled(nowMs: number): Promise<AnalyseLedgerEntry[]>;
  settled(requestId: string): Promise<void>;
  /** The phone's copy of the draft AS OF NOW, or nothing if it's gone. Read more than once. */
  findQuote(quoteId: string): Quote | undefined;
  /** The quote the tradie has open in the wizard or chat right now, if any. */
  currentQuoteId(): string | undefined;
  /** Runs the analyse pipeline over the parked payload; resolves with the populated quote. */
  applyParked(quote: Quote, resume: { requestId: string; result: Record<string, unknown> }): Promise<Quote>;
  /** Persist WITHOUT making the quote current — a background write, not a wizard action. */
  persist(quote: Quote): Promise<void>;
  /** Drop the server's parked copy — called only once the draft is persisted. */
  forgetParked(requestId: string): void;
  /** The handoff reader — injectable so the wait can be driven in tests. */
  handoffIo?: AnalyseHandoffIo;
}

export type AnalyseResumeOutcome =
  | 'applied'
  /** Nothing to do for this entry; it is settled and forgotten. */
  | 'dropped'
  /** Not now, maybe later: the entry stays for the next launch. */
  | 'deferred';

/**
 * Why a parked analyse may not land on this quote right now.
 *   'permanent' — sent, invoiced, gone, or already has rows: never resumable.
 *   'transient' — open on screen right now: try again on a later launch.
 * Pure, and re-evaluated after the wait — see resumeOne.
 */
export function resumeBlocker(
  quote: Quote | undefined,
  currentQuoteId: string | undefined,
): 'permanent' | 'transient' | null {
  if (!quote) return 'permanent';
  if (quote.status !== 'draft') return 'permanent';
  if (quote.sentAt || quote.invoiceId || quote.invoicedAt) return 'permanent';
  if ((quote.materials?.length ?? 0) > 0) return 'permanent';
  if (currentQuoteId && quote.id === currentQuoteId) return 'transient';
  return null;
}

/** The only quote a parked analyse may land on. */
export function isResumableDraft(quote: Quote | undefined, currentQuoteId: string | undefined): boolean {
  return resumeBlocker(quote, currentQuoteId) === null;
}

/**
 * What to do with one ledger entry given the draft as the phone has it NOW
 * and what the server parked. Pure, so every branch can be pinned down.
 */
export function planAnalyseResume(
  quote: Quote | undefined,
  currentQuoteId: string | undefined,
  parked: ParkedAnalyse,
): { kind: 'apply'; result: Record<string, unknown> } | { kind: 'drop' } | { kind: 'defer' } {
  // Offline, signed out, or the read itself failed: not the server's verdict,
  // so the entry keeps its place in the ledger — even if the draft looks
  // unresumable right now, it may be resumable on a later launch.
  if (parked.kind === 'gone' && parked.reason === 'could not read the parked result') return { kind: 'defer' };
  const blocker = resumeBlocker(quote, currentQuoteId);
  if (blocker === 'transient') return { kind: 'defer' };
  if (blocker === 'permanent') return { kind: 'drop' };
  if (parked.kind === 'done') return { kind: 'apply', result: parked.result };
  // Still running on the server past this launch's patience: keep the entry,
  // a later launch may find it finished.
  if (parked.kind === 'gone' && parked.reason === 'still running') return { kind: 'defer' };
  return { kind: 'drop' };
}

let resumedThisLaunch = false;

/**
 * Forget that this process already resumed. Called on sign-out / account
 * switch, so the next sign-in in the same process gets its own pass.
 */
export function resetAnalyseResume(): void {
  resumedThisLaunch = false;
}

/** Test seam — same latch. */
export const __resetAnalyseResume = resetAnalyseResume;

/**
 * Collect every analyse a previous process sent and apply the ones that
 * finished. Once per app process (until reset): an analyse THIS process
 * sends is still being waited on by the code that sent it. Returns how many
 * were applied.
 */
export async function resumeUnfinishedAnalyses(deps: AnalyseResumeDeps): Promise<number> {
  if (resumedThisLaunch) return 0;
  resumedThisLaunch = true;

  let entries: AnalyseLedgerEntry[] = [];
  try {
    entries = await deps.unsettled(deps.now());
  } catch {
    return 0;
  }

  let applied = 0;
  for (const entry of entries) {
    const outcome = await resumeOne(entry, deps);
    if (outcome === 'applied') applied += 1;
    if (outcome !== 'deferred') deps.settled(entry.requestId).catch(() => {});
  }
  return applied;
}

async function resumeOne(entry: AnalyseLedgerEntry, deps: AnalyseResumeDeps): Promise<AnalyseResumeOutcome> {
  // Cheap skip before the read: a draft that can never take the result
  // costs nothing, and one that's open on screen waits for another launch.
  // NOT the decision — that is made again below, on a fresh copy.
  const before = resumeBlocker(deps.findQuote(entry.quoteId), deps.currentQuoteId());
  if (before === 'permanent') return 'dropped';
  if (before === 'transient') return 'deferred';

  // Nobody is watching a card here, so the wait may run to the server's own
  // deadline rather than the in-process cap.
  const parked = await waitForParkedAnalyse(entry.requestId, entry.sentAt, deps.handoffIo, {
    maxWaitMs: HANDOFF_DEADLINE_MS,
  });

  // The wait may have taken minutes. Everything about the draft is re-read
  // here; the copy from before the wait is never used again.
  const quote = deps.findQuote(entry.quoteId);
  const plan = planAnalyseResume(quote, deps.currentQuoteId(), parked);
  if (plan.kind === 'defer') return 'deferred';
  if (plan.kind === 'drop' || !quote) return 'dropped';

  try {
    const populated = await deps.applyParked(quote, { requestId: entry.requestId, result: plan.result });
    // Finished-but-unpriced: the wizard step that carries Fetch Prices, and
    // the stamp the dashboard banner keys on. A background write — it must
    // not become the wizard's current quote.
    await deps.persist({ ...populated, draftStep: 'MaterialsList' });
  } catch {
    // The payload was collected but couldn't be applied — a malformed
    // result, or a save that threw. Retrying next launch would hit the same
    // wall; let it go. The parked copy is left for the TTL, not deleted.
    return 'dropped';
  }
  // The store's save swallows its own errors, so "persist resolved" proves
  // nothing. Read the draft back: only rows that are actually there make
  // the server's copy surplus. If they aren't, leave the copy for the TTL.
  const landed = deps.findQuote(entry.quoteId);
  if (!landed || (landed.materials?.length ?? 0) === 0) return 'dropped';
  deps.forgetParked(entry.requestId);
  return 'applied';
}
