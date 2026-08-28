/**
 * applyStageChange — the single place that translates a target DocumentStage
 * into a legacy save (saveQuote / saveInvoice) OR a convert-to-invoice flow.
 *
 * The stage names are more granular than the legacy per-type status enums;
 * this helper does that mapping. Screens stay thin — they just wire a
 * StageSheet and call us.
 */

import type { Quote, Invoice } from '../types';
import type { Document, DocumentStage, SendMethod } from '../types/document';
import { documentToQuote } from '../types/documentAdapter';
import { isStageDowngrade } from '../../shared/document/stage';

export interface ApplyStageChangeHelpers {
  saveQuote: (q: Quote) => Promise<void>;
  saveInvoice: (i: Invoice) => Promise<void>;
  createInvoiceFromQuote: (q: Quote) => Promise<Invoice>;
  navigation?: { navigate: (route: string, params?: any) => void };
  /**
   * Really remove fields from the stored quote + document
   * (documentService.clearDocumentFields). saveQuote merges and omits
   * undefined, so a field can only be retired by an explicit delete — see
   * the re-pitch reset below. Optional: only the send paths supply it, and
   * only a re-pitch ever needs it.
   */
  clearQuoteFields?: (documentId: string, fields: string[]) => Promise<void>;
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
  sendMethod: SendMethod = 'manual',
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
    // First-send audit: stamp sentAt + sendMethod the first time an invoice
    // actually leaves draft. Never overwrite an existing sentAt.
    const firstSend = target === 'invoice_sent' && !doc.sentAt
      ? { sentAt: Date.now(), sendMethod }
      : {};
    await helpers.saveInvoice({ ...invoice, status, updatedAt: new Date(), ...firstSend });
    return;
  }

  // Quote-side
  const status = stageToQuoteStatus(target);
  if (!status) {
    console.warn(`[applyStageChange] No quote status for stage=${target}`);
    return;
  }
  const quote = documentToQuote(doc);
  // First-send audit: stamp sentAt + sendMethod the first time a quote
  // actually leaves draft. Never overwrite an existing sentAt.
  const firstSend = target === 'quote_sent' && !doc.sentAt
    ? { sentAt: Date.now(), sendMethod }
    : {};
  // Re-pitch (quote_rejected → quote_sent): retire the old answer, because
  // respondedAt is what locks an acceptance token — carry one out of a
  // rejection and the customer's new link opens on "already responded to".
  //
  // This is the moment to do it. It's the same write that flips the stage, so
  // the reset can't happen for a send that was abandoned half way. The email
  // path does the equivalent server-side inside sendDocumentEmail; every
  // client-side channel (SMS, Share, Export, "Mark as sent") arrives here via
  // markDocumentSent.
  //
  // clientNotes stays: it's the tradie's record of why they said no.
  const isRepitch = target === 'quote_sent' && doc.stage === 'quote_rejected';
  const repitchReset = isRepitch ? { respondedAt: undefined, respondedBy: undefined } : {};
  await helpers.saveQuote({ ...quote, status, updatedAt: new Date(), ...firstSend, ...repitchReset });
  // ...and undefined is not enough on its own. saveQuote strips undefined and
  // writes with merge:true, so an omitted key leaves the STORED value exactly
  // where it was — the field has to be deleted explicitly or the customer's
  // fresh link is still locked. Same trap documentService.clearDocumentFields
  // was written for. Best-effort: the stage move is the important half.
  if (isRepitch && helpers.clearQuoteFields) {
    await helpers.clearQuoteFields(doc.id, ['respondedAt', 'respondedBy']).catch(() => {});
  }
}

/**
 * Record that a document was delivered through a non-email channel (SMS,
 * Share, Export PDF). Moves the doc into its sent stage and stamps the
 * first-send audit fields via applyStageChange. No-op when the doc is already
 * in (or past) its sent stage, so a re-share never rewrites the original
 * first-send timestamp or drags an accepted/paid doc backwards.
 */
export async function markDocumentSent(
  doc: Document,
  sendMethod: SendMethod,
  helpers: ApplyStageChangeHelpers,
): Promise<void> {
  const target: DocumentStage = doc.type === 'invoice' ? 'invoice_sent' : 'quote_sent';
  if (doc.stage === target || isStageDowngrade(doc.stage, target)) return;
  await applyStageChange(doc, target, helpers, sendMethod);
}
