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
  getDocs,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';

function getUserId(): string | null {
  return auth.currentUser?.uid || null;
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
  return out as Document;
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

  /** Subscribe to document changes in real-time. */
  listenToDocuments(callback: (documents: Document[]) => void): Unsubscribe | null {
    const userId = getUserId();
    if (!userId) return null;
    try {
      const ref = collection(db, 'users', userId, 'documents');
      const q = query(ref, orderBy('createdAt', 'desc'));
      this.documentsUnsubscribe = onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map((d) => normaliseDocument(d.data(), d.id));
        callback(docs);
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
  async saveDocument(document: Document): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    const docRef = doc(db, 'users', userId, 'documents', document.id);
    const payload = stripUndefined({
      ...document,
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
