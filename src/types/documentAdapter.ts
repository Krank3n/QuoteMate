/**
 * Bidirectional adapters between the legacy Quote/Invoice types and the new
 * unified Document type. Used by the phase-2 migration and by any UI that
 * wants to render either flavour through one code path.
 *
 * Round-trip guarantee: documentToQuote(quoteToDocument(q)) is a structural
 * superset of q for shared fields; invoice-only optionals are dropped on the
 * way back, and vice versa for invoices.
 */

import type { Invoice, Quote } from './index';
import type {
  Document,
  DocumentPayment,
  DocumentStage,
  DocumentType,
} from './document';

// -------- date helpers --------------------------------------------------

function toMs(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return isNaN(t) ? undefined : t;
  }
  // ISO string or Firestore Timestamp shape
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return isNaN(t) ? undefined : t;
  }
  if (typeof value === 'object' && typeof (value as any).toDate === 'function') {
    const t = (value as any).toDate().getTime();
    return isNaN(t) ? undefined : t;
  }
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    return (value as any).seconds * 1000;
  }
  return undefined;
}

function toMsRequired(value: any): number {
  return toMs(value) ?? Date.now();
}

function fromMs(ms?: number): Date | undefined {
  return typeof ms === 'number' ? new Date(ms) : undefined;
}

function fromMsRequired(ms: number): Date {
  return new Date(ms);
}

// -------- stage derivation ----------------------------------------------

/**
 * Map a (Quote | Invoice, type) pair onto the new DocumentStage union. Pure
 * — no I/O, no time, no randomness — so the state machine can be tested in
 * isolation. The mapping favours forward progress: a status the legacy enum
 * couldn't express (e.g. an accepted quote with a paid deposit) collapses
 * to the closest forward stage.
 */
export function deriveStage(
  source: Quote | Invoice,
  type: DocumentType,
): DocumentStage {
  const status = (source as any).status as string | undefined;

  if (type === 'invoice') {
    const inv = source as Invoice;
    const paidTotal = Number(inv.paidTotal ?? inv.paidAmount ?? 0);
    const total = Number(inv.total ?? 0);
    if (status === 'cancelled') return 'cancelled';
    if (status === 'paid' || (total > 0 && paidTotal >= total)) return 'paid';
    if (status === 'partial' || (paidTotal > 0 && paidTotal < total)) {
      return 'partially_paid';
    }
    if (status === 'sent' || status === 'overdue') return 'invoice_sent';
    return 'draft';
  }

  // Quote-side: post-narrowing the legacy enum is draft|sent|accepted|
  // rejected|completed|cancelled — but data on disk may still carry
  // paid/partial/overdue, so handle them defensively.
  switch (status) {
    case 'cancelled':
      return 'cancelled';
    case 'rejected':
      return 'quote_rejected';
    case 'accepted':
    case 'completed':
    case 'paid':
    case 'partial':
      return 'quote_accepted';
    case 'sent':
    case 'overdue':
      return 'quote_sent';
    case 'draft':
    default:
      return 'draft';
  }
}

// -------- shared field projection ---------------------------------------

function projectShared(source: Quote | Invoice, type: DocumentType): Omit<
  Document,
  'id' | 'number' | 'stage' | 'type' | 'createdAt' | 'updatedAt' |
  'payments' | 'paidTotal' | 'balanceDue'
> {
  const s = source as any;
  return {
    contactId: s.contactId,
    customerName: s.customerName ?? '',
    customerEmail: s.customerEmail,
    customerPhone: s.customerPhone,
    jobAddress: s.jobAddress,
    job: s.job,
    materials: s.materials ?? [],
    laborRate: Number(s.laborRate ?? 0),
    laborHours: Number(s.laborHours ?? 0),
    laborUnit: s.laborUnit,
    laborTotal: Number(s.laborTotal ?? 0),
    laborExtraHours: s.laborExtraHours,
    sections: s.sections,
    materialsSubtotal: Number(s.materialsSubtotal ?? 0),
    markup: Number(s.markup ?? 0),
    laborMarkup: s.laborMarkup,
    markupAmount: Number(s.markupAmount ?? 0),
    subtotal: Number(s.subtotal ?? 0),
    gst: Number(s.gst ?? 0),
    total: Number(s.total ?? 0),
    showMarkup: s.showMarkup,
    showLaborBreakdown: s.showLaborBreakdown,
    travelAdjustment: s.travelAdjustment,
    estimatedDistance: s.estimatedDistance,
    estimatedFuelCost: s.estimatedFuelCost,
    travelGeocodeFailed: s.travelGeocodeFailed,
    termsSnapshot: s.termsSnapshot,
    termsVersionHash: s.termsVersionHash,
    depositTcAccepted: s.depositTcAccepted,
    fullTcAccepted: s.fullTcAccepted,
    tcAccepted: s.tcAccepted,
    notes: s.notes,
    draftEmailBody: s.draftEmailBody,
    paymentSyncError: s.paymentSyncError,
    disputeStatus: s.disputeStatus,
    disputeId: s.disputeId,
    jobId: s.jobId,
    requireDeposit: s.requireDeposit,
    depositPercentage: s.depositPercentage,
    depositAmount: s.depositAmount,
    depositPaid: s.depositPaid,
    depositPaidAt: toMs(s.depositPaidAt),
    depositPaymentLinkId: s.depositPaymentLinkId,
    depositPaymentLinkUrl: s.depositPaymentLinkUrl,
    depositPaymentLinkCreatedAt: toMs(s.depositPaymentLinkCreatedAt),
    depositSquarePaymentId: s.depositSquarePaymentId,

    // Quote-only optionals (undefined for invoices)
    acceptanceToken: type === 'quote' ? s.acceptanceToken : undefined,
    acceptanceTokenCreatedAt:
      type === 'quote' ? toMs(s.acceptanceTokenCreatedAt) : undefined,
    respondedAt: type === 'quote' ? toMs(s.respondedAt) : undefined,
    respondedBy: type === 'quote' ? s.respondedBy : undefined,
    clientNotes: type === 'quote' ? s.clientNotes : undefined,
    templateSuggestions:
      type === 'quote' ? s.templateSuggestions : undefined,
    photos: type === 'quote' ? s.photos : undefined,
    aiEmailBody: type === 'quote' ? s.aiEmailBody : undefined,
    aiSkipped: type === 'quote' ? s.aiSkipped : undefined,
    draftStep: type === 'quote' ? s.draftStep : undefined,
    invoicedAt: type === 'quote' ? toMs(s.invoicedAt) : undefined,

    // Invoice-only optionals (undefined for quotes)
    issueDate: type === 'invoice' ? toMs(s.issueDate) : undefined,
    dueDate: type === 'invoice' ? toMs(s.dueDate) : undefined,
    paymentTerms: type === 'invoice' ? s.paymentTerms : undefined,
    customPaymentDays: type === 'invoice' ? s.customPaymentDays : undefined,
    xeroInvoiceId: type === 'invoice' ? s.xeroInvoiceId : undefined,
    xeroContactId: type === 'invoice' ? s.xeroContactId : undefined,
    xeroSyncStatus: type === 'invoice' ? s.xeroSyncStatus : undefined,
    xeroSyncedAt: type === 'invoice' ? toMs(s.xeroSyncedAt) : undefined,
    xeroSyncError: type === 'invoice' ? s.xeroSyncError : undefined,
    squarePaymentLinkId: type === 'invoice' ? s.squarePaymentLinkId : undefined,
    squarePaymentLinkUrl:
      type === 'invoice' ? s.squarePaymentLinkUrl : undefined,
    squarePaymentId: type === 'invoice' ? s.squarePaymentId : undefined,
    squarePaidAt: type === 'invoice' ? toMs(s.squarePaidAt) : undefined,

    // Migration back-references — populated by the converters below.
    legacyQuoteId: undefined,
    legacyInvoiceId: undefined,
  };
}

// -------- payment ledger -------------------------------------------------

function buildQuotePayments(quote: Quote): DocumentPayment[] {
  const out: DocumentPayment[] = [];
  const depositPaid = Number(quote.depositPaid ?? 0);
  if (depositPaid > 0) {
    out.push({
      id: quote.depositSquarePaymentId
        ? `deposit-${quote.depositSquarePaymentId}`
        : `deposit-${quote.id}`,
      kind: 'deposit',
      amount: depositPaid,
      paidAt: toMsRequired(quote.depositPaidAt ?? quote.updatedAt),
      squarePaymentId: quote.depositSquarePaymentId,
      method: quote.depositSquarePaymentId ? 'square' : undefined,
    });
  }
  return out;
}

function buildInvoicePayments(invoice: Invoice): DocumentPayment[] {
  const out: DocumentPayment[] = [];
  // The deposit credit on an invoice came from the source quote — represent
  // it explicitly so the unified ledger reflects the customer's full payment
  // history rather than only what hit the invoice directly.
  const depositCredit = Number(invoice.depositCredit ?? 0);
  if (depositCredit > 0) {
    out.push({
      id: `deposit-credit-${invoice.depositCreditFromQuoteId ?? invoice.id}`,
      kind: 'deposit',
      amount: depositCredit,
      paidAt: toMsRequired(invoice.createdAt),
      method: 'square',
      notes: 'Carried over from source quote',
    });
  }

  const squarePaid = invoice.squarePaymentId
    ? Number(invoice.paidAmount ?? invoice.total ?? 0)
    : 0;
  if (squarePaid > 0 && invoice.squarePaymentId) {
    out.push({
      id: `square-${invoice.squarePaymentId}`,
      kind: 'balance',
      amount: squarePaid,
      paidAt: toMsRequired(invoice.squarePaidAt ?? invoice.paidDate),
      squarePaymentId: invoice.squarePaymentId,
      method: 'square',
    });
  } else {
    // Manual payment recorded by the tradie via recordPayment
    const manual = Number(invoice.paidAmount ?? 0);
    if (manual > 0) {
      out.push({
        id: `manual-${invoice.id}`,
        kind: 'manual',
        amount: manual,
        paidAt: toMsRequired(invoice.paidDate),
        method: invoice.paymentMethod === 'card' ? 'square' :
                invoice.paymentMethod === 'cash' ? 'cash' :
                invoice.paymentMethod === 'bank_transfer' ? 'bank' : 'other',
        notes: invoice.paymentNotes,
      });
    }
  }
  return out;
}

function sumPayments(payments: DocumentPayment[]): number {
  return payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
}

// -------- forward adapters (legacy → Document) --------------------------

export function quoteToDocument(quote: Quote): Document {
  const shared = projectShared(quote, 'quote');
  const payments = buildQuotePayments(quote);
  const paidTotal = sumPayments(payments);
  const total = Number(quote.total ?? 0);
  return {
    ...shared,
    id: quote.id,
    number: quote.quoteNumber || `QU-${quote.id.slice(0, 6)}`,
    stage: deriveStage(quote, 'quote'),
    type: 'quote',
    createdAt: toMsRequired(quote.createdAt),
    updatedAt: toMsRequired(quote.updatedAt),
    payments,
    paidTotal,
    balanceDue: Math.max(0, total - paidTotal),
    legacyQuoteId: quote.id,
    legacyInvoiceId: quote.invoiceId,
  };
}

export function invoiceToDocument(invoice: Invoice): Document {
  const shared = projectShared(invoice, 'invoice');
  const payments = buildInvoicePayments(invoice);
  const paidTotal = sumPayments(payments);
  const total = Number(invoice.total ?? 0);
  return {
    ...shared,
    id: invoice.id,
    number: invoice.invoiceNumber || `IN-${invoice.id.slice(0, 6)}`,
    stage: deriveStage(invoice, 'invoice'),
    type: 'invoice',
    createdAt: toMsRequired(invoice.createdAt),
    updatedAt: toMsRequired(invoice.updatedAt),
    payments,
    paidTotal,
    balanceDue: Math.max(0, total - paidTotal),
    legacyQuoteId: invoice.sourceQuoteId,
    legacyInvoiceId: invoice.id,
  };
}

// -------- reverse adapters (Document → legacy) --------------------------
//
// Best-effort. Fields exclusive to the other shape are dropped — the legacy
// types simply don't carry them. Stage maps back to the closest legacy
// status, never the other way around (an `invoice_sent` Document → 'sent'
// invoice; the reverse can't be inferred without the type field).

function stageToQuoteStatus(stage: DocumentStage): Quote['status'] {
  switch (stage) {
    case 'draft':
      return 'draft';
    case 'quote_sent':
      return 'sent';
    case 'quote_accepted':
      return 'accepted';
    case 'quote_rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    // Invoice-side stages projected back onto a quote — the cleanest mapping
    // is 'completed' since the quote-side journey is finished.
    case 'invoice_sent':
    case 'partially_paid':
    case 'paid':
      return 'completed';
  }
}

function stageToInvoiceStatus(stage: DocumentStage): Invoice['status'] {
  switch (stage) {
    case 'cancelled':
      return 'cancelled';
    case 'paid':
      return 'paid';
    case 'partially_paid':
      return 'partial';
    case 'invoice_sent':
      return 'sent';
    // Pre-invoice stages don't strictly fit; 'draft' is the safe landing pad.
    case 'draft':
    case 'quote_sent':
    case 'quote_accepted':
    case 'quote_rejected':
      return 'draft';
  }
}

export function documentToQuote(doc: Document): Quote {
  const depositPayment = doc.payments.find((p) => p.kind === 'deposit');
  return {
    id: doc.id,
    quoteNumber: doc.number,
    createdAt: fromMsRequired(doc.createdAt),
    updatedAt: fromMsRequired(doc.updatedAt),
    contactId: doc.contactId,
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    jobAddress: doc.jobAddress,
    job: doc.job,
    materials: doc.materials,
    laborRate: doc.laborRate,
    laborHours: doc.laborHours,
    laborUnit: doc.laborUnit,
    laborTotal: doc.laborTotal,
    laborExtraHours: doc.laborExtraHours,
    materialsSubtotal: doc.materialsSubtotal,
    markup: doc.markup,
    laborMarkup: doc.laborMarkup,
    markupAmount: doc.markupAmount,
    subtotal: doc.subtotal,
    gst: doc.gst,
    total: doc.total,
    sections: doc.sections,
    status: stageToQuoteStatus(doc.stage),
    draftStep: doc.draftStep,
    notes: doc.notes,
    aiSkipped: doc.aiSkipped,
    templateSuggestions: doc.templateSuggestions,
    showMarkup: doc.showMarkup,
    showLaborBreakdown: doc.showLaborBreakdown,
    travelAdjustment: doc.travelAdjustment,
    estimatedDistance: doc.estimatedDistance,
    estimatedFuelCost: doc.estimatedFuelCost,
    travelGeocodeFailed: doc.travelGeocodeFailed,
    acceptanceToken: doc.acceptanceToken,
    acceptanceTokenCreatedAt: fromMs(doc.acceptanceTokenCreatedAt),
    respondedAt: fromMs(doc.respondedAt),
    respondedBy: doc.respondedBy,
    clientNotes: doc.clientNotes,
    photos: doc.photos,
    aiEmailBody: doc.aiEmailBody,
    draftEmailBody: doc.draftEmailBody,
    requireDeposit: doc.requireDeposit,
    depositPercentage: doc.depositPercentage,
    depositAmount: doc.depositAmount,
    depositPaid: depositPayment?.amount ?? doc.depositPaid,
    depositPaidAt: fromMs(depositPayment?.paidAt ?? doc.depositPaidAt),
    depositPaymentLinkId: doc.depositPaymentLinkId,
    depositPaymentLinkUrl: doc.depositPaymentLinkUrl,
    depositPaymentLinkCreatedAt: doc.depositPaymentLinkCreatedAt,
    depositSquarePaymentId: depositPayment?.squarePaymentId ?? doc.depositSquarePaymentId,
    termsSnapshot: doc.termsSnapshot,
    termsVersionHash: doc.termsVersionHash,
    depositTcAccepted: doc.depositTcAccepted,
    fullTcAccepted: doc.fullTcAccepted,
    jobId: doc.jobId,
    paidTotal: doc.paidTotal,
    balanceDue: doc.balanceDue,
    paymentSyncError: doc.paymentSyncError,
    disputeStatus: doc.disputeStatus,
    disputeId: doc.disputeId,
    invoiceId: doc.legacyInvoiceId,
    invoicedAt: fromMs(doc.invoicedAt),
  };
}

export function documentToInvoice(doc: Document): Invoice {
  const balancePayment = doc.payments.find((p) => p.kind === 'balance');
  const manualPayment = doc.payments.find((p) => p.kind === 'manual');
  const paid = balancePayment ?? manualPayment;
  const depositCredit = doc.payments
    .filter((p) => p.kind === 'deposit')
    .reduce((acc, p) => acc + p.amount, 0);

  const paymentMethod: Invoice['paymentMethod'] | undefined = paid
    ? paid.method === 'square'
      ? 'card'
      : paid.method === 'bank'
        ? 'bank_transfer'
        : paid.method === 'cash'
          ? 'cash'
          : 'other'
    : undefined;

  return {
    id: doc.id,
    invoiceNumber: doc.number,
    createdAt: fromMsRequired(doc.createdAt),
    updatedAt: fromMsRequired(doc.updatedAt),
    issueDate: fromMs(doc.issueDate) ?? fromMsRequired(doc.createdAt),
    dueDate: fromMs(doc.dueDate) ?? fromMsRequired(doc.createdAt),
    contactId: doc.contactId,
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    jobAddress: doc.jobAddress,
    job: doc.job,
    materials: doc.materials,
    laborRate: doc.laborRate,
    laborHours: doc.laborHours,
    laborUnit: doc.laborUnit,
    laborTotal: doc.laborTotal,
    laborExtraHours: doc.laborExtraHours,
    materialsSubtotal: doc.materialsSubtotal,
    markup: doc.markup,
    laborMarkup: doc.laborMarkup,
    markupAmount: doc.markupAmount,
    subtotal: doc.subtotal,
    gst: doc.gst,
    total: doc.total,
    sections: doc.sections,
    showMarkup: doc.showMarkup,
    showLaborBreakdown: doc.showLaborBreakdown,
    status: stageToInvoiceStatus(doc.stage),
    paymentTerms: doc.paymentTerms ?? 'net_14',
    customPaymentDays: doc.customPaymentDays,
    paidDate: fromMs(paid?.paidAt),
    paidAmount: paid?.amount,
    paymentMethod,
    paymentNotes: paid?.notes,
    sourceQuoteId: doc.legacyQuoteId,
    notes: doc.notes,
    travelAdjustment: doc.travelAdjustment,
    estimatedDistance: doc.estimatedDistance,
    estimatedFuelCost: doc.estimatedFuelCost,
    travelGeocodeFailed: doc.travelGeocodeFailed,
    xeroInvoiceId: doc.xeroInvoiceId,
    xeroContactId: doc.xeroContactId,
    xeroSyncStatus: doc.xeroSyncStatus,
    xeroSyncedAt: fromMs(doc.xeroSyncedAt),
    xeroSyncError: doc.xeroSyncError,
    squarePaymentLinkId: doc.squarePaymentLinkId,
    squarePaymentLinkUrl: doc.squarePaymentLinkUrl,
    squarePaymentId: doc.squarePaymentId,
    squarePaidAt: fromMs(doc.squarePaidAt),
    depositCredit: depositCredit > 0 ? depositCredit : undefined,
    depositCreditFromQuoteId: depositCredit > 0 ? doc.legacyQuoteId : undefined,
    termsSnapshot: doc.termsSnapshot,
    termsVersionHash: doc.termsVersionHash,
    tcAccepted: doc.tcAccepted,
    jobId: doc.jobId,
    paidTotal: doc.paidTotal,
    balanceDue: doc.balanceDue,
    paymentSyncError: doc.paymentSyncError,
    disputeStatus: doc.disputeStatus,
    disputeId: doc.disputeId,
    draftEmailBody: doc.draftEmailBody,
  };
}
