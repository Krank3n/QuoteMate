/**
 * Job Service
 * Reads/writes the top-level `users/{uid}/jobs/{jobId}` collection introduced
 * in Phase 8. Aggregate fields on each Job are populated server-side by the
 * onDocumentWriteSyncJob trigger — the client is responsible for creating the
 * Job and keeping user-editable fields (customer, address, name, stage,
 * dates, notes, photos) in sync.
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { Job } from '../../shared/job/types';

function getUserId(): string | null {
  return auth.currentUser?.uid || null;
}

/** Ceiling on the live listener. See listenToJobs for why it isn't unbounded. */
export const JOBS_LISTENER_LIMIT = 500;

/** Recursively strip undefined values — Firestore rejects them. */
function stripUndefined(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  const cleaned: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) cleaned[k] = typeof v === 'object' && v !== null && !(v instanceof Date)
      ? stripUndefined(v)
      : v;
  }
  return cleaned;
}

function normalise(raw: any, id: string): Job {
  return {
    ...raw,
    id,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    documentIds: Array.isArray(raw.documentIds) ? raw.documentIds : [],
    totalQuoted: Number(raw.totalQuoted) || 0,
    totalInvoiced: Number(raw.totalInvoiced) || 0,
    totalPaid: Number(raw.totalPaid) || 0,
    balanceDue: Number(raw.balanceDue) || 0,
  } as Job;
}

class JobService {
  private unsubscribe: Unsubscribe | null = null;

  async loadJobs(): Promise<Job[]> {
    const uid = getUserId();
    if (!uid) return [];
    try {
      const ref = collection(db, 'users', uid, 'jobs');
      const q = query(ref, orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map((d) => normalise(d.data(), d.id));
    } catch {
      return [];
    }
  }

  /**
   * @param callback receives the snapshot plus whether it came back at the cap,
   *   i.e. whether older jobs exist that this listener will never deliver.
   */
  listenToJobs(
    callback: (jobs: Job[], wasTruncated: boolean) => void,
  ): Unsubscribe | null {
    const uid = getUserId();
    if (!uid) return null;
    try {
      // Release prior listener — token-refresh re-invokes this every ~hour.
      this.unsubscribe?.();
      const ref = collection(db, 'users', uid, 'jobs');
      // Cap the live listener so a long-tenured account doesn't replay its
      // whole history on every reconnect. 500 matches the ceiling used
      // elsewhere (readTools reads contacts at the same limit) and puts
      // truncation out of reach for any real user — the largest account seen
      // is ~44 jobs.
      //
      // A snapshot REPLACES the store array, and loadJobs() is unbounded, so
      // when the snapshot comes back full the caller merges rather than
      // trimming the tail loadJobs already fetched. See mergeTruncatedSnapshot.
      const q = query(ref, orderBy('updatedAt', 'desc'), limit(JOBS_LISTENER_LIMIT));
      this.unsubscribe = onSnapshot(
        q,
        (snap) => {
          callback(
            snap.docs.map((d) => normalise(d.data(), d.id)),
            snap.docs.length >= JOBS_LISTENER_LIMIT,
          );
        },
        () => {},
      );
      return this.unsubscribe;
    } catch {
      return null;
    }
  }

  /**
   * Writes the Job, scrubbing undefined values. Aggregate fields
   * (totalQuoted/Invoiced/Paid/balanceDue/documentIds) come from the server
   * trigger — clients should leave them alone (pass through whatever the
   * server last set). We use merge:true so a client write of user-editable
   * fields doesn't accidentally clobber an aggregate the trigger just
   * computed.
   */
  async saveJob(job: Job): Promise<void> {
    const uid = getUserId();
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'jobs', job.id);
    const payload = stripUndefined({
      ...job,
      userId: uid,
      updatedAt: Date.now(),
    });
    await setDoc(ref, payload, { merge: true });
  }

  async deleteJob(jobId: string): Promise<void> {
    const uid = getUserId();
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'jobs', jobId);
    await deleteDoc(ref);
  }

  cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export const jobService = new JobService();
