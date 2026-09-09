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
 * Every side effect goes through AnalyseResumeDeps, so the decisions are
 * testable without a store, Firestore or a device.
 */

import type { Quote } from '../types';
import { waitForParkedAnalyse, type AnalyseHandoffIo, type ParkedAnalyse } from './analyseHandoff';
import type { AnalyseLedgerEntry } from './analyseLedger';

export interface AnalyseResumeDeps {
  now(): number;
  unsettled(nowMs: number): Promise<AnalyseLedgerEntry[]>;
  settled(requestId: string): Promise<void>;
  /** The phone's copy of the draft, or nothing if it's gone. */
  findQuote(quoteId: string): Quote | undefined;
  /** Runs the analyse pipeline over the parked payload; resolves with the populated quote. */
  applyParked(quote: Quote, resume: { requestId: string; result: Record<string, unknown> }): Promise<Quote>;
  saveDraft(quote: Quote): Promise<void>;
  /** The handoff reader — injectable so the wait can be driven in tests. */
  handoffIo?: AnalyseHandoffIo;
}

export type AnalyseResumeOutcome =
  | 'applied'
  /** Nothing to do for this entry; it is settled and forgotten. */
  | 'dropped'
  /** Could not reach the server; the entry stays for next launch. */
  | 'deferred';

/**
 * What to do with one ledger entry given the draft as the phone has it and
 * what the server parked. Pure, so every branch can be pinned down.
 */
export function planAnalyseResume(
  quote: Quote | undefined,
  parked: ParkedAnalyse,
): { kind: 'apply'; result: Record<string, unknown> } | { kind: 'drop' } | { kind: 'defer' } {
  // No draft, or a draft that already has rows: a gap-fill result generated
  // against an EMPTY quote would land twice over whatever is there now.
  if (!quote || (quote.materials?.length ?? 0) > 0) return { kind: 'drop' };
  if (parked.kind === 'done') return { kind: 'apply', result: parked.result };
  // Offline, signed out, or the read itself failed: not the server's verdict,
  // so the entry keeps its place in the ledger.
  if (parked.kind === 'gone' && parked.reason === 'could not read the parked result') return { kind: 'defer' };
  return { kind: 'drop' };
}

let resumedThisLaunch = false;

/** Test seam — the once-per-process latch. */
export function __resetAnalyseResume(): void {
  resumedThisLaunch = false;
}

/**
 * Collect every analyse a previous process sent and apply the ones that
 * finished. Once per app process: an analyse THIS process sends is still
 * being waited on by the code that sent it. Returns how many were applied.
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
  // Checked before the read so a draft that no longer needs it costs nothing.
  const quote = deps.findQuote(entry.quoteId);
  if (!quote || (quote.materials?.length ?? 0) > 0) return 'dropped';

  const parked = await waitForParkedAnalyse(entry.requestId, entry.sentAt, deps.handoffIo);
  const plan = planAnalyseResume(quote, parked);
  if (plan.kind === 'defer') return 'deferred';
  if (plan.kind === 'drop') return 'dropped';

  try {
    const populated = await deps.applyParked(quote, { requestId: entry.requestId, result: plan.result });
    // Finished-but-unpriced: the wizard step that carries Fetch Prices, and
    // the stamp the dashboard banner keys on.
    await deps.saveDraft({ ...populated, draftStep: 'MaterialsList' });
    return 'applied';
  } catch {
    // The payload was collected but couldn't be applied — a malformed
    // result, or a save that threw. Retrying next launch would hit the same
    // wall, and the doc is being deleted by the collect; let it go.
    return 'dropped';
  }
}
