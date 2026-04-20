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
