// Top-level Job entity — introduced in Phase 8 of the jobs refactor.
//
// Stored at users/{uid}/jobs/{jobId}. Sits above the unified Document model
// (shared/document/*) — one Job can have many attached Documents via
// doc.jobId. Aggregate fields on the Job are server-computed from those
// attached docs; the client never writes them directly.

export type JobStage =
  | 'inquiry'        // job created, no quote yet
  | 'quoted'         // quote sent
  | 'accepted'       // quote accepted (deposit may or may not be paid)
  | 'scheduled'      // scheduledStartDate is set
  | 'in_progress'    // actualStartDate set, completedDate not set
  | 'completed'      // work done, may still be awaiting payment
  | 'paid'           // invoice paid in full
  | 'closed'         // terminal — archived
  | 'cancelled';     // terminal — job killed

// Structural copy of src/types.QuotePhoto — duplicated so this module stays
// self-contained and doesn't cross-import from src/.
export interface JobPhoto {
  id: string;
  storageUrl: string;
  thumbnailUrl?: string;
  annotated?: boolean;
}

export interface Job {
  id: string;
  userId: string;                      // denormalised for indexing
  customerId?: string;                 // link to Contacts if picked from there
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress: string;

  name: string;                        // "Jones pergola"
  description?: string;

  stage: JobStage;
  archivedAt?: number;

  // Attached documents (unified Document model — a quote that becomes an
  // invoice is the same Document record, so usually a Job has just one).
  documentIds: string[];
  primaryDocumentId?: string;

  // Schedule
  scheduledStartDate?: number;         // ms epoch
  scheduledEndDate?: number;
  estimatedDurationDays?: number;
  actualStartDate?: number;
  completedDate?: number;

  // Calendar sync (Phase 14 — declared but unused in Phase 8)
  googleCalendarEventId?: string;
  googleCalendarId?: string;

  // Customer self-scheduling (Phase 15 — declared but unused in Phase 8)
  allowCustomerScheduling?: boolean;
  customerAvailableSlots?: Array<{ start: number; end: number }>;
  customerPickedSlot?: { start: number; end: number; pickedAt: number };

  // Aggregates — written by the jobHandlers trigger, never by the client.
  totalQuoted: number;      // Σ doc.total where doc.type === 'quote'
  totalInvoiced: number;    // Σ doc.total where doc.type === 'invoice'
  totalPaid: number;        // Σ doc.paidTotal across all attached docs
  balanceDue: number;       // Σ doc.balanceDue across all attached docs

  // Media & notes
  photos?: JobPhoto[];
  notes?: string;

  createdAt: number;
  updatedAt: number;
}

// Minimal subset of the unified DocumentRecord that Phase 8 needs. Matches
// fields on `shared/document/types.DocumentRecord` but kept narrow so the job
// module doesn't take a hard dependency on the full Document type tree.
export interface JobDocument {
  id: string;
  type: 'quote' | 'invoice';
  stage:
    | 'draft'
    | 'quote_sent'
    | 'quote_accepted'
    | 'quote_rejected'
    | 'invoice_sent'
    | 'partially_paid'
    | 'paid'
    | 'cancelled';
  total: number;
  paidTotal: number;
  balanceDue: number;
  jobId?: string;
  createdAt?: number;
  updatedAt?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job?: { name?: string };
  photos?: JobPhoto[];
}
