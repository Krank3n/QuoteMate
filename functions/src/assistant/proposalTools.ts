// Proposal-tool handlers. These never write — they validate the payload the
// model emitted and bundle it as a Proposal for the client to render. The
// client's applyProposal() is the only path that touches store actions.

import { generateProposalId } from './ids';

export interface BaseProposal {
  id: string;
  toolUseId: string;
  createdAt: string;
}

export interface DraftQuoteProposal extends BaseProposal {
  type: 'propose_draft_quote';
  customerId?: string;
  customerDraft?: { name: string; phone?: string; email?: string; address?: string };
  jobName: string;
  jobDescription: string;
  estimatedDurationHours?: number;
}

export interface AddLineItemProposal extends BaseProposal {
  type: 'propose_add_line_item';
  quoteId: string;
  searchTerm: string;
  qty: number;
  unit: string;
  section?: string;
}

export interface DeleteLineItemProposal extends BaseProposal {
  type: 'propose_delete_line_item';
  quoteId: string;
  materialId: string;
  displayName?: string;
  displayQty?: number;
  displayUnit?: string;
  displayTotal?: number;
}

export interface CreateContactProposal extends BaseProposal {
  type: 'propose_create_contact';
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface SendQuoteProposal extends BaseProposal {
  type: 'propose_send_quote';
  quoteId: string;
  recipientEmail?: string;
}

export interface ConvertToInvoiceProposal extends BaseProposal {
  type: 'propose_convert_to_invoice';
  quoteId: string;
}

export type Proposal =
  | DraftQuoteProposal
  | AddLineItemProposal
  | DeleteLineItemProposal
  | CreateContactProposal
  | SendQuoteProposal
  | ConvertToInvoiceProposal;

export interface ProposalResult {
  proposal?: Proposal;
  error?: string;
}

export function buildProposal(
  toolName: string,
  toolUseId: string,
  input: any,
): ProposalResult {
  const now = new Date().toISOString();
  const id = generateProposalId();

  switch (toolName) {
    case 'propose_draft_quote': {
      if (!input.jobName) return { error: 'propose_draft_quote requires jobName.' };
      if (!input.jobDescription || String(input.jobDescription).trim().length < 10) {
        return { error: 'propose_draft_quote requires a real jobDescription — the pipeline needs the scope to generate materials.' };
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
      if (!input.quoteId) return { error: 'propose_add_line_item requires quoteId.' };
      if (!input.searchTerm) return { error: 'propose_add_line_item requires searchTerm — the pipeline prices it.' };
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
      if (!input.quoteId) return { error: 'propose_delete_line_item requires quoteId.' };
      if (!input.materialId) return { error: 'propose_delete_line_item requires materialId — fetch the quote first to get it.' };
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
      if (!input.name) return { error: 'propose_create_contact requires name.' };
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
      if (!input.quoteId) return { error: 'propose_send_quote requires quoteId.' };
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
      if (!input.quoteId) return { error: 'propose_convert_to_invoice requires quoteId.' };
      const proposal: ConvertToInvoiceProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_convert_to_invoice',
        quoteId: String(input.quoteId),
      };
      return { proposal };
    }

    default:
      return { error: `Unknown proposal tool: ${toolName}` };
  }
}
