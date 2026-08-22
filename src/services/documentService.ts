/**
 * Document Service
 * Reads/writes the unified `users/{uid}/documents/{docId}` collection.
 *
 * Phase 5 client cutover: this is the new canonical read/write path. Saves are
 * dual-written — the unified document AND the corresponding legacy collection
 * (via the canonical adapter) so older app builds still see live data. Reads
 * come from the unified collection only; the server-side mirror trigger keeps
 * it in sync with any legacy writes from older clients.
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  updateDoc,
  onSnapshot,
  Unsubscribe,
  query,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { normaliseLabourToHours } from '../../shared/document/labourUnits';

function getUserId(): string | null {
  return auth.currentUser?.uid || null;
}

/** Ceiling on the live listener. See listenToDocuments for why it isn't unbounded. */
export const DOCUMENTS_LISTENER_LIMIT = 500;

/**
 * Fires when a day-shaped document reaches the write path, which the type
 * system says cannot happen. If this ever shows up in the logs, some writer
 * is bypassing the canonical labour model — find it before it prices a job.
 */
function logLabourUnitCanary(doc: any): void {
  const daySections = (doc?.sections || [])
    .filter((s: any) => s?.laborUnit === 'days')
    .map((s: any) => s?.name);
  console.warn('[labour-units] non-canonical document reached saveDocument', {
    id: doc?.id,
    type: doc?.type,
    stage: doc?.stage,
    laborUnit: doc?.laborUnit,
    laborRate: doc?.laborRate,
    daySections,
  });
}

/** Recursively strip undefined values (Firestore rejects them). */
function stripUndefined(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = typeof value === 'object' && value !== null && !(value instanceof Date)
        ? stripUndefined(value)
        : value;
    }
  }
  return cleaned;
}

/** Coerce any Firestore-shaped date value to a millis epoch. */
function toMs(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return isNaN(t) ? undefined : t;
  }
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return isNaN(t) ? undefined : t;
  }
  return undefined;
}

/**
 * Normalise a raw Firestore document record into the strongly-typed Document.
 * Firestore-shaped dates (Timestamp/{seconds,nanoseconds}/ISO) become millis
 * so the rest of the client doesn't have to think about provenance.
 */
function normaliseDocument(raw: any, id: string): Document {
  const out: any = { ...raw, id };
  const dateFields = [
    'createdAt', 'updatedAt', 'depositPaidAt', 'depositPaymentLinkCreatedAt',
    'fullPaymentLinkCreatedAt', 'acceptanceTokenCreatedAt', 'respondedAt',
    'invoicedAt', 'issueDate', 'dueDate', 'xeroSyncedAt', 'squarePaidAt',
  ];
  for (const f of dateFields) {
    if (raw[f] !== undefined) {
      const ms = toMs(raw[f]);
      if (ms !== undefined) out[f] = ms;
    }
  }
  if (Array.isArray(raw.payments)) {
    out.payments = raw.payments.map((p: any) => ({
      ...p,
      paidAt: toMs(p.paidAt) ?? Date.now(),
    }));
  } else {
    out.payments = [];
  }
  if (raw.activePaymentLink) {
    const link = raw.activePaymentLink;
    out.activePaymentLink = {
      ...link,
      createdAt: toMs(link.createdAt) ?? Date.now(),
      consumedAt: toMs(link.consumedAt),
      archivedAt: toMs(link.archivedAt),
    };
  }
  if (Array.isArray(raw.archivedPaymentLinks)) {
    out.archivedPaymentLinks = raw.archivedPaymentLinks.map((link: any) => ({
      ...link,
      createdAt: toMs(link.createdAt) ?? Date.now(),
      consumedAt: toMs(link.consumedAt),
      archivedAt: toMs(link.archivedAt),
    }));
  }
  out.paidTotal = Number(raw.paidTotal) || 0;
  out.balanceDue = Number(raw.balanceDue) || 0;
  // Canonicalise labour on the way in, so nothing downstream ever has to ask
  // "is this number hours or days?". Records healed by healLabourUnits.ts are
  // already canonical and pass through untouched; anything still day-shaped
  // (written by an older build) is converted money-for-money here.
  return normaliseLabourToHours(out) as Document;
}

class DocumentService {
  private documentsUnsubscribe: Unsubscribe | null = null;

  /** Load all documents for the current user. */
  async loadDocuments(): Promise<Document[]> {
    const userId = getUserId();
    if (!userId) return [];
    try {
      const ref = collection(db, 'users', userId, 'documents');
      const q = query(ref, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => normaliseDocument(d.data(), d.id));
    } catch (error) {
      return [];
    }
  }

  /**
   * Fetch a single document by id. Used by Mate's applyProposal as a fallback
   * when the model emits a quoteId that isn't in the local cache yet — the
   * server-side find / list / get_quote tools read from this same collection,
   * so a Firestore round-trip will always resolve a freshly-minted doc.
   */
  async getDocumentById(docId: string): Promise<Document | null> {
    const userId = getUserId();
    if (!userId || !docId) return null;
    try {
      const ref = doc(db, 'users', userId, 'documents', docId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return normaliseDocument(snap.data(), snap.id);
    } catch {
      return null;
    }
  }

  /**
   * Subscribe to document changes in real-time.
   *
   * @param callback receives the snapshot plus whether it came back at the cap,
   *   i.e. whether older documents exist that this listener will never deliver.
   */
  listenToDocuments(
    callback: (documents: Document[], wasTruncated: boolean) => void,
  ): Unsubscribe | null {
    const userId = getUserId();
    if (!userId) return null;
    try {
      this.documentsUnsubscribe?.();
      const ref = collection(db, 'users', userId, 'documents');
      // Cap the live listener so the snapshot replay doesn't grow without
      // bound with usage history.
      //
      // This used to be 100, and the old comment claimed older docs "remain
      // reachable via loadDocuments()". They don't, in practice: a snapshot
      // REPLACES the store array, so the capped listener overwrote whatever
      // the unbounded loadDocuments() had fetched. A job whose only invoice
      // fell outside the window then read as having no documents at all —
      // wrong filter bucket, $0 on the card, and "Create Quote" offered on a
      // job that already had a sent invoice. The caller now merges instead of
      // trimming (see mergeTruncatedSnapshot), and 500 puts truncation out of
      // reach for any real account.
      const q = query(ref, orderBy('createdAt', 'desc'), limit(DOCUMENTS_LISTENER_LIMIT));
      this.documentsUnsubscribe = onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map((d) => normaliseDocument(d.data(), d.id));
        callback(docs, snapshot.docs.length >= DOCUMENTS_LISTENER_LIMIT);
      }, () => {});
      return this.documentsUnsubscribe;
    } catch {
      return null;
    }
  }

  /**
   * Save a document AND mirror it into the legacy collection. The mirror
   * trigger on the server also runs, but a direct write keeps reads fast and
   * prevents stale legacy data when older clients open the app.
   */
  async saveDocument(rawDocument: Document): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    // Last line of defence on the write path. The types already make a
    // day-shaped document impossible to construct, so this should never
    // convert anything — but a record can still reach here from an untyped
    // source (a legacy import, an older cached draft), and writing two unit
    // systems into one document is what produced the Aug 2026 inflated quotes.
    // Canonicalise, and shout if it ever actually had work to do.
    const document = normaliseLabourToHours(rawDocument) as Document;
    if (document !== rawDocument) {
      logLabourUnitCanary(rawDocument);
    }
    const docRef = doc(db, 'users', userId, 'documents', document.id);
    // `receiptSentPaidCents` is the server's payment-receipt idempotency mark
    // (functions/src/index.ts onDocumentPaymentReceived). We round-trip every
    // field we read, so writing it back from a copy loaded before the last
    // payment would rewind the mark and re-send the customer a receipt they
    // already have. The server owns it; never echo it.
    const { receiptSentPaidCents: _serverOwned, ...clientOwned } = document as any;
    const payload = stripUndefined({
      ...clientOwned,
      updatedAt: document.updatedAt ?? Date.now(),
      syncedAt: new Date().toISOString(),
    });
    await setDoc(docRef, payload, { merge: true });

    // Mirror back to the legacy collection so older client builds still see
    // the change. The shared adapter handles type-specific projection.
    if (document.type === 'invoice') {
      const invoice = documentToInvoice(document);
      const invoiceRef = doc(db, 'users', userId, 'invoices', document.id);
      await setDoc(invoiceRef, stripUndefined({
        ...invoice,
        createdAt: dateToIsoOr(invoice.createdAt, new Date()),
        updatedAt: dateToIsoOr(invoice.updatedAt, new Date()),
        issueDate: dateToIsoOr(invoice.issueDate, new Date()),
        dueDate: dateToIsoOr(invoice.dueDate, new Date()),
        paidDate: invoice.paidDate ? dateToIso(invoice.paidDate) : null,
        xeroSyncedAt: invoice.xeroSyncedAt ? dateToIso(invoice.xeroSyncedAt) : null,
        syncedAt: new Date().toISOString(),
      }), { merge: true });
    } else {
      const quote = documentToQuote(document);
      const quoteRef = doc(db, 'users', userId, 'quotes', document.id);
      await setDoc(quoteRef, stripUndefined({
        ...quote,
        createdAt: dateToIsoOr(quote.createdAt, new Date()),
        updatedAt: dateToIsoOr(quote.updatedAt, new Date()),
        acceptanceTokenCreatedAt: quote.acceptanceTokenCreatedAt
          ? dateToIso(quote.acceptanceTokenCreatedAt) : null,
        respondedAt: quote.respondedAt ? dateToIso(quote.respondedAt) : null,
        invoicedAt: quote.invoicedAt ? dateToIso(quote.invoicedAt) : null,
        syncedAt: new Date().toISOString(),
      }), { merge: true });
    }
  }

  /**
   * Actually remove fields from the stored document.
   *
   * saveDocument strips undefined and writes with `{ merge: true }`, so
   * setting a field to undefined leaves the stored value untouched — the
   * key simply never reaches Firestore. That's right for a partial save
   * and wrong when a field has to go: after "Back to a quote…" a surviving
   * `invoicedAt` makes canConvert refuse, so the tradie could undo the
   * conversion and then never redo it.
   *
   * Mirrors into the legacy quote row, which carries invoicedAt too.
   */
  async clearDocumentFields(documentId: string, fields: string[]): Promise<void> {
    const userId = getUserId();
    if (!userId || fields.length === 0) return;
    const sentinels = Object.fromEntries(fields.map((f) => [f, deleteField()]));
    await Promise.allSettled([
      updateDoc(doc(db, 'users', userId, 'documents', documentId), sentinels),
      updateDoc(doc(db, 'users', userId, 'quotes', documentId), sentinels),
    ]);
  }

  async deleteDocument(documentId: string): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    // Delete from all three so older clients also see the removal.
    await Promise.allSettled([
      deleteDoc(doc(db, 'users', userId, 'documents', documentId)),
      deleteDoc(doc(db, 'users', userId, 'quotes', documentId)),
      deleteDoc(doc(db, 'users', userId, 'invoices', documentId)),
    ]);
  }

  cleanup(): void {
    if (this.documentsUnsubscribe) {
      this.documentsUnsubscribe();
      this.documentsUnsubscribe = null;
    }
  }
}

function dateToIso(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function dateToIsoOr(value: any, fallback: Date): string {
  try {
    if (!value) return fallback.toISOString();
    return dateToIso(value);
  } catch {
    return fallback.toISOString();
  }
}

export const documentService = new DocumentService();
