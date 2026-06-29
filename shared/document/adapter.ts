/**
 * Bidirectional adapters between legacy Quote/Invoice records and the unified
 * Document record. Operates on loosely typed records so the same logic runs
 * client-side (against typed Quote/Invoice values) and server-side (against
 * raw Firestore data).
 *
 * Round-trip guarantee: documentToQuoteRecord(quoteToDocumentRecord(q)) is a
 * structural superset of q for shared fields; invoice-only optionals are
 * dropped on the way back, and vice versa for invoices.
 */

import type {
  DocumentPayment,
  DocumentPaymentLink,
  DocumentRecord,
  DocumentStage,
  DocumentType,
  LegacyDocumentRecord,
} from './types';

// -------- date helpers --------------------------------------------------

export function toMs(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return isNaN(t) ? undefined : t;
  }
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

export function toMsRequired(value: any): number {
  return toMs(value) ?? Date.now();
}

export function fromMs(ms?: number): Date | undefined {
  return typeof ms === 'number' ? new Date(ms) : undefined;
}

export function fromMsRequired(ms: number): Date {
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
  source: LegacyDocumentRecord,
  type: DocumentType,
): DocumentStage {
  const status = source.status as string | undefined;

  if (type === 'invoice') {
    const paidTotal = Number(source.paidTotal ?? source.paidAmount ?? 0);
    const total = Number(source.total ?? 0);
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

function projectShared(s: LegacyDocumentRecord, type: DocumentType): LegacyDocumentRecord {
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
    // Write the totalled hours into laborHoursTotal so PDFs/HTML can show
    // the section total without re-deriving it. Leave laborHours as the
    // per-unit value the editor stores — overwriting it here used to corrupt
    // sections on the next save/load round-trip, multiplying labour by the
    // section multiplier on every cycle until figures hit the millions.
    sections: s.sections?.map((sec: any) => {
      const perUnit = Number(sec.laborHours ?? 0);
      const mul = Number(sec.multiplier ?? 1);
      return {
        ...sec,
        laborHoursTotal: Math.round(perUnit * mul * 100) / 100,
      };
    }),
    materialsSubtotal: Number(s.materialsSubtotal ?? 0),
    markup: Number(s.markup ?? 0),
    laborMarkup: s.laborMarkup,
    markupAmount: Number(s.markupAmount ?? 0),
    subtotal: Number(s.subtotal ?? 0),
    gst: Number(s.gst ?? 0),
    total: Number(s.total ?? 0),
    showMarkup: s.showMarkup,
    showMaterialCosts: s.showMaterialCosts,
    showLaborCosts: s.showLaborCosts,
    materialsDisplay: s.materialsDisplay,
    laborDisplay: s.laborDisplay,
    showLaborBreakdown: s.showLaborBreakdown,
    travelAdjustment: s.travelAdjustment,
    estimatedDistance: s.estimatedDistance,
    estimatedFuelCost: s.estimatedFuelCost,
    travelGeocodeFailed: s.travelGeocodeFailed,
    pricesIncludeGst: s.pricesIncludeGst,
    termsSnapshot: s.termsSnapshot,
    termsVersionHash: s.termsVersionHash,
    depositTcAccepted: s.depositTcAccepted,
    fullTcAccepted: s.fullTcAccepted,
    tcAccepted: s.tcAccepted,
    notes: s.notes,
    draftEmailBody: s.draftEmailBody,
    draftEmailSubject: s.draftEmailSubject,
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
    fullPaymentLinkId: type === 'quote' ? s.fullPaymentLinkId : undefined,
    fullPaymentLinkUrl: type === 'quote' ? s.fullPaymentLinkUrl : undefined,
    fullPaymentLinkCreatedAt: type === 'quote' ? toMs(s.fullPaymentLinkCreatedAt) : undefined,
    fullPaymentLinkAmount: type === 'quote' ? s.fullPaymentLinkAmount : undefined,

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
    // Xero integration — both quote-side (xeroQuoteId) and invoice-side
    // (xeroInvoiceId) records project. xeroContactId is shared so the
    // invoice generated from a quote re-uses the contact and avoids
    // duplicate-creating it in Xero.
    xeroInvoiceId: type === 'invoice' ? s.xeroInvoiceId : undefined,
    xeroQuoteId: type === 'quote' ? s.xeroQuoteId : undefined,
    xeroContactId: s.xeroContactId,
    xeroSyncStatus: s.xeroSyncStatus,
    xeroSyncedAt: toMs(s.xeroSyncedAt),
    xeroSyncError: s.xeroSyncError,
    squarePaymentLinkId: type === 'invoice' ? s.squarePaymentLinkId : undefined,
    squarePaymentLinkUrl:
      type === 'invoice' ? s.squarePaymentLinkUrl : undefined,
    squarePaymentLinkCreatedAt:
      type === 'invoice' ? toMs(s.squarePaymentLinkCreatedAt) : undefined,
    squarePaymentId: type === 'invoice' ? s.squarePaymentId : undefined,
    squarePaidAt: type === 'invoice' ? toMs(s.squarePaidAt) : undefined,
  };
}

// -------- payment ledger -------------------------------------------------

function buildQuotePayments(quote: LegacyDocumentRecord, quoteId: string): DocumentPayment[] {
  const out: DocumentPayment[] = [];
  const depositPaid = Number(quote.depositPaid ?? 0);
  if (depositPaid > 0) {
    out.push({
      id: quote.depositSquarePaymentId
        ? `deposit-${quote.depositSquarePaymentId}`
        : `deposit-${quoteId}`,
      kind: 'deposit',
      amount: depositPaid,
      paidAt: toMsRequired(quote.depositPaidAt ?? quote.updatedAt),
      squarePaymentId: quote.depositSquarePaymentId,
      method: quote.depositSquarePaymentId ? 'square' : undefined,
    });
  }
  return out;
}

function buildInvoicePayments(invoice: LegacyDocumentRecord, invoiceId: string): DocumentPayment[] {
  const out: DocumentPayment[] = [];
  // The deposit credit on an invoice came from the source quote — represent
  // it explicitly so the unified ledger reflects the customer's full payment
  // history rather than only what hit the invoice directly.
  const depositCredit = Number(invoice.depositCredit ?? 0);
  if (depositCredit > 0) {
    out.push({
      id: `deposit-credit-${invoice.depositCreditFromQuoteId ?? invoiceId}`,
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
        id: `manual-${invoiceId}`,
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

export function sumPayments(payments: DocumentPayment[]): number {
  return payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
}

// -------- payment link derivation ---------------------------------------

/**
 * Derive the active payment link from legacy quote fields. A quote may have
 * a deposit link (depositPaymentLink*) or a full-quote link (fullPaymentLink*);
 * the deposit link takes precedence while the deposit is the outstanding
 * payment, otherwise the full-quote link wins.
 *
 * `consumedAt` is set when the corresponding squarePaymentId is recorded.
 */
function deriveQuoteActiveLink(quote: LegacyDocumentRecord): DocumentPaymentLink | undefined {
  const depositId = quote.depositPaymentLinkId;
  const depositUrl = quote.depositPaymentLinkUrl;
  if (typeof depositId === 'string' && typeof depositUrl === 'string') {
    return {
      id: depositId,
      url: depositUrl,
      kind: 'deposit',
      amount: Number(quote.depositAmount) || 0,
      createdAt: toMs(quote.depositPaymentLinkCreatedAt) ?? toMsRequired(quote.updatedAt),
      consumedAt: quote.depositSquarePaymentId
        ? toMs(quote.depositPaidAt) ?? toMsRequired(quote.updatedAt)
        : undefined,
    };
  }
  const fullId = quote.fullPaymentLinkId;
  const fullUrl = quote.fullPaymentLinkUrl;
  if (typeof fullId === 'string' && typeof fullUrl === 'string') {
    return {
      id: fullId,
      url: fullUrl,
      kind: 'quote_full',
      amount: Number(quote.fullPaymentLinkAmount) || 0,
      createdAt: toMs(quote.fullPaymentLinkCreatedAt) ?? toMsRequired(quote.updatedAt),
    };
  }
  return undefined;
}

function deriveInvoiceActiveLink(invoice: LegacyDocumentRecord): DocumentPaymentLink | undefined {
  const id = invoice.squarePaymentLinkId;
  const url = invoice.squarePaymentLinkUrl;
  if (typeof id !== 'string' || typeof url !== 'string') return undefined;
  return {
    id,
    url,
    kind: 'balance',
    amount: Math.max(0, Number(invoice.total) - (Number(invoice.depositCredit) || 0)),
    createdAt: toMs(invoice.squarePaymentLinkCreatedAt) ?? toMsRequired(invoice.updatedAt),
    consumedAt: invoice.squarePaymentId
      ? toMs(invoice.squarePaidAt) ?? toMsRequired(invoice.updatedAt)
      : undefined,
  };
}

// -------- forward adapters (legacy → Document) --------------------------

export function quoteRecordToDocumentRecord(
  quote: LegacyDocumentRecord,
  quoteId: string,
): DocumentRecord {
  const shared = projectShared(quote, 'quote');
  const payments = buildQuotePayments(quote, quoteId);
  const paidTotal = sumPayments(payments);
  const total = Number(quote.total ?? 0);
  const activePaymentLink = quote.activePaymentLink as DocumentPaymentLink | undefined
    ?? deriveQuoteActiveLink(quote);
  const archivedPaymentLinks = Array.isArray(quote.archivedPaymentLinks)
    ? (quote.archivedPaymentLinks as DocumentPaymentLink[])
    : undefined;
  return {
    ...shared,
    id: quoteId,
    number: quote.quoteNumber || `QU-${quoteId.slice(0, 6)}`,
    stage: deriveStage(quote, 'quote'),
    type: 'quote',
    createdAt: toMsRequired(quote.createdAt),
    updatedAt: toMsRequired(quote.updatedAt),
    payments,
    paidTotal,
    balanceDue: Math.max(0, total - paidTotal),
    activePaymentLink,
    archivedPaymentLinks,
    legacyQuoteId: quoteId,
    legacyInvoiceId: quote.invoiceId,
  } as DocumentRecord;
}

export function invoiceRecordToDocumentRecord(
  invoice: LegacyDocumentRecord,
  invoiceId: string,
): DocumentRecord {
  const shared = projectShared(invoice, 'invoice');
  const payments = buildInvoicePayments(invoice, invoiceId);
  const paidTotal = sumPayments(payments);
  const total = Number(invoice.total ?? 0);
  const activePaymentLink = invoice.activePaymentLink as DocumentPaymentLink | undefined
    ?? deriveInvoiceActiveLink(invoice);
  const archivedPaymentLinks = Array.isArray(invoice.archivedPaymentLinks)
    ? (invoice.archivedPaymentLinks as DocumentPaymentLink[])
    : undefined;
  return {
    ...shared,
    id: invoiceId,
    number: invoice.invoiceNumber || `IN-${invoiceId.slice(0, 6)}`,
    stage: deriveStage(invoice, 'invoice'),
    type: 'invoice',
    createdAt: toMsRequired(invoice.createdAt),
    updatedAt: toMsRequired(invoice.updatedAt),
    payments,
    paidTotal,
    balanceDue: Math.max(0, total - paidTotal),
    activePaymentLink,
    archivedPaymentLinks,
    legacyQuoteId: invoice.sourceQuoteId,
    legacyInvoiceId: invoiceId,
  } as DocumentRecord;
}

// -------- reverse adapters (Document → legacy) --------------------------

function stageToQuoteStatus(stage: DocumentStage): string {
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
    case 'invoice_sent':
    case 'partially_paid':
    case 'paid':
      return 'completed';
  }
}

function stageToInvoiceStatus(stage: DocumentStage): string {
  switch (stage) {
    case 'cancelled':
      return 'cancelled';
    case 'paid':
      return 'paid';
    case 'partially_paid':
      return 'partial';
    case 'invoice_sent':
      return 'sent';
    case 'draft':
    case 'quote_sent':
    case 'quote_accepted':
    case 'quote_rejected':
      return 'draft';
  }
}

export { stageToQuoteStatus, stageToInvoiceStatus };

export function documentRecordToQuoteRecord(doc: DocumentRecord): LegacyDocumentRecord {
  const depositPayment = doc.payments.find((p) => p.kind === 'deposit');
  const active = doc.activePaymentLink as DocumentPaymentLink | undefined;
  // The unified link supersedes the legacy fields when set; otherwise the
  // doc's own legacy field copies (kept by older writers) are returned.
  const depositLink = active && active.kind === 'deposit' ? active : undefined;
  const fullLink = active && active.kind === 'quote_full' ? active : undefined;
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
    showMaterialCosts: doc.showMaterialCosts,
    showLaborCosts: doc.showLaborCosts,
    materialsDisplay: doc.materialsDisplay,
    laborDisplay: doc.laborDisplay,
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
    draftEmailSubject: doc.draftEmailSubject,
    requireDeposit: doc.requireDeposit,
    depositPercentage: doc.depositPercentage,
    depositAmount: doc.depositAmount,
    depositPaid: depositPayment?.amount ?? doc.depositPaid,
    depositPaidAt: fromMs(depositPayment?.paidAt ?? doc.depositPaidAt),
    depositPaymentLinkId: depositLink?.id ?? doc.depositPaymentLinkId,
    depositPaymentLinkUrl: depositLink?.url ?? doc.depositPaymentLinkUrl,
    depositPaymentLinkCreatedAt: depositLink?.createdAt ?? doc.depositPaymentLinkCreatedAt,
    depositSquarePaymentId: depositPayment?.squarePaymentId ?? doc.depositSquarePaymentId,
    fullPaymentLinkId: fullLink?.id ?? (doc as any).fullPaymentLinkId,
    fullPaymentLinkUrl: fullLink?.url ?? (doc as any).fullPaymentLinkUrl,
    fullPaymentLinkCreatedAt: fullLink?.createdAt ?? (doc as any).fullPaymentLinkCreatedAt,
    fullPaymentLinkAmount: fullLink?.amount ?? (doc as any).fullPaymentLinkAmount,
    activePaymentLink: doc.activePaymentLink,
    archivedPaymentLinks: doc.archivedPaymentLinks,
    pricesIncludeGst: doc.pricesIncludeGst,
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
    xeroQuoteId: doc.xeroQuoteId,
    xeroContactId: doc.xeroContactId,
    xeroSyncStatus: doc.xeroSyncStatus,
    xeroSyncedAt: fromMs(doc.xeroSyncedAt),
    xeroSyncError: doc.xeroSyncError,
  };
}

export function documentRecordToInvoiceRecord(doc: DocumentRecord): LegacyDocumentRecord {
  const balancePayment = doc.payments.find((p) => p.kind === 'balance');
  const manualPayment = doc.payments.find((p) => p.kind === 'manual');
  const paid = balancePayment ?? manualPayment;
  const depositCredit = doc.payments
    .filter((p) => p.kind === 'deposit')
    .reduce((acc, p) => acc + p.amount, 0);
  const active = doc.activePaymentLink as DocumentPaymentLink | undefined;
  const balanceLink = active && active.kind === 'balance' ? active : undefined;

  const paymentMethod: string | undefined = paid
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
    showMaterialCosts: doc.showMaterialCosts,
    showLaborCosts: doc.showLaborCosts,
    materialsDisplay: doc.materialsDisplay,
    laborDisplay: doc.laborDisplay,
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
    squarePaymentLinkId: balanceLink?.id ?? doc.squarePaymentLinkId,
    squarePaymentLinkUrl: balanceLink?.url ?? doc.squarePaymentLinkUrl,
    squarePaymentLinkCreatedAt: balanceLink?.createdAt ?? (doc as any).squarePaymentLinkCreatedAt,
    squarePaymentId: doc.squarePaymentId,
    squarePaidAt: fromMs(doc.squarePaidAt),
    activePaymentLink: doc.activePaymentLink,
    archivedPaymentLinks: doc.archivedPaymentLinks,
    depositCredit: depositCredit > 0 ? depositCredit : undefined,
    depositCreditFromQuoteId: depositCredit > 0 ? doc.legacyQuoteId : undefined,
    pricesIncludeGst: doc.pricesIncludeGst,
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
    draftEmailSubject: doc.draftEmailSubject,
  };
}
