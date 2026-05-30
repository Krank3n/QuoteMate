// Shared types for the Mate assistant chat surface. Mirrors the function-side
// Proposal union (see functions/src/assistant/proposalTools.ts) — changes to
// either side must be reflected here.

export type ProposalType =
  | 'propose_draft_quote'
  | 'propose_add_line_item'
  | 'propose_delete_line_item'
  | 'propose_create_contact'
  | 'propose_send_quote'
  | 'propose_convert_to_invoice';

export interface BaseProposal {
  id: string;
  toolUseId: string;
  createdAt: string;
  type: ProposalType;
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

export type ProposalStatus = 'pending' | 'applied' | 'dismissed' | 'failed';

export interface WorkingStatus {
  /** Pipeline phase identifier — drives icon + style. */
  phase: 'preflight' | 'analyzing' | 'building' | 'pricing' | 'done' | 'failed';
  /** Single short line — what's happening right now. */
  status: string;
  /** Optional secondary line — e.g. names of items being processed. */
  detail?: string;
  /** When true, the spinner stops and the card renders the final state. */
  done: boolean;
  /** Final summary text shown when done. */
  summary?: string;
}

export type ChatMessageCtaAction =
  | { type: 'open_quote'; quoteId: string };

export interface ChatMessageCta {
  label: string;
  action: ChatMessageCtaAction;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  // Proposals emitted by the assistant on this turn — rendered as inline cards
  // beneath the message bubble. Each proposal carries its own apply state so the
  // bubble doesn't have to swap when one card is applied.
  proposals?: Proposal[];
  proposalStatus?: Record<string, ProposalStatus>;
  // Set when the assistant call failed; UI renders the message in muted red.
  errorMessage?: string;
  // When present, the message renders as a live "working" card that the
  // chat updates as pipeline events arrive. Used for analyse + pricing
  // progress so the user sees what's happening without leaving chat.
  working?: WorkingStatus;
  // Optional CTA rendered below the text. Used after pipeline completion to
  // offer "View quote" — keeps the user in chat unless they tap.
  cta?: ChatMessageCta;
  // When set, the bubble renders an inline JobScopeCard for this quote so the
  // tradie can review the priced draft (and keep chatting to adjust) without
  // bouncing out to the wizard.
  inlineQuoteId?: string;
}

export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface AssistantChatResponse {
  messageId: string;
  text: string;
  proposals: Proposal[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
    escalated: boolean;
  };
}
