/**
 * Phase-1 dual-write mirror: every write to the legacy `quotes` and `invoices`
 * collections is projected into the unified `documents` collection by these
 * triggers. Old clients keep writing the legacy shape; the new shape is a
 * derived view.
 *
 * Document ID strategy: an invoice converted from a quote (sourceQuoteId set)
 * mirrors into the same documents/{quoteId} doc, so the quote→invoice lifecycle
 * collapses to a single document. Otherwise the legacy id is reused as the
 * document id.
 *
 * Idempotency: writes use merge:true and a updatedAt-based skip so re-running
 * the trigger or the backfill never clobbers a newer projection.
 *
 * Loop prevention: triggers fire on `quotes` and `invoices` only — they never
 * write to those collections, only to `documents`. There is no reverse mirror
 * in this phase.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Adapter — duplicates src/types/documentAdapter.ts behaviour with relaxed
// input typing so the trigger can accept raw Firestore data. Kept in lockstep
// with the canonical adapter; see src/types/documentAdapter.ts for the
// authoritative version used by the client.
// ---------------------------------------------------------------------------

type AnyData = Record<string, any>;

function toMs(value: any): number | undefined {
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
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const t = value.toDate().getTime();
    return isNaN(t) ? undefined : t;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return undefined;
}

function toMsRequired(value: any): number {
  return toMs(value) ?? Date.now();
}

type DocumentType = 'quote' | 'invoice';
type DocumentStage =
  | 'draft'
  | 'quote_sent'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'invoice_sent'
  | 'partially_paid'
  | 'paid'
  | 'cancelled';

interface DocumentPayment {
  id: string;
  kind: 'deposit' | 'balance' | 'manual';
  amount: number;
  paidAt: number;
  squarePaymentId?: string;
  method?: 'square' | 'bank' | 'cash' | 'other';
  notes?: string;
}

function deriveStage(source: AnyData, type: DocumentType): DocumentStage {
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

function projectShared(s: AnyData, type: DocumentType): AnyData {
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
  };
}

function buildQuotePayments(quote: AnyData, quoteId: string): DocumentPayment[] {
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

function buildInvoicePayments(invoice: AnyData, invoiceId: string): DocumentPayment[] {
  const out: DocumentPayment[] = [];
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

function sumPayments(payments: DocumentPayment[]): number {
  return payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
}

function quoteToDocument(quote: AnyData, quoteId: string): AnyData {
  const shared = projectShared(quote, 'quote');
  const payments = buildQuotePayments(quote, quoteId);
  const paidTotal = sumPayments(payments);
  const total = Number(quote.total ?? 0);
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
    legacyQuoteId: quoteId,
    legacyInvoiceId: quote.invoiceId,
  };
}

function invoiceToDocument(invoice: AnyData, invoiceId: string): AnyData {
  const shared = projectShared(invoice, 'invoice');
  const payments = buildInvoicePayments(invoice, invoiceId);
  const paidTotal = sumPayments(payments);
  const total = Number(invoice.total ?? 0);
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
    legacyQuoteId: invoice.sourceQuoteId,
    legacyInvoiceId: invoiceId,
  };
}

// ---------------------------------------------------------------------------
// Mirror writers — pure side-effect functions used by both triggers and the
// backfill callable.
// ---------------------------------------------------------------------------

const db = () => admin.firestore();

// Firestore rejects undefined values; strip them recursively before write.
function stripUndefined(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stripUndefined).filter((v) => v !== undefined);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: AnyData = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

function documentRef(userId: string, docId: string) {
  return db().collection('users').doc(userId).collection('documents').doc(docId);
}

/**
 * The mirror id collapses a quote and its converted invoice into one document.
 * If an invoice carries a sourceQuoteId, both write to documents/{quoteId};
 * standalone quotes/invoices write to documents/{ownId}.
 */
function mirrorIdForQuote(quoteId: string): string {
  return quoteId;
}

function mirrorIdForInvoice(invoice: AnyData, invoiceId: string): string {
  return typeof invoice.sourceQuoteId === 'string' && invoice.sourceQuoteId
    ? invoice.sourceQuoteId
    : invoiceId;
}

interface MirrorWriteResult {
  written: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * Write the projection if it would not clobber a newer one already on disk.
 * The skip is based on updatedAt of the source vs the mirror — if the existing
 * mirror already reflects a strictly newer source updatedAt, leave it alone.
 */
async function writeMirror(
  userId: string,
  mirrorId: string,
  projection: AnyData,
): Promise<MirrorWriteResult> {
  const ref = documentRef(userId, mirrorId);
  const existing = await ref.get();
  if (existing.exists) {
    const existingUpdated = Number(existing.data()?.updatedAt ?? 0);
    const incomingUpdated = Number(projection.updatedAt ?? 0);
    if (existingUpdated > incomingUpdated) {
      return { written: false, skipped: true, reason: 'newer-on-disk' };
    }
  }
  await ref.set(stripUndefined(projection), { merge: true });
  return { written: true, skipped: false };
}

async function deleteMirror(userId: string, mirrorId: string): Promise<void> {
  await documentRef(userId, mirrorId).delete().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export const onQuoteWritten = functions.firestore
  .document('users/{userId}/quotes/{quoteId}')
  .onWrite(async (change, context) => {
    const { userId, quoteId } = context.params as { userId: string; quoteId: string };
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    if (!after && before) {
      // Delete: if the deleted quote was the lineage anchor for an invoice
      // mirror, leave that invoice mirror in place — the invoice trigger
      // owns the lifecycle of any sourceQuoteId-keyed mirror that still has
      // a live invoice. We only delete the mirror if no invoice points at it.
      const invoicesSnap = await db()
        .collection('users').doc(userId)
        .collection('invoices')
        .where('sourceQuoteId', '==', quoteId)
        .limit(1)
        .get();
      if (invoicesSnap.empty) {
        await deleteMirror(userId, mirrorIdForQuote(quoteId));
      }
      return;
    }

    if (!after) return;

    // If a converted invoice already exists for this quote, that invoice's
    // projection wins — skip writing the quote-shaped projection so the
    // collapsed document keeps its invoice view.
    if (after.invoiceId) {
      const invoiceSnap = await db()
        .collection('users').doc(userId)
        .collection('invoices').doc(String(after.invoiceId))
        .get();
      if (invoiceSnap.exists) {
        const invoiceData = invoiceSnap.data() as AnyData;
        const projection = invoiceToDocument(invoiceData, invoiceSnap.id);
        await writeMirror(userId, mirrorIdForQuote(quoteId), projection);
        return;
      }
    }

    const projection = quoteToDocument(after, quoteId);
    await writeMirror(userId, mirrorIdForQuote(quoteId), projection);
  });

export const onInvoiceWritten = functions.firestore
  .document('users/{userId}/invoices/{invoiceId}')
  .onWrite(async (change, context) => {
    const { userId, invoiceId } = context.params as { userId: string; invoiceId: string };
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    if (!after && before) {
      // Delete: if this invoice was collapsed onto a source quote's mirror,
      // re-project from the quote (still the lineage anchor) so the document
      // reverts to the quote view rather than disappearing.
      const sourceQuoteId = typeof before.sourceQuoteId === 'string'
        ? before.sourceQuoteId : null;
      if (sourceQuoteId) {
        const quoteSnap = await db()
          .collection('users').doc(userId)
          .collection('quotes').doc(sourceQuoteId)
          .get();
        if (quoteSnap.exists) {
          const projection = quoteToDocument(quoteSnap.data() as AnyData, quoteSnap.id);
          await writeMirror(userId, mirrorIdForQuote(sourceQuoteId), projection);
          return;
        }
      }
      await deleteMirror(userId, mirrorIdForInvoice(before, invoiceId));
      return;
    }

    if (!after) return;

    const projection = invoiceToDocument(after, invoiceId);
    await writeMirror(userId, mirrorIdForInvoice(after, invoiceId), projection);
  });

// ---------------------------------------------------------------------------
// Backfill — admin-only callable. Walks every user's quotes + invoices and
// runs the same mirror logic. Idempotent: re-runs are safe and cheap (the
// updatedAt skip short-circuits unchanged docs).
// ---------------------------------------------------------------------------

interface BackfillSummary {
  usersProcessed: number;
  quotesMirrored: number;
  invoicesMirrored: number;
  skipped: number;
  errors: number;
  errorSamples: string[];
}

const USER_PAGE_SIZE = 50;
const SUBCOLLECTION_PAGE_SIZE = 200;

async function mirrorAllForUser(userId: string, summary: BackfillSummary): Promise<void> {
  const userRef = db().collection('users').doc(userId);

  // Pre-collect invoice sourceQuoteIds so the quote pass knows which quotes
  // are already collapsed and should defer to the invoice projection.
  const invoicesByQuoteId = new Map<string, { id: string; data: AnyData }>();

  let lastInvoice: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let query = userRef.collection('invoices')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SUBCOLLECTION_PAGE_SIZE);
    if (lastInvoice) query = query.startAfter(lastInvoice);
    const page = await query.get();
    if (page.empty) break;
    for (const inv of page.docs) {
      const data = inv.data() as AnyData;
      if (typeof data.sourceQuoteId === 'string' && data.sourceQuoteId) {
        invoicesByQuoteId.set(data.sourceQuoteId, { id: inv.id, data });
      }
      try {
        const projection = invoiceToDocument(data, inv.id);
        const res = await writeMirror(userId, mirrorIdForInvoice(data, inv.id), projection);
        if (res.written) summary.invoicesMirrored++;
        if (res.skipped) summary.skipped++;
      } catch (err: any) {
        summary.errors++;
        if (summary.errorSamples.length < 10) {
          summary.errorSamples.push(`invoice ${userId}/${inv.id}: ${err?.message ?? err}`);
        }
      }
    }
    lastInvoice = page.docs[page.docs.length - 1];
    if (page.size < SUBCOLLECTION_PAGE_SIZE) break;
  }

  let lastQuote: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let query = userRef.collection('quotes')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SUBCOLLECTION_PAGE_SIZE);
    if (lastQuote) query = query.startAfter(lastQuote);
    const page = await query.get();
    if (page.empty) break;
    for (const q of page.docs) {
      try {
        // If a converted invoice exists for this quote, the invoice pass
        // already wrote the collapsed projection — skip the quote write.
        if (invoicesByQuoteId.has(q.id)) {
          summary.skipped++;
          continue;
        }
        const projection = quoteToDocument(q.data() as AnyData, q.id);
        const res = await writeMirror(userId, mirrorIdForQuote(q.id), projection);
        if (res.written) summary.quotesMirrored++;
        if (res.skipped) summary.skipped++;
      } catch (err: any) {
        summary.errors++;
        if (summary.errorSamples.length < 10) {
          summary.errorSamples.push(`quote ${userId}/${q.id}: ${err?.message ?? err}`);
        }
      }
    }
    lastQuote = page.docs[page.docs.length - 1];
    if (page.size < SUBCOLLECTION_PAGE_SIZE) break;
  }
}

export const mirrorAllDocuments = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (_data, context) => {
    const isAdmin = context.auth?.token?.admin === true;
    if (!context.auth?.uid || !isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const summary: BackfillSummary = {
      usersProcessed: 0,
      quotesMirrored: 0,
      invoicesMirrored: 0,
      skipped: 0,
      errors: 0,
      errorSamples: [],
    };

    let lastUser: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    while (true) {
      let userQuery = db().collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(USER_PAGE_SIZE);
      if (lastUser) userQuery = userQuery.startAfter(lastUser);
      const usersPage = await userQuery.get();
      if (usersPage.empty) break;

      for (const userDoc of usersPage.docs) {
        try {
          await mirrorAllForUser(userDoc.id, summary);
          summary.usersProcessed++;
        } catch (err: any) {
          summary.errors++;
          if (summary.errorSamples.length < 10) {
            summary.errorSamples.push(`user ${userDoc.id}: ${err?.message ?? err}`);
          }
        }
        if (summary.usersProcessed % 25 === 0) {
          functions.logger.info('mirrorAllDocuments progress', summary);
        }
      }

      lastUser = usersPage.docs[usersPage.docs.length - 1];
      if (usersPage.size < USER_PAGE_SIZE) break;
    }

    functions.logger.info('mirrorAllDocuments done', summary);
    return summary;
  });
