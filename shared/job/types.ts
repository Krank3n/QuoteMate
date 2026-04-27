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

// Lightweight to-do item on a Job. Phase-17+: brain-dump of materials
// needed, site tasks, follow-ups. Not a project-management feature, just
// a note with a checkbox.
export interface JobChecklistItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;      // ms epoch
  completedAt?: number;   // ms epoch — stamped when done flips to true
  /** Optional free-form notes — shown when the row is expanded. */
  notes?: string;
  /** Optional deadline — ms epoch. Renders as a chip on the row and a
   * warning tint when overdue. */
  dueAt?: number;
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

  // Schedule. The "when" of the job — duration is intentionally NOT stored
  // here; it's derived from the primary Document's labor (laborHours +
  // laborUnit) so the tradie types it once, on the quote.
  scheduledStartDate?: number;         // ms epoch (start of first day)
  scheduledEndDate?: number;           // ms epoch (end of final day)
  estimatedDurationDays?: number;      // legacy hint, retained for back-compat
  actualStartDate?: number;
  completedDate?: number;

  // Stage-transition timestamps. Stamped by the jobHandlers trigger when
  // the Job's stage advances. Drive the activity timeline on ViewJob.
  // Write-once: never overwritten once set.
  quotedAt?: number;        // inquiry → quoted
  acceptedAt?: number;      // → accepted
  scheduledAt?: number;     // → scheduled
  inProgressAt?: number;    // → in_progress
  completedAt?: number;     // → completed (paired with completedDate for back-compat)
  paidAt?: number;          // → paid
  closedAt?: number;        // → closed
  cancelledAt?: number;     // → cancelled

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
  checklist?: JobChecklistItem[];

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
