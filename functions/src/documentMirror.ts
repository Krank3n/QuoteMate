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

import {
  quoteRecordToDocumentRecord,
  invoiceRecordToDocumentRecord,
} from './shared/document/adapter';
import { isStageDowngrade } from './shared/document/stage';
import type { DocumentStage, LegacyDocumentRecord } from './shared/document/types';

type AnyData = LegacyDocumentRecord;

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
  let toWrite: AnyData = projection;
  if (existing.exists) {
    const existingData = existing.data() ?? {};
    const existingUpdated = Number(existingData.updatedAt ?? 0);
    const incomingUpdated = Number(projection.updatedAt ?? 0);
    if (existingUpdated > incomingUpdated) {
      return { written: false, skipped: true, reason: 'newer-on-disk' };
    }
    // Forward-only TYPE guard. Phase-5 `convertDocumentToInvoice` flips the
    // unified Document to type='invoice' in-place (same doc id as the source
    // quote). It does NOT stamp `invoiceId` on the legacy `quotes/{id}`
    // record. So when the wizard later calls saveDraft / saveQuote on that
    // same legacy quote (e.g. re-opening the doc to view it), this trigger
    // would otherwise project type='quote' over the invoice mirror —
    // visibly "switching it back to a quote". The canonical source of truth
    // for type post-convert is the unified doc, not the legacy quote, so
    // skip the projection entirely when we'd be downgrading invoice→quote.
    const existingType = existingData.type as string | undefined;
    const incomingType = projection.type as string | undefined;
    if (existingType === 'invoice' && incomingType === 'quote') {
      functions.logger.warn('[type] mirror_invoice_to_quote_blocked', {
        userId,
        docId: mirrorId,
        existingUpdatedAt: existingUpdated,
        incomingUpdatedAt: incomingUpdated,
      });
      return { written: false, skipped: true, reason: 'type-downgrade' };
    }
    // Forward-only stage guard. The mirror derives `stage` from the legacy
    // `status` field, but `setDocumentStage` (cloud-function send / payment /
    // convert) is the canonical writer of advanced stages. If a legacy quote
    // gets re-written with status='draft' (e.g. a stale-cache saveDraft right
    // after the tradie tapped Send), the derived projection would otherwise
    // downgrade an already-sent doc and leave a contradictory sentAt behind.
    const existingStage = existingData.stage as DocumentStage | undefined;
    const incomingStage = projection.stage as DocumentStage | undefined;
    if (
      typeof existingStage === 'string' &&
      typeof incomingStage === 'string' &&
      existingStage !== incomingStage
    ) {
      const downgrade = isStageDowngrade(existingStage, incomingStage);
      functions.logger.warn('[stage] mirror_drift', {
        userId,
        docId: mirrorId,
        existing: existingStage,
        incoming: incomingStage,
        existingUpdatedAt: existingUpdated,
        incomingUpdatedAt: incomingUpdated,
        downgrade,
      });
      if (downgrade) {
        const { stage: _drop, ...rest } = projection;
        toWrite = rest;
      }
    }
  }
  await ref.set(stripUndefined(toWrite), { merge: true });
  return { written: true, skipped: false };
}

async function deleteMirror(userId: string, mirrorId: string): Promise<void> {
  await documentRef(userId, mirrorId).delete().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Backfill — admin-only callable. Walks every user's quotes + invoices and
// runs the same mirror logic. Idempotent: re-runs are safe and cheap (the
// updatedAt skip short-circuits unchanged docs).
// ---------------------------------------------------------------------------

export interface BackfillSummary {
  usersProcessed: number;
  quotesMirrored: number;
  invoicesMirrored: number;
  skipped: number;
  errors: number;
  errorSamples: string[];
}

const USER_PAGE_SIZE = 50;
const SUBCOLLECTION_PAGE_SIZE = 200;

export async function mirrorAllForUser(userId: string, summary: BackfillSummary): Promise<void> {
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
        const projection = invoiceRecordToDocumentRecord(data, inv.id);
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
        const projection = quoteRecordToDocumentRecord(q.data() as AnyData, q.id);
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
