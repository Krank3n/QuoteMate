/**
 * Phase-2 unified Cloud Function handlers driven by the unified Document model.
 * Old per-type endpoints (sendQuoteEmail / sendInvoiceEmail / etc.) are kept
 * as shims in functions/src/index.ts and delegate here.
 *
 * Design principles:
 *   - The source of truth is `users/{uid}/documents/{docId}`. Reads prefer it,
 *     and fall back to legacy quotes/invoices via the shared adapter when the
 *     mirror hasn't fired yet (early adopters or pre-backfill).
 *   - Writes go to the legacy collection AND to documents/{id} so neither view
 *     lags. The mirror trigger from phase-1 keeps the documents projection
 *     consistent regardless, but the direct write keeps reads fast.
 *   - Branching on doc.type / doc.stage replaces the parallel quote/invoice
 *     code paths.
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {
  buildQuoteEmailHtml,
  buildInvoiceEmailHtml,
  sendEmail,
  getUserEmail,
  sendQuoteSentEmail,
} from './email';
import {
  buildQuotePdfHtml,
  buildInvoicePdfHtml,
  generateQuotePdfBuffer,
} from './pdfGenerator';
import { hashTerms } from './shared/pdf/terms/defaultAuTradie';
import { dollarsToCents, centsToDollars } from './shared/pdf/money';
import {
  quoteRecordToDocumentRecord,
  invoiceRecordToDocumentRecord,
  documentRecordToQuoteRecord,
  documentRecordToInvoiceRecord,
} from './shared/document/adapter';
import { canTransition } from './shared/document/stage';
import type {
  DocumentRecord,
  DocumentStage,
  DocumentPayment,
  DocumentPaymentLink,
  DocumentPaymentLinkKind,
} from './shared/document/types';

type AnyData = Record<string, any>;

// ---------------------------------------------------------------------------
// Document loaders
// ---------------------------------------------------------------------------

const db = () => admin.firestore();

// Loose RFC 5321 sanity check: one @, no whitespace, dot in the domain. Not a
// full validator — the goal is to catch typos like trailing characters that
// would silently route customer replies into the void.
function isLikelyValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/**
 * Decide which address to use as Reply-To on customer-facing sends. Prefers
 * the saved business email; falls back to the auth email when the business
 * email is missing or malformed. Returns null only when both are unusable.
 */
async function resolveTradieReplyEmail(
  userId: string,
  businessEmail: string | undefined,
): Promise<string | null> {
  const trimmed = (businessEmail || '').trim();
  if (trimmed && isLikelyValidEmail(trimmed)) return trimmed;
  if (trimmed) {
    // Logged so we can surface bad data in support / outreach later.
    console.warn(
      `resolveTradieReplyEmail: business.email "${trimmed}" failed validation for user ${userId}; falling back to auth email`,
    );
  }
  const authEmail = await getUserEmail(userId);
  if (authEmail && isLikelyValidEmail(authEmail)) return authEmail;
  return null;
}

/**
 * Load a unified document for a user. Prefers `documents/{id}`. Falls back to
 * `quotes/{id}` then `invoices/{id}`, mirroring through the shared adapter on
 * the fly so the rest of the handler chain only deals with the unified shape.
 *
 * Returns null when nothing matching exists.
 */
export async function loadDocument(
  userId: string,
  docId: string,
): Promise<DocumentRecord | null> {
  const firestore = db();
  const docRef = firestore.doc(`users/${userId}/documents/${docId}`);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
    return docSnap.data() as DocumentRecord;
  }

  // Fall back to legacy. Quote-id-keyed mirror collapses converted invoices
  // back onto their source quote, so we look at the invoice path first only
  // if a quote with this id doesn't exist.
  const quoteSnap = await firestore.doc(`users/${userId}/quotes/${docId}`).get();
  if (quoteSnap.exists) {
    return quoteRecordToDocumentRecord(quoteSnap.data() as AnyData, docId);
  }
  const invoiceSnap = await firestore.doc(`users/${userId}/invoices/${docId}`).get();
  if (invoiceSnap.exists) {
    return invoiceRecordToDocumentRecord(invoiceSnap.data() as AnyData, docId);
  }
  return null;
}

/**
 * Load a document by interpreting the legacy quote id semantics. If the quote
 * has been converted to an invoice (legacyInvoiceId set in the documents
 * mirror or invoiceId on the quote), the unified document is keyed by the
 * source quote id, so this just delegates to loadDocument.
 */
export async function loadDocumentForQuoteId(
  userId: string,
  quoteId: string,
): Promise<DocumentRecord | null> {
  return loadDocument(userId, quoteId);
}

/**
 * Load a document for a legacy invoice id. The mirror keys on sourceQuoteId
 * when set; if the lookup by raw invoice id misses, fall back through the
 * adapter so callers always see the unified view.
 */
export async function loadDocumentForInvoiceId(
  userId: string,
  invoiceId: string,
): Promise<DocumentRecord | null> {
  const firestore = db();
  const invoiceSnap = await firestore.doc(`users/${userId}/invoices/${invoiceId}`).get();
  if (!invoiceSnap.exists) {
    return loadDocument(userId, invoiceId);
  }
  const invoice = invoiceSnap.data() as AnyData;
  const mirrorId = typeof invoice.sourceQuoteId === 'string' && invoice.sourceQuoteId
    ? invoice.sourceQuoteId
    : invoiceId;
  const mirrorSnap = await firestore.doc(`users/${userId}/documents/${mirrorId}`).get();
  if (mirrorSnap.exists) {
    return mirrorSnap.data() as DocumentRecord;
  }
  return invoiceRecordToDocumentRecord(invoice, invoiceId);
}

/**
 * Persist a partial document update. Writes to the documents collection
 * directly so the new view doesn't lag the legacy collection. Idempotent
 * via merge:true; updatedAt is bumped to current time.
 */
export async function writeDocumentUpdate(
  userId: string,
  docId: string,
  partial: AnyData,
): Promise<void> {
  const ref = db().doc(`users/${userId}/documents/${docId}`);
  await ref.set(stripUndefined({ ...partial, updatedAt: Date.now() }), { merge: true });
}

function stripUndefined(value: any): any {
  if (Array.isArray(value)) return value.map(stripUndefined).filter((v) => v !== undefined);
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

// ---------------------------------------------------------------------------
// Stage transitions — single canonical chokepoint
// ---------------------------------------------------------------------------

/**
 * Phase-4 stage-write chokepoint. Every server-side path that mutates a
 * document's stage MUST go through this function so the state machine in
 * shared/document/stage.ts can observe (and, in phase-4-tighten, enforce)
 * transitions consistently.
 *
 * Soft-enforce semantics: an illegal transition is logged to Cloud Logging
 * AND recorded as a Firestore violation event (read by getStageViolationCounts),
 * but the write is still applied — phase-4 is observability-only. Phase-4-
 * tighten will flip this to a hard rejection.
 *
 * Signature note: the caller passes `fromStage` rather than the function
 * re-loading the document. Every existing call site already has the doc in
 * hand, and a stage write inside a payment webhook is hot enough that an
 * extra read isn't free.
 */

export interface SetDocumentStageInput {
  uid: string;
  docId: string;
  fromStage: DocumentStage;
  toStage: DocumentStage;
  reason: string;
  /**
   * If supplied, the stage write (and any extraUpdates) is added to this
   * batch instead of issued as its own set(). Lets the caller fold the
   * stage transition into a wider document write atomically.
   */
  batch?: FirebaseFirestore.WriteBatch;
  /**
   * Additional fields to merge alongside `stage` on the documents/{id} doc.
   * `updatedAt` is always stamped by this helper.
   */
  extraUpdates?: AnyData;
}

export interface SetDocumentStageResult {
  accepted: boolean;
  from: DocumentStage;
  to: DocumentStage;
}

const STAGE_VIOLATIONS_COLLECTION = '_telemetry/stage/violations';

function recordStageViolation(
  uid: string,
  docId: string,
  from: DocumentStage,
  to: DocumentStage,
  reason: string,
  callsite: string | undefined,
): void {
  // Fire-and-forget. We don't want a Firestore hiccup on the telemetry write
  // to derail the actual stage write the caller is trying to do.
  db().collection(STAGE_VIOLATIONS_COLLECTION).add({
    uid,
    docId,
    from,
    to,
    reason,
    callsite: callsite ?? null,
    at: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err: any) => {
    functions.logger.warn('phase4_stage_violation_log_failed', {
      uid, docId, message: err?.message,
    });
  });
}

export async function setDocumentStage(
  input: SetDocumentStageInput,
): Promise<SetDocumentStageResult> {
  const { uid, docId, fromStage, toStage, reason, batch, extraUpdates } = input;
  const accepted = canTransition(fromStage, toStage);
  if (!accepted) {
    const callsite = new Error().stack;
    console.warn('[stage] illegal transition', {
      uid, docId, from: fromStage, to: toStage, reason, callsite,
    });
    functions.logger.warn('phase4_illegal_stage_transition', {
      uid, docId, from: fromStage, to: toStage, reason,
    });
    recordStageViolation(uid, docId, fromStage, toStage, reason, callsite);
  }

  const update: AnyData = stripUndefined({
    ...(extraUpdates || {}),
    ...stageTransitionTimestamps(fromStage, toStage),
    stage: toStage,
    updatedAt: Date.now(),
  });
  const ref = db().doc(`users/${uid}/documents/${docId}`);
  if (batch) {
    batch.set(ref, update, { merge: true });
  } else {
    await ref.set(update, { merge: true });
  }

  return { accepted, from: fromStage, to: toStage };
}

/**
 * Stamp the per-stage "when did this happen" field used by the Phase-17
 * activity timeline. Only fires when the doc actually moves stage (so
 * self-transitions don't reset the original timestamp) and only for the
 * field mapped to the incoming stage.
 */
function stageTransitionTimestamps(
  fromStage: DocumentStage,
  toStage: DocumentStage,
): Record<string, number> {
  if (fromStage === toStage) return {};
  const now = Date.now();
  switch (toStage) {
    case 'quote_sent':
      return { sentAt: now };
    case 'quote_accepted':
      return { acceptedAt: now };
    case 'invoice_sent':
      // invoicedAt is also set by convertDocumentToInvoice via extraUpdates;
      // stamping sentAt here captures the "I actually sent the invoice" event.
      return { sentAt: now };
    case 'paid':
      return { paidInFullAt: now };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// PDF + email payload builders (shared between quote and invoice flows)
// ---------------------------------------------------------------------------

interface BusinessSettings {
  businessName?: string;
  email?: string;
  phone?: string;
  address?: string;
  abn?: string;
  website?: string;
  logoStorageUrl?: string;
  logoUri?: string;
  brandColor?: string;
  pdfTemplate?: any;
  showMarkup?: boolean;
  showMaterialCostsByDefault?: boolean;
  showLaborCostsByDefault?: boolean;
  showLaborHours?: boolean;
  groupMaterialsBySection?: boolean;
  paymentMethods?: any;
  termsAndConditions?: string;
  [key: string]: any;
}

function applyHideMarkupForDisplay(q: any, businessSettings?: any) {
  const matMarkup = Number(q.markup) || 0;
  const laborMarkup = Number(q.laborMarkup ?? q.markup) || 0;
  // Resolution order matches the PDF: per-doc override > business default > false.
  const showMarkup = q.showMarkup !== undefined
    ? q.showMarkup === true
    : businessSettings?.showMarkup === true;
  const hideMarkup = !showMarkup && (matMarkup > 0 || laborMarkup > 0);
  if (!hideMarkup) {
    return {
      materials: (q.materials || []).map((m: any) => ({ ...m })),
      materialsSubtotal: q.materialsSubtotal || 0,
      laborTotal: q.laborTotal || 0,
      subtotal: q.subtotal || 0,
      markupAmount: q.markupAmount || 0,
    };
  }
  const matFactor = 1 + matMarkup / 100;
  const laborFactor = 1 + laborMarkup / 100;
  const inflatedMaterials = (q.materials || []).map((m: any) => ({
    ...m,
    price: (Number(m.price) || 0) * matFactor,
    totalPrice: (Number(m.totalPrice) || 0) * matFactor,
  }));
  return {
    materials: inflatedMaterials,
    materialsSubtotal: (Number(q.materialsSubtotal) || 0) * matFactor,
    laborTotal: (Number(q.laborTotal) || 0) * laborFactor,
    subtotal:
      ((Number(q.materialsSubtotal) || 0) * matFactor) +
      ((Number(q.laborTotal) || 0) * laborFactor) +
      (Number(q.travelAdjustment) || 0),
    markupAmount: 0,
  };
}

function buildPdfMaterials(materials: any[]): any[] {
  return (materials || []).map((m: any) => ({
    name: m.name,
    quantity: m.quantity,
    unit: m.unit,
    price: m.price || 0,
    totalPrice: m.totalPrice || 0,
    section: m.section,
  }));
}

function buildPdfSections(sections: any[]): any[] {
  return (sections || []).map((s: any) => ({
    name: s.name,
    laborHours: s.laborHours,
    laborRate: s.laborRate,
    laborUnit: s.laborUnit,
    laborTotal: s.laborTotal,
  }));
}

function businessLogoHtml(business: BusinessSettings): string {
  const url = business.logoStorageUrl || business.logoUri || '';
  if (!url) return '';
  return `<img src="${url}" alt="${business.businessName || 'Business'}" class="logo" />`;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
}

function fmtAuDate(value: any): string {
  return new Date(value || Date.now()).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Email/PDF input shape — unified, derived from a Document
// ---------------------------------------------------------------------------

export interface SendDocumentEmailInput {
  userId: string;
  docId: string;
  emailBody: string;
  recipientEmail: string;
  isTestSend?: boolean;
  includePhotos?: boolean;
  /**
   * Override fields the client may have edited locally and wants persisted as
   * part of this send. Mirrors the legacy `quote: ...` / `invoice: ...` body
   * field on the old endpoints.
   */
  overrides?: AnyData;
  /**
   * Helpers normally constructed in the index.ts squareWebhook scope but
   * needed here to mint deposit/full-quote payment links during quote send.
   * Injected so this module doesn't need to import the entire Square stack.
   */
  squareDepositLinkMint?: (userId: string, quoteId: string) => Promise<{ paymentLinkUrl: string } | null>;
  squareInvoiceLinkMint?: (userId: string, invoiceId: string) => Promise<{ paymentLinkId: string; paymentLinkUrl: string } | null>;
  /**
   * Generate the customer acceptance URL for a quote. Injected because the
   * URL host is environment-specific and the legacy code derives it from a
   * project-level constant in index.ts.
   */
  acceptanceUrlForToken?: (token: string) => string;
  /**
   * For quotes: photo attachment fetch helper (Brevo expects base64 attachments).
   */
  fetchPhotoAttachments?: (urls: string[]) => Promise<Array<{ name: string; content: string }>>;
  /**
   * Crypto helpers for acceptance token. Injected (not imported) to keep this
   * file free of crypto/Node-only deps that complicate testing.
   */
  generateAcceptanceToken?: () => { token: string; hashedToken: string };
}

export interface SendDocumentEmailResult {
  success: boolean;
  acceptanceUrl?: string;
}

/**
 * Unified email-send. Branches on doc.type for quote vs invoice copy, PDF
 * template, and acceptance/payment link side-effects. The shape returned
 * matches what the legacy sendQuoteEmail / sendInvoiceEmail returned so the
 * shims can pass it through unmodified.
 */
export async function sendDocumentEmail(
  doc: DocumentRecord,
  input: SendDocumentEmailInput,
): Promise<SendDocumentEmailResult> {
  const firestore = db();
  const { userId, docId, emailBody, recipientEmail, isTestSend, includePhotos } = input;

  // Settings + terms snapshot
  const settingsDoc = await firestore.doc(`users/${userId}/settings/business`).get();
  const business: BusinessSettings = settingsDoc.exists ? (settingsDoc.data() as BusinessSettings) : {};
  const termsRaw = typeof business.termsAndConditions === 'string'
    ? business.termsAndConditions.trim()
    : '';
  const termsToSend: string | null = termsRaw || null;
  const termsVersionHash = termsToSend ? hashTerms(termsToSend) : null;

  if (doc.type === 'quote') {
    return sendQuoteFlavour({
      userId, docId, emailBody, recipientEmail, isTestSend, includePhotos,
      doc, business, termsToSend, termsVersionHash, input,
    });
  }
  return sendInvoiceFlavour({
    userId, docId, emailBody, recipientEmail, isTestSend, includePhotos,
    doc, business, termsToSend, termsVersionHash, input,
  });
}

interface FlavourArgs {
  userId: string;
  docId: string;
  emailBody: string;
  recipientEmail: string;
  isTestSend?: boolean;
  includePhotos?: boolean;
  doc: DocumentRecord;
  business: BusinessSettings;
  termsToSend: string | null;
  termsVersionHash: string | null;
  input: SendDocumentEmailInput;
}

async function sendQuoteFlavour(args: FlavourArgs): Promise<SendDocumentEmailResult> {
  const firestore = db();
  const { userId, docId, emailBody, recipientEmail, isTestSend, includePhotos,
          doc, business, termsToSend, termsVersionHash, input } = args;

  // Quote-shaped projection for downstream PDF/email builders that still
  // accept the legacy field names (quoteNumber, requireDeposit, etc.).
  const quote: AnyData = documentRecordToQuoteRecord(doc as DocumentRecord);
  Object.assign(quote, input.overrides || {});

  // Acceptance token
  const tokenGen = input.generateAcceptanceToken ?? (() => {
    throw new Error('generateAcceptanceToken not injected');
  });
  const { token, hashedToken } = tokenGen();
  const quoteRef = firestore.doc(`users/${userId}/quotes/${docId}`);
  const docRef = firestore.doc(`users/${userId}/documents/${docId}`);

  const batch = firestore.batch();
  // Field ordering: Object.assign client overrides FIRST, then stamp
  // server-managed fields on top. A resend that round-trips
  // acceptanceTokenCreatedAt as a null/stale value via the client must not
  // clobber the fresh serverTimestamp — that bug let the acceptance page
  // read `new Date(null)` = 1970 and false-report links as expired.
  const quoteUpdate: AnyData = {};
  if (input.overrides) {
    Object.assign(quoteUpdate, input.overrides);
    delete quoteUpdate.id;
  }
  quoteUpdate.acceptanceTokenHash = hashedToken;
  quoteUpdate.acceptanceTokenCreatedAt = admin.firestore.FieldValue.serverTimestamp();
  if (!isTestSend) {
    quoteUpdate.status = 'sent';
    quoteUpdate.sentAt = admin.firestore.FieldValue.serverTimestamp();
    quoteUpdate.aiEmailBody = emailBody;
    // Server-stamped updatedAt forces the client's mergeRemoteQuotes to
    // accept the 'sent' snapshot over its own in-flight saveDraft write.
    quoteUpdate.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  batch.set(quoteRef, quoteUpdate, { merge: true });
  // Step 7 — auto-flip stage on send. For real sends only.
  if (!isTestSend) {
    await setDocumentStage({
      uid: userId,
      docId,
      fromStage: doc.stage,
      toStage: 'quote_sent',
      reason: 'sendDocumentEmail:quote',
      batch,
      extraUpdates: {
        aiEmailBody: emailBody,
        acceptanceTokenCreatedAt: Date.now(),
      },
    });
  }
  batch.set(firestore.doc(`quoteAcceptanceTokens/${hashedToken}`), {
    userId,
    quoteId: docId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  const acceptanceUrl = input.acceptanceUrlForToken
    ? input.acceptanceUrlForToken(token)
    : `https://us-central1-hansendev.cloudfunctions.net/quoteAcceptancePage?token=${token}`;

  const photoUrls = (quote.photos || []).map((p: any) => p.storageUrl).filter(Boolean);
  const logoUrl = business.logoStorageUrl || business.logoUri || '';
  const displayQuote = applyHideMarkupForDisplay(quote, business);
  const emailMaterials = displayQuote.materials.map((m: any) => ({
    name: m.name, quantity: m.quantity, unit: m.unit,
    totalPrice: m.totalPrice || 0, section: m.section,
  }));
  const businessData = {
    name: business.businessName || '', abn: business.abn,
    phone: business.phone, email: business.email,
    address: business.address, logoUrl, brandColor: business.brandColor,
  };

  // Deposit calculation
  const depositRequired = quote.requireDeposit === true;
  const depositPctForEmail = depositRequired ? (Number(quote.depositPercentage) || 0) : 0;
  const depositAmountForEmail = depositPctForEmail > 0
    ? centsToDollars(dollarsToCents((Number(quote.total) || 0) * (depositPctForEmail / 100)))
    : 0;

  // Snapshot terms (legacy collection AND mirror)
  if (!isTestSend && termsToSend) {
    await quoteRef.set({ termsSnapshot: termsToSend, termsVersionHash }, { merge: true });
    await docRef.set({ termsSnapshot: termsToSend, termsVersionHash, updatedAt: Date.now() }, { merge: true });
  }

  // Mint Square deposit link (best-effort)
  let depositPayNowUrl: string | undefined;
  if (!isTestSend && depositRequired && depositPctForEmail > 0 && depositAmountForEmail > 0 && input.squareDepositLinkMint) {
    try {
      await quoteRef.set({ depositAmount: depositAmountForEmail }, { merge: true });
      const linkResult = await input.squareDepositLinkMint(userId, docId);
      if (linkResult) depositPayNowUrl = linkResult.paymentLinkUrl;
    } catch (err: any) {
      console.error('[square] deposit link mint threw in sendDocumentEmail (quote)', {
        userId, docId, message: err?.message,
      });
    }
  }

  const htmlContent = buildQuoteEmailHtml({
    customerName: quote.customerName || 'Client',
    emailBody,
    jobName: quote.job?.name || 'Job',
    materials: emailMaterials,
    laborTotal: displayQuote.laborTotal,
    materialsSubtotal: displayQuote.materialsSubtotal,
    subtotal: displayQuote.subtotal,
    gst: quote.gst || 0,
    total: quote.total || 0,
    acceptanceUrl,
    photoUrls,
    depositAmount: depositAmountForEmail || undefined,
    depositPercentage: depositPctForEmail || undefined,
    depositPayNowUrl,
    hasTerms: !!termsToSend,
    surchargePaymentFees: business.surchargePaymentFees === true,
    business: businessData,
  });

  const pdfHtml = buildQuotePdfHtml(
    {
      customerName: quote.customerName || 'Client',
      customerEmail: quote.customerEmail,
      customerPhone: quote.customerPhone,
      jobAddress: quote.jobAddress,
      quoteNumber: quote.quoteNumber,
      quoteDate: fmtAuDate(quote.updatedAt),
      job: quote.job || { name: 'Job', description: '' },
      materials: buildPdfMaterials(quote.materials),
      materialsSubtotal: quote.materialsSubtotal || 0,
      laborHours: quote.laborHours,
      laborRate: quote.laborRate,
      laborUnit: quote.laborUnit,
      laborTotal: quote.laborTotal || 0,
      laborExtraHours: quote.laborExtraHours,
      sections: buildPdfSections(quote.sections),
      subtotal: quote.subtotal || 0,
      markup: quote.markup || 0,
      markupAmount: quote.markupAmount || 0,
      laborMarkup: quote.laborMarkup ?? quote.markup ?? 0,
      showMarkup: quote.showMarkup !== undefined
        ? quote.showMarkup === true
        : business.showMarkup === true,
      showMaterialCosts: quote.showMaterialCosts !== undefined
        ? quote.showMaterialCosts
        : business.showMaterialCostsByDefault !== false,
      showLaborCosts: quote.showLaborCosts !== undefined
        ? quote.showLaborCosts
        : business.showLaborCostsByDefault !== false,
      travelAdjustment: quote.travelAdjustment,
      gst: quote.gst || 0,
      total: quote.total || 0,
      notes: quote.notes,
      showLaborHours: business.showLaborHours,
      showLaborBreakdown: quote.showLaborBreakdown !== false,
      groupMaterialsBySection: business.groupMaterialsBySection,
      paymentMethods: business.paymentMethods,
      squarePaymentLinkUrl: depositPayNowUrl || quote.squarePaymentLinkUrl,
      surchargePaymentFees: business.surchargePaymentFees === true,
      terms: termsToSend || undefined,
    },
    {
      businessName: business.businessName || 'Business',
      email: business.email,
      phone: business.phone,
      website: business.website,
      abn: business.abn,
      address: business.address,
      logoHtml: businessLogoHtml(business),
      brandColor: business.brandColor,
      pdfTemplate: business.pdfTemplate,
    },
  );

  const pdfBuffer = await generateQuotePdfBuffer(pdfHtml);
  const pdfBase64 = pdfBuffer.toString('base64');
  const pdfFilename = `Quote_${sanitizeFilename(quote.customerName || 'Client')}_${sanitizeFilename(quote.job?.name || 'Job')}.pdf`;
  const attachments: Array<{ name: string; content: string }> = [{ name: pdfFilename, content: pdfBase64 }];

  if (includePhotos && photoUrls.length > 0 && input.fetchPhotoAttachments) {
    const photoAttachments = await input.fetchPhotoAttachments(photoUrls);
    attachments.push(...photoAttachments);
  }

  // Prefer business settings email, fall back to auth email so replies always
  // land in the tradie's actual inbox even if they haven't filled in settings.
  // Validates the email so a typo doesn't silently swallow customer replies.
  const tradieReplyEmail = await resolveTradieReplyEmail(userId, business.email);
  const tradieDisplayName = business.businessName || undefined;

  const sent = await sendEmail({
    to: recipientEmail,
    subject: `${isTestSend ? '[TEST] ' : ''}Quotation from ${business.businessName || 'Your Tradie'} - ${quote.job?.name || 'Job'}`,
    htmlContent,
    category: 'transactional',
    userId,
    tags: isTestSend ? ['quote-test'] : ['quote-to-client'],
    attachment: attachments,
    senderName: tradieDisplayName,
    replyTo: tradieReplyEmail ? { email: tradieReplyEmail, name: tradieDisplayName } : undefined,
  });

  if (!sent) return { success: false };

  if (!isTestSend) {
    const tradieEmail = await getUserEmail(userId);
    if (tradieEmail) {
      await sendQuoteSentEmail(
        tradieEmail,
        quote.customerName || 'Client',
        quote.quoteNumber || docId,
        quote.total || 0,
        userId,
      );
    }
  }

  return { success: true, acceptanceUrl };
}

async function sendInvoiceFlavour(args: FlavourArgs): Promise<SendDocumentEmailResult> {
  const firestore = db();
  const { userId, docId, emailBody, recipientEmail, isTestSend, includePhotos,
          doc, business, termsToSend, termsVersionHash, input } = args;

  const invoice: AnyData = documentRecordToInvoiceRecord(doc as DocumentRecord);
  Object.assign(invoice, input.overrides || {});

  // The legacy invoice may live under a different doc id than the unified
  // document (for converted-from-quote invoices, the unified doc is keyed by
  // quoteId but the invoice doc is keyed by invoiceId). Resolve.
  const legacyInvoiceId = (doc.legacyInvoiceId as string | undefined) ?? docId;
  const invoiceRef = firestore.doc(`users/${userId}/invoices/${legacyInvoiceId}`);

  const invoiceUpdate: AnyData = {};
  if (input.overrides) {
    Object.assign(invoiceUpdate, input.overrides);
    delete invoiceUpdate.id;
  }
  if (!isTestSend) {
    invoiceUpdate.status = 'sent';
    invoiceUpdate.aiEmailBody = emailBody;
    invoiceUpdate.sentAt = admin.firestore.FieldValue.serverTimestamp();
  }
  if (!isTestSend && termsToSend) {
    invoiceUpdate.termsSnapshot = termsToSend;
    invoiceUpdate.termsVersionHash = termsVersionHash;
  }
  if (Object.keys(invoiceUpdate).length > 0) {
    await invoiceRef.set(invoiceUpdate, { merge: true });
  }
  // Step 7 — auto-flip stage on send. For invoices created via convert flow,
  // current stage is quote_accepted; otherwise it could be draft. Either way,
  // sending an invoice puts the doc into invoice_sent.
  if (!isTestSend) {
    await setDocumentStage({
      uid: userId,
      docId,
      fromStage: doc.stage,
      toStage: 'invoice_sent',
      reason: 'sendDocumentEmail:invoice',
      extraUpdates: {
        aiEmailBody: emailBody,
        termsSnapshot: termsToSend ?? undefined,
        termsVersionHash: termsVersionHash ?? undefined,
      },
    });
  }

  // Mint Square invoice payment link (best-effort)
  let payNowUrl: string | undefined;
  if (!isTestSend && input.squareInvoiceLinkMint) {
    try {
      const squareConnDoc = await firestore.doc(`users/${userId}/settings/squareConnection`).get();
      if (squareConnDoc.exists) {
        const linkResult = await input.squareInvoiceLinkMint(userId, legacyInvoiceId);
        if (linkResult) {
          payNowUrl = linkResult.paymentLinkUrl;
          invoice.squarePaymentLinkId = linkResult.paymentLinkId;
          invoice.squarePaymentLinkUrl = linkResult.paymentLinkUrl;
        }
      }
    } catch (err: any) {
      console.error('[square] invoice pay link mint threw in sendDocumentEmail', {
        userId, docId, message: err?.message,
      });
    }
  }

  const logoUrl = business.logoStorageUrl || business.logoUri || '';
  const emailMaterials = (invoice.materials || []).map((m: any) => ({
    name: m.name, quantity: m.quantity, unit: m.unit,
    totalPrice: m.totalPrice || 0, section: m.section,
  }));
  const businessData = {
    name: business.businessName || '', abn: business.abn,
    phone: business.phone, email: business.email,
    address: business.address, logoUrl, brandColor: business.brandColor,
  };

  const htmlContent = buildInvoiceEmailHtml({
    customerName: invoice.customerName || 'Client',
    emailBody,
    jobName: invoice.job?.name || 'Job',
    materials: emailMaterials,
    laborTotal: invoice.laborTotal || 0,
    materialsSubtotal: invoice.materialsSubtotal || 0,
    subtotal: invoice.subtotal || 0,
    gst: invoice.gst || 0,
    total: invoice.total || 0,
    invoiceNumber: invoice.invoiceNumber,
    dueDate: invoice.dueDate || new Date().toISOString(),
    payNowUrl,
    depositCredit: Number(invoice.depositCredit) > 0 ? Number(invoice.depositCredit) : undefined,
    hasTerms: !!termsToSend,
    surchargePaymentFees: business.surchargePaymentFees === true,
    business: businessData,
  });

  const pdfHtml = buildInvoicePdfHtml(
    {
      customerName: invoice.customerName || 'Client',
      customerEmail: invoice.customerEmail,
      customerPhone: invoice.customerPhone,
      jobAddress: invoice.jobAddress,
      quoteNumber: invoice.invoiceNumber,
      quoteDate: fmtAuDate(invoice.updatedAt),
      invoiceNumber: invoice.invoiceNumber,
      issueDate: fmtAuDate(invoice.issueDate || invoice.createdAt),
      dueDate: fmtAuDate(invoice.dueDate),
      paymentTerms: invoice.paymentTerms,
      paidAmount: invoice.paidAmount || 0,
      depositCredit: Number(invoice.depositCredit) > 0 ? Number(invoice.depositCredit) : undefined,
      job: invoice.job || { name: 'Job', description: '' },
      materials: buildPdfMaterials(invoice.materials),
      materialsSubtotal: invoice.materialsSubtotal || 0,
      laborHours: invoice.laborHours,
      laborRate: invoice.laborRate,
      laborUnit: invoice.laborUnit,
      laborTotal: invoice.laborTotal || 0,
      laborExtraHours: invoice.laborExtraHours,
      sections: buildPdfSections(invoice.sections),
      subtotal: invoice.subtotal || 0,
      markup: invoice.markup || 0,
      markupAmount: invoice.markupAmount || 0,
      laborMarkup: invoice.laborMarkup ?? invoice.markup ?? 0,
      showMarkup: invoice.showMarkup !== undefined
        ? invoice.showMarkup === true
        : business.showMarkup === true,
      showMaterialCosts: invoice.showMaterialCosts !== undefined
        ? invoice.showMaterialCosts
        : business.showMaterialCostsByDefault !== false,
      showLaborCosts: invoice.showLaborCosts !== undefined
        ? invoice.showLaborCosts
        : business.showLaborCostsByDefault !== false,
      travelAdjustment: invoice.travelAdjustment,
      gst: invoice.gst || 0,
      total: invoice.total || 0,
      notes: invoice.notes,
      showLaborHours: business.showLaborHours,
      showLaborBreakdown: invoice.showLaborBreakdown !== false,
      groupMaterialsBySection: business.groupMaterialsBySection,
      paymentMethods: business.paymentMethods,
      squarePaymentLinkUrl: payNowUrl || invoice.squarePaymentLinkUrl,
      surchargePaymentFees: business.surchargePaymentFees === true,
      terms: termsToSend || undefined,
    },
    {
      businessName: business.businessName || 'Business',
      email: business.email,
      phone: business.phone,
      website: business.website,
      abn: business.abn,
      address: business.address,
      logoHtml: businessLogoHtml(business),
      brandColor: business.brandColor,
      pdfTemplate: business.pdfTemplate,
    },
  );

  const pdfBuffer = await generateQuotePdfBuffer(pdfHtml);
  const pdfBase64 = pdfBuffer.toString('base64');
  const pdfFilename = `Invoice_${sanitizeFilename(invoice.customerName || 'Client')}_${sanitizeFilename(invoice.job?.name || 'Job')}.pdf`;
  const attachments: Array<{ name: string; content: string }> = [{ name: pdfFilename, content: pdfBase64 }];

  if (includePhotos && invoice.sourceQuoteId && input.fetchPhotoAttachments) {
    const sourceQuoteDoc = await firestore.doc(`users/${userId}/quotes/${invoice.sourceQuoteId}`).get();
    if (sourceQuoteDoc.exists) {
      const sourceQuote = sourceQuoteDoc.data() as AnyData;
      const photoUrls = (sourceQuote.photos || []).map((p: any) => p.storageUrl).filter(Boolean);
      if (photoUrls.length > 0) {
        const photoAttachments = await input.fetchPhotoAttachments(photoUrls);
        attachments.push(...photoAttachments);
      }
    }
  }

  const tradieReplyEmail = await resolveTradieReplyEmail(userId, business.email);
  const tradieDisplayName = business.businessName || undefined;

  const sent = await sendEmail({
    to: recipientEmail,
    subject: `${isTestSend ? '[TEST] ' : ''}Invoice from ${business.businessName || 'Your Tradie'} - ${invoice.job?.name || 'Job'}`,
    htmlContent,
    category: 'transactional',
    userId,
    tags: isTestSend ? ['invoice-test'] : ['invoice-to-client'],
    attachment: attachments,
    senderName: tradieDisplayName,
    replyTo: tradieReplyEmail ? { email: tradieReplyEmail, name: tradieDisplayName } : undefined,
  });

  if (!sent) return { success: false };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Square webhook payment routing
// ---------------------------------------------------------------------------

export interface SquarePaymentReconciliationInput {
  userId: string;
  paymentId: string;
  orderId: string;
  amountCents: number;
  source: 'in_app' | 'pay_link';
  /** quote_deposit | quote_full | invoice — same kinds the index already uses. */
  kind: string;
  quoteId?: string | null;
  invoiceId?: string | null;
}

/**
 * Apply a Square payment to the unified document ledger. The legacy webhook
 * still updates quotes/invoices directly (so the mirror cascades), but this
 * helper writes a complementary update to documents/{id} so the new view
 * doesn't lag on payment events.
 *
 * Recompute paidTotal/balanceDue on every write. Drive stage transitions
 * via the state machine (soft-enforced).
 */
export async function applyPaymentToDocument(
  input: SquarePaymentReconciliationInput,
): Promise<void> {
  const { userId, paymentId, kind, quoteId, invoiceId } = input;

  const docId = (kind === 'quote_deposit' || kind === 'quote_full')
    ? quoteId
    : invoiceId;
  if (!docId) return;

  const doc = await loadDocument(userId, docId);
  if (!doc) return;

  // Idempotency: skip if this payment is already on the ledger.
  const alreadyOnLedger = (doc.payments || []).some(
    (p: DocumentPayment) => p.squarePaymentId === paymentId,
  );
  if (alreadyOnLedger) return;

  const paidDollars = centsToDollars(input.amountCents);
  const total = Number(doc.total) || 0;

  let payment: DocumentPayment;
  let nextStage: DocumentStage = doc.stage;

  if (kind === 'quote_deposit') {
    const expectedCap = Number(doc.depositAmount) || paidDollars;
    const cappedAmount = expectedCap > 0 ? Math.min(paidDollars, expectedCap) : paidDollars;
    payment = {
      id: `deposit-${paymentId}`,
      kind: 'deposit',
      amount: cappedAmount,
      paidAt: Date.now(),
      squarePaymentId: paymentId,
      method: 'square',
    };
    if (doc.stage === 'quote_sent' || doc.stage === 'draft') {
      nextStage = 'quote_accepted';
    }
  } else if (kind === 'quote_full') {
    const cappedAmount = total > 0 ? Math.min(paidDollars, total) : paidDollars;
    payment = {
      id: `full-${paymentId}`,
      kind: 'balance',
      amount: cappedAmount,
      paidAt: Date.now(),
      squarePaymentId: paymentId,
      method: 'square',
    };
    if (doc.stage === 'quote_sent' || doc.stage === 'draft') {
      nextStage = 'quote_accepted';
    }
  } else {
    // invoice balance
    const cappedAmount = total > 0 ? Math.min(paidDollars, total) : paidDollars;
    payment = {
      id: `square-${paymentId}`,
      kind: 'balance',
      amount: cappedAmount,
      paidAt: Date.now(),
      squarePaymentId: paymentId,
      method: 'square',
    };
    const newPaidTotal = (Number(doc.paidTotal) || 0) + cappedAmount;
    nextStage = newPaidTotal + 0.005 >= total ? 'paid' : 'partially_paid';
  }

  const newPayments = [...(doc.payments || []), payment];
  const paidTotal = newPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const balanceDue = Math.max(0, total - paidTotal);

  // Mark the active payment link consumed if this payment came in via it.
  // The customer may re-open the email and click the same link; flagging
  // consumed lets the receiving page (or future SDK consumers) show a
  // "payment received" state instead of erroring.
  const active = doc.activePaymentLink as DocumentPaymentLink | undefined;
  const updatedActive: DocumentPaymentLink | undefined = active
    ? { ...active, consumedAt: active.consumedAt ?? Date.now() }
    : undefined;

  await setDocumentStage({
    uid: userId,
    docId: doc.id,
    fromStage: doc.stage,
    toStage: nextStage,
    reason: `applyPaymentToDocument:${kind}`,
    extraUpdates: {
      payments: newPayments,
      paidTotal,
      balanceDue,
      paymentSyncError: admin.firestore.FieldValue.delete(),
      ...(updatedActive ? { activePaymentLink: updatedActive } : {}),
    },
  });

  // Phase 11: cascade the document's stage jump onto the parent Job so the
  // Jobs tab reflects reality without the tradie touching anything. A deposit
  // lands and the Job flips from 'quoted' to 'accepted'; an invoice paid in
  // full flips it to 'paid'. Only fire when the Document actually moved
  // stages — otherwise every follow-on payment would re-promote.
  const jobId = typeof (doc as AnyData).jobId === 'string'
    ? ((doc as AnyData).jobId as string)
    : null;
  if (jobId && nextStage !== doc.stage) {
    await cascadeJobStageFromDocumentPayment(userId, jobId, nextStage);
  }
}

/**
 * Cascade DocumentStage jumps onto the parent Job. Strict about when it fires:
 *   - Document → quote_accepted: Job 'inquiry' | 'quoted' → 'accepted'
 *   - Document → paid:           Job '<=completed' → 'paid'
 * Leaves the Job alone if the tradie has already pushed it further (no
 * demotions, no overriding manual "in_progress" / "scheduled").
 */
async function cascadeJobStageFromDocumentPayment(
  userId: string,
  jobId: string,
  docStage: DocumentStage,
): Promise<void> {
  const jobRef = db().doc(`users/${userId}/jobs/${jobId}`);
  const snap = await jobRef.get();
  if (!snap.exists) return;
  const job = snap.data() || {};
  const currentJobStage = typeof job.stage === 'string' ? (job.stage as string) : 'inquiry';

  let nextJobStage: string | null = null;
  if (docStage === 'quote_accepted') {
    if (currentJobStage === 'inquiry' || currentJobStage === 'quoted') {
      nextJobStage = 'accepted';
    }
  } else if (docStage === 'paid') {
    const parkedStages = ['closed', 'cancelled', 'paid'];
    if (!parkedStages.includes(currentJobStage)) {
      nextJobStage = 'paid';
    }
  }

  if (!nextJobStage) return;
  await jobRef.set({ stage: nextJobStage, updatedAt: Date.now() }, { merge: true });
}

// ---------------------------------------------------------------------------
// Xero — wraps the existing invoice-only sync so the call site is doc-driven.
// ---------------------------------------------------------------------------

export interface XeroSyncDelegate {
  pushInvoice: (userId: string, invoiceId: string, invoice: AnyData) => Promise<void>;
}

export async function syncDocumentToXero(
  doc: DocumentRecord,
  userId: string,
  delegate: XeroSyncDelegate,
): Promise<void> {
  if (doc.type !== 'invoice') return;
  const invoiceId = (doc.legacyInvoiceId as string | undefined) ?? doc.id;
  const invoice = documentRecordToInvoiceRecord(doc as DocumentRecord);
  await delegate.pushInvoice(userId, invoiceId, invoice);
}

// ---------------------------------------------------------------------------
// Telemetry — used by the legacy endpoint shims so we can monitor when old
// clients still hit the legacy paths.
// ---------------------------------------------------------------------------

export function logShimInvocation(endpoint: string, userId: string, extras?: AnyData): void {
  functions.logger.info('phase2_shim_invoked', { endpoint, userId, ...(extras || {}) });
}

// ---------------------------------------------------------------------------
// Phase-3 unified payment-link lifecycle
// ---------------------------------------------------------------------------

/**
 * Mints a new Square hosted payment link for a given amount/kind. Implemented
 * in functions/src/index.ts where the Square HTTP/auth machinery lives;
 * injected here so this module stays free of the Square stack.
 */
export interface SquareLinkMinter {
  mintDeposit: (userId: string, quoteId: string) => Promise<{
    paymentLinkId: string; paymentLinkUrl: string; depositAmount: number;
  } | null>;
  mintQuoteFull: (userId: string, quoteId: string) => Promise<{
    paymentLinkId: string; paymentLinkUrl: string; amount: number;
  } | null>;
  mintInvoice: (userId: string, invoiceId: string) => Promise<{
    paymentLinkId: string; paymentLinkUrl: string;
  } | null>;
}

interface RotationDecision {
  needed: boolean;
  reason: string;
  kind?: DocumentPaymentLinkKind;
  amount?: number;
}

/**
 * Decide whether the doc currently needs a different active link than the one
 * it already has. Pure — no I/O — so the rotation gate is testable.
 *
 * Rules:
 *   - draft / cancelled / paid / quote_rejected: no link.
 *   - quote_sent + requireDeposit: deposit link sized to depositAmount.
 *   - quote_sent without deposit: no link (customer accepts via the page).
 *   - quote_accepted: keep whatever link is there (consumed); no rotation.
 *   - invoice_sent / partially_paid: balance link sized to balanceDue
 *     (total − paidTotal).
 */
function decideRotation(doc: DocumentRecord): RotationDecision {
  const total = Number(doc.total) || 0;
  const paidTotal = Number(doc.paidTotal) || 0;
  const balance = Math.max(0, total - paidTotal);
  const stage = doc.stage;

  if (stage === 'draft' || stage === 'cancelled' || stage === 'paid' || stage === 'quote_rejected') {
    return { needed: false, reason: 'stage-no-link' };
  }

  if (stage === 'quote_sent') {
    if (doc.requireDeposit !== true) return { needed: false, reason: 'quote-no-deposit' };
    const depositAmount = Number(doc.depositAmount) || 0;
    if (depositAmount <= 0) return { needed: false, reason: 'quote-zero-deposit' };
    return { needed: true, reason: 'quote_sent', kind: 'deposit', amount: depositAmount };
  }

  if (stage === 'quote_accepted') {
    return { needed: false, reason: 'accepted-await-invoice' };
  }

  if (stage === 'invoice_sent' || stage === 'partially_paid') {
    if (balance <= 0) return { needed: false, reason: 'no-balance' };
    return { needed: true, reason: stage, kind: 'balance', amount: balance };
  }

  return { needed: false, reason: 'unknown-stage' };
}

/**
 * Mirror the active link onto the corresponding legacy quote/invoice doc so
 * pre-phase-3 clients keep finding the deposit/squarePaymentLink* fields they
 * read today. This is a best-effort write — failure is logged but doesn't
 * fail the rotation (the unified doc is the source of truth).
 */
async function mirrorLinkToLegacy(
  userId: string,
  doc: DocumentRecord,
  link: DocumentPaymentLink | null,
): Promise<void> {
  const firestore = db();
  try {
    if (doc.type === 'quote' || (doc.type === 'invoice' && doc.legacyQuoteId)) {
      const quoteId = (doc.type === 'quote' ? doc.id : doc.legacyQuoteId) as string;
      const quoteRef = firestore.doc(`users/${userId}/quotes/${quoteId}`);
      const update: AnyData = {};
      if (link && link.kind === 'deposit') {
        update.depositPaymentLinkId = link.id;
        update.depositPaymentLinkUrl = link.url;
        update.depositPaymentLinkCreatedAt = link.createdAt;
      } else if (link && link.kind === 'quote_full') {
        update.fullPaymentLinkId = link.id;
        update.fullPaymentLinkUrl = link.url;
        update.fullPaymentLinkCreatedAt = link.createdAt;
        update.fullPaymentLinkAmount = link.amount;
      }
      if (Object.keys(update).length > 0) {
        await quoteRef.set(update, { merge: true });
      }
    }
    if (doc.type === 'invoice') {
      const invoiceId = (doc.legacyInvoiceId as string | undefined) ?? doc.id;
      const invoiceRef = firestore.doc(`users/${userId}/invoices/${invoiceId}`);
      if (link && link.kind === 'balance') {
        await invoiceRef.set({
          squarePaymentLinkId: link.id,
          squarePaymentLinkUrl: link.url,
          squarePaymentLinkCreatedAt: link.createdAt,
        }, { merge: true });
      }
    }
  } catch (err: any) {
    functions.logger.warn('phase3_legacy_link_mirror_failed', {
      docId: doc.id, userId, message: err?.message,
    });
  }
}

/**
 * Mark the active link consumed when its corresponding payment is reconciled.
 * Idempotent: a second call against the same paymentId is a no-op.
 */
export async function markActivePaymentLinkConsumed(
  userId: string,
  docId: string,
  paymentId: string,
  paidAt: number = Date.now(),
): Promise<void> {
  const doc = await loadDocument(userId, docId);
  if (!doc) return;
  const active = doc.activePaymentLink as DocumentPaymentLink | undefined;
  if (!active || active.consumedAt) return;
  const consumed: DocumentPaymentLink = { ...active, consumedAt: paidAt };
  await writeDocumentUpdate(userId, doc.id, {
    activePaymentLink: consumed,
    // Stamp a hint so audit/debugging can trace which payment closed the link.
    activePaymentLinkConsumedBy: paymentId,
  });
}

export interface RotateLinkResult {
  url: string;
  paymentLinkId: string;
  rotated: boolean;
  reused: boolean;
  reason: string;
}

/**
 * Document-driven payment-link minter. Looks at the document's stage + amounts,
 * decides what kind of link is needed, mints via the injected Square minter if
 * the existing active link doesn't already satisfy that need, archives the old
 * one, and mirrors the new fields back to the legacy quote/invoice doc.
 *
 * Returns null when no link is needed (e.g. quote without deposit, paid doc),
 * the existing link details when it can be reused, or the new link details
 * after a successful mint.
 */
export async function createOrRotatePaymentLink(
  userId: string,
  docId: string,
  minter: SquareLinkMinter,
): Promise<RotateLinkResult | null> {
  const doc = await loadDocument(userId, docId);
  if (!doc) return null;

  const decision = decideRotation(doc);
  if (!decision.needed) {
    return null;
  }

  const active = doc.activePaymentLink as DocumentPaymentLink | undefined;
  // Reuse the active link only if its kind AND amount still satisfy the
  // current need. Square's API doesn't let us update a link's price, so any
  // amount drift forces a fresh mint.
  if (
    active &&
    !active.consumedAt &&
    active.kind === decision.kind &&
    Math.abs(Number(active.amount || 0) - Number(decision.amount || 0)) < 0.005
  ) {
    return {
      url: active.url,
      paymentLinkId: active.id,
      rotated: false,
      reused: true,
      reason: decision.reason,
    };
  }

  const legacyTargetId = decision.kind === 'balance'
    ? ((doc.legacyInvoiceId as string | undefined) ?? doc.id)
    : doc.id;

  let minted: { paymentLinkId: string; paymentLinkUrl: string } | null;
  if (decision.kind === 'deposit') {
    minted = await minter.mintDeposit(userId, legacyTargetId);
  } else if (decision.kind === 'quote_full') {
    minted = await minter.mintQuoteFull(userId, legacyTargetId);
  } else {
    minted = await minter.mintInvoice(userId, legacyTargetId);
  }
  if (!minted) {
    functions.logger.warn('phase3_mint_failed', {
      userId, docId, kind: decision.kind, reason: decision.reason,
    });
    return null;
  }

  const newLink: DocumentPaymentLink = {
    id: minted.paymentLinkId,
    url: minted.paymentLinkUrl,
    kind: decision.kind!,
    amount: decision.amount!,
    createdAt: Date.now(),
  };

  // Archive the previous link if it differs from the new one. We don't try
  // to void Square links — they expire after their TTL, and a customer who
  // hits the URL after expiry sees Square's standard "expired" page.
  const archived: DocumentPaymentLink[] = Array.isArray(doc.archivedPaymentLinks)
    ? [...(doc.archivedPaymentLinks as DocumentPaymentLink[])]
    : [];
  if (active && active.id !== newLink.id) {
    archived.push({ ...active, archivedAt: Date.now() });
  }

  await writeDocumentUpdate(userId, doc.id, {
    activePaymentLink: newLink,
    archivedPaymentLinks: archived,
  });

  await mirrorLinkToLegacy(userId, doc, newLink);

  return {
    url: newLink.url,
    paymentLinkId: newLink.id,
    rotated: true,
    reused: false,
    reason: decision.reason,
  };
}

// ---------------------------------------------------------------------------
// Phase-4 telemetry — admin-only callable surfacing the violation count so
// the operator can decide whether the state machine is safe to harden.
// ---------------------------------------------------------------------------

interface StageViolationSample {
  uid: string;
  docId: string;
  from: string;
  to: string;
  reason: string;
  at: number;
}

interface StageViolationCountsResult {
  totalShimInvocations: number;
  totalIllegalTransitions: number;
  lastSampleAt: number | null;
  sampleViolations: StageViolationSample[];
}

const VIOLATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const VIOLATION_SAMPLE_LIMIT = 25;

export const getStageViolationCounts = functions.https.onCall(
  async (_data, context): Promise<StageViolationCountsResult> => {
    const isAdmin = context.auth?.token?.admin === true;
    if (!context.auth?.uid || !isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const firestore = db();
    const cutoff = Date.now() - VIOLATION_RETENTION_MS;

    // Opportunistic purge of entries older than the retention window. Done
    // here rather than via a scheduled job since this endpoint is the only
    // reader and the volume is expected to be low (it's a violation log).
    try {
      const stale = await firestore.collection(STAGE_VIOLATIONS_COLLECTION)
        .where('at', '<', new Date(cutoff))
        .limit(500)
        .get();
      if (!stale.empty) {
        const purgeBatch = firestore.batch();
        stale.docs.forEach((d) => purgeBatch.delete(d.ref));
        await purgeBatch.commit();
      }
    } catch (err: any) {
      functions.logger.warn('phase4_stage_violation_purge_failed', { message: err?.message });
    }

    // Fresh slice for the count + samples.
    const recent = await firestore.collection(STAGE_VIOLATIONS_COLLECTION)
      .orderBy('at', 'desc')
      .limit(500)
      .get();

    const sampleViolations: StageViolationSample[] = recent.docs
      .slice(0, VIOLATION_SAMPLE_LIMIT)
      .map((d) => {
        const data = d.data();
        return {
          uid: String(data.uid ?? ''),
          docId: String(data.docId ?? ''),
          from: String(data.from ?? ''),
          to: String(data.to ?? ''),
          reason: String(data.reason ?? ''),
          at: data.at?.toMillis?.() ?? 0,
        };
      });

    const lastSampleAt = sampleViolations[0]?.at ?? null;

    // The shim invocation counter lives in Cloud Logging (logShimInvocation),
    // not Firestore. Reading it would require an external query to GCP
    // Logging; the user said "overkill" — return 0 so the field exists for
    // the UI contract but the meaningful number is the illegal-transition
    // count read directly from the violation collection.
    return {
      totalShimInvocations: 0,
      totalIllegalTransitions: recent.size,
      lastSampleAt,
      sampleViolations,
    };
  },
);

// ---------------------------------------------------------------------------
// Convert quote → invoice (phase-5 step 5)
// ---------------------------------------------------------------------------

/**
 * Server-side flip from quote to invoice. Loads the document, computes the
 * invoice-side fields (issueDate, dueDate, deposit credit, adjusted total),
 * and writes the new state through setDocumentStage so the canonical state
 * machine observes the transition. Idempotent — re-calling once invoicedAt
 * is set returns the existing document untouched.
 */
export const convertDocumentToInvoice = functions.https.onCall(
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    const docId = String(data?.documentId || '').trim();
    if (!docId) {
      throw new functions.https.HttpsError('invalid-argument', 'documentId is required.');
    }
    const invoiceNumber = data?.invoiceNumber ? String(data.invoiceNumber) : undefined;

    const existing = await loadDocument(uid, docId);
    if (!existing) {
      throw new functions.https.HttpsError('not-found', 'Document not found.');
    }

    // Idempotent — already invoiced.
    if (existing.type === 'invoice' || existing.invoicedAt) {
      return { ok: true, alreadyInvoiced: true, document: existing };
    }

    const now = Date.now();
    const dueDate = now + 14 * 24 * 60 * 60 * 1000;
    const depositCredit = Math.max(0, Number(existing.depositPaid) || 0);
    const adjustedTotal = Math.max(0, (Number(existing.total) || 0) - depositCredit);

    // Convert flips type to invoice but the doc hasn't been sent yet —
    // keep it in 'draft' until sendDocumentEmail actually delivers it.
    // Stage was force-stamped invoice_sent here, which surprised
    // customers with "sent" history they hadn't authorised.
    await setDocumentStage({
      uid,
      docId,
      fromStage: existing.stage,
      toStage: 'draft',
      reason: 'manual_convert',
      extraUpdates: {
        type: 'invoice',
        number: invoiceNumber ?? existing.number,
        invoicedAt: now,
        issueDate: now,
        dueDate,
        paymentTerms: 'net_14',
        total: adjustedTotal,
        legacyInvoiceId: docId,
        // Xero: keep xeroQuoteId (historical link, used as Reference on the
        // pushed invoice) and xeroContactId (re-use Xero contact, avoid a
        // duplicate). Reset sync status so the invoice push fires fresh.
        xeroSyncStatus: 'not_synced',
        xeroSyncedAt: admin.firestore.FieldValue.delete(),
        xeroSyncError: admin.firestore.FieldValue.delete(),
      },
    });

    const updated = await loadDocument(uid, docId);
    return { ok: true, alreadyInvoiced: false, document: updated };
  },
);
