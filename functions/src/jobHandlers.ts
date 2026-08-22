/**
 * Phase 8 of the jobs refactor — top-level Job entity.
 *
 * Sits above the unified Document model (shared/document/*). One Job has many
 * attached Documents via `doc.jobId`. The trigger here listens to writes on
 * the unified documents collection (users/{uid}/documents/{docId}) and
 * recomputes the attached Job's aggregates.
 *
 *  - onDocumentWriteSyncJob: fires on every unified-document write, refreshes
 *    aggregates for any affected job (old jobId + new jobId so reassigning a
 *    doc updates both sides).
 *  - backfillJobsFromDocuments: admin-gated callable. Groups a user's existing
 *    documents by customer + address + job name and proposes one Job per
 *    group. Dry-run by default; pass commit:true to actually write.
 *
 *  Phase 8 deliberately does NOT auto-create Jobs on doc writes — creation
 *  is explicit (the Phase 9 quote wizard, or the backfill). If a doc's jobId
 *  is unset the trigger no-ops; if it dangles, it logs and skips.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';

import { computeJobAggregates } from './shared/job/aggregate';
import { deriveJobStageFromDocs } from './shared/job/stage';
import type { Job, JobDocument, JobStage } from './shared/job/types';

const db = () => admin.firestore();

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export const onDocumentWriteSyncJob = functions.firestore
  .document('users/{userId}/documents/{docId}')
  .onWrite(async (change, ctx) => {
    const userId = ctx.params.userId as string;
    const docId = ctx.params.docId as string;

    // Safety net: documents are supposed to arrive with jobId already
    // stamped (saveDraft → ensureJobForQuote on the client, or the email-
    // accept handler). Anything that slips through — legacy imports,
    // older code paths, third-party writes — leaves an orphan in the
    // documents collection that the Jobs tab can never see. Materialise
    // a Job from this doc's fields and stamp jobId back, atomically.
    const after = change.after.exists ? change.after.data() || null : null;
    if (after && shouldMaterialiseJob(after)) {
      const stamped = await ensureJobForOrphanDocument(userId, docId, after);
      // Stamping jobId fires another onWrite — that pass syncs aggregates
      // against the freshly-created Job. Bail this pass to avoid double-
      // computing on stale data.
      if (stamped) return;
    }

    for (const jobId of collectJobIds(change)) {
      await syncJobAggregates(userId, jobId);
    }
  });

// Decide whether the trigger should attempt to materialise a Job for an
// otherwise-orphaned document. Skip when the doc already has a Job (happy
// path), when it's been cancelled (no point creating a Job we'd close), or
// when there's nothing to put on the Job card (blank shell).
function shouldMaterialiseJob(after: Record<string, unknown>): boolean {
  if (typeof after.jobId === 'string' && after.jobId) return false;
  if (after.stage === 'cancelled') return false;
  const customerName = trimString(after.customerName);
  const customerEmail = trimString(after.customerEmail);
  const customerPhone = trimString(after.customerPhone);
  const jobAddress = trimString(after.jobAddress);
  const job = (after.job as { name?: unknown } | undefined) || {};
  const jobName = trimString(job.name);
  return !!(customerName || customerEmail || customerPhone || jobAddress || jobName);
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Materialise a Job for a document that arrived without jobId. Runs in a
// transaction so the new Job and the doc.jobId stamp land together — and
// re-checks jobId inside the transaction in case a concurrent invocation
// already won. Returns the new Job's id, or null if we declined / lost the
// race. Logs and swallows errors so a transient Firestore hiccup doesn't
// take the trigger out.
async function ensureJobForOrphanDocument(
  userId: string,
  docId: string,
  // The change's after data — used only to decide whether to enter the
  // transaction. The transaction re-reads from Firestore for the actual
  // values it writes against.
  _after: Record<string, unknown>,
): Promise<string | null> {
  const docRef = db()
    .collection('users').doc(userId)
    .collection('documents').doc(docId);
  const jobRef = db()
    .collection('users').doc(userId)
    .collection('jobs').doc();

  try {
    return await db().runTransaction(async (tx) => {
      const fresh = await tx.get(docRef);
      if (!fresh.exists) return null;
      const data = fresh.data() || {};
      // Concurrent invocation may have already stamped a jobId — bail.
      if (typeof data.jobId === 'string' && data.jobId) return null;

      const customerName = trimString(data.customerName);
      const customerEmail = trimString(data.customerEmail);
      const customerPhone = trimString(data.customerPhone);
      const jobAddress = trimString(data.jobAddress);
      const job = (data.job as { name?: unknown; description?: unknown } | undefined) || {};
      const jobName = trimString(job.name);
      const jobDescription = trimString(job.description);

      if (!customerName && !customerEmail && !customerPhone && !jobAddress && !jobName) {
        return null;
      }

      // Derive starting stage from this single document so a doc that
      // arrives mid-lifecycle (e.g. a customer-accepted quote with no
      // jobId) lands on the right Job stage instead of inquiry.
      const initialStage = deriveJobStageFromDocs([
        { id: docId, ...(data as Omit<JobDocument, 'id'>) } as JobDocument,
      ]);

      // Inherit timestamps from the source document so the materialised
      // Job carries its real history. Per-stage stamps come from the
      // doc's sentAt / acceptedAt / paidInFullAt fields when present.
      const docCreatedAt = toMillis(data.createdAt);
      const docUpdatedAt = toMillis(data.updatedAt);
      const now = Date.now();
      const createdAt = docCreatedAt > 0 ? docCreatedAt : now;
      const updatedAt = docUpdatedAt > 0 ? docUpdatedAt : createdAt;
      const stageStamps = computeStageStampsFromDocs([data]);

      tx.set(jobRef, {
        id: jobRef.id,
        userId,
        customerName,
        customerEmail,
        customerPhone,
        jobAddress,
        name: jobName || 'Job',
        description: jobDescription,
        stage: initialStage,
        ...stageStamps,
        documentIds: [docId],
        primaryDocumentId: docId,
        totalQuoted: 0,
        totalInvoiced: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdAt,
        updatedAt,
      });
      tx.update(docRef, { jobId: jobRef.id, updatedAt: docUpdatedAt > 0 ? docUpdatedAt : now });

      return jobRef.id;
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    functions.logger.error('ensureJobForOrphanDocument failed', {
      userId, docId, message,
    });
    return null;
  }
}

// Gather every jobId that might be affected by this write: the new one, and
// (if different) the old one — a doc moving from Job A to Job B needs both
// aggregates refreshed.
function collectJobIds(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
): string[] {
  const before = change.before.exists ? change.before.data() || {} : null;
  const after = change.after.exists ? change.after.data() || {} : null;
  const ids = new Set<string>();
  const beforeJobId = typeof before?.jobId === 'string' ? before.jobId : null;
  const afterJobId = typeof after?.jobId === 'string' ? after.jobId : null;
  if (beforeJobId) ids.add(beforeJobId);
  if (afterJobId) ids.add(afterJobId);
  return [...ids];
}

async function syncJobAggregates(userId: string, jobId: string): Promise<void> {
  const jobRef = db()
    .collection('users').doc(userId)
    .collection('jobs').doc(jobId);

  const [jobSnap, docsSnap] = await Promise.all([
    jobRef.get(),
    db()
      .collection('users').doc(userId)
      .collection('documents')
      .where('jobId', '==', jobId)
      .get(),
  ]);

  const docs: JobDocument[] = docsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<JobDocument, 'id'>),
  }));

  let job: Record<string, unknown>;
  if (!jobSnap.exists) {
    // Dangling reference — docs point at a Job that doesn't exist. If we
    // can rebuild it from the attached docs, do so; otherwise bail. This
    // is the auto-heal counterpart to the orphan-doc safety net above —
    // together they make sure no doc can leak into a state where the Jobs
    // tab can't see it.
    if (docs.length === 0) {
      functions.logger.warn('syncJobAggregates: job missing, no attached docs', { userId, jobId });
      return;
    }
    const rebuilt = rebuildDanglingJob(userId, jobId, docs);
    if (!rebuilt) {
      functions.logger.warn('syncJobAggregates: job missing, no signal to rebuild', { userId, jobId });
      return;
    }
    await jobRef.set(rebuilt);
    job = rebuilt as Record<string, unknown>;
  } else {
    job = jobSnap.data() || {};
  }

  const aggregates = computeJobAggregates({ id: jobId }, docs);

  // Sync user-facing fields from the most recently updated attached doc when
  // the Job still holds auto-create placeholders. A Job created via
  // ensureJobForQuote on the first saveDraft sees an empty customerName /
  // jobAddress; later wizard screens fill them in. This keeps the Job card
  // in step without clobbering a real manual edit.
  const primary = pickPrimaryDoc(docs);
  const userFields = primary
    ? buildUserFieldSync(job, primary as unknown as Record<string, unknown>)
    : {};

  // Stage cascade. If any attached doc has moved to quote_sent / accepted /
  // invoiced / partial / paid, nudge the Job along. Forward-only, with one
  // exception: a Job sitting at `paid` when no document is paid any more has
  // to come back down — see deriveJobStageBump. Manual progressions
  // (scheduled / in_progress / completed) stay intact either way, and a
  // cancelled or closed job is never touched.
  const stageBump = deriveJobStageBump(
    typeof job.stage === 'string' ? (job.stage as string) : 'inquiry',
    docs,
  );

  // Stamp the per-stage timestamp the Phase-17 activity timeline uses.
  // Only write if the Job is actually changing stage AND the target stamp
  // isn't already set (write-once semantics — don't bump the clock on a
  // second transition into the same stage).
  const stampField = stageBump ? STAGE_STAMP_FIELD[stageBump] : null;
  const alreadyStamped =
    !!stampField && typeof job[stampField] === 'number' && job[stampField] > 0;
  const stageStamp =
    stampField && !alreadyStamped ? { [stampField]: Date.now() } : {};

  // updatedAt should track real activity, not trigger-fire time. Take the
  // max of the Job's existing updatedAt and the most recent doc.updatedAt
  // — that way a backfill / re-aggregate doesn't make a months-old Job
  // look like it was just touched.
  const docMaxUpdatedAt = docs.reduce(
    (acc, d) => Math.max(acc, Number(d.updatedAt) || 0),
    0,
  );
  const existingUpdatedAt = Number(job.updatedAt) || 0;
  const updatedAt = Math.max(existingUpdatedAt, docMaxUpdatedAt) || Date.now();

  await applyJobAggregatePatch(
    jobRef,
    {
      ...aggregates,
      ...userFields,
      ...(stageBump ? { stage: stageBump } : {}),
      ...stageStamp,
      updatedAt,
    },
    () =>
      functions.logger.warn('syncJobAggregates: job deleted mid-flight, skipping aggregate write', {
        userId, jobId,
      }),
  );
}

/** gRPC status code Firestore uses for update() on a missing document. */
const GRPC_NOT_FOUND = 5;

/**
 * Apply the aggregate patch with update(), not set({merge}): if the client
 * deleted or re-keyed the Job between the trigger's read and this write, a
 * merge-set would recreate it as a stage-less "ghost" doc holding only
 * aggregates — which then renders as a malformed card on every device (the
 * July 2026 crash-on-open). NOT_FOUND just means the Job is gone and there
 * is nothing left to aggregate onto.
 */
export async function applyJobAggregatePatch(
  jobRef: { update: (data: Record<string, unknown>) => Promise<unknown> },
  patch: Record<string, unknown>,
  onMissing: () => void,
): Promise<void> {
  try {
    await jobRef.update(patch);
  } catch (err) {
    if ((err as { code?: number }).code === GRPC_NOT_FOUND) {
      onMissing();
      return;
    }
    throw err;
  }
}

// Map Job stage → write-once timestamp field on the Job document.
const STAGE_STAMP_FIELD: Record<string, string> = {
  quoted: 'quotedAt',
  accepted: 'acceptedAt',
  scheduled: 'scheduledAt',
  in_progress: 'inProgressAt',
  completed: 'completedAt',
  paid: 'paidAt',
  closed: 'closedAt',
  cancelled: 'cancelledAt',
};

const JOB_STAGE_ORDER = [
  'inquiry',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'paid',
  'closed',
] as const;

/**
 * Compute an optional forward-only stage nudge for the parent Job based on
 * the current set of attached documents. Returns null when no change is
 * warranted.
 *
 *   any attached doc.stage === 'paid'            → Job 'paid'
 *   any 'invoice_sent' / 'partially_paid'         → Job 'in_progress'
 *   any 'quote_accepted'                          → Job 'accepted'
 *   any 'quote_sent'                              → Job 'quoted'
 *
 * Never moves the Job backwards — if the tradie has manually pushed it to
 * 'scheduled' or 'in_progress', that stands until the Document payments
 * / stages catch up.
 *
 * Skips cancelled / closed jobs entirely — those are user decisions.
 */
export function deriveJobStageBump(currentStage: string, docs: JobDocument[]): string | null {
  if (currentStage === 'cancelled' || currentStage === 'closed') return null;

  const active = docs.filter((d) => d.stage !== 'cancelled');
  if (active.length === 0) return null;

  let target: string | null = null;
  if (active.some((d) => d.stage === 'paid')) target = 'paid';
  else if (active.some((d) => d.stage === 'invoice_sent' || d.stage === 'partially_paid')) {
    target = 'in_progress';
  } else if (active.some((d) => d.stage === 'quote_accepted')) target = 'accepted';
  else if (active.some((d) => d.stage === 'quote_sent')) target = 'quoted';

  // `paid` is the one Job stage that is purely a claim about money, which
  // makes it the one stage that has to be able to come back DOWN.
  //
  // Removing or correcting a payment drops the document out of `paid`
  // (saveDocumentWithLedger re-derives its stage from the ledger), but with a
  // strictly forward-only cascade the Job stayed `paid` forever. The card then
  // said three things at once — "Paid 3 minutes ago" on the status line,
  // "Unpaid" on the payment chip, and a green Paid pill on the timeline — and,
  // because bucketForJob files stage `paid` under Done, an invoice that still
  // owed money sat in the finished pile where the Owed filter could never
  // surface it.
  //
  // Deliberately the ONLY backward move. A manual push to scheduled /
  // in_progress / completed still stands: those say nothing about money, so
  // they stay the tradie's to own.
  if (currentStage === 'paid' && target !== 'paid') {
    // No positive target means the documents support nothing on the ladder —
    // e.g. the invoice was un-sent as well as un-paid, leaving only a draft.
    // Every job that reached `paid` did the work, so `completed` is the
    // strongest claim still standing, and it's one tap from anywhere else.
    return target ?? 'completed';
  }

  if (!target) return null;
  const curIdx = JOB_STAGE_ORDER.indexOf(currentStage as typeof JOB_STAGE_ORDER[number]);
  const tgtIdx = JOB_STAGE_ORDER.indexOf(target as typeof JOB_STAGE_ORDER[number]);
  if (curIdx === -1 || tgtIdx === -1) return null;
  return tgtIdx > curIdx ? target : null;
}

// Prefer the document pointed at by primaryDocumentId; fall back to the most
// recently updated non-cancelled doc. Avoids letting a stale draft clobber
// fresh customer details on a newer revision.
function pickPrimaryDoc(docs: JobDocument[]): JobDocument | null {
  if (docs.length === 0) return null;
  const live = docs.filter((d) => d.stage !== 'cancelled');
  const pool = live.length > 0 ? live : docs;
  const byUpdated = [...pool].sort(
    (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0),
  );
  return byUpdated[0];
}

function buildUserFieldSync(
  job: Record<string, unknown>,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const syncIfPlaceholder = (
    jobField: string,
    docField: string,
    placeholders: string[],
  ) => {
    const current = typeof job[jobField] === 'string' ? (job[jobField] as string).trim() : '';
    const isPlaceholder = current.length === 0 || placeholders.includes(current);
    const incoming = typeof doc[docField] === 'string' ? (doc[docField] as string).trim() : '';
    if (isPlaceholder && incoming.length > 0) out[jobField] = incoming;
  };

  syncIfPlaceholder('customerName', 'customerName', ['Unknown customer']);
  syncIfPlaceholder('customerEmail', 'customerEmail', []);
  syncIfPlaceholder('customerPhone', 'customerPhone', []);
  syncIfPlaceholder('jobAddress', 'jobAddress', []);

  // Job name lives on doc.job.name (embedded JobSpec), not at the top level.
  const currentName = typeof job.name === 'string' ? (job.name as string).trim() : '';
  const namePlaceholders = ['', 'Job', 'New job', 'Untitled job'];
  const embeddedJob = (doc.job as { name?: unknown } | undefined) || {};
  const incomingName =
    typeof embeddedJob.name === 'string' ? embeddedJob.name.trim() : '';
  if (namePlaceholders.includes(currentName) && incomingName.length > 0) {
    out.name = incomingName;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

interface BackfillRequest {
  userId?: string;
  commit?: boolean;
}

export interface BackfillGroupReport {
  proposedJobId: string;
  key: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress: string;
  jobName: string;
  stage: JobStage;
  primaryDocumentId?: string;
  documentIds: string[];
}

export interface BackfillConflict {
  key: string;
  reason: string;
  docIds: string[];
}

export interface BackfillResult {
  userId: string;
  commit: boolean;
  groupCount: number;
  docCount: number;
  groups: BackfillGroupReport[];
  conflicts: BackfillConflict[];
}

function requireAdmin(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  const isAdmin = context.auth?.token?.admin === true;
  if (!uid || !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
  return uid;
}

export const backfillJobsFromDocuments = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data: BackfillRequest, context) => {
    requireAdmin(context);
    const userId = data?.userId;
    if (!userId) {
      throw new functions.https.HttpsError('invalid-argument', 'userId required');
    }
    const commit = data?.commit === true;
    return runBackfill({ userId, commit });
  });

export async function runBackfill(opts: {
  userId: string;
  commit: boolean;
}): Promise<BackfillResult> {
  const { userId, commit } = opts;

  const docsSnap = await db()
    .collection('users').doc(userId)
    .collection('documents')
    .get();

  interface Entry {
    id: string;
    data: JobDocument;
    createdAtMs: number;
  }

  const groups = new Map<string, Entry[]>();
  let docCount = 0;

  for (const d of docsSnap.docs) {
    const raw = d.data() as Omit<JobDocument, 'id'>;
    const data: JobDocument = { id: d.id, ...raw };
    const key = groupKey(data);
    const list = groups.get(key) ?? [];
    list.push({ id: d.id, data, createdAtMs: toMillis(raw.createdAt) });
    groups.set(key, list);
    docCount += 1;
  }

  const reports: BackfillGroupReport[] = [];
  const conflicts: BackfillConflict[] = [];

  for (const [key, entries] of groups.entries()) {
    const distinctEmails = new Set(
      entries
        .map((e) => (e.data.customerEmail || '').trim().toLowerCase())
        .filter(Boolean),
    );
    if (distinctEmails.size > 1) {
      conflicts.push({
        key,
        reason:
          'Multiple distinct customer emails grouped together by address + job name',
        docIds: entries.map((e) => e.id),
      });
    }

    const sorted = [...entries].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const latest = sorted[0];
    const primaryDocumentId = latest?.id;

    const stage = deriveJobStageFromDocs(entries.map((e) => e.data));

    const proposedJobId = db()
      .collection('users').doc(userId)
      .collection('jobs').doc().id;

    reports.push({
      proposedJobId,
      key,
      customerName: latest.data.customerName || '',
      customerEmail: latest.data.customerEmail,
      customerPhone: latest.data.customerPhone,
      jobAddress: latest.data.jobAddress || '',
      jobName: latest.data.job?.name || 'Job',
      stage,
      primaryDocumentId,
      documentIds: sorted.map((e) => e.id),
    });
  }

  if (!commit) {
    return {
      userId,
      commit: false,
      groupCount: reports.length,
      docCount,
      groups: reports,
      conflicts,
    };
  }

  // Commit mode. One transaction per group so the Job materialisation and the
  // per-doc jobId stamp land atomically.
  for (const report of reports) {
    const entries = groups.get(report.key)!;
    await db().runTransaction(async (tx) => {
      const jobRef = db()
        .collection('users').doc(userId)
        .collection('jobs').doc(report.proposedJobId);

      const docs = entries.map<JobDocument>((e) => ({
        ...e.data,
        jobId: report.proposedJobId,
      }));
      const aggregates = computeJobAggregates(
        { id: report.proposedJobId },
        docs,
      );

      // Union of photos across all attached docs, deduped by id or storageUrl.
      const photos = docs.flatMap((d) => d.photos || []);
      const seen = new Set<string>();
      const uniquePhotos = photos.filter((p) => {
        const k = p.id || p.storageUrl;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      // Inherit timestamps from the attached docs so a migrated job
      // shows its real history rather than "created just now". Earliest
      // doc.createdAt anchors the Job; latest doc.updatedAt mirrors the
      // most recent activity.
      const createdAt = Math.min(...entries.map((e) => e.createdAtMs).filter((n) => n > 0)) || Date.now();
      const updatedAt = Math.max(...entries.map((e) => toMillis(e.data.updatedAt)).filter((n) => n > 0)) || createdAt;

      // Lift per-stage timestamps off the source documents so the JobCard
      // status line ("accepted 1d ago") reflects real activity instead of
      // the moment the backfill ran. Use the earliest sentAt across all
      // docs (when did this job first go out?), the earliest accept
      // confirmation (respondedAt or doc.acceptedAt), the earliest paid
      // confirmation. quotedAt seeds from sentAt; we don't try to
      // reconstruct scheduled / in_progress / completed since those have
      // no source-doc analogue.
      const stageStamps = computeStageStampsFromDocs(
        entries.map((e) => e.data as unknown as { [k: string]: unknown }),
      );

      const newJob: Job = {
        id: report.proposedJobId,
        userId,
        customerName: report.customerName,
        customerEmail: report.customerEmail,
        customerPhone: report.customerPhone,
        jobAddress: report.jobAddress,
        name: report.jobName,
        stage: report.stage,
        documentIds: aggregates.documentIds,
        primaryDocumentId: report.primaryDocumentId,
        totalQuoted: aggregates.totalQuoted,
        totalInvoiced: aggregates.totalInvoiced,
        totalPaid: aggregates.totalPaid,
        balanceDue: aggregates.balanceDue,
        photos: uniquePhotos.length > 0 ? uniquePhotos : undefined,
        ...stageStamps,
        createdAt,
        updatedAt,
      };

      tx.set(jobRef, stripUndefined(newJob));

      for (const e of entries) {
        const docRef = db()
          .collection('users').doc(userId)
          .collection('documents').doc(e.id);
        tx.update(docRef, { jobId: report.proposedJobId });
      }
    });
  }

  return {
    userId,
    commit: true,
    groupCount: reports.length,
    docCount,
    groups: reports,
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupKey(doc: JobDocument): string {
  const customer =
    (doc.customerEmail || doc.customerPhone || '').toString().trim().toLowerCase() ||
    '∅';
  const address = (doc.jobAddress || '').toString().trim().toLowerCase() || '∅';
  const name = (doc.job?.name || '').toString().trim().toLowerCase() || '∅';
  const raw = `${customer}‖${address}‖${name}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

// Build a Job record from a set of attached documents whose jobId is set
// but whose Job has gone missing (dangling reference). Mirrors what
// runBackfill does for a single group: pick the latest doc as the source
// of customer fields, derive stage from the doc set, inherit timestamps.
// Returns null when there's nothing to rebuild from.
function rebuildDanglingJob(
  userId: string,
  jobId: string,
  docs: JobDocument[],
): Record<string, unknown> | null {
  if (docs.length === 0) return null;

  const sorted = [...docs].sort(
    (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0),
  );
  const primary = sorted[0];
  const customerName = (primary.customerName || '').trim();
  const customerEmail = (primary.customerEmail || '').trim();
  const customerPhone = (primary.customerPhone || '').trim();
  const jobAddress = (primary.jobAddress || '').trim();
  const jobName = (primary.job?.name || '').trim();
  if (!customerName && !customerEmail && !customerPhone && !jobAddress && !jobName) {
    return null;
  }

  const stage = deriveJobStageFromDocs(docs);
  const aggregates = computeJobAggregates({ id: jobId }, docs);
  const stageStamps = computeStageStampsFromDocs(
    docs as unknown as Array<{ [k: string]: unknown }>,
  );

  const createdAtCandidates = docs.map((d) => Number(d.createdAt) || 0).filter((n) => n > 0);
  const updatedAtCandidates = docs.map((d) => Number(d.updatedAt) || 0).filter((n) => n > 0);
  const now = Date.now();
  const createdAt = createdAtCandidates.length > 0 ? Math.min(...createdAtCandidates) : now;
  const updatedAt = updatedAtCandidates.length > 0 ? Math.max(...updatedAtCandidates) : createdAt;

  return {
    id: jobId,
    userId,
    customerName,
    customerEmail,
    customerPhone,
    jobAddress,
    name: jobName || 'Job',
    stage,
    documentIds: aggregates.documentIds,
    primaryDocumentId: primary.id,
    totalQuoted: aggregates.totalQuoted,
    totalInvoiced: aggregates.totalInvoiced,
    totalPaid: aggregates.totalPaid,
    balanceDue: aggregates.balanceDue,
    ...stageStamps,
    createdAt,
    updatedAt,
  };
}

// Reconstruct per-Job-stage timestamps from a set of source documents. Used
// by both the runBackfill path (script + admin callable) and the safety-net
// trigger when materialising Jobs after the fact, so a migrated Job lands
// with realistic "accepted 3d ago" / "paid 2w ago" labels instead of the
// moment of materialisation.
//
//   sentAt → quotedAt (first time the doc was sent)
//   acceptedAt or respondedAt → acceptedAt
//   paidInFullAt or paidAt → paidAt
//
// Earliest wins: a Job that already has multiple docs uses the first time
// any of them moved into that stage. Returns only the fields it has signal
// for; absent fields are omitted so existing values aren't clobbered.
function computeStageStampsFromDocs(
  docs: ReadonlyArray<{ readonly [k: string]: unknown }>,
): Partial<Record<'quotedAt' | 'acceptedAt' | 'paidAt', number>> {
  const out: Partial<Record<'quotedAt' | 'acceptedAt' | 'paidAt', number>> = {};
  const minPositive = (values: number[]): number | null => {
    const filtered = values.filter((n) => Number.isFinite(n) && n > 0);
    return filtered.length ? Math.min(...filtered) : null;
  };

  const sentAts = docs.map((d) => toMillis(d.sentAt));
  const sent = minPositive(sentAts);
  if (sent !== null) out.quotedAt = sent;

  const acceptedAts = docs.map((d) =>
    toMillis(d.acceptedAt ?? d.respondedAt),
  );
  const accepted = minPositive(acceptedAts);
  if (accepted !== null) out.acceptedAt = accepted;

  const paidAts = docs.map((d) => toMillis(d.paidInFullAt ?? d.paidAt));
  const paid = minPositive(paidAts);
  if (paid !== null) out.paidAt = paid;

  return out;
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Firestore rejects undefined values in set(). Strip them so we can build Job
// objects using optional fields without per-field ternaries.
function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
