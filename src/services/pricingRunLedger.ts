/**
 * Which server-side pricing runs THIS phone started and hasn't heard the end
 * of. Chat history is in-memory, so when the app is killed mid-run the
 * working card and Mate's "pricing finished" note die with the process; the
 * quote is priced on the server but the next chat knows nothing about it —
 * and a tradie who asks again gets a second quote for the same job. This
 * ledger is what lets the next chat pick the thread back up (see
 * assistant/pricingRunResume).
 *
 * Entries older than RESUME_WINDOW_MS are dropped unread: a run from last
 * week is not news.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PRICING_RUN_LEDGER_KEY = '@quotemate:pricing_runs_in_flight';
export const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LedgerEntry {
  runId: string;
  quoteId: string;
  jobName?: string;
  /** ISO — when the phone created the run. */
  createdAt: string;
}

export interface LedgerStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

async function readAll(storage: LedgerStorage): Promise<Record<string, LedgerEntry>> {
  try {
    const raw = await storage.getItem(PRICING_RUN_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAll(storage: LedgerStorage, entries: Record<string, LedgerEntry>): Promise<void> {
  try {
    await storage.setItem(PRICING_RUN_LEDGER_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort: a missed ledger write costs a resume card, nothing more.
  }
}

export async function recordRunStarted(entry: LedgerEntry, storage: LedgerStorage = AsyncStorage): Promise<void> {
  const all = await readAll(storage);
  all[entry.runId] = entry;
  await writeAll(storage, all);
}

export async function recordRunSettled(runId: string, storage: LedgerStorage = AsyncStorage): Promise<void> {
  const all = await readAll(storage);
  if (!(runId in all)) return;
  delete all[runId];
  await writeAll(storage, all);
}

/** Runs still unsettled and recent enough to be worth mentioning; older ones are pruned. */
export async function listUnsettledRuns(nowMs: number, storage: LedgerStorage = AsyncStorage): Promise<LedgerEntry[]> {
  const all = await readAll(storage);
  const keep: Record<string, LedgerEntry> = {};
  const fresh: LedgerEntry[] = [];
  for (const entry of Object.values(all)) {
    const age = nowMs - Date.parse(entry.createdAt);
    if (Number.isFinite(age) && age >= 0 && age <= RESUME_WINDOW_MS) {
      keep[entry.runId] = entry;
      fresh.push(entry);
    }
  }
  if (Object.keys(keep).length !== Object.keys(all).length) await writeAll(storage, keep);
  return fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
