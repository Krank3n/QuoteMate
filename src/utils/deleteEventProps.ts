/**
 * Props for the `quote_deleted` analytics event.
 *
 * Why it exists: on 13 Sep 2026 a new tradie's first two Mate quotes ($23,100
 * and a drainage job) were deleted from the phone 11 s after the app came to
 * the foreground, and nothing recorded who or what did it — every client
 * delete path needs a tap, but the app tracked none of them. This gives the
 * funnel a row per deleted document: which screen deleted it, how far it had
 * got, and how old it was. No PII — ids, stages and numbers only.
 */

/** Where the delete was triggered. Extend when a new delete surface lands. */
export type QuoteDeleteSource =
  // The dashboard's "in-progress draft" card → Delete draft → confirm.
  | 'dashboard_draft_card'
  // A QuoteCard on the dashboard list (its own confirmation modal).
  | 'dashboard_quote_card'
  // The dashboard's shared delete confirmation modal.
  | 'dashboard_delete_modal'
  // "Delete job" on the job actions sheet, cascading through attached docs.
  | 'job_cascade'
  // Mate's propose_delete_quote, applied from chat.
  | 'mate_proposal'
  // A caller that has not named itself yet.
  | 'unknown';

/** The subset of a Quote / Invoice / Document the props are read from. */
export interface DeletableRecord {
  id: string;
  createdAt?: Date | number | string;
  status?: string;
  stage?: string;
  draftStep?: string;
  sentAt?: number | string | null;
  total?: number;
  customerEmail?: string;
  customerPhone?: string;
  materials?: unknown[];
}

export interface QuoteDeletedProps {
  doc_type: 'quote' | 'invoice';
  doc_id: string;
  source: QuoteDeleteSource;
  /** Legacy `status` or unified `stage`, whichever the record carries. */
  stage: string;
  draft_step: string | null;
  /** True once the doc had gone to a customer (stage/status past draft, or sentAt). */
  was_sent: boolean;
  total: number;
  material_count: number;
  has_customer_email: boolean;
  has_customer_phone: boolean;
  /** Hours since createdAt, one decimal; null when createdAt is unusable. */
  age_hours: number | null;
  /** The delete fired with no local record to describe — id only. */
  record_found: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

function toMs(v: Date | number | string | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function describeDeletedDoc(
  docType: 'quote' | 'invoice',
  id: string,
  record: DeletableRecord | null | undefined,
  source: QuoteDeleteSource,
  now: number = Date.now(),
): QuoteDeletedProps {
  if (!record) {
    return {
      doc_type: docType,
      doc_id: id,
      source,
      stage: 'unknown',
      draft_step: null,
      was_sent: false,
      total: 0,
      material_count: 0,
      has_customer_email: false,
      has_customer_phone: false,
      age_hours: null,
      record_found: false,
    };
  }
  const stage = record.stage || record.status || 'draft';
  const created = toMs(record.createdAt);
  const sentAt = toMs(record.sentAt ?? null);
  return {
    doc_type: docType,
    doc_id: record.id || id,
    source,
    stage,
    draft_step: record.draftStep || null,
    was_sent: stage !== 'draft' || sentAt !== null,
    total: Number.isFinite(record.total) ? Math.round((record.total as number) * 100) / 100 : 0,
    material_count: Array.isArray(record.materials) ? record.materials.length : 0,
    has_customer_email: !!(record.customerEmail && record.customerEmail.trim()),
    has_customer_phone: !!(record.customerPhone && record.customerPhone.trim()),
    age_hours: created === null ? null : Math.max(0, Math.round(((now - created) / 3600e3) * 10) / 10),
    record_found: true,
  };
}

/** Where a job delete was triggered. */
export type JobDeleteSource =
  // "Delete job" on the job actions sheet (after its attached docs cascade).
  | 'job_actions_sheet'
  // Mate deleted a quote and the parent job had nothing left on it.
  | 'mate_cascade'
  | 'unknown';

export interface DeletableJob {
  id: string;
  createdAt?: number | string | Date;
  stage?: string;
  name?: string;
  customerEmail?: string;
  customerPhone?: string;
  documentIds?: string[];
}

export interface JobDeletedProps {
  job_id: string;
  source: JobDeleteSource;
  stage: string;
  /** Docs still linked when the job went — the cascade deletes them first, so this is usually 0. */
  attached_doc_count: number;
  has_name: boolean;
  has_customer_email: boolean;
  has_customer_phone: boolean;
  age_hours: number | null;
  record_found: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

export function describeDeletedJob(
  id: string,
  job: DeletableJob | null | undefined,
  source: JobDeleteSource,
  now: number = Date.now(),
): JobDeletedProps {
  if (!job) {
    return {
      job_id: id,
      source,
      stage: 'unknown',
      attached_doc_count: 0,
      has_name: false,
      has_customer_email: false,
      has_customer_phone: false,
      age_hours: null,
      record_found: false,
    };
  }
  const created = toMs(job.createdAt);
  return {
    job_id: job.id || id,
    source,
    stage: job.stage || 'unknown',
    attached_doc_count: Array.isArray(job.documentIds) ? job.documentIds.length : 0,
    has_name: !!(job.name && job.name.trim()),
    has_customer_email: !!(job.customerEmail && job.customerEmail.trim()),
    has_customer_phone: !!(job.customerPhone && job.customerPhone.trim()),
    age_hours: created === null ? null : Math.max(0, Math.round(((now - created) / 3600e3) * 10) / 10),
    record_found: true,
  };
}
