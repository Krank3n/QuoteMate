/**
 * Which analyse requests THIS phone sent and hasn't heard the end of.
 *
 * The analyse handoff (src/services/analyseHandoff.ts) lets the phone collect
 * a result whose HTTP response was lost — but only while the process that
 * sent the request is still alive to remember the request id. If the OS
 * kills the app mid-analyse, the id dies with its memory and the parked
 * result sits unread until the TTL reaps it. This ledger is the id's second
 * home; analyseResume reads it on the next launch.
 *
 * Same shape and lifecycle as pricingRunLedger, kept separate because the
 * two are settled by different things at different times.
 *
 * Entries older than RESUME_WINDOW_MS are dropped unread — that is also the
 * parked result's TTL, so anything older is gone from the server anyway.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ANALYSE_HANDOFF_TTL_MS } from '../../shared/pricing/analyseRunDoc';
import type { LedgerStorage } from './pricingRunLedger';

export const ANALYSE_LEDGER_KEY = '@quotemate:analyses_in_flight';
export const RESUME_WINDOW_MS = ANALYSE_HANDOFF_TTL_MS;

export interface AnalyseLedgerEntry {
  requestId: string;
  quoteId: string;
  /** Epoch ms — when the request left the phone. The handoff's clock starts here. */
  sentAt: number;
}

async function readAll(storage: LedgerStorage): Promise<Record<string, AnalyseLedgerEntry>> {
  try {
    const raw = await storage.getItem(ANALYSE_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAll(storage: LedgerStorage, entries: Record<string, AnalyseLedgerEntry>): Promise<void> {
  try {
    await storage.setItem(ANALYSE_LEDGER_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort: a missed ledger write costs a resume, nothing more.
  }
}

export async function recordAnalyseSent(entry: AnalyseLedgerEntry, storage: LedgerStorage = AsyncStorage): Promise<void> {
  const all = await readAll(storage);
  all[entry.requestId] = entry;
  await writeAll(storage, all);
}

export async function recordAnalyseSettled(requestId: string, storage: LedgerStorage = AsyncStorage): Promise<void> {
  const all = await readAll(storage);
  if (!(requestId in all)) return;
  delete all[requestId];
  await writeAll(storage, all);
}

/** Requests still unsettled and recent enough to still be parked; older ones are pruned. */
export async function listUnsettledAnalyses(nowMs: number, storage: LedgerStorage = AsyncStorage): Promise<AnalyseLedgerEntry[]> {
  const all = await readAll(storage);
  const keep: Record<string, AnalyseLedgerEntry> = {};
  const fresh: AnalyseLedgerEntry[] = [];
  for (const entry of Object.values(all)) {
    const age = nowMs - entry.sentAt;
    if (Number.isFinite(age) && age >= 0 && age <= RESUME_WINDOW_MS) {
      keep[entry.requestId] = entry;
      fresh.push(entry);
    }
  }
  if (Object.keys(keep).length !== Object.keys(all).length) await writeAll(storage, keep);
  return fresh.sort((a, b) => a.sentAt - b.sentAt);
}
