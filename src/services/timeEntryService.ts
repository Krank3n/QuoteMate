/**
 * Time Entry Service
 * Reads/writes the `users/{uid}/timeEntries/{entryId}` collection — hours
 * actually worked on a Job (see shared/time/types.ts).
 *
 * Mirrors reportService.ts: getUserId, stripUndefined, normalise, class +
 * singleton. Job-scoped queries sort client-side so no composite index is
 * needed (a missing index fails silently and entries just vanish).
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { generateId } from '../utils/generateId';
import { stripUndefined } from './reportService';
import { isDateKey, isValidEntryHours, sortEntriesNewestFirst } from '../../shared/time/hours';
import { CREW_WORKER_PREFIX, type CrewMember, type TimeEntry, type TimeEntrySource } from '../../shared/time/types';
import { stampedCost, type LabourCostSettings } from '../../shared/time/labourCost';

/**
 * The crew and cost settings an entry's cost is stamped from (see
 * stampedCost). Callers pass the business settings; without them an entry
 * just isn't stamped, and costing falls back to today's rates.
 */
export type Costing = LabourCostSettings & { crew?: CrewMember[] };

function getUserId(): string | null {
  return auth.currentUser?.uid || null;
}

/** Coerce a raw Firestore doc into a well-formed TimeEntry. */
export function normaliseTimeEntry(raw: any, id: string): TimeEntry {
  const hours = Number(raw?.hours);
  return {
    ...raw,
    id,
    userId: String(raw?.userId || ''),
    jobId: String(raw?.jobId || ''),
    date: String(raw?.date || ''),
    hours: Number.isFinite(hours) && hours > 0 ? hours : 0,
    workerId: String(raw?.workerId || raw?.userId || ''),
    billable: raw?.billable !== false,
    source: (raw?.source === 'mate' || raw?.source === 'crew_link' ? raw.source : 'manual') as TimeEntrySource,
    status: raw?.status === 'pending' ? 'pending' : undefined,
    createdAt: Number(raw?.createdAt) || 0,
    updatedAt: Number(raw?.updatedAt) || 0,
  };
}

/** What the caller supplies when logging time. */
export interface CreateTimeEntryInput {
  jobId: string;
  documentId?: string;
  date: string;
  hours: number;
  startTime?: string;
  endTime?: string;
  note?: string;
  workerName?: string;
  /** Set when the time was worked by a crew member; absent = the owner. */
  crewMemberId?: string;
  billable?: boolean;
  source?: TimeEntrySource;
}

/** Throws the message a tradie should see when an entry can't be stored. */
export function assertStorableEntry(input: Pick<CreateTimeEntryInput, 'jobId' | 'date' | 'hours'>): void {
  if (!input.jobId) throw new Error('Pick a job to log the time against.');
  if (!isDateKey(input.date)) throw new Error("That date doesn't look right.");
  if (!isValidEntryHours(input.hours)) throw new Error('Hours need to be more than 0 and no more than 24.');
}

/**
 * How long a write waits for the server before the sheet moves on. Firestore
 * queues the write either way; on bad site signal the ack can take minutes,
 * and a spinner that never stops is how the same 8 hours gets logged twice.
 */
export const WRITE_ACK_TIMEOUT_MS = 4000;

/** Wait for the write, or give up WAITING (never the write) after the timeout. */
async function settleWrite(write: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, WRITE_ACK_TIMEOUT_MS);
  });
  try {
    await Promise.race([write, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Thrown when hours sent in by crew changed or were deleted on their link
 * after this copy was loaded. Writing the old copy back would approve hours
 * they've since fixed, or bring back hours they took off.
 */
export class StaleEntryError extends Error {
  constructor(public readonly reason: 'gone' | 'changed', workerName?: string) {
    super(
      reason === 'gone'
        ? `${workerName || 'They'} deleted those hours just now.`
        : `${workerName || 'They'} changed those hours just now — have another look.`,
    );
    this.name = 'StaleEntryError';
  }
}

/**
 * Whether a waiting entry moved under us. Only crew can change an entry
 * that's waiting, and only until it's approved, so an approved one (or one
 * that was never waiting) is never stale.
 */
export function staleWaitingEntry(
  loaded: Pick<TimeEntry, 'status' | 'updatedAt'>,
  stored: { status?: unknown; updatedAt?: unknown } | undefined,
): 'gone' | 'changed' | null {
  if (loaded.status !== 'pending') return null;
  if (!stored) return 'gone';
  if (stored.status !== 'pending') return null;
  return (Number(stored.updatedAt) || 0) !== (Number(loaded.updatedAt) || 0) ? 'changed' : null;
}

class TimeEntryService {
  private colRef(uid: string) {
    return collection(db, 'users', uid, 'timeEntries');
  }

  async createEntry(input: CreateTimeEntryInput, costing?: Costing): Promise<TimeEntry> {
    const uid = getUserId();
    if (!uid) throw new Error('Not signed in');
    assertStorableEntry(input);
    const now = Date.now();
    const id = generateId();
    const note = input.note?.trim();
    const entry: TimeEntry = {
      id,
      userId: uid,
      jobId: input.jobId,
      documentId: input.documentId,
      date: input.date,
      hours: input.hours,
      startTime: input.startTime,
      endTime: input.endTime,
      note: note || undefined,
      workerId: input.crewMemberId ? `${CREW_WORKER_PREFIX}${input.crewMemberId}` : uid,
      workerName: input.workerName,
      billable: input.billable !== false,
      source: input.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
    };
    if (costing) entry.cost = stampedCost(entry, undefined, costing.crew, costing);
    await settleWrite(setDoc(doc(db, 'users', uid, 'timeEntries', id), stripUndefined(entry)));
    return entry;
  }

  /**
   * Replace an entry's editable fields. Written whole (not merged) so a
   * cleared start/finish or note actually clears. `loaded` is the copy the
   * edit started from (defaults to `entry`); if that was waiting, the write
   * fails with StaleEntryError when crew changed or deleted it since.
   */
  async updateEntry(entry: TimeEntry, loaded: TimeEntry = entry, costing?: Costing): Promise<TimeEntry> {
    const uid = getUserId();
    if (!uid) throw new Error('Not signed in');
    assertStorableEntry(entry);
    const next: TimeEntry = { ...entry, userId: uid, note: entry.note?.trim() || undefined, updatedAt: Date.now() };
    if (costing) next.cost = stampedCost(next, loaded, costing.crew, costing);
    const ref = doc(db, 'users', uid, 'timeEntries', entry.id);
    if (loaded.status === 'pending') {
      // Crew can still change or delete a waiting entry on their link, so
      // check it's the copy we loaded and write in the same transaction.
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const stale = staleWaitingEntry(loaded, snap.exists() ? snap.data() : undefined);
        if (stale) throw new StaleEntryError(stale, loaded.workerName);
        tx.set(ref, stripUndefined(next));
      });
      return next;
    }
    await settleWrite(setDoc(ref, stripUndefined(next)));
    return next;
  }

  /** Count a crew member's sent-in time — it joins the totals from here on. */
  async approveEntry(entry: TimeEntry, costing?: Costing): Promise<TimeEntry> {
    return this.updateEntry({ ...entry, status: 'approved' }, entry, costing);
  }

  async deleteEntry(id: string): Promise<void> {
    const uid = getUserId();
    if (!uid) return;
    await settleWrite(deleteDoc(doc(db, 'users', uid, 'timeEntries', id)));
  }

  /**
   * Entries on one job, newest day first. Null when the read failed — which
   * is NOT "nothing logged": showing the empty state there invites the
   * tradie to log the same hours again.
   */
  async listForJob(jobId: string): Promise<TimeEntry[] | null> {
    const uid = getUserId();
    if (!uid || !jobId) return [];
    try {
      const snap = await getDocs(query(this.colRef(uid), where('jobId', '==', jobId)));
      return sortEntriesNewestFirst(snap.docs.map((d) => normaliseTimeEntry(d.data(), d.id)));
    } catch {
      return null;
    }
  }

  /**
   * Everything sent in and not approved yet, any week — so hours sent in
   * for last Friday aren't missed on Monday. Null when the read failed.
   */
  async listWaiting(): Promise<TimeEntry[] | null> {
    const uid = getUserId();
    if (!uid) return [];
    try {
      const snap = await getDocs(query(this.colRef(uid), where('status', '==', 'pending')));
      return sortEntriesNewestFirst(snap.docs.map((d) => normaliseTimeEntry(d.data(), d.id)));
    } catch {
      return null;
    }
  }

  /** Every entry from one day to another, both inclusive. Null when the read failed. */
  async listRange(fromKey: string, toKey: string): Promise<TimeEntry[] | null> {
    const uid = getUserId();
    if (!uid) return [];
    try {
      const snap = await getDocs(
        query(this.colRef(uid), where('date', '>=', fromKey), where('date', '<=', toKey)),
      );
      return sortEntriesNewestFirst(snap.docs.map((d) => normaliseTimeEntry(d.data(), d.id)));
    } catch {
      return null;
    }
  }

  /** Every entry on the account — for cross-job views like Insights. */
  async listAll(): Promise<TimeEntry[]> {
    const uid = getUserId();
    if (!uid) return [];
    try {
      const snap = await getDocs(this.colRef(uid));
      return sortEntriesNewestFirst(snap.docs.map((d) => normaliseTimeEntry(d.data(), d.id)));
    } catch {
      return [];
    }
  }
}

export const timeEntryService = new TimeEntryService();
