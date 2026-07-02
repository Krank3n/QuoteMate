/**
 * Shared types for the unified Document model. Consumed by both client
 * (`src/types/document.ts` re-exports these) and server
 * (`functions/src/documentMirror.ts` and `documentHandlers.ts`).
 *
 * Deep field types (Job, Material, etc.) are intentionally loose here —
 * the client's `src/types/document.ts` overlays the strongly-typed
 * `Document` interface on top of these primitives.
 */

export type DocumentStage =
  | 'draft'
  | 'quote_sent'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'invoice_sent'
  | 'partially_paid'
  | 'paid'
  | 'cancelled';

export type DocumentType = 'quote' | 'invoice';

/**
 * How a quote/invoice was delivered to the customer. Recorded alongside
 * `sentAt` on the first send so the activity timeline can show not just when
 * a doc went out but through which channel.
 */
export type SendMethod = 'email' | 'sms' | 'share' | 'export_pdf' | 'manual';

export type DocumentPaymentKind = 'deposit' | 'balance' | 'manual';
export type DocumentPaymentMethod = 'square' | 'bank' | 'cash' | 'other';

export interface DocumentPayment {
  id: string;
  kind: DocumentPaymentKind;
  amount: number;
  paidAt: number; // ms epoch
  squarePaymentId?: string;
  method?: DocumentPaymentMethod;
  notes?: string;
}

/**
 * A Square hosted payment link associated with a Document. `kind` mirrors the
 * payment it collects: a deposit while the doc is a quote, the outstanding
 * balance once invoiced. The Square Payment Links API does not support
 * mutating price after creation, so a stage/amount change requires creating
 * a new link and archiving the old one.
 */
export type DocumentPaymentLinkKind = 'deposit' | 'balance' | 'quote_full';

export interface DocumentPaymentLink {
  id: string;
  url: string;
  kind: DocumentPaymentLinkKind;
  amount: number;
  createdAt: number; // ms epoch
  consumedAt?: number; // ms epoch — set once the link's payment lands
  archivedAt?: number; // ms epoch — set when superseded by a rotation
  /** Square order id; populated when known so we can reverse-index. */
  orderId?: string;
}

/**
 * Loosely typed record-shape of a Document. The strongly typed version lives
 * in `src/types/document.ts` and is structurally compatible — both share the
 * same field names, this one just relaxes the deep types so the shared code
 * doesn't depend on the entire client type tree.
 */
export type DocumentRecord = {
  id: string;
  number: string;
  stage: DocumentStage;
  type: DocumentType;
  createdAt: number;
  updatedAt: number;
  payments: DocumentPayment[];
  paidTotal: number;
  balanceDue: number;
  [key: string]: any;
};

/** Loosely typed legacy quote/invoice as it sits on disk. */
export type LegacyDocumentRecord = Record<string, any>;
