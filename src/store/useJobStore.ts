/**
 * useJobStore — client-side store for the top-level Job entity (Phase 8+).
 *
 * Lives alongside the other stores (useStore for quotes/invoices/documents,
 * subscriptionStore for premium status). Kept separate so Jobs can evolve
 * their own API without bloating the already-large useStore.
 */

import { create } from 'zustand';
import { auth } from '../config/firebase';
import { jobService } from '../services/jobService';
import { generateId } from '../utils/generateId';
import type { Job, JobStage } from '../../shared/job/types';
import type { Document } from '../types/document';

interface JobState {
  jobs: Job[];
  jobsLoaded: boolean;

  loadJobs: () => Promise<void>;
  listenToJobs: () => void;
  saveJob: (job: Job) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;

  /**
   * Materialise a Job from minimal input. Returns the created Job (with id,
   * createdAt/updatedAt set). Aggregate fields are initialised to zero and
   * get overwritten by the server trigger once a Document is attached.
   */
  createJob: (input: {
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    jobAddress: string;
    name: string;
    description?: string;
  }) => Promise<Job>;

  getJobById: (id: string) => Job | undefined;
  /** Look up the Job that a given Document is attached to (by doc.jobId). */
  getJobByDocumentId: (documentId: string) => Job | undefined;

  cleanup: () => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: [],
  jobsLoaded: false,

  loadJobs: async () => {
    if (!auth.currentUser) return;
    try {
      const jobs = await jobService.loadJobs();
      set({ jobs, jobsLoaded: true });
    } catch {
      set({ jobsLoaded: true });
    }
  },

  listenToJobs: () => {
    if (!auth.currentUser) return;
    jobService.listenToJobs((jobs) => {
      set({ jobs, jobsLoaded: true });
    });
  },

  saveJob: async (job: Job) => {
    const next: Job = { ...job, updatedAt: Date.now() };
    // Optimistic local update.
    set((state) => {
      const i = state.jobs.findIndex((j) => j.id === next.id);
      const jobs =
        i >= 0
          ? state.jobs.map((j, idx) => (idx === i ? next : j))
          : [next, ...state.jobs];
      return { jobs };
    });
    if (auth.currentUser) {
      await jobService.saveJob(next);
    }
  },

  deleteJob: async (jobId: string) => {
    set((state) => ({ jobs: state.jobs.filter((j) => j.id !== jobId) }));
    if (auth.currentUser) {
      await jobService.deleteJob(jobId);
    }
  },

  createJob: async (input) => {
    const now = Date.now();
    const uid = auth.currentUser?.uid || 'local';
    const job: Job = {
      id: generateId(),
      userId: uid,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      jobAddress: input.jobAddress,
      name: input.name,
      description: input.description,
      stage: 'inquiry' as JobStage,
      documentIds: [],
      totalQuoted: 0,
      totalInvoiced: 0,
      totalPaid: 0,
      balanceDue: 0,
      createdAt: now,
      updatedAt: now,
    };
    await get().saveJob(job);
    return job;
  },

  getJobById: (id: string) => get().jobs.find((j) => j.id === id),

  getJobByDocumentId: (documentId: string) =>
    get().jobs.find((j) => j.documentIds.includes(documentId)),

  cleanup: () => {
    jobService.cleanup();
    set({ jobs: [], jobsLoaded: false });
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * If the document isn't linked to a Job yet, create one using whatever
 * customer+address+name info is on the document and stamp jobId onto a
 * shallow copy. Returns the (possibly updated) document.
 *
 * Called from the save path so any quote saved without an explicit pre-step
 * still gets a Job. The explicit UI pre-step (Phase 10) will create the Job
 * up front; this keeps the contract consistent either way.
 */
export async function ensureJobForDocument(doc: Document): Promise<Document> {
  if (doc.jobId) return doc;
  const customerName = (doc.customerName || '').trim();
  // Drafts with nothing typed yet don't warrant a Job. Once the user has at
  // least a name OR an address OR a job title, create the Job.
  const hasName = customerName.length > 0;
  const hasAddress = (doc.jobAddress || '').trim().length > 0;
  const hasJobName = (doc.job?.name || '').trim().length > 0;
  if (!hasName && !hasAddress && !hasJobName) return doc;

  const job = await useJobStore.getState().createJob({
    customerName: customerName || 'Unknown customer',
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    jobAddress: (doc.jobAddress || '').trim(),
    name: (doc.job?.name || 'Job').trim() || 'Job',
    description: doc.job?.description,
  });
  return { ...doc, jobId: job.id };
}

/**
 * Legacy-quote variant. Mirrors ensureJobForDocument but operates on the
 * legacy Quote shape used in saveDraft / saveQuote.
 */
export async function ensureJobForQuote<
  T extends {
    jobId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    jobAddress?: string;
    job?: { name?: string; description?: string };
  },
>(quote: T): Promise<T> {
  if (quote.jobId) return quote;
  const customerName = (quote.customerName || '').trim();
  const hasName = customerName.length > 0;
  const hasAddress = (quote.jobAddress || '').trim().length > 0;
  const hasJobName = (quote.job?.name || '').trim().length > 0;
  if (!hasName && !hasAddress && !hasJobName) return quote;

  const job = await useJobStore.getState().createJob({
    customerName: customerName || 'Unknown customer',
    customerEmail: quote.customerEmail,
    customerPhone: quote.customerPhone,
    jobAddress: (quote.jobAddress || '').trim(),
    name: (quote.job?.name || 'Job').trim() || 'Job',
    description: quote.job?.description,
  });
  return { ...quote, jobId: job.id };
}
