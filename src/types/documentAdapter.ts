/**
 * Strongly-typed wrappers around the canonical adapter in
 * `shared/document/adapter.ts`. The shared adapter operates on loose record
 * shapes so it can be reused by Cloud Functions; here we narrow the IO back
 * down to the client's typed Quote / Invoice / Document.
 */

import type { Invoice, Quote } from './index';
import type { Document, DocumentType } from './document';
import {
  quoteRecordToDocumentRecord,
  invoiceRecordToDocumentRecord,
  documentRecordToQuoteRecord,
  documentRecordToInvoiceRecord,
  deriveStage as deriveStageShared,
} from '../../shared/document/adapter';

export function deriveStage(
  source: Quote | Invoice,
  type: DocumentType,
) {
  return deriveStageShared(source as any, type);
}

export function quoteToDocument(quote: Quote): Document {
  return quoteRecordToDocumentRecord(quote as any, quote.id) as unknown as Document;
}

export function invoiceToDocument(invoice: Invoice): Document {
  return invoiceRecordToDocumentRecord(invoice as any, invoice.id) as unknown as Document;
}

export function documentToQuote(doc: Document): Quote {
  return documentRecordToQuoteRecord(doc as any) as unknown as Quote;
}

export function documentToInvoice(doc: Document): Invoice {
  return documentRecordToInvoiceRecord(doc as any) as unknown as Invoice;
}
