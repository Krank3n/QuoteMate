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
import type { LegacyDocumentRecord } from './shared/document/types';

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
        const projection = invoiceRecordToDocumentRecord(invoiceData, invoiceSnap.id);
        await writeMirror(userId, mirrorIdForQuote(quoteId), projection);
        return;
      }
    }

    const projection = quoteRecordToDocumentRecord(after, quoteId);
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
          const projection = quoteRecordToDocumentRecord(quoteSnap.data() as AnyData, quoteSnap.id);
          await writeMirror(userId, mirrorIdForQuote(sourceQuoteId), projection);
          return;
        }
      }
      await deleteMirror(userId, mirrorIdForInvoice(before, invoiceId));
      return;
    }

    if (!after) return;

    const projection = invoiceRecordToDocumentRecord(after, invoiceId);
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
