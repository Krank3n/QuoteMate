/**
 * Service Report Service
 * Reads/writes the `users/{uid}/reports/{reportId}` collection. A Service
 * Report is a customer-facing leave-behind document a tradie produces after a
 * service visit — linked to a Job via `jobId`, it carries no money, no stage,
 * and no line items (see shared/report/types.ts).
 *
 * Mirrors jobService.ts: getUserId, stripUndefined, normalise, class +
 * singleton, onSnapshot subscribe. Report numbers ("RP-001") are reconciled
 * against existing reports via reconcileNextNumber so a fresh device doesn't
 * mint a colliding number.
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { generateId } from '../utils/generateId';
import { reconcileNextNumber } from '../utils/nextNumber';
import type {
  ServiceReport,
  ServiceReportStatus,
} from '../../shared/report/types';

function getUserId(): string | null {
  return auth.currentUser?.uid || null;
}

/** Recursively strip undefined values — Firestore rejects them. */
export function stripUndefined(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  const cleaned: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined)
      cleaned[k] =
        typeof v === 'object' && v !== null && !(v instanceof Date)
          ? stripUndefined(v)
          : v;
  }
  return cleaned;
}

/** Coerce a raw Firestore doc into a well-formed ServiceReport. */
export function normaliseReport(raw: any, id: string): ServiceReport {
  return {
    ...raw,
    id,
    jobId: String(raw.jobId || ''),
    userId: String(raw.userId || ''),
    number: String(raw.number || ''),
    visitDate: Number(raw.visitDate) || 0,
    serviceType: String(raw.serviceType || ''),
    equipment: Array.isArray(raw.equipment) ? raw.equipment : [],
    itemsChecked: Array.isArray(raw.itemsChecked) ? raw.itemsChecked : [],
    photos: Array.isArray(raw.photos) ? raw.photos : undefined,
    status: (raw.status === 'sent' ? 'sent' : 'draft') as ServiceReportStatus,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  } as ServiceReport;
}

/**
 * Compute the next "RP-NNN" report number from a list of existing reports.
 * Pure — extracted so it can be tested without live Firestore. Reconciles the
 * derived max against a cached floor (defaults to 1) exactly like quote/invoice
 * numbering.
 */
export function computeNextReportNumber(
  reports: Array<{ number?: string }>,
  cached = 1,
): string {
  const next = reconcileNextNumber({
    items: reports,
    field: (r) => r.number,
    prefix: 'RP',
    cached,
  });
  return `RP-${String(next).padStart(3, '0')}`;
}

/** Fields the caller supplies when creating a report. */
export type CreateReportInput = Omit<
  ServiceReport,
  'id' | 'userId' | 'number' | 'createdAt' | 'updatedAt' | 'status'
> &
  Partial<Pick<ServiceReport, 'status' | 'number'>>;

class ReportService {
  private unsubscribe: Unsubscribe | null = null;

  private colRef(uid: string) {
    return collection(db, 'users', uid, 'reports');
  }

  /** Derive the next "RP-001"-style number from existing reports. */
  async nextReportNumber(): Promise<string> {
    const uid = getUserId();
    if (!uid) return computeNextReportNumber([]);
    try {
      const snap = await getDocs(this.colRef(uid));
      const reports = snap.docs.map((d) => d.data() as { number?: string });
      return computeNextReportNumber(reports);
    } catch {
      return computeNextReportNumber([]);
    }
  }

  async createReport(input: CreateReportInput): Promise<ServiceReport> {
    const uid = getUserId();
    if (!uid) throw new Error('Not signed in');
    const now = Date.now();
    const id = generateId();
    const number = input.number || (await this.nextReportNumber());
    const report: ServiceReport = {
      ...input,
      id,
      userId: uid,
      number,
      status: input.status || 'draft',
      createdAt: now,
      updatedAt: now,
    };
    const ref = doc(db, 'users', uid, 'reports', id);
    await setDoc(ref, stripUndefined(report));
    return report;
  }

  async updateReport(
    id: string,
    patch: Partial<ServiceReport>,
  ): Promise<void> {
    const uid = getUserId();
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'reports', id);
    const payload = stripUndefined({
      ...patch,
      updatedAt: Date.now(),
    });
    await setDoc(ref, payload, { merge: true });
  }

  async getReport(id: string): Promise<ServiceReport | null> {
    const uid = getUserId();
    if (!uid) return null;
    try {
      const ref = doc(db, 'users', uid, 'reports', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return normaliseReport(snap.data(), snap.id);
    } catch {
      return null;
    }
  }

  async listReports(jobId?: string): Promise<ServiceReport[]> {
    const uid = getUserId();
    if (!uid) return [];
    try {
      const ref = this.colRef(uid);
      const q = jobId
        ? query(ref, where('jobId', '==', jobId), orderBy('updatedAt', 'desc'))
        : query(ref, orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map((d) => normaliseReport(d.data(), d.id));
    } catch {
      return [];
    }
  }

  subscribeReports(
    callback: (reports: ServiceReport[]) => void,
    jobId?: string,
  ): Unsubscribe {
    const uid = getUserId();
    if (!uid) return () => {};
    try {
      // Release prior listener — token-refresh re-invokes this every ~hour.
      this.unsubscribe?.();
      const ref = this.colRef(uid);
      const q = jobId
        ? query(ref, where('jobId', '==', jobId), orderBy('updatedAt', 'desc'))
        : query(ref, orderBy('updatedAt', 'desc'));
      this.unsubscribe = onSnapshot(
        q,
        (snap) => {
          callback(snap.docs.map((d) => normaliseReport(d.data(), d.id)));
        },
        () => {},
      );
      return this.unsubscribe;
    } catch {
      return () => {};
    }
  }

  async deleteReport(id: string): Promise<void> {
    const uid = getUserId();
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'reports', id);
    await deleteDoc(ref);
  }

  cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export const reportService = new ReportService();
