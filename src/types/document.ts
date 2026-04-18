/**
 * Unified Document type — the eventual replacement for the parallel Quote
 * and Invoice collections. Defined here so the adapter, state machine, and
 * tests have a single source of truth ahead of the phase-2 migration that
 * will swap the storage layer over. Quote and Invoice continue to be the
 * canonical types until then; nothing reads or writes Document yet.
 */

import type {
  Job,
  Material,
  QuoteSection,
  QuotePhoto,
  TemplateSuggestion,
  PaymentTerms,
  PaymentSyncError,
  SquareDisputeStatus,
  TcAcceptance,
  XeroSyncStatus,
  LaborUnit,
} from './index';

export type DocumentStage =
  | 'draft'
  | 'quote_sent'
  | 'quote_accepted' // deposit may or may not be paid
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
  paidAt: number; // ms epoch — Firestore-friendly across web/native
  squarePaymentId?: string;
  method?: DocumentPaymentMethod;
  notes?: string;
}

export interface Document {
  id: string;
  number: string; // QU-1042 / IN-1042 — format chosen at format time, derived from stage
  stage: DocumentStage;
  type: DocumentType; // current canonical view of this doc
  createdAt: number; // ms epoch — see DocumentPayment.paidAt note
  updatedAt: number;

  // ===== Customer + job =====
  contactId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job: Job;

  // ===== Materials, labor, sections =====
  materials: Material[];
  laborRate: number;
  laborHours: number;
  laborUnit?: LaborUnit;
  laborTotal: number;
  laborExtraHours?: number;
  sections?: QuoteSection[];

  // ===== Pricing / markup / totals =====
  materialsSubtotal: number;
  markup: number;
  laborMarkup?: number;
  markupAmount: number;
  subtotal: number;
  gst: number;
  total: number;

  // ===== Display flags =====
  showMarkup?: boolean;
  showLaborBreakdown?: boolean;

  // ===== Travel adjustment =====
  travelAdjustment?: number;
  estimatedDistance?: number;
  estimatedFuelCost?: number;
  travelGeocodeFailed?: boolean;

  // ===== T&Cs snapshot (shared between quote and invoice flows) =====
  termsSnapshot?: string;
  termsVersionHash?: string;
  // The deposit/full/invoice acceptance records all collapse to a single
  // ledger eventually; for now we surface the three shapes Quote/Invoice
  // already store so the adapter is round-trippable.
  depositTcAccepted?: TcAcceptance;
  fullTcAccepted?: TcAcceptance;
  tcAccepted?: TcAcceptance; // invoice-side equivalent

  notes?: string;
  draftEmailBody?: string;

  // ===== Quote-side optionals =====
  acceptanceToken?: string;
  acceptanceTokenCreatedAt?: number;
  respondedAt?: number;
  respondedBy?: string;
  clientNotes?: string;
  templateSuggestions?: TemplateSuggestion[];
  photos?: QuotePhoto[];
  aiEmailBody?: string;
  aiSkipped?: boolean;
  draftStep?: string;
  // When the doc transitioned from quote-shaped to invoice-shaped.
  invoicedAt?: number;

  // ===== Invoice-side optionals =====
  issueDate?: number;
  dueDate?: number;
  paymentTerms?: PaymentTerms;
  customPaymentDays?: number;

  xeroInvoiceId?: string;
  xeroContactId?: string;
  xeroSyncStatus?: XeroSyncStatus;
  xeroSyncedAt?: number;
  xeroSyncError?: string;

  // ===== Square (covers both quote-deposit and invoice-balance links) =====
  // Quote-deposit link
  depositPaymentLinkId?: string;
  depositPaymentLinkUrl?: string;
  depositPaymentLinkCreatedAt?: number;
  depositSquarePaymentId?: string;
  // Invoice-balance link
  squarePaymentLinkId?: string;
  squarePaymentLinkUrl?: string;
  squarePaymentId?: string;
  squarePaidAt?: number;

  // ===== Deposit shape (snapshotted from quote, also drives invoice credit) =====
  requireDeposit?: boolean;
  depositPercentage?: number;
  depositAmount?: number;
  depositPaid?: number;
  depositPaidAt?: number;

  // ===== Unified payment ledger =====
  payments: DocumentPayment[];

  // Computed (recompute on every write, store so reads are cheap).
  paidTotal: number;
  balanceDue: number;

  // ===== Job linkage (forward-compat) =====
  jobId?: string;

  // ===== Operational alerts =====
  paymentSyncError?: PaymentSyncError;
  disputeStatus?: SquareDisputeStatus;
  disputeId?: string;

  // ===== Migration back-references =====
  legacyQuoteId?: string;
  legacyInvoiceId?: string;
}
