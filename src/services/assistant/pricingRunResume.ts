/**
 * Picking the thread back up after the app died mid-run.
 *
 * Chat history is in-memory, so an app kill during a server-side pricing run
 * loses the working card and — worse — the "[context]" note that tells Mate
 * the quote exists and is priced. The next chat would happily draft the same
 * job again. The phone keeps a ledger of runs it started (pricingRunLedger);
 * when the next conversation opens, each unsettled run is read back from the
 * server and turned into a card the tradie can act on plus the note Mate
 * would have had.
 *
 * The decision is pure (resumePlanFor); the orchestration around it takes
 * every side effect through ResumeDeps.
 */

import type { ChatMessage, WorkingStatus } from '../../types/assistant';
import type { PricingRunRecord } from '../../../shared/pricing/pricingRunDoc';
import { summarisePriceCounts } from '../../../shared/pricing/progress';
import { formatCurrency } from '../../utils/quoteCalculator';
import { generateId } from '../../utils/generateId';
import type { LedgerEntry } from '../pricingRunLedger';
import { STALE_TIMEOUT_MS, watchServerRun, type ServerRunIo, type ServerRunOutcome } from '../serverPricingRun';

export type ResumePlan =
  /** Nothing to say — the run document is gone (taken back, or never created). */
  | { kind: 'drop' }
  /** Still going on the server: re-attach and show the live card. */
  | { kind: 'watch' }
  | {
      kind: 'card';
      working: WorkingStatus;
      text: string;
      ctaLabel: string;
      note: string;
      /** A queued run nobody ever claimed is cancelled so it can't start later behind the tradie's back. */
      cancel?: boolean;
    };

const jobLabel = (entry: LedgerEntry) => entry.jobName?.trim() || 'that quote';

function doneCard(entry: LedgerEntry, record: PricingRunRecord, quoteTotal: number | undefined): ResumePlan {
  const result = record.result;
  const counts = result ? summarisePriceCounts(result) : 'priced';
  const items = result ? `${result.generatedMaterialCount} item${result.generatedMaterialCount === 1 ? '' : 's'}` : 'the gear list';
  const money = typeof quoteTotal === 'number' && quoteTotal > 0 ? `, ${formatCurrency(quoteTotal)} all up` : '';
  const job = jobLabel(entry);
  return {
    kind: 'card',
    working: { phase: 'done', status: 'Priced up while you were away.', done: true, summary: counts },
    text: `${job}'s priced — ${items}${money}. Tap to open it, or tell me what to tweak.`,
    ctaLabel: 'Open the quote',
    note:
      `[context] Quote ${entry.quoteId} ("${job}") finished pricing while the app was closed — ${counts}. ` +
      `It's priced and saved. Reference this id on follow-ups; do NOT draft a new quote for the same job — ` +
      `a scope change goes through propose_update_quote_scope on ${entry.quoteId}.`,
  };
}

function snagCard(entry: LedgerEntry, reason: string, cancel = false): ResumePlan {
  const job = jobLabel(entry);
  return {
    kind: 'card',
    working: {
      phase: 'failed',
      status: "Couldn't finish pricing that one while you were away.",
      detail: 'Your gear list is saved.',
      done: true,
    },
    text: `Couldn't finish pricing ${job} while you were away — your gear list is saved. Tap to open it and hit Continue Quote, or tell me to have another go.`,
    ctaLabel: 'Open the quote',
    note:
      `[context] Pricing for quote ${entry.quoteId} ("${job}") did not finish while the app was closed (${reason}). ` +
      `The draft and its gear list are saved on the Fetch Prices step. Reference this id; do NOT draft a new quote ` +
      `for the same job — offer propose_reprice on ${entry.quoteId} if they want another go.`,
    cancel,
  };
}

export function resumePlanFor(
  entry: LedgerEntry,
  record: PricingRunRecord | null,
  context: { nowMs: number; quoteTotal?: number },
): ResumePlan {
  if (!record) return { kind: 'drop' };
  switch (record.status) {
    case 'done':
      return doneCard(entry, record, context.quoteTotal);
    case 'failed':
      return snagCard(entry, record.error || 'the server reported a failure');
    case 'cancelled':
      return snagCard(entry, 'the run was cancelled');
    case 'queued':
      // The phone died before its queue watchdog could fall back, and no
      // function ever claimed it.
      return snagCard(entry, 'nothing picked the run up', true);
    case 'running': {
      const lastHeard = Date.parse(record.updatedAt || record.startedAt || record.createdAt);
      const quiet = Number.isFinite(lastHeard) ? context.nowMs - lastHeard : Number.POSITIVE_INFINITY;
      return quiet > STALE_TIMEOUT_MS ? snagCard(entry, 'the server stopped reporting progress') : { kind: 'watch' };
    }
    default:
      return { kind: 'drop' };
  }
}

/** The card the watcher's outcome becomes, once a re-attached run settles. */
export function planForOutcome(entry: LedgerEntry, outcome: ServerRunOutcome, quoteTotal: number | undefined): ResumePlan {
  if (outcome.kind === 'done') {
    return doneCard(entry, { status: 'done', result: outcome.result } as PricingRunRecord, quoteTotal);
  }
  if (outcome.kind === 'failed') return snagCard(entry, outcome.error);
  return snagCard(entry, outcome.reason);
}

export interface ResumeDeps {
  io: ServerRunIo;
  now(): number;
  /** The quote's total as the phone currently knows it, for the card's money line. */
  quoteTotal(quoteId: string): number | undefined;
  appendMessage(message: ChatMessage): void;
  updateMessage(messageId: string, patch: Partial<ChatMessage>): void;
  noteToMate(text: string): void;
}

let resumedThisLaunch = false;

/** Test seam — the once-per-process latch. */
export function __resetPricingRunResume(): void {
  resumedThisLaunch = false;
}

/**
 * Show every unsettled run from a previous app process in the current chat.
 * Runs once per app process: a chat that already carries the cards doesn't
 * need them again, and a run this process started is still being watched.
 * Returns how many runs were surfaced.
 */
export async function resumeUnfinishedPricingRuns(deps: ResumeDeps): Promise<number> {
  if (resumedThisLaunch) return 0;
  resumedThisLaunch = true;
  if (!deps.io.uid()) return 0;

  let entries: LedgerEntry[] = [];
  try {
    entries = await deps.io.ledger.unsettled(deps.now());
  } catch {
    return 0;
  }
  let surfaced = 0;

  const showCard = (plan: Extract<ResumePlan, { kind: 'card' }>, entry: LedgerEntry, cardId?: string) => {
    const working: ChatMessage = {
      id: cardId ?? generateId(),
      role: 'assistant',
      text: '',
      createdAt: new Date(deps.now()).toISOString(),
      working: plan.working,
    };
    if (cardId) deps.updateMessage(cardId, { working: plan.working });
    else deps.appendMessage(working);
    deps.appendMessage({
      id: generateId(),
      role: 'assistant',
      text: plan.text,
      createdAt: new Date(deps.now()).toISOString(),
      cta: { label: plan.ctaLabel, action: { type: 'open_quote', quoteId: entry.quoteId } },
    });
    deps.noteToMate(plan.note);
  };

  for (const entry of entries) {
    let record: PricingRunRecord | null = null;
    try {
      record = await deps.io.readRun(entry.runId);
    } catch {
      // Offline: leave the ledger entry for next time.
      continue;
    }
    const plan = resumePlanFor(entry, record, { nowMs: deps.now(), quoteTotal: deps.quoteTotal(entry.quoteId) });
    if (plan.kind === 'drop') {
      deps.io.ledger.settled(entry.runId).catch(() => {});
      continue;
    }
    surfaced += 1;
    if (plan.kind === 'card') {
      showCard(plan, entry);
      if (plan.cancel) deps.io.cancelIfQueued(entry.runId).catch(() => {});
      deps.io.ledger.settled(entry.runId).catch(() => {});
      continue;
    }
    // Still running: re-attach, show the live card, and finish it like any other.
    const cardId = generateId();
    deps.appendMessage({
      id: cardId,
      role: 'assistant',
      text: '',
      createdAt: new Date(deps.now()).toISOString(),
      working: { ...(record?.progress ?? { phase: 'pricing', status: 'Still pricing…', done: false }), runsOnServer: true },
    });
    void watchServerRun(
      entry.runId,
      entry.quoteId,
      { onProgress: (status) => deps.updateMessage(cardId, { working: status }) },
      deps.io,
      { initiallyClaimed: true },
    ).then((outcome) => {
      const final = planForOutcome(entry, outcome, deps.quoteTotal(entry.quoteId));
      if (final.kind === 'card') showCard(final, entry, cardId);
      deps.io.ledger.settled(entry.runId).catch(() => {});
    });
  }
  return surfaced;
}
