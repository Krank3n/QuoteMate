// Mate proposal-tool validators — the client-side source of truth (no
// server-side copy). These don't mutate state; they turn a tool-call payload
// into a typed Proposal that the chat surface renders as a confirmation card.
// The store's applyProposal() is the only path that touches data.

import {
  AddLineItemProposal,
  ConvertToInvoiceProposal,
  CreateContactProposal,
  DeleteLineItemProposal,
  DeleteQuoteProposal,
  DraftQuoteProposal,
  MarkPaidProposal,
  Proposal,
  RepriceQuoteProposal,
  SendQuoteProposal,
  UpdateCustomerProposal,
  UpdateQuoteRatesProposal,
} from '../../types/assistant';
import { resolveQuoteId } from './quoteRefMap';
import { sanitizeJobDescription } from '../../utils/sanitizeJobDescription';

export interface ProposalResult {
  proposal?: Proposal;
  error?: string;
}

function newProposalId(): string {
  return `prop_${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

    case 'propose_update_quote_rates': {
      if (!input?.quoteId) return { error: 'propose_update_quote_rates requires quoteId.' };
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
        quoteId: resolveQuoteId(input.quoteId),
        markup,
        laborMarkup,
        laborRate,
        laborHours,
        displayName: input.displayName ? String(input.displayName) : undefined,
      };
      return { proposal };
    }

    case 'propose_add_line_item': {
      if (!input?.quoteId) return { error: 'propose_add_line_item requires quoteId.' };
      if (!input?.searchTerm) return { error: 'propose_add_line_item requires searchTerm — the pipeline prices it.' };
      const proposal: AddLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_add_line_item',
        quoteId: resolveQuoteId(input.quoteId),
        searchTerm: String(input.searchTerm),
        qty: Number(input.qty) || 1,
        unit: String(input.unit || 'each'),
        section: input.section ? String(input.section) : undefined,
      };
      return { proposal };
    }

    case 'propose_delete_quote': {
      if (!input?.quoteId) return { error: 'propose_delete_quote requires quoteId.' };
      const docType = input.displayDocType === 'invoice' ? 'invoice' : input.displayDocType === 'quote' ? 'quote' : undefined;
      const proposal: DeleteQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_delete_quote',
        quoteId: resolveQuoteId(input.quoteId),
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCustomerName: input.displayCustomerName ? String(input.displayCustomerName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        displayDocType: docType,
      };
      return { proposal };
    }

    case 'propose_delete_line_item': {
      if (!input?.quoteId) return { error: 'propose_delete_line_item requires quoteId.' };
      if (!input?.materialId) {
        return { error: 'propose_delete_line_item requires materialId — fetch the quote first to get it.' };
      }
      const proposal: DeleteLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_delete_line_item',
        quoteId: resolveQuoteId(input.quoteId),
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
      if (!input?.quoteId) return { error: 'propose_update_customer requires quoteId.' };
      if (!input.customerId && !input.customerDraft?.name) {
        return { error: 'Provide customerId (from find_customer) or customerDraft.name.' };
      }
      const proposal: UpdateCustomerProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_customer',
        quoteId: resolveQuoteId(input.quoteId),
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
      if (!input?.quoteId) return { error: 'propose_send_quote requires quoteId.' };
      const proposal: SendQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_send_quote',
        quoteId: resolveQuoteId(input.quoteId),
        recipientEmail: input.recipientEmail ? String(input.recipientEmail) : undefined,
        draftEmailBody: input.draftEmailBody ? String(input.draftEmailBody) : undefined,
        draftEmailSubject: input.draftEmailSubject ? String(input.draftEmailSubject) : undefined,
      };
      return { proposal };
    }

    case 'propose_convert_to_invoice': {
      if (!input?.quoteId) return { error: 'propose_convert_to_invoice requires quoteId.' };
      const proposal: ConvertToInvoiceProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_convert_to_invoice',
        quoteId: resolveQuoteId(input.quoteId),
      };
      return { proposal };
    }

    case 'propose_reprice': {
      if (!input?.quoteId) return { error: 'propose_reprice requires quoteId.' };
      const proposal: RepriceQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_reprice',
        quoteId: resolveQuoteId(input.quoteId),
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
      };
      return { proposal };
    }

    case 'propose_mark_paid': {
      if (!input?.quoteId) return { error: 'propose_mark_paid requires quoteId.' };
      const allowed = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const;
      const method = allowed.includes(input.method) ? input.method : undefined;
      const proposal: MarkPaidProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_mark_paid',
        quoteId: resolveQuoteId(input.quoteId),
        method,
        notes: input.notes ? String(input.notes) : undefined,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCustomerName: input.displayCustomerName ? String(input.displayCustomerName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        displayBalance: Number.isFinite(Number(input.displayBalance)) ? Number(input.displayBalance) : undefined,
      };
      return { proposal };
    }

    default:
      return { error: `Unknown proposal tool: ${toolName}` };
  }
}
