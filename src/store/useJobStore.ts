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

  /**
   * Duplicate an existing Job — customer details, address, scope, and
   * checklist are copied; schedule, photos, notes, and money state are
   * reset. The cloned Job lands in `accepted` (the contract was already
   * approved) with a cloned primary document marked `quote_accepted`, so
   * the sticky bar immediately offers "Pick a Date". Returns the new Job.
   *
   * Caller is responsible for cloning the primary Document via the
   * useStore.duplicateDocumentForJob helper — we can't import useStore
   * here without creating a circular dep.
   */
  duplicateJob: (
    sourceJobId: string,
    clonedPrimaryDocumentId?: string,
  ) => Promise<Job>;

  cleanup: () => void;
}

// Job stage → write-once timestamp field. Mirrors the server's
// STAGE_STAMP_FIELD in functions/src/jobHandlers.ts — keep them in sync.
const JOB_STAGE_STAMP_FIELD: Record<string, string> = {
  quoted: 'quotedAt',
  accepted: 'acceptedAt',
  scheduled: 'scheduledAt',
  in_progress: 'inProgressAt',
  completed: 'completedAt',
  paid: 'paidAt',
  closed: 'closedAt',
  cancelled: 'cancelledAt',
};

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
    // Stamp the per-stage "when did this happen" field if the stage is
    // changing and that field isn't already set. Write-once semantics —
    // tapping a stage chip twice doesn't reset the timestamp. The server
    // trigger does the same thing for cascades; this handles the
    // direct-client-write path (tap → stage sheet → saveJob).
    const prior = get().jobs.find((j) => j.id === job.id);
    const stageChanged = prior && prior.stage !== job.stage;
    const stampField = stageChanged ? JOB_STAGE_STAMP_FIELD[job.stage] : null;
    const alreadyStamped =
      !!stampField &&
      typeof (job as unknown as Record<string, unknown>)[stampField] === 'number';
    const withStamp: Job =
      stampField && !alreadyStamped
        ? ({ ...job, [stampField]: Date.now() } as Job)
        : job;

    const next: Job = { ...withStamp, updatedAt: Date.now() };
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

  duplicateJob: async (sourceJobId, clonedPrimaryDocumentId) => {
    const source = get().jobs.find((j) => j.id === sourceJobId);
    if (!source) throw new Error(`duplicateJob: source ${sourceJobId} not found`);

    const now = Date.now();
    const uid = auth.currentUser?.uid || 'local';
    // Checklist items keep their text/notes but reset `done` + timestamps
    // so the new visit starts with a fresh punch list.
    const checklist = (source.checklist ?? []).map((item) => ({
      ...item,
      id: generateId(),
      done: false,
      completedAt: undefined,
      createdAt: now,
    }));

    const clone: Job = {
      id: generateId(),
      userId: uid,
      customerId: source.customerId,
      customerName: source.customerName,
      customerEmail: source.customerEmail,
      customerPhone: source.customerPhone,
      jobAddress: source.jobAddress,
      name: source.name,
      description: source.description,
      // Contract's already approved — start in the execution lane.
      stage: 'accepted',
      documentIds: clonedPrimaryDocumentId ? [clonedPrimaryDocumentId] : [],
      primaryDocumentId: clonedPrimaryDocumentId,
      // Fresh schedule — tradie picks a new date.
      scheduledStartDate: undefined,
      scheduledEndDate: undefined,
      actualStartDate: undefined,
      completedDate: undefined,
      estimatedDurationDays: source.estimatedDurationDays,
      // New lifecycle, no stage-transition history.
      acceptedAt: now,
      // Aggregates reset; trigger will recompute from the cloned doc.
      totalQuoted: 0,
      totalInvoiced: 0,
      totalPaid: 0,
      balanceDue: 0,
      // Fresh visit — drop photos/notes/calendar-event.
      photos: [],
      notes: undefined,
      checklist,
      googleCalendarEventId: undefined,
      googleCalendarId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await get().saveJob(clone);
    return clone;
  },

  cleanup: () => {
    jobService.cleanup();
    set({ jobs: [], jobsLoaded: false });
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface JobLinkableSource {
  jobId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job?: { name?: string; description?: string };
}

// Treat these as "placeholder" values on a Job — always happy to overwrite
// them as the tradie fills in later wizard steps. The legacy default of
// 'Unknown customer' shipped once and we still need to recognise it on
// existing Job records even though new Jobs no longer stamp it.
const JOB_CUSTOMER_PLACEHOLDERS = ['', 'Unknown customer'];
const JOB_NAME_PLACEHOLDERS = ['', 'Job', 'New job', 'Untitled job'];

function isPlaceholder(value: string | undefined, placeholders: string[]): boolean {
  const v = (value ?? '').trim();
  return placeholders.includes(v);
}

/**
 * Make sure the source doc/quote has a Job attached, and make sure that
 * Job's customer + address + job-name fields stay in step with whatever
 * the user has typed so far. Two paths:
 *
 *  1. No jobId yet → create a Job if there's at least SOMETHING to go on
 *     (name, address, or job title filled).
 *  2. jobId already set → leave the Job alone UNLESS one of its fields is
 *     still a placeholder. Then patch only the placeholder fields from the
 *     source. A tradie who manually renamed the customer keeps their edit.
 *
 * Works without the server trigger being deployed.
 */
async function syncJobFromSource<T extends JobLinkableSource>(source: T): Promise<T> {
  const customerName = (source.customerName || '').trim();
  const customerEmail = (source.customerEmail || '').trim();
  const customerPhone = (source.customerPhone || '').trim();
  const jobAddress = (source.jobAddress || '').trim();
  const jobName = (source.job?.name || '').trim();
  const jobDescription = (source.job?.description || '').trim();

  // Case 1 — unlinked. Bail out if there's nothing useful yet; otherwise
  // create a fresh Job and stamp jobId on the source.
  if (!source.jobId) {
    const hasAny = !!(customerName || customerEmail || customerPhone || jobAddress || jobName);
    if (!hasAny) return source;

    const created = await useJobStore.getState().createJob({
      customerName,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      jobAddress,
      name: jobName,
      description: jobDescription || undefined,
    });
    return { ...source, jobId: created.id };
  }

  // Case 2 — already linked. Patch the Job's customer / job fields
  // when the source has a different non-empty value. Used to restrict
  // updates to placeholder-only fields, but that meant edits made in
  // the wizard's CustomerDetails / JobDetails steps never made it back
  // to the Job record. Now: if you typed something different in the
  // wizard, that's your intent — the Job updates to match.
  const existing = useJobStore.getState().getJobById(source.jobId);
  if (!existing) return source;

  const patch: Record<string, string> = {};
  if (customerName && customerName !== (existing.customerName || '')) {
    patch.customerName = customerName;
  }
  if (customerEmail && customerEmail !== (existing.customerEmail || '')) {
    patch.customerEmail = customerEmail;
  }
  if (customerPhone && customerPhone !== (existing.customerPhone || '')) {
    patch.customerPhone = customerPhone;
  }
  if (jobAddress && jobAddress !== (existing.jobAddress || '')) {
    patch.jobAddress = jobAddress;
  }
  if (jobName && jobName !== (existing.name || '')) {
    patch.name = jobName;
  }
  if (
    jobDescription &&
    jobDescription !== (existing.description || '')
  ) {
    patch.description = jobDescription;
  }
  if (Object.keys(patch).length === 0) return source;

  await useJobStore.getState().saveJob({ ...existing, ...patch });
  return source;
}

/**
 * Document variant. Thin wrapper around syncJobFromSource.
 */
export async function ensureJobForDocument(doc: Document): Promise<Document> {
  return syncJobFromSource(doc);
}

/**
 * Legacy Quote / Invoice variant. Structurally compatible with the Document
 * shape for the fields we care about.
 */
export async function ensureJobForQuote<T extends JobLinkableSource>(quote: T): Promise<T> {
  return syncJobFromSource(quote);
}
