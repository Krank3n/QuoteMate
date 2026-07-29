/**
 * Customer-email body generation, shared by the send flow and the JobPreview
 * warm-up.
 *
 * Jul 2026 send audit: the tradie taps "Send Quote" — an action — and the app
 * answers with a writing task they never asked for. Generation is the same
 * work either way, so JobPreview kicks it off the moment the doc is saved and
 * the send flow just reads what's already there (`draftEmailBody`).
 *
 * The warm-up is strictly best-effort: it never blocks a screen, never
 * surfaces an error, and never fires for a doc that already carries a body.
 */

import type { BusinessSettings } from '../types';
import type { Document } from '../types/document';
import { documentToInvoice, documentToQuote } from '../types/documentAdapter';
import {
  generateInvoiceEmail,
  generateQuoteEmail,
  getDefaultEmailBody,
  getDefaultInvoiceEmailBody,
} from '../services/llmService';
import { useStore } from '../store/useStore';

export interface EmailBodySource {
  /** Written body — server round-trip, Pro / trial only. */
  generate: () => Promise<string>;
  /** Plain local template. No network, never throws. */
  fallback: () => string;
}

/**
 * The generate/fallback pair for a document, branching on type. One mapping
 * for both callers so a warmed body is byte-for-byte what the send flow
 * would have produced on tap.
 */
export function buildEmailBodySource(
  doc: Document,
  businessSettings: BusinessSettings | null,
): EmailBodySource {
  const businessName = businessSettings?.businessName || '';
  if (doc.type === 'invoice') {
    const invoice = documentToInvoice(doc);
    return {
      generate: () => generateInvoiceEmail({
        jobName: invoice.job.name,
        jobDescription: invoice.job.description || '',
        materials: invoice.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
        laborHours: invoice.laborHours,
        total: invoice.total,
        businessName,
        customerName: invoice.customerName,
        dueDate: new Date(invoice.dueDate).toISOString(),
        invoiceNumber: invoice.invoiceNumber,
        gstRegistered: invoice.gstRegistered,
      }),
      fallback: () => getDefaultInvoiceEmailBody(
        invoice.customerName,
        invoice.job.name,
        invoice.total,
        businessSettings?.businessName || 'Your Business',
        new Date(invoice.dueDate).toISOString(),
        invoice.gstRegistered,
      ),
    };
  }

  const quote = documentToQuote(doc);
  return {
    generate: () => generateQuoteEmail({
      jobName: quote.job.name,
      jobDescription: quote.job.description || '',
      materials: quote.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
      laborHours: quote.laborHours,
      total: quote.total,
      businessName,
      customerName: quote.customerName,
      gstRegistered: quote.gstRegistered,
    }),
    fallback: () => getDefaultEmailBody(
      quote.customerName,
      quote.job.name,
      quote.total,
      businessSettings?.businessName || 'Your Business',
      quote.gstRegistered,
    ),
  };
}

/**
 * Whether a background warm-up is worth firing. Skips a doc that already
 * carries a body (warmed earlier, or written on a previous send) and anything
 * that has left draft — that one already went out, and a resend reuses the
 * body persisted at the time.
 */
export function shouldWarmEmailDraft(
  doc: Pick<Document, 'id' | 'stage' | 'draftEmailBody'> | null | undefined,
): boolean {
  if (!doc?.id) return false;
  if (doc.draftEmailBody?.trim()) return false;
  return doc.stage === 'draft';
}

// One warm-up per doc at a time. JobPreview re-mounts every time the tradie
// loops out to a wizard section and back; without this each loop would fire
// another generation before the first had landed.
const warming = new Set<string>();

/**
 * Generate this doc's customer email in the background and persist it to
 * `draftEmailBody`, so the send flow opens on a finished email instead of a
 * progress spinner. Fire-and-forget — resolves quietly whatever happens.
 *
 * Free tier is deliberately skipped: those users get the local template, which
 * is instant, so there's nothing to warm and no write worth spending.
 */
export async function warmEmailDraft(
  doc: Document,
  businessSettings: BusinessSettings | null,
  opts: { isPro: boolean },
): Promise<void> {
  if (!opts.isPro) return;
  if (!shouldWarmEmailDraft(doc)) return;
  if (warming.has(doc.id)) return;

  warming.add(doc.id);
  try {
    persistWarmedBody(doc, await buildEmailBodySource(doc, businessSettings).generate());
  } catch {
    // Best effort. The send flow still generates on tap when nothing landed.
  } finally {
    warming.delete(doc.id);
  }
}

/**
 * Merge the warmed body onto the LATEST stored copy of the doc — never the
 * snapshot generation started from. The tradie keeps editing notes and the
 * reference number on JobPreview while this is in flight, and writing back a
 * stale snapshot would roll those edits back. No stored copy yet, or a body
 * that landed first, means we leave it alone.
 */
function persistWarmedBody(doc: Document, body: string): void {
  if (!body?.trim()) return;
  const state = useStore.getState();

  if (doc.type === 'invoice') {
    const latest = state.invoices.find((i) => i.id === doc.id);
    if (!latest || latest.draftEmailBody?.trim()) return;
    void state.saveInvoice({ ...latest, draftEmailBody: body }).catch(() => { /* best effort */ });
    return;
  }

  const latest = state.quotes.find((q) => q.id === doc.id);
  if (!latest || latest.draftEmailBody?.trim()) return;
  void state.saveDraft({ ...latest, draftEmailBody: body }).catch(() => { /* best effort */ });
}
