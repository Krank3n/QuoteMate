/**
 * applyStageChange — the single place that translates a target DocumentStage
 * into a legacy save (saveQuote / saveInvoice) OR a convert-to-invoice flow.
 *
 * The stage names are more granular than the legacy per-type status enums;
 * this helper does that mapping. Screens stay thin — they just wire a
 * StageSheet and call us.
 */

import type { Quote, Invoice } from '../types';
import type { Document, DocumentStage } from '../types/document';
import { documentToQuote } from '../types/documentAdapter';

export interface ApplyStageChangeHelpers {
  saveQuote: (q: Quote) => Promise<void>;
  saveInvoice: (i: Invoice) => Promise<void>;
  createInvoiceFromQuote: (q: Quote) => Promise<Invoice>;
  navigation?: { navigate: (route: string, params?: any) => void };
}

/** Map a DocumentStage to the legacy Quote['status'], if one applies. */
function stageToQuoteStatus(stage: DocumentStage): Quote['status'] | null {
  switch (stage) {
    case 'draft': return 'draft';
    case 'quote_sent': return 'sent';
    case 'quote_accepted': return 'accepted';
    case 'quote_rejected': return 'rejected';
    case 'cancelled': return 'cancelled';
    default: return null;
  }
}

/** Map a DocumentStage to the legacy Invoice['status'], if one applies. */
function stageToInvoiceStatus(stage: DocumentStage): Invoice['status'] | null {
  switch (stage) {
    case 'draft': return 'draft';
    case 'invoice_sent': return 'sent';
    case 'partially_paid': return 'partial';
    case 'paid': return 'paid';
    case 'cancelled': return 'cancelled';
    default: return null;
  }
}

export async function applyStageChange(
  doc: Document,
  target: DocumentStage,
  helpers: ApplyStageChangeHelpers,
): Promise<void> {
  // Convert-to-invoice: only meaningful on the quote side.
  if (target === 'invoice_sent' && doc.type === 'quote') {
    const quote = documentToQuote(doc);
    const invoice = await helpers.createInvoiceFromQuote(quote);
    await helpers.saveInvoice(invoice);
    // Navigate back to the Job (the single detail screen post-UX
    // collapse). The invoice inherits jobId from the quote on
    // creation — if it's missing we stay where we are and let the
    // caller decide.
    const jobId = (invoice as any).jobId ?? doc.jobId;
    if (jobId) {
      helpers.navigation?.navigate('ViewJob', { jobId });
    }
    return;
  }

  if (doc.type === 'invoice') {
    const status = stageToInvoiceStatus(target);
    if (!status) {
      console.warn(`[applyStageChange] No invoice status for stage=${target}`);
      return;
    }
    // Reconstruct an Invoice-shaped object from the doc. The adapter is the
    // canonical way but we already know the fields we need; cheaper to pull
    // them out directly and avoid dragging the adapter into this helper's
    // contract. Screens that call us already have the legacy invoice.
    const { documentToInvoice } = await import('../types/documentAdapter');
    const invoice = documentToInvoice(doc);
    await helpers.saveInvoice({ ...invoice, status, updatedAt: new Date() });
    return;
  }

  // Quote-side
  const status = stageToQuoteStatus(target);
  if (!status) {
    console.warn(`[applyStageChange] No quote status for stage=${target}`);
    return;
  }
  const quote = documentToQuote(doc);
  await helpers.saveQuote({ ...quote, status, updatedAt: new Date() });
}
