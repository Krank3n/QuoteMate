// Mate proposal-tool validators — the client-side source of truth (no
// server-side copy). These don't mutate state; they turn a tool-call payload
// into a typed Proposal that the chat surface renders as a confirmation card.
// The store's applyProposal() is the only path that touches data.

import {
  AddLineItemProposal,
  ConvertToInvoiceProposal,
  CreateContactProposal,
  DeleteLineItemProposal,
  UpdateLineItemProposal,
  DeleteQuoteProposal,
  DraftQuoteProposal,
  ImportSupplierListProposal,
  MarkPaidProposal,
  Proposal,
  RepriceQuoteProposal,
  SendQuoteProposal,
  UpdateCustomerProposal,
  UpdateQuoteRatesProposal,
  UpdateQuoteScopeProposal,
} from '../../types/assistant';
import { resolveQuoteId } from './quoteRefMap';
import { resolveKnownQuoteId } from './showQuoteGate';
import { isPricingInFlight } from './pricingInFlight';
import { sanitizeJobDescription } from '../../utils/sanitizeJobDescription';

export interface ProposalResult {
  proposal?: Proposal;
  error?: string;
}

function newProposalId(): string {
  return `prop_${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// A quote-targeting proposal must name a quote that actually exists on this
// device, or the card it renders can only fail on Apply — after the model has
// already promised the change out loud. The birdhouse convo (25 Aug 2026) had
// the model INVENT "quote_pending_<ts>" for a draft nobody had applied, then
// spend six turns telling the tradie to fix it manually. Failing the tool
// call in-turn hands the model its recovery path instead. Uses the same
// screen-registered lookup as show_quote; no probe registered (tests, screen
// unmounted) keeps the old pass-through.
function requireKnownQuote(toolName: string, input: any): { quoteId?: string; error?: string } {
  if (!input?.quoteId) return { error: `${toolName} requires quoteId.` };
  const resolved = resolveQuoteId(String(input.quoteId));
  const known = resolveKnownQuoteId(resolved);
  if (known) return { quoteId: known };
  return {
    error:
      `No quote with id "${resolved}" exists on this phone — never invent a quoteId. ` +
      'If the draft card has not been applied yet there is no quote to change: call propose_draft_quote again with the corrected details and the fresh card replaces the old one. ' +
      'For a saved quote, call list_recent_quotes and use the id it returns.',
  };
}

// Whether the chat still holds a photo nobody has spent. Registered by the
// screen rather than imported, same pattern as quoteRefMap — the validator
// must stay free of the store graph, and Mate never names an attachment id.
let unconsumedAttachmentProbe: () => boolean = () => false;

export function setUnconsumedAttachmentProbe(probe: () => boolean): void {
  unconsumedAttachmentProbe = probe;
}

const IMPORT_SOURCES = ['attachment', 'camera', 'gallery', 'pdf', 'spreadsheet', 'ask'] as const;
const IMPORT_REASONS = ['no_retail_coverage', 'pricing_fell_back', 'tradie_asked'] as const;
const MAX_MISSED_ITEMS = 5;

export function buildProposal(toolName: string, toolUseId: string, input: any): ProposalResult {
  const now = new Date().toISOString();
  const id = newProposalId();

  switch (toolName) {
    case 'propose_draft_quote': {
      if (!input?.jobName) return { error: 'propose_draft_quote requires jobName.' };
      if (!input?.jobDescription || String(input.jobDescription).trim().length < 10) {
        return {
          error:
            'propose_draft_quote requires a real jobDescription — the pipeline needs the scope to generate materials.',
        };
      }
      if (!input.customerId && !input.customerDraft?.name) {
        return { error: 'Provide customerId (from find_customer) or customerDraft.name.' };
      }
      const proposal: DraftQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_draft_quote',
        customerId: input.customerId,
        customerDraft: input.customerDraft,
        jobName: String(input.jobName),
        // The description prints on the customer's quote — strip any Mate
        // conversation the model concatenated onto the scope ("what's their
        // name and phone number… customer name is tarik", QU-178342).
        jobDescription: sanitizeJobDescription(String(input.jobDescription)).text,
        estimatedDurationHours:
          Number.isFinite(Number(input.estimatedDurationHours)) && Number(input.estimatedDurationHours) > 0
            ? Number(input.estimatedDurationHours)
            : undefined,
        documentType: input.documentType === 'invoice' ? 'invoice' : 'quote',
      };
      return { proposal };
    }

    case 'propose_update_quote_scope': {
      const known = requireKnownQuote('propose_update_quote_scope', input);
      if (known.error) return { error: known.error };
      const jobName = typeof input.jobName === 'string' && input.jobName.trim() ? String(input.jobName).trim() : undefined;
      const rawDescription = typeof input.jobDescription === 'string' ? String(input.jobDescription) : '';
      const jobDescription = rawDescription.trim() ? sanitizeJobDescription(rawDescription).text : undefined;
      if (rawDescription.trim() && (!jobDescription || jobDescription.trim().length < 10)) {
        return {
          error:
            'propose_update_quote_scope needs the FULL corrected jobDescription — the pipeline regenerates the materials from it.',
        };
      }
      const hours =
        Number.isFinite(Number(input.estimatedDurationHours)) && Number(input.estimatedDurationHours) > 0
          ? Number(input.estimatedDurationHours)
          : undefined;
      if (jobName === undefined && jobDescription === undefined && hours === undefined) {
        return { error: 'propose_update_quote_scope needs at least one of jobName, jobDescription or estimatedDurationHours.' };
      }
      // Two pipelines on one quote would race each other's saves. Refuse
      // in-turn so Mate tells the tradie it'll fold the change in once pricing
      // lands, then proposes it after the "[context]" line says it finished.
      if (isPricingInFlight(known.quoteId!)) {
        return {
          error:
            `Quote ${known.quoteId} is still being priced. Tell the tradie you'll fold the change in once pricing lands (one short line), and call propose_update_quote_scope only after the "[context]" line says pricing finished.`,
        };
      }
      const proposal: UpdateQuoteScopeProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_quote_scope',
        quoteId: known.quoteId!,
        jobName,
        jobDescription,
        estimatedDurationHours: hours,
        displayName: input.displayName ? String(input.displayName) : undefined,
      };
      return { proposal };
    }

    case 'propose_update_quote_rates': {
      const known = requireKnownQuote('propose_update_quote_rates', input);
      if (known.error) return { error: known.error };
      const num = (v: unknown): number | undefined =>
        Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
      const markup = num(input.markup);
      const laborMarkup = num(input.laborMarkup);
      const laborRate = num(input.laborRate);
      const laborHours = num(input.laborHours);
      if (
        markup === undefined &&
        laborMarkup === undefined &&
        laborRate === undefined &&
        laborHours === undefined
      ) {
        return { error: 'Provide at least one of markup, laborMarkup, laborRate, or laborHours.' };
      }
      const proposal: UpdateQuoteRatesProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_quote_rates',
        quoteId: known.quoteId!,
        markup,
        laborMarkup,
        laborRate,
        laborHours,
        displayName: input.displayName ? String(input.displayName) : undefined,
      };
      return { proposal };
    }

    case 'propose_add_line_item': {
      const known = requireKnownQuote('propose_add_line_item', input);
      if (known.error) return { error: known.error };
      if (!input?.searchTerm) return { error: 'propose_add_line_item requires searchTerm — the pipeline prices it.' };
      const proposal: AddLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_add_line_item',
        quoteId: known.quoteId!,
        searchTerm: String(input.searchTerm),
        qty: Number(input.qty) || 1,
        unit: String(input.unit || 'each'),
        section: input.section ? String(input.section) : undefined,
      };
      return { proposal };
    }

    case 'propose_delete_quote': {
      const known = requireKnownQuote('propose_delete_quote', input);
      if (known.error) return { error: known.error };
      const docType = input.displayDocType === 'invoice' ? 'invoice' : input.displayDocType === 'quote' ? 'quote' : undefined;
      const proposal: DeleteQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_delete_quote',
        quoteId: known.quoteId!,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCustomerName: input.displayCustomerName ? String(input.displayCustomerName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        displayDocType: docType,
      };
      return { proposal };
    }

    case 'propose_update_line_item': {
      const known = requireKnownQuote('propose_update_line_item', input);
      if (known.error) return { error: known.error };
      if (!input?.materialId) {
        return { error: 'propose_update_line_item requires materialId — call get_quote first to get it.' };
      }
      const price = Number(input.price);
      const quantity = Number(input.quantity);
      const hasPrice = input.price !== undefined && Number.isFinite(price);
      const hasQty = input.quantity !== undefined && Number.isFinite(quantity);
      const hasName = typeof input.name === 'string' && input.name.trim().length > 0;
      if (!hasPrice && !hasQty && !hasName) {
        return { error: 'propose_update_line_item needs at least one of price, quantity or name to change.' };
      }
      // A negative price or quantity is never what the tradie meant, and both
      // flow straight into the customer-facing total.
      if (hasPrice && price < 0) return { error: 'Price cannot be negative.' };
      if (hasQty && quantity <= 0) {
        return { error: 'Quantity must be above zero — to take the line off, use propose_delete_line_item.' };
      }
      const proposal: UpdateLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_line_item',
        quoteId: known.quoteId!,
        materialId: String(input.materialId),
        ...(hasPrice ? { price } : {}),
        ...(hasQty ? { quantity } : {}),
        ...(hasName ? { name: String(input.name).trim() } : {}),
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCurrentPrice: Number.isFinite(Number(input.displayCurrentPrice)) ? Number(input.displayCurrentPrice) : undefined,
        displayCurrentQty: Number.isFinite(Number(input.displayCurrentQty)) ? Number(input.displayCurrentQty) : undefined,
        displayUnit: input.displayUnit ? String(input.displayUnit) : undefined,
      };
      return { proposal };
    }

    case 'propose_delete_line_item': {
      const known = requireKnownQuote('propose_delete_line_item', input);
      if (known.error) return { error: known.error };
      if (!input?.materialId) {
        return { error: 'propose_delete_line_item requires materialId — fetch the quote first to get it.' };
      }
      const proposal: DeleteLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_delete_line_item',
        quoteId: known.quoteId!,
        materialId: String(input.materialId),
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayQty: Number.isFinite(Number(input.displayQty)) ? Number(input.displayQty) : undefined,
        displayUnit: input.displayUnit ? String(input.displayUnit) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
      };
      return { proposal };
    }

    case 'propose_create_contact': {
      if (!input?.name) return { error: 'propose_create_contact requires name.' };
      const proposal: CreateContactProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_create_contact',
        name: String(input.name),
        phone: input.phone ? String(input.phone) : undefined,
        email: input.email ? String(input.email) : undefined,
        address: input.address ? String(input.address) : undefined,
      };
      return { proposal };
    }

    case 'propose_update_customer': {
      const known = requireKnownQuote('propose_update_customer', input);
      if (known.error) return { error: known.error };
      if (!input.customerId && !input.customerDraft?.name) {
        return { error: 'Provide customerId (from find_customer) or customerDraft.name.' };
      }
      const proposal: UpdateCustomerProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_customer',
        quoteId: known.quoteId!,
        customerId: input.customerId ? String(input.customerId) : undefined,
        customerDraft: input.customerDraft?.name ? input.customerDraft : undefined,
        customerName: input.customerName
          ? String(input.customerName)
          : input.customerDraft?.name
            ? String(input.customerDraft.name)
            : undefined,
      };
      return { proposal };
    }

    case 'propose_send_quote': {
      const known = requireKnownQuote('propose_send_quote', input);
      if (known.error) return { error: known.error };
      const proposal: SendQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_send_quote',
        quoteId: known.quoteId!,
        recipientEmail: input.recipientEmail ? String(input.recipientEmail) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        draftEmailBody: input.draftEmailBody ? String(input.draftEmailBody) : undefined,
        draftEmailSubject: input.draftEmailSubject ? String(input.draftEmailSubject) : undefined,
      };
      return { proposal };
    }

    case 'propose_convert_to_invoice': {
      const known = requireKnownQuote('propose_convert_to_invoice', input);
      if (known.error) return { error: known.error };
      const proposal: ConvertToInvoiceProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_convert_to_invoice',
        quoteId: known.quoteId!,
      };
      return { proposal };
    }

    case 'propose_reprice': {
      const known = requireKnownQuote('propose_reprice', input);
      if (known.error) return { error: known.error };
      const proposal: RepriceQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_reprice',
        quoteId: known.quoteId!,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
      };
      return { proposal };
    }

    case 'propose_mark_paid': {
      const known = requireKnownQuote('propose_mark_paid', input);
      if (known.error) return { error: known.error };
      const allowed = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const;
      const method = allowed.includes(input.method) ? input.method : undefined;
      const proposal: MarkPaidProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_mark_paid',
        quoteId: known.quoteId!,
        method,
        notes: input.notes ? String(input.notes) : undefined,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCustomerName: input.displayCustomerName ? String(input.displayCustomerName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        displayBalance: Number.isFinite(Number(input.displayBalance)) ? Number(input.displayBalance) : undefined,
      };
      return { proposal };
    }

    case 'propose_import_supplier_list': {
      // Never errors. This card exists to unblock a tradie whose prices are
      // wrong; refusing it over a bad enum would be the worst possible moment
      // to be pedantic, so every field falls back to something usable.
      let source = (IMPORT_SOURCES as readonly string[]).includes(input?.source)
        ? (input.source as ImportSupplierListProposal['source'])
        : 'ask';
      // Mate can't see whether the photo it's thinking of is still going
      // spare — downgrade rather than open a picker that finds nothing.
      if (source === 'attachment' && !unconsumedAttachmentProbe()) source = 'ask';
      const missedItems = Array.isArray(input?.missedItems)
        ? input.missedItems
            .map((i: unknown) => String(i ?? '').trim())
            .filter(Boolean)
            .slice(0, MAX_MISSED_ITEMS)
        : undefined;
      const proposal: ImportSupplierListProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_import_supplier_list',
        supplierName: input?.supplierName ? String(input.supplierName).trim() || undefined : undefined,
        source,
        reason: (IMPORT_REASONS as readonly string[]).includes(input?.reason)
          ? (input.reason as ImportSupplierListProposal['reason'])
          : undefined,
        missedItems: missedItems?.length ? missedItems : undefined,
      };
      return { proposal };
    }

    default:
      return { error: `Unknown proposal tool: ${toolName}` };
  }
}
