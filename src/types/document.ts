/**
 * Unified Document type — the eventual replacement for the parallel Quote
 * and Invoice collections. The stage/payment primitives live in
 * `shared/document/types.ts` so the server (Cloud Functions) and client
 * share one source of truth. The strongly-typed `Document` interface here
 * overlays those primitives with the client's existing typed deep fields
 * (Job, Material, etc.).
 */

import type {
  JobSpec,
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

export type {
  DocumentStage,
  DocumentType,
  DocumentPayment,
  DocumentPaymentKind,
  DocumentPaymentMethod,
  DocumentPaymentLink,
  DocumentPaymentLinkKind,
} from '../../shared/document/types';

import type {
  DocumentStage,
  DocumentType,
  DocumentPayment,
  DocumentPaymentLink,
} from '../../shared/document/types';

export interface Document {
  id: string;
  number: string; // QU-1042 / IN-1042 — format chosen at format time, derived from stage
  stage: DocumentStage;
  type: DocumentType; // current canonical view of this doc
  createdAt: number; // ms epoch — Firestore-friendly across web/native
  updatedAt: number;

  // ===== Customer + job =====
  contactId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job: JobSpec;

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
  showMaterialCosts?: boolean;
  showLaborCosts?: boolean;
  showLaborBreakdown?: boolean;

  // ===== Travel adjustment =====
  travelAdjustment?: number;
  estimatedDistance?: number;
  estimatedFuelCost?: number;
  travelGeocodeFailed?: boolean;

  // ===== GST mode snapshot =====
  // Inclusive vs exclusive at the time this document was created. Calculator
  // and PDF render branch on this; falls back to BusinessSettings when undefined.
  pricesIncludeGst?: boolean;

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
  // Stage-transition timestamps. Set by setDocumentStage on the server —
  // never overwritten once set. Drive the activity timeline on ViewJob.
  sentAt?: number;           // first time the doc was stage_sent (quote or invoice)
  acceptedAt?: number;       // first time the doc moved to quote_accepted
  paidInFullAt?: number;     // first time the doc moved to paid
  // When the doc transitioned from quote-shaped to invoice-shaped.
  invoicedAt?: number;

  // ===== Invoice-side optionals =====
  issueDate?: number;
  dueDate?: number;
  paymentTerms?: PaymentTerms;
  customPaymentDays?: number;

  xeroInvoiceId?: string;
  // Quote-side Xero record. Set when a quote is pushed to Xero as a Quote.
  // Carried over to the resulting invoice so we can set Xero's Reference
  // field for traceability between the two records in Xero.
  xeroQuoteId?: string;
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

  // ===== Phase-3 unified payment-link lifecycle =====
  // Single active link per Document, rotated on stage transitions. Old links
  // are kept in archivedPaymentLinks[] for audit (Square links don't get
  // explicitly voided — they 404 after their TTL).
  activePaymentLink?: DocumentPaymentLink;
  archivedPaymentLinks?: DocumentPaymentLink[];

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
