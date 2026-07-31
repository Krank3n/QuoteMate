/**
 * Customer-email body generation, shared by the send flow and the JobPreview
 * warm-up.
 *
 * Jul 2026 send audit: the tradie taps "Send Quote" — an action — and the app
 * answers with a writing task they never asked for. Generation is the same
 * work either way, so JobPreview kicks it off the moment the doc is saved and
 * the send flow reads what's already there.
 *
 * The warmed body is held in memory here rather than written straight to
 * `draftEmailBody`, deliberately:
 *   - `saveDraft` replaces `currentQuote`, the wizard's live editing buffer.
 *     A background write landing while the tradie is in MaterialsList would
 *     revert their unsaved line-item edits AND reset that screen's dirty
 *     check, so nothing would even prompt on the way out.
 *   - `draftEmailBody` only reaches the unified Document the send flow is
 *     handed after a Firestore round-trip through the server-side mirror, so
 *     a body written here often wouldn't be visible in time anyway.
 * It gets persisted the moment the send flow uses it, on the tradie's own
 * tap — the same write the on-tap path has always done.
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

/** The identity a warmed body is filed under. */
export type WarmTarget = Pick<Document, 'id' | 'type'>;

/**
 * Cache key — type as well as id, and the type half is load-bearing.
 * `convertQuoteToInvoice` is a server-side flip performed IN PLACE: it loads
 * the document, sets type to 'invoice', and writes it back under the SAME id
 * (functions/src/documentHandlers.ts). Keyed on id alone, a quote body warmed
 * before the convert was handed straight to the invoice send afterwards — the
 * customer received an invoice reading "Please find attached your quotation…
 * valid for 30 days" instead of an amount due and a due date.
 */
function cacheKey(doc: WarmTarget): string {
  return `${doc.type}:${doc.id}`;
}

// Bodies ready to use, and the generations still running, keyed by cacheKey.
// Session-scoped: a warm body is worth minutes, not days, and the persisted
// draftEmailBody covers anything longer.
const warmedBodies = new Map<string, string>();
const inFlight = new Map<string, Promise<void>>();

// A tradie churns through a handful of docs per session; this only exists so
// a very long session can't grow the map without bound.
const MAX_WARMED = 20;

/** The warmed body for this doc, ready right now. */
export function getWarmedEmailBody(doc: WarmTarget): string | undefined {
  return warmedBodies.get(cacheKey(doc));
}

/**
 * The in-flight warm-up for this doc, if one is still running. The send flow
 * awaits it rather than starting a second generation — tapping Send while the
 * warm-up is still going is the common case, not an edge one.
 */
export function whenEmailDraftWarm(doc: WarmTarget): Promise<void> | undefined {
  return inFlight.get(cacheKey(doc));
}

/** Test seam — the caches above are module state by design. */
export function resetWarmedEmailDrafts(): void {
  warmedBodies.clear();
  inFlight.clear();
}

/**
 * Generate this doc's customer email in the background so the send flow opens
 * on a finished email instead of a progress spinner. Fire-and-forget —
 * resolves quietly whatever happens, and never touches the store.
 *
 * Free tier is deliberately skipped: those users get the local template,
 * which is instant, so there's nothing to warm.
 */
export async function warmEmailDraft(
  doc: Document,
  businessSettings: BusinessSettings | null,
  opts: { isPro: boolean },
): Promise<void> {
  if (!opts.isPro) return;
  if (!shouldWarmEmailDraft(doc)) return;
  // JobPreview re-mounts every time the tradie loops out to a wizard section
  // and back; without this each loop would fire another generation.
  const key = cacheKey(doc);
  if (warmedBodies.has(key) || inFlight.has(key)) return;

  const run = (async () => {
    try {
      const source = buildEmailBodySource(doc, businessSettings);
      const body = await source.generate();
      // generateQuoteEmail / generateInvoiceEmail never reject — on a network
      // or server failure they return the plain template. Caching that would
      // hand a Pro tradie the generic email for good, since every later path
      // reads "a body exists" as "nothing to generate". Leave it uncached so
      // the send flow gets its own go.
      if (!body?.trim() || body === source.fallback()) return;
      if (warmedBodies.size >= MAX_WARMED) {
        const oldest = warmedBodies.keys().next().value;
        if (oldest !== undefined) warmedBodies.delete(oldest);
      }
      warmedBodies.set(key, body);
    } catch {
      // Best effort. The send flow still generates on tap when nothing landed.
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, run);
  await run;
}
