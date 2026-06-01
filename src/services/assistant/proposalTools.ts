// Mate proposal-tool validators — client-side mirror of
// functions/src/assistant/proposalTools.ts. These don't mutate state; they
// turn a tool-call payload into a typed Proposal that the chat surface
// renders as a confirmation card. The store's applyProposal() is the only
// path that touches data.

import {
  AddLineItemProposal,
  ConvertToInvoiceProposal,
  CreateContactProposal,
  DeleteLineItemProposal,
  DraftQuoteProposal,
  Proposal,
  RepriceQuoteProposal,
  SendQuoteProposal,
} from '../../types/assistant';

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
        jobDescription: String(input.jobDescription).trim(),
        estimatedDurationHours:
          Number.isFinite(Number(input.estimatedDurationHours)) && Number(input.estimatedDurationHours) > 0
            ? Number(input.estimatedDurationHours)
            : undefined,
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
        quoteId: String(input.quoteId),
        searchTerm: String(input.searchTerm),
        qty: Number(input.qty) || 1,
        unit: String(input.unit || 'each'),
        section: input.section ? String(input.section) : undefined,
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
        quoteId: String(input.quoteId),
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

    case 'propose_send_quote': {
      if (!input?.quoteId) return { error: 'propose_send_quote requires quoteId.' };
      const proposal: SendQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_send_quote',
        quoteId: String(input.quoteId),
        recipientEmail: input.recipientEmail ? String(input.recipientEmail) : undefined,
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
        quoteId: String(input.quoteId),
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
        quoteId: String(input.quoteId),
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
      };
      return { proposal };
    }

    default:
      return { error: `Unknown proposal tool: ${toolName}` };
  }
}
